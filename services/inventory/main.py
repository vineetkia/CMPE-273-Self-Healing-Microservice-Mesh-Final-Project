import os
import time
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

log = get_logger("inventory")

REQS = Counter("inventory_requests_total", "inventory requests", ["method", "result"])
LAT = Histogram("inventory_request_latency_seconds", "latency",
                buckets=(0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0))

SERVICE = "inventory"
state = FailureState()
STOCK: dict[str, int] = {
    "sku-1": 100, "sku-2": 50, "sku-3": 25,
    "sku-4": 80,  "sku-5": 40, "sku-6": 12, "sku-7": 0,
}


def _emit(method: str, ok: bool, ms: int):
    publish_event_sync("mesh.events", {
        "type": "rpc", "service": SERVICE, "method": method,
        "ok": ok, "latency_ms": ms,
    })


class InventoryServicer(pb_grpc.InventoryServiceServicer):
    def Reserve(self, request, context):
        t0 = time.time()
        # Apply failure mode (latency / errors / grey).
        if state.apply() == "error":
            ms = int((time.time() - t0) * 1000)
            REQS.labels("reserve", "err").inc()
            LAT.observe(time.time() - t0)
            _emit("Reserve", False, ms)
            context.set_code(grpc.StatusCode.UNAVAILABLE)
            context.set_details("inventory failure injected")
            return pb.ReserveReply(ok=False, message="inventory failure", remaining=0)

        cur = STOCK.get(request.sku, 0)
        if cur < request.qty:
            REQS.labels("reserve", "out_of_stock").inc()
            LAT.observe(time.time() - t0)
            _emit("Reserve", False, int((time.time() - t0) * 1000))
            return pb.ReserveReply(ok=False, message="out of stock", remaining=cur)
        STOCK[request.sku] = cur - request.qty
        REQS.labels("reserve", "ok").inc()
        LAT.observe(time.time() - t0)
        _emit("Reserve", True, int((time.time() - t0) * 1000))
        return pb.ReserveReply(ok=True, message="reserved", remaining=STOCK[request.sku])

    def Release(self, request, context):
        t0 = time.time()
        if state.apply() == "error":
            REQS.labels("release", "err").inc()
            LAT.observe(time.time() - t0)
            _emit("Release", False, int((time.time() - t0) * 1000))
            context.set_code(grpc.StatusCode.UNAVAILABLE)
            return pb.ReleaseReply(ok=False, remaining=0)
        STOCK[request.sku] = STOCK.get(request.sku, 0) + request.qty
        REQS.labels("release", "ok").inc()
        LAT.observe(time.time() - t0)
        _emit("Release", True, int((time.time() - t0) * 1000))
        return pb.ReleaseReply(ok=True, remaining=STOCK[request.sku])

    def Restock(self, request, context):
        t0 = time.time()
        if state.apply() == "error":
            REQS.labels("restock", "err").inc()
            LAT.observe(time.time() - t0)
            _emit("Restock", False, int((time.time() - t0) * 1000))
            context.set_code(grpc.StatusCode.UNAVAILABLE)
            return pb.RestockReply(ok=False, remaining=0)
        STOCK[request.sku] = STOCK.get(request.sku, 0) + request.qty
        REQS.labels("restock", "ok").inc()
        LAT.observe(time.time() - t0)
        _emit("Restock", True, int((time.time() - t0) * 1000))
        return pb.RestockReply(ok=True, remaining=STOCK[request.sku])

    def StockCheck(self, request, context):
        t0 = time.time()
        if state.apply() == "error":
            REQS.labels("stock_check", "err").inc()
            LAT.observe(time.time() - t0)
            _emit("StockCheck", False, int((time.time() - t0) * 1000))
            context.set_code(grpc.StatusCode.UNAVAILABLE)
            return pb.StockCheckReply(levels=[])
        levels = [pb.StockLevel(sku=s, remaining=STOCK.get(s, 0)) for s in request.skus]
        REQS.labels("stock_check", "ok").inc()
        LAT.observe(time.time() - t0)
        _emit("StockCheck", True, int((time.time() - t0) * 1000))
        return pb.StockCheckReply(levels=levels)

    def Health(self, request, context):
        status = state.health
        if state.active() and state.mode in ("errors", "grey"):
            status = "degraded"
        if state.active() and state.mode == "latency" and state.latency_ms >= 800:
            status = "degraded"
        return pb.HealthReply(service=SERVICE, status=status, ts_ms=int(time.time()*1000))

    def Control(self, request, context):
        action = request.action
        log.info(f"control action={action}")
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
        publish_event_sync("mesh.events", {
            "type": "control", "service": SERVICE, "action": action,
        })
        return pb.ControlReply(ok=True, message=f"applied {action}")


def main():
    os.environ.setdefault("SERVICE_NAME", SERVICE)
    init_tracing(SERVICE)
    port = int(os.getenv("PORT", "50053"))
    metrics_port = int(os.getenv("METRICS_PORT", "9103"))
    threading.Thread(target=start_http_server, args=(metrics_port,), daemon=True).start()
    register(SERVICE, f"{SERVICE}:{port}")
    start_chaos_listener(SERVICE, state)

    def _wire(server):
        pb_grpc.add_InventoryServiceServicer_to_server(InventoryServicer(), server)

    serve(_wire, port, SERVICE)


if __name__ == "__main__":
    main()
