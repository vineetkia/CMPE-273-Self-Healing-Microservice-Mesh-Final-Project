import os
import time
import random
import threading
import grpc
from collections import defaultdict
from prometheus_client import Counter, Histogram, start_http_server

import mesh_pb2 as pb
import mesh_pb2_grpc as pb_grpc

from shared.logging import get_logger
from shared.discovery import register
from shared.telemetry import init_tracing, publish_event_sync, elapsed_ms
from shared.failure_modes import FailureState
from shared.chaos_listener import start as start_chaos_listener
from shared.grpc_server import serve

log = get_logger("recommendation")
SERVICE = "recommendation"
state = FailureState()

REQS = Counter("recommendation_requests_total", "recommendation requests", ["method", "result"])
LAT = Histogram("recommendation_request_latency_seconds", "latency",
                buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5))

# user -> list of (event, sku, ts)
HISTORY: dict[str, list] = defaultdict(list)
CATALOG = ["sku-1", "sku-2", "sku-3", "sku-4", "sku-5", "sku-6", "sku-7"]


def _emit(method, ok, ms):
    publish_event_sync("mesh.events", {
        "type": "rpc", "service": SERVICE, "method": method,
        "ok": ok, "latency_ms": ms,
    })


class RecommendationServicer(pb_grpc.RecommendationServiceServicer):
    def Suggest(self, request, context):
        t0 = time.time()
        if state.apply() == "error":
            REQS.labels("suggest", "err").inc()
            LAT.observe(time.time() - t0)
            _emit("Suggest", False, elapsed_ms(t0))
            context.set_code(grpc.StatusCode.UNAVAILABLE)
            return pb.SuggestReply(ok=False, skus=[])
        seen = {h[1] for h in HISTORY.get(request.user, [])}
        pool = [s for s in CATALOG if s not in seen] or CATALOG
        random.shuffle(pool)
        limit = max(1, min(10, request.limit or 3))
        skus = pool[:limit]
        REQS.labels("suggest", "ok").inc()
        LAT.observe(time.time() - t0)
        _emit("Suggest", True, elapsed_ms(t0))
        return pb.SuggestReply(ok=True, skus=skus)

    def RecordEvent(self, request, context):
        t0 = time.time()
        if state.apply() == "error":
            REQS.labels("record", "err").inc()
            LAT.observe(time.time() - t0)
            _emit("RecordEvent", False, elapsed_ms(t0))
            context.set_code(grpc.StatusCode.UNAVAILABLE)
            return pb.RecordEventReply(ok=False)
        HISTORY[request.user].append((request.event, request.sku, time.time()))
        REQS.labels("record", "ok").inc()
        LAT.observe(time.time() - t0)
        _emit("RecordEvent", True, elapsed_ms(t0))
        return pb.RecordEventReply(ok=True)

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
    port = int(os.getenv("PORT", "50058"))
    metrics_port = int(os.getenv("METRICS_PORT", "9108"))
    threading.Thread(target=start_http_server, args=(metrics_port,), daemon=True).start()
    register(SERVICE, f"{SERVICE}:{port}")
    start_chaos_listener(SERVICE, state)

    def _wire(server):
        pb_grpc.add_RecommendationServiceServicer_to_server(RecommendationServicer(), server)

    serve(_wire, port, SERVICE)


if __name__ == "__main__":
    main()
