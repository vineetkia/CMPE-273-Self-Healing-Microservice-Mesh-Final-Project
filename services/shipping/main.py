import os
import time
import uuid
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

log = get_logger("shipping")
SERVICE = "shipping"
state = FailureState()

REQS = Counter("shipping_requests_total", "shipping requests", ["method", "result"])
LAT = Histogram("shipping_request_latency_seconds", "latency",
                buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5))

LABELS: dict[str, dict] = {}


def _emit(method, ok, ms):
    publish_event_sync("mesh.events", {
        "type": "rpc", "service": SERVICE, "method": method,
        "ok": ok, "latency_ms": ms,
    })


class ShippingServicer(pb_grpc.ShippingServiceServicer):
    def Quote(self, request, context):
        t0 = time.time()
        if state.apply() == "error":
            REQS.labels("quote", "err").inc()
            LAT.observe(time.time() - t0)
            _emit("Quote", False, int((time.time() - t0) * 1000))
            context.set_code(grpc.StatusCode.UNAVAILABLE)
            return pb.QuoteReply(ok=False, cents=0, eta_days=0)
        # Toy pricing: 599 + 50 per qty.
        cents = 599 + 50 * max(1, request.qty)
        eta = random.choice([2, 3, 4, 5])
        REQS.labels("quote", "ok").inc()
        LAT.observe(time.time() - t0)
        _emit("Quote", True, int((time.time() - t0) * 1000))
        return pb.QuoteReply(ok=True, cents=cents, eta_days=eta)

    def CreateLabel(self, request, context):
        t0 = time.time()
        if state.apply() == "error":
            REQS.labels("label", "err").inc()
            LAT.observe(time.time() - t0)
            _emit("CreateLabel", False, int((time.time() - t0) * 1000))
            context.set_code(grpc.StatusCode.UNAVAILABLE)
            return pb.LabelReply(ok=False, tracking_id="", message="label failure injected")
        tid = f"trk_{uuid.uuid4().hex[:10]}"
        LABELS[tid] = {"order_id": request.order_id, "user": request.user, "sku": request.sku, "qty": request.qty}
        REQS.labels("label", "ok").inc()
        LAT.observe(time.time() - t0)
        _emit("CreateLabel", True, int((time.time() - t0) * 1000))
        return pb.LabelReply(ok=True, tracking_id=tid, message="label created")

    def Health(self, request, context):
        status = state.health
        if state.active() and state.mode in ("errors", "grey"):
            status = "degraded"
        if state.active() and state.mode == "latency" and state.latency_ms >= 800:
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
    port = int(os.getenv("PORT", "50057"))
    metrics_port = int(os.getenv("METRICS_PORT", "9107"))
    threading.Thread(target=start_http_server, args=(metrics_port,), daemon=True).start()
    register(SERVICE, f"{SERVICE}:{port}")
    start_chaos_listener(SERVICE, state)

    def _wire(server):
        pb_grpc.add_ShippingServiceServicer_to_server(ShippingServicer(), server)

    serve(_wire, port, SERVICE)


if __name__ == "__main__":
    main()
