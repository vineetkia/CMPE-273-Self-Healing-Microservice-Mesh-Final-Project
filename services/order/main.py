import os
import time
import uuid
import threading
import grpc
from prometheus_client import Counter, Histogram, start_http_server

import mesh_pb2 as pb
import mesh_pb2_grpc as pb_grpc

from shared.logging import get_logger
from shared.discovery import register, lookup
from shared.telemetry import init_tracing, publish_event_sync
from shared.failure_modes import FailureState
from shared.resilience import retry_with_backoff, CircuitBreaker, CircuitOpenError
from shared.chaos_listener import start as start_chaos_listener
from shared.grpc_server import serve

log = get_logger("order")

REQS = Counter("order_requests_total", "order requests", ["result"])
LAT = Histogram("order_request_latency_seconds", "latency",
                buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0))

SERVICE = "order"
state = FailureState()

inventory_cb = CircuitBreaker(name="inventory", fail_threshold=4, reset_after_s=8.0)
notify_cb = CircuitBreaker(name="notification", fail_threshold=4, reset_after_s=8.0)

# In-memory orders. Toy persistence for the demo.
ORDERS: dict[str, dict] = {}
ORDERS_LOCK = threading.Lock()


def _save_order(order_id, user, sku, qty, status, amount_cents):
    with ORDERS_LOCK:
        ORDERS[order_id] = {
            "order_id": order_id, "user": user, "sku": sku, "qty": qty,
            "status": status, "amount_cents": amount_cents,
        }


def _update_order_status(order_id, status):
    with ORDERS_LOCK:
        if order_id in ORDERS:
            ORDERS[order_id]["status"] = status
            return True
        return False


def _channel(name: str, default: str) -> grpc.Channel:
    addr = lookup(name) or default
    return grpc.insecure_channel(addr)


def _call_inventory(sku: str, qty: int, timeout_s: float) -> tuple[bool, str]:
    if not inventory_cb.allow():
        raise CircuitOpenError("inventory circuit open")
    ch = _channel("inventory", "inventory:50053")
    stub = pb_grpc.InventoryServiceStub(ch)

    def _do():
        return stub.Reserve(pb.ReserveRequest(sku=sku, qty=qty), timeout=timeout_s)

    try:
        rep = retry_with_backoff(_do, attempts=3, base_delay=0.1, max_delay=0.4)
        if not rep.ok:
            inventory_cb.on_failure()
            return False, rep.message or "inventory failed"
        inventory_cb.on_success()
        return True, rep.message
    except Exception as e:
        inventory_cb.on_failure()
        raise


def _call_notify(user: str, message: str, timeout_s: float) -> bool:
    if not notify_cb.allow():
        return False  # fallback: just skip notify
    ch = _channel("notification", "notification:50054")
    stub = pb_grpc.NotificationServiceStub(ch)
    try:
        rep = stub.Notify(pb.NotifyRequest(user=user, message=message), timeout=timeout_s)
        if rep.ok:
            notify_cb.on_success()
            return True
        notify_cb.on_failure()
        return False
    except Exception:
        notify_cb.on_failure()
        return False


def _call_validate(token: str, timeout_s: float) -> str | None:
    ch = _channel("auth", "auth:50051")
    stub = pb_grpc.AuthServiceStub(ch)
    try:
        rep = stub.Validate(pb.ValidateRequest(token=token), timeout=timeout_s)
        return rep.user if rep.ok else None
    except Exception as e:
        log.warning(f"auth validate failed: {e}")
        return None


