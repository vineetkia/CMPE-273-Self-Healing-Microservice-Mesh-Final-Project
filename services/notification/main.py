import os
import time
import threading
import grpc
from prometheus_client import Counter, start_http_server

import mesh_pb2 as pb
import mesh_pb2_grpc as pb_grpc

from shared.logging import get_logger
from shared.discovery import register
from shared.telemetry import init_tracing, publish_event_sync
from shared.failure_modes import FailureState
from shared.chaos_listener import start as start_chaos_listener
from shared.grpc_server import serve

log = get_logger("notification")

REQS = Counter("notification_requests_total", "notification requests", ["method", "result"])
SERVICE = "notification"
state = FailureState()


class NotificationServicer(pb_grpc.NotificationServiceServicer):
    def Notify(self, request, context):
        t0 = time.time()
        if state.apply() == "error":
            REQS.labels("notify", "err").inc()
            publish_event_sync("mesh.events", {
                "type": "rpc", "service": SERVICE, "method": "Notify",
                "ok": False, "latency_ms": int((time.time() - t0) * 1000),
            })
            context.set_code(grpc.StatusCode.UNAVAILABLE)
            context.set_details("notify failure injected")
            return pb.NotifyReply(ok=False)
        log.info(f"notify user={request.user} msg={request.message}")
        REQS.labels("notify", "ok").inc()
        publish_event_sync("mesh.events", {
            "type": "rpc", "service": SERVICE, "method": "Notify",
            "ok": True, "latency_ms": int((time.time() - t0) * 1000),
        })
        return pb.NotifyReply(ok=True)

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

    def _wire(server):
        pb_grpc.add_NotificationServiceServicer_to_server(NotificationServicer(), server)

    serve(_wire, port, SERVICE)


if __name__ == "__main__":
    main()
