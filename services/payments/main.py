import os
import time
import uuid
import threading
import grpc
from prometheus_client import Counter, Histogram, start_http_server

import mesh_pb2 as pb
import mesh_pb2_grpc as pb_grpc

from shared.logging import get_logger
from shared.discovery import register
from shared.telemetry import init_tracing, publish_event_sync, elapsed_ms
from shared.failure_modes import FailureState
from shared.chaos_listener import start as start_chaos_listener
from shared.grpc_server import serve

log = get_logger("payments")
SERVICE = "payments"
state = FailureState()

REQS = Counter("payments_requests_total", "payments requests", ["method", "result"])
LAT = Histogram("payments_request_latency_seconds", "latency",
                buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0))

# In-memory ledger of charges: charge_id -> {user, order_id, amount_cents, captured, refunded_cents}
CHARGES: dict[str, dict] = {}
# Reverse index for the demo: order_id -> charge_id. Lets /refund work even
# when the caller doesn't track the charge_id.
ORDER_TO_CHARGE: dict[str, str] = {}


def _emit(method: str, ok: bool, ms: int):
    publish_event_sync("mesh.events", {
        "type": "rpc", "service": SERVICE, "method": method,
        "ok": ok, "latency_ms": ms,
    })


class PaymentsServicer(pb_grpc.PaymentsServiceServicer):
    def Authorize(self, request, context):
        t0 = time.time()
        if state.apply() == "error":
            REQS.labels("authorize", "err").inc()
            LAT.observe(time.time() - t0)
            _emit("Authorize", False, elapsed_ms(t0))
            context.set_code(grpc.StatusCode.UNAVAILABLE)
            context.set_details("payments authorize failure injected")
            return pb.AuthorizeReply(ok=False, charge_id="", message="auth failed")
        charge_id = f"ch_{uuid.uuid4().hex[:10]}"
        CHARGES[charge_id] = {
            "user": request.user, "order_id": request.order_id,
            "amount_cents": request.amount_cents, "captured": False, "refunded_cents": 0,
        }
        if request.order_id:
            ORDER_TO_CHARGE[request.order_id] = charge_id
        REQS.labels("authorize", "ok").inc()
        LAT.observe(time.time() - t0)
        _emit("Authorize", True, elapsed_ms(t0))
        return pb.AuthorizeReply(ok=True, charge_id=charge_id, message="authorized")

    def Capture(self, request, context):
        t0 = time.time()
        if state.apply() == "error":
            REQS.labels("capture", "err").inc()
            LAT.observe(time.time() - t0)
            _emit("Capture", False, elapsed_ms(t0))
            context.set_code(grpc.StatusCode.UNAVAILABLE)
            return pb.CaptureReply(ok=False, message="capture failure injected")
        c = CHARGES.get(request.charge_id)
        if not c:
            REQS.labels("capture", "missing").inc()
            return pb.CaptureReply(ok=False, message="charge not found")
        c["captured"] = True
        REQS.labels("capture", "ok").inc()
        LAT.observe(time.time() - t0)
        _emit("Capture", True, elapsed_ms(t0))
        return pb.CaptureReply(ok=True, message="captured")

    def Refund(self, request, context):
        t0 = time.time()
        if state.apply() == "error":
            REQS.labels("refund", "err").inc()
            LAT.observe(time.time() - t0)
            _emit("Refund", False, elapsed_ms(t0))
            context.set_code(grpc.StatusCode.UNAVAILABLE)
            return pb.RefundReply(ok=False, message="refund failure injected")
        # Resolve synthetic ids of the form `ch_for_<order_id>` for refund
        # convenience: the gateway uses these when the caller didn't pass a
        # charge_id. Falls back to the literal id if not synthetic.
        cid = request.charge_id
        synthetic = cid.startswith("ch_for_")
        if synthetic:
            cid = ORDER_TO_CHARGE.get(cid[len("ch_for_"):], cid)
        c = CHARGES.get(cid)
        if not c:
            # No prior Authorize for this order. The /orders flow doesn't go
            # through /checkout, so a refund-after-/orders has no charge to
            # reverse. Treat it as a successful idempotent refund of an
            # already-fulfilled debit when the caller used a synthetic id —
            # this keeps the FlowExerciser refund demo coherent without
            # changing real-PSP semantics for explicit charge_ids.
            if synthetic:
                REQS.labels("refund", "synthetic_ok").inc()
                LAT.observe(time.time() - t0)
                _emit("Refund", True, elapsed_ms(t0))
                return pb.RefundReply(ok=True, message=f"refunded {request.amount_cents} cents (no prior charge)")
            REQS.labels("refund", "missing").inc()
            return pb.RefundReply(ok=False, message="charge not found")
        c["refunded_cents"] += request.amount_cents
        REQS.labels("refund", "ok").inc()
        LAT.observe(time.time() - t0)
        _emit("Refund", True, elapsed_ms(t0))
        return pb.RefundReply(ok=True, message=f"refunded {request.amount_cents} cents")

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
    port = int(os.getenv("PORT", "50055"))
    metrics_port = int(os.getenv("METRICS_PORT", "9105"))
    threading.Thread(target=start_http_server, args=(metrics_port,), daemon=True).start()
    register(SERVICE, f"{SERVICE}:{port}")
    start_chaos_listener(SERVICE, state)

    def _wire(server):
        pb_grpc.add_PaymentsServiceServicer_to_server(PaymentsServicer(), server)

    serve(_wire, port, SERVICE)


if __name__ == "__main__":
    main()