class OrderServicer(pb_grpc.OrderServiceServicer):
    def PlaceOrder(self, request, context):
        t0 = time.time()
        user = _call_validate(request.token, timeout_s=1.0)
        if not user:
            REQS.labels("auth_failed").inc()
            LAT.observe(time.time() - t0)
            context.set_code(grpc.StatusCode.UNAUTHENTICATED)
            return pb.PlaceOrderReply(ok=False, order_id="", message="invalid token")

        try:
            ok, msg = _call_inventory(request.sku, request.qty, timeout_s=2.0)
        except CircuitOpenError:
            REQS.labels("inv_circuit_open").inc()
            LAT.observe(time.time() - t0)
            publish_event_sync("mesh.events", {
                "type": "circuit_open", "service": SERVICE, "downstream": "inventory",
            })
            if state.fallback_enabled:
                # Graceful degradation: accept order, mark deferred.
                order_id = f"ord-deferred-{uuid.uuid4().hex[:8]}"
                return pb.PlaceOrderReply(ok=True, order_id=order_id,
                                          message="inventory unavailable; deferred")
            context.set_code(grpc.StatusCode.UNAVAILABLE)
            return pb.PlaceOrderReply(ok=False, order_id="", message="inventory circuit open")
        except Exception as e:
            REQS.labels("inv_error").inc()
            LAT.observe(time.time() - t0)
            publish_event_sync("mesh.events", {
                "type": "downstream_error", "service": SERVICE,
                "downstream": "inventory", "err": str(e)[:200],
            })
            context.set_code(grpc.StatusCode.UNAVAILABLE)
            return pb.PlaceOrderReply(ok=False, order_id="", message=f"inventory error: {e}")

        if not ok:
            REQS.labels("inv_rejected").inc()
            LAT.observe(time.time() - t0)
            return pb.PlaceOrderReply(ok=False, order_id="", message=msg)

        order_id = f"ord-{uuid.uuid4().hex[:8]}"
        # Toy unit price: $19.99 per unit.
        amount_cents = 1999 * max(1, request.qty)
        _save_order(order_id, user, request.sku, request.qty, "placed", amount_cents)

        notified = _call_notify(user, f"Order {order_id} placed", timeout_s=1.0)

        REQS.labels("ok").inc()
        elapsed = time.time() - t0
        LAT.observe(elapsed)
        publish_event_sync("mesh.events", {
            "type": "rpc", "service": SERVICE, "method": "PlaceOrder",
            "ok": True, "latency_ms": int(elapsed * 1000),
            "order_id": order_id, "notified": notified,
        })
        msg_out = "ok" if notified else "ok (notify degraded)"
        return pb.PlaceOrderReply(ok=True, order_id=order_id, message=msg_out)

    def GetOrder(self, request, context):
        with ORDERS_LOCK:
            o = ORDERS.get(request.order_id)
        if not o:
            return pb.GetOrderReply(ok=False, order_id=request.order_id)
        publish_event_sync("mesh.events", {
            "type": "rpc", "service": SERVICE, "method": "GetOrder", "ok": True, "latency_ms": 1,
        })
        return pb.GetOrderReply(
            ok=True, order_id=o["order_id"], user=o["user"], sku=o["sku"],
            qty=o["qty"], status=o["status"], amount_cents=o["amount_cents"],
        )

    def MergeCart(self, request, context):
        t0 = time.time()
        if state.apply() == "error":
            REQS.labels("merge_err").inc()
            LAT.observe(time.time() - t0)
            publish_event_sync("mesh.events", {
                "type": "rpc", "service": SERVICE, "method": "MergeCart",
                "ok": False, "latency_ms": int((time.time() - t0) * 1000),
            })
            context.set_code(grpc.StatusCode.UNAVAILABLE)
            return pb.MergeCartReply(ok=False, merged_items=0, message="merge failure injected")
        user = _call_validate(request.token, timeout_s=1.0)
        if not user:
            return pb.MergeCartReply(ok=False, merged_items=0, message="invalid token")
        # Validate stock for all skus via inventory.StockCheck
        try:
            ch = _channel("inventory", "inventory:50053")
            stub = pb_grpc.InventoryServiceStub(ch)
            rep = stub.StockCheck(pb.StockCheckRequest(skus=list(request.skus)), timeout=2.0)
            in_stock = [lvl.sku for lvl in rep.levels if lvl.remaining > 0]
        except Exception as e:
            publish_event_sync("mesh.events", {
                "type": "downstream_error", "service": SERVICE,
                "downstream": "inventory", "err": str(e)[:200],
            })
            context.set_code(grpc.StatusCode.UNAVAILABLE)
            return pb.MergeCartReply(ok=False, merged_items=0, message=f"inventory error: {e}")
        REQS.labels("merge_ok").inc()
        LAT.observe(time.time() - t0)
        publish_event_sync("mesh.events", {
            "type": "rpc", "service": SERVICE, "method": "MergeCart",
            "ok": True, "latency_ms": int((time.time() - t0) * 1000),
        })
        return pb.MergeCartReply(ok=True, merged_items=len(in_stock), message=f"merged {len(in_stock)}/{len(request.skus)}")

    def UpdateStatus(self, request, context):
        ok = _update_order_status(request.order_id, request.status)
        return pb.UpdateOrderStatusReply(ok=ok)

    def Health(self, request, context):
        status = state.health
        if inventory_cb.state == "open" or notify_cb.state == "open":
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
    port = int(os.getenv("PORT", "50052"))
    metrics_port = int(os.getenv("METRICS_PORT", "9102"))
    threading.Thread(target=start_http_server, args=(metrics_port,), daemon=True).start()
    register(SERVICE, f"{SERVICE}:{port}")
    start_chaos_listener(SERVICE, state)

    def _wire(server):
        pb_grpc.add_OrderServiceServicer_to_server(OrderServicer(), server)

    serve(_wire, port, SERVICE)


if __name__ == "__main__":
    main()
