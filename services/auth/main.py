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

log = get_logger("auth")

REQS = Counter("auth_requests_total", "auth requests", ["method", "result"])
SERVICE = "auth"
state = FailureState()

_TOKENS: dict[str, str] = {}


class AuthServicer(pb_grpc.AuthServiceServicer):
    def Login(self, request, context):
        t0 = time.time()
        if state.apply() == "error":
            REQS.labels("login", "err").inc()
            publish_event_sync("mesh.events", {
                "type": "rpc", "service": SERVICE, "method": "Login",
                "ok": False, "latency_ms": int((time.time() - t0) * 1000),
            })
            context.set_code(grpc.StatusCode.UNAVAILABLE)
            context.set_details("auth login failure injected")
            return pb.LoginReply(ok=False, token="")
        REQS.labels("login", "ok").inc()
        token = f"t-{request.user}-{int(time.time())}"
        _TOKENS[token] = request.user
        publish_event_sync("mesh.events", {
            "type": "rpc", "service": SERVICE, "method": "Login",
            "ok": True, "latency_ms": int((time.time() - t0) * 1000),
        })
        return pb.LoginReply(ok=True, token=token)

    def Validate(self, request, context):
        t0 = time.time()
        if state.apply() == "error":
            REQS.labels("validate", "err").inc()
            publish_event_sync("mesh.events", {
                "type": "rpc", "service": SERVICE, "method": "Validate",
                "ok": False, "latency_ms": int((time.time() - t0) * 1000),
            })
            context.set_code(grpc.StatusCode.UNAVAILABLE)
            context.set_details("auth validate failure injected")
            return pb.ValidateReply(ok=False, user="")
        ok = request.token in _TOKENS
        REQS.labels("validate", "ok" if ok else "err").inc()
        publish_event_sync("mesh.events", {
            "type": "rpc", "service": SERVICE, "method": "Validate",
            "ok": ok, "latency_ms": int((time.time() - t0) * 1000),
        })
        return pb.ValidateReply(ok=ok, user=_TOKENS.get(request.token, ""))

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
    port = int(os.getenv("PORT", "50051"))
    metrics_port = int(os.getenv("METRICS_PORT", "9101"))
    threading.Thread(target=start_http_server, args=(metrics_port,), daemon=True).start()
    register(SERVICE, f"{SERVICE}:{port}")
    start_chaos_listener(SERVICE, state)

    def _wire(server):
        pb_grpc.add_AuthServiceServicer_to_server(AuthServicer(), server)

    serve(_wire, port, SERVICE)


if __name__ == "__main__":
    main()
