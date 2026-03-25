import os
import time
import random
import threading
import grpc
from prometheus_client import Counter, Histogram, start_http_server

import mesh_pb2 as pb
import mesh_pb2_grpc as pb_grpc

from shared.logging import get_logger
from shared.discovery import register
from shared.telemetry import init_tracing, publish_event_sync
from shared.failure_modes import FailureState
from shared.chaos_listener import start as start_chaos_listener
from shared.grpc_server import serve

log = get_logger("fraud")
SERVICE = "fraud"
state = FailureState()

REQS = Counter("fraud_requests_total", "fraud requests", ["method", "result"])
LAT = Histogram("fraud_request_latency_seconds", "latency",
                buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0))


def _emit(method, ok, ms):
    publish_event_sync("mesh.events", {
        "type": "rpc", "service": SERVICE, "method": method,
        "ok": ok, "latency_ms": ms,
    })


class FraudServicer(pb_grpc.FraudServiceServicer):
    def Score(self, request, context):
        t0 = time.time()
        if state.apply() == "error":
            REQS.labels("score", "err").inc()
            LAT.observe(time.time() - t0)
            _emit("Score", False, int((time.time() - t0) * 1000))
            context.set_code(grpc.StatusCode.UNAVAILABLE)
            return pb.ScoreReply(ok=False, score=0, decision="error", reason="fraud failure injected")

        # Toy scoring: amount > $1000 triggers higher risk; otherwise mostly approve.
        base = 5 + random.randint(0, 15)
        if request.amount_cents > 100_000:
            base += 30
        if request.amount_cents > 500_000:
            base += 40
        score = min(100, base)
        if score >= 80:
            decision, reason = "deny", "high risk score"
        elif score >= 50:
            decision, reason = "review", "moderate risk; manual review"
        else:
            decision, reason = "approve", "ok"

        REQS.labels("score", decision).inc()
        LAT.observe(time.time() - t0)
        _emit("Score", True, int((time.time() - t0) * 1000))
        return pb.ScoreReply(ok=True, score=score, decision=decision, reason=reason)

    def Health(self, request, context):
        status = state.health
        if state.active() and state.mode in ("errors", "grey"):
            status = "degraded"
        if state.active() and state.mode == "latency" and state.latency_ms >= 600:
            status = "degraded"
        return pb.HealthReply(service=SERVICE, status=status, ts_ms=int(time.time()*1000))

    def Control(self, request, context):
        a = request.action
        if a == "clear_failure":
            state.clear()
        elif a == "mark_degraded":
            state.health = "degraded"
        elif a == "enable_fallback":
            state.fallback_enabled = True
        elif a == "disable_fallback":
            state.fallback_enabled = False
        else:
            return pb.ControlReply(ok=False, message=f"unknown action {a}")
        return pb.ControlReply(ok=True, message=f"applied {a}")


def main():
    os.environ.setdefault("SERVICE_NAME", SERVICE)
    init_tracing(SERVICE)
    port = int(os.getenv("PORT", "50056"))
    metrics_port = int(os.getenv("METRICS_PORT", "9106"))
    threading.Thread(target=start_http_server, args=(metrics_port,), daemon=True).start()
    register(SERVICE, f"{SERVICE}:{port}")
    start_chaos_listener(SERVICE, state)

    def _wire(server):
        pb_grpc.add_FraudServiceServicer_to_server(FraudServicer(), server)

    serve(_wire, port, SERVICE)


if __name__ == "__main__":
    main()
