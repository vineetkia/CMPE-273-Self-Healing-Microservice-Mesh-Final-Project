import os
import time
import uuid
import asyncio
import json
import threading
from collections import deque
import grpc
import nats
from prometheus_client import Counter, start_http_server

import mesh_pb2 as pb
import mesh_pb2_grpc as pb_grpc

from shared.logging import get_logger
from shared.discovery import register
from shared.telemetry import init_tracing, publish_event_sync, elapsed_ms
from shared.failure_modes import FailureState
from shared.chaos_listener import start as start_chaos_listener
from shared.grpc_server import serve

log = get_logger("notification")

REQS = Counter("notification_requests_total", "notification requests", ["method", "result"])
SERVICE = "notification"
state = FailureState()

# Per-user notification deque (max 50 each). Keyed by user id.
_NOTIFS: dict[str, deque] = {}
_NOTIFS_LOCK = threading.Lock()


def _push(user: str, message: str, kind: str = "info") -> dict:
    with _NOTIFS_LOCK:
        if user not in _NOTIFS:
            _NOTIFS[user] = deque(maxlen=50)
        n = {
            "id": f"n-{uuid.uuid4().hex[:10]}",
            "user": user,
            "message": message,
            "kind": kind,
            "ts_ms": int(time.time() * 1000),
            "read": False,
        }
        _NOTIFS[user].appendleft(n)
        return n


def _unread_count(user: str) -> int:
    with _NOTIFS_LOCK:
        q = _NOTIFS.get(user)
        if not q:
            return 0
        return sum(1 for n in q if not n["read"])


# ============== NATS subscriber: fan-out incidents to "ops" ==============
async def _subscribe_agent_actions():
    """Subscribe to agent actions and push them as incident notifications
    addressed to the 'ops' user. The dashboard's logged-in user reads from
    its own queue plus, optionally, the 'ops' shared queue."""
    url = os.getenv("NATS_URL", "nats://nats:4222")
    while True:
        try:
            nc = await nats.connect(url, max_reconnect_attempts=-1)
            log.info("notification listener connected to nats")

            async def cb(msg):
                try:
                    payload = json.loads(msg.data.decode())
                except Exception:
                    return
                if payload.get("type") != "agent_action":
                    return
                root = payload.get("root_cause") or "unknown"
                source = payload.get("source") or "rules"
                actions = payload.get("actions") or []
                verb_summary = ", ".join(f"{a.get('action')} on {a.get('service')}" for a in actions[:3])
                _push(
                    "ops",
                    f"Agent acted on {root} via {source}: {verb_summary}",
                    kind="incident",
                )

            await nc.subscribe("mesh.events", cb=cb)
            while nc.is_connected:
                await asyncio.sleep(1.0)
        except Exception as e:
            log.warning(f"notification listener error: {e}")
            await asyncio.sleep(2.0)


def _start_listener():
    def _run():
        asyncio.run(_subscribe_agent_actions())
    threading.Thread(target=_run, daemon=True).start()


class NotificationServicer(pb_grpc.NotificationServiceServicer):
    def Notify(self, request, context):
        t0 = time.time()
        if state.apply() == "error":
            REQS.labels("notify", "err").inc()
            publish_event_sync("mesh.events", {
                "type": "rpc", "service": SERVICE, "method": "Notify",
                "ok": False, "latency_ms": elapsed_ms(t0),
            })
            context.set_code(grpc.StatusCode.UNAVAILABLE)
            context.set_details("notify failure injected")
            return pb.NotifyReply(ok=False)
        log.info(f"notify user={request.user} msg={request.message}")
        # Persist for the user's notification list.
        kind = "info"
        msg = request.message or ""
        if "shipped" in msg.lower() or "placed" in msg.lower():
            kind = "info"
        elif "refund" in msg.lower():
            kind = "info"
        elif "held" in msg.lower() or "review" in msg.lower():
            kind = "warning"
        _push(request.user, msg, kind=kind)
        REQS.labels("notify", "ok").inc()
        publish_event_sync("mesh.events", {
            "type": "rpc", "service": SERVICE, "method": "Notify",
            "ok": True, "latency_ms": elapsed_ms(t0),
        })
        return pb.NotifyReply(ok=True)

    def List(self, request, context):
        with _NOTIFS_LOCK:
            user_q = list(_NOTIFS.get(request.user, []))
            ops_q = list(_NOTIFS.get("ops", [])) if request.user != "ops" else []
        merged = sorted(user_q + ops_q, key=lambda n: n["ts_ms"], reverse=True)
        limit = max(1, min(100, request.limit or 30))
        merged = merged[:limit]
        unread = sum(1 for n in merged if not n["read"])
        items = [
            pb.Notification(
                id=n["id"], user=n["user"], message=n["message"],
                kind=n["kind"], ts_ms=n["ts_ms"], read=n["read"],
            ) for n in merged
        ]
        REQS.labels("list", "ok").inc()
        return pb.ListNotificationsReply(ok=True, unread=unread, items=items)

    def MarkRead(self, request, context):
        with _NOTIFS_LOCK:
            for source_user in (request.user, "ops"):
                q = _NOTIFS.get(source_user)
                if not q: continue
                for n in q:
                    if n["id"] == request.notification_id:
                        n["read"] = True
        unread = _unread_count(request.user) + (
            _unread_count("ops") if request.user != "ops" else 0
        )
        REQS.labels("mark_read", "ok").inc()
        return pb.MarkReadReply(ok=True, unread=unread)

    def MarkAllRead(self, request, context):
        with _NOTIFS_LOCK:
            for source_user in (request.user, "ops"):
                q = _NOTIFS.get(source_user)
                if not q: continue
                for n in q:
                    n["read"] = True
        REQS.labels("mark_all_read", "ok").inc()
        return pb.MarkAllReadReply(ok=True)

    def Health(self, request, context):
        status = state.health
        if state.active() and state.mode in ("errors", "grey"):
            status = "degraded"
        if state.active() and state.mode == "latency" and state.latency_ms >= 600:
            status = "degraded"
        return pb.HealthReply(service=SERVICE, status=status, ts_ms=int(time.time()*1000))

    def Control(self, request, context):
        action = request.action
        if action == "clear_failure":
            state.clear()
        elif action == "mark_degraded":
            state.health = "degraded"
        elif action == "enable_fallback":
            state.fallback_enabled = True
        elif action == "disable_fallback":
            state.fallback_enabled = False
        else:
            return pb.ControlReply(ok=False, message=f"unknown action {action}")
        return pb.ControlReply(ok=True, message=f"applied {action}")


def main():
    os.environ.setdefault("SERVICE_NAME", SERVICE)
    init_tracing(SERVICE)
    port = int(os.getenv("PORT", "50054"))
    metrics_port = int(os.getenv("METRICS_PORT", "9104"))
    threading.Thread(target=start_http_server, args=(metrics_port,), daemon=True).start()
    register(SERVICE, f"{SERVICE}:{port}")
    start_chaos_listener(SERVICE, state)
    _start_listener()

    def _wire(server):
        pb_grpc.add_NotificationServiceServicer_to_server(NotificationServicer(), server)

    serve(_wire, port, SERVICE)


if __name__ == "__main__":
    main()
