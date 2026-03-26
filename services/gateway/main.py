import os
import time
import threading
import grpc
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
from starlette.responses import Response

import mesh_pb2 as pb
import mesh_pb2_grpc as pb_grpc

from shared.logging import get_logger
from shared.discovery import register, lookup, list_services
from shared.telemetry import init_tracing, publish_event_sync
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

log = get_logger("gateway")
SERVICE = "gateway"

REQS = Counter("gateway_requests_total", "gateway requests", ["path", "result"])
LAT = Histogram("gateway_request_latency_seconds", "latency", ["path"],
                buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0))

app = FastAPI(title="Self-Healing Mesh Gateway")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ============== Topology of services we know about ==============
ALL_SERVICES = [
    ("auth",           "auth:50051"),
    ("order",          "order:50052"),
    ("inventory",      "inventory:50053"),
    ("notification",   "notification:50054"),
    ("payments",       "payments:50055"),
    ("fraud",          "fraud:50056"),
    ("shipping",       "shipping:50057"),
    ("recommendation", "recommendation:50058"),
]
SERVICE_DEFAULTS = dict(ALL_SERVICES)


def _channel(name: str) -> grpc.Channel:
    addr = lookup(name) or SERVICE_DEFAULTS.get(name)
    return grpc.insecure_channel(addr)


def _stub_for(name: str, ch):
    if name == "auth":           return pb_grpc.AuthServiceStub(ch)
    if name == "order":          return pb_grpc.OrderServiceStub(ch)
    if name == "inventory":      return pb_grpc.InventoryServiceStub(ch)
    if name == "notification":   return pb_grpc.NotificationServiceStub(ch)
    if name == "payments":       return pb_grpc.PaymentsServiceStub(ch)
    if name == "fraud":          return pb_grpc.FraudServiceStub(ch)
    if name == "shipping":       return pb_grpc.ShippingServiceStub(ch)
    if name == "recommendation": return pb_grpc.RecommendationServiceStub(ch)
    raise ValueError(f"unknown service {name}")


def _validate_token(token: str) -> Optional[str]:
    try:
        ch = _channel("auth")
        stub = pb_grpc.AuthServiceStub(ch)
        rep = stub.Validate(pb.ValidateRequest(token=token), timeout=1.5)
        return rep.user if rep.ok else None
    except Exception as e:
        log.warning(f"validate failed: {e}")
        return None


# ============== Models ==============
class LoginIn(BaseModel):
    user: str
    password: str = "x"


class OrderIn(BaseModel):
    token: str
    sku: str
    qty: int


class CheckoutIn(BaseModel):
    token: str
    sku: str
    qty: int
    zip: str = "94103"


class RefundIn(BaseModel):
    token: str
    order_id: str
    charge_id: str = ""
    amount_cents: int = 0


class CartMergeIn(BaseModel):
    token: str
    guest_cart_id: str
    skus: List[str]


class RestockIn(BaseModel):
    token: str
    sku: str
    qty: int


class FraudReviewIn(BaseModel):
    token: str
    order_id: str


class FailureIn(BaseModel):
    service: str
    mode: str
    error_rate: float = 0.0
    latency_ms: int = 0
    duration_s: int = 60


class ScriptedDemoIn(BaseModel):
    flow: str       # checkout | refund | cart_merge | restock | fraud_review | recommendations


# ============== Routes: meta ==============
@app.get("/health")
def health():
    return {"service": SERVICE, "status": "healthy", "ts_ms": int(time.time() * 1000)}


@app.get("/metrics")
def metrics():
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


# ============== Topology + flows ==============
# Each flow names the *minimum sufficient* set of services and their call edges.
# This is what the dashboard renders.
FLOWS = {
    "checkout": {
        "title": "Checkout",
        "endpoint": "POST /checkout",
        "summary": "Place an order with stock reservation, fraud screening, payment authorize+capture, label creation, and notify.",
        "services": ["gateway", "order", "auth", "inventory", "fraud", "payments", "shipping", "notification"],
        "edges": [
            ["gateway", "order"],
            ["order", "auth"],
            ["order", "inventory"],
            ["order", "fraud"],
            ["order", "payments"],
            ["order", "shipping"],
            ["order", "notification"],
        ],
    },
    "refund": {
        "title": "Refund",
        "endpoint": "POST /refund",
        "summary": "Validate user, fetch order, refund charge, restock inventory, notify the buyer.",
        "services": ["gateway", "order", "auth", "payments", "inventory", "notification"],
        "edges": [
            ["gateway", "order"],
            ["order", "auth"],
            ["order", "payments"],
            ["order", "inventory"],
            ["order", "notification"],
        ],
    },
    "cart_merge": {
        "title": "Cart merge",
        "endpoint": "POST /cart/merge",
        "summary": "Merge a guest cart into a logged-in user's cart, validating stock for each line item.",
        "services": ["gateway", "order", "auth", "inventory"],
        "edges": [
            ["gateway", "order"],
            ["order", "auth"],
            ["order", "inventory"],
        ],
    },
    "restock": {
        "title": "Restock",
        "endpoint": "POST /inventory/restock",
        "summary": "Replenish inventory for a SKU and refresh recommendations against the new availability.",
        "services": ["gateway", "auth", "inventory", "recommendation"],
        "edges": [
            ["gateway", "auth"],
            ["gateway", "inventory"],
            ["gateway", "recommendation"],
        ],
    },
    "fraud_review": {
        "title": "Fraud review",
        "endpoint": "POST /fraud/review",
        "summary": "Re-score a placed order, hold or release based on risk, and notify ops.",
        "services": ["gateway", "order", "auth", "fraud", "notification"],
        "edges": [
            ["gateway", "order"],
            ["order", "auth"],
            ["order", "fraud"],
            ["order", "notification"],
        ],
    },
    "recommendations": {
        "title": "Recommendations",
        "endpoint": "GET /recommendations/{user}",
        "summary": "Return personalized SKUs based on history, filtered by current inventory levels.",
        "services": ["gateway", "auth", "order", "recommendation", "inventory"],
        "edges": [
            ["gateway", "auth"],
            ["gateway", "order"],
            ["gateway", "recommendation"],
            ["recommendation", "inventory"],
        ],
    },
}


@app.get("/flows")
def list_flows():
    """Returns the catalog of demo flows the dashboard renders."""
    return {"flows": FLOWS}


@app.get("/topology")
def topology():
    """Aggregate dependency graph (union of every flow). Used as a fallback
    when the UI hasn't selected a specific flow yet.
    """
    # Build union of edges across flows.
    edges = set()
    services = set(["gateway"])
    for f in FLOWS.values():
        services.update(f["services"])
        for e in f["edges"]:
            edges.add(tuple(e))
    return {
        "graph": {
            "gateway": ["order"],
            "order": ["auth", "inventory", "notification", "payments", "fraud", "shipping"],
            "auth": [],
            "inventory": [],
            "notification": [],
            "payments": [],
            "fraud": [],
            "shipping": [],
            "recommendation": ["inventory"],
        },
        "services": sorted(services),
        "edges": [list(e) for e in sorted(edges)],
        "flows": list(FLOWS.keys()),
        "registered": list_services(),
    }


@app.get("/services/health")
def services_health():
    out = {}
    for name, default in ALL_SERVICES:
        addr = lookup(name) or default
        try:
            ch = grpc.insecure_channel(addr)
            stub = _stub_for(name, ch)
            rep = stub.Health(pb.Empty(), timeout=1.5)
            out[name] = {"status": rep.status, "ts_ms": rep.ts_ms, "addr": addr}
        except Exception as e:
            out[name] = {"status": "unreachable", "error": str(e)[:160], "addr": addr}
    return out


# ============== Auth ==============
@app.post("/login")
def do_login(body: LoginIn):
    t0 = time.time()
    ch = _channel("auth")
    stub = pb_grpc.AuthServiceStub(ch)
    try:
        rep = stub.Login(pb.LoginRequest(user=body.user, password=body.password), timeout=2.0)
        REQS.labels("/login", "ok").inc()
        LAT.labels("/login").observe(time.time() - t0)
        return {"ok": rep.ok, "token": rep.token}
    except Exception as e:
        REQS.labels("/login", "err").inc()
        raise HTTPException(status_code=502, detail=str(e))


# ============== Endpoint 1: place a single order (existing) ==============
@app.post("/orders")
def place_order(body: OrderIn):
    t0 = time.time()
    ch = _channel("order")
    stub = pb_grpc.OrderServiceStub(ch)
    try:
        rep = stub.PlaceOrder(
            pb.PlaceOrderRequest(token=body.token, sku=body.sku, qty=body.qty),
            timeout=5.0,
        )
        result = "ok" if rep.ok else "rejected"
        REQS.labels("/orders", result).inc()
        LAT.labels("/orders").observe(time.time() - t0)
        return {"ok": rep.ok, "order_id": rep.order_id, "message": rep.message}
    except grpc.RpcError as e:
        REQS.labels("/orders", "err").inc()
        LAT.labels("/orders").observe(time.time() - t0)
        return {"ok": False, "order_id": "", "message": f"rpc error: {e.code().name}"}


# ============== Endpoint 2: full checkout ==============
@app.post("/checkout")
def checkout(body: CheckoutIn):
    """Full-fat checkout: place -> fraud -> pay -> ship -> notify.

    Each downstream call has a small per-call timeout so that one failing
    service can't drag the whole call past 6s. Returns the orchestration
    result with a `stage` field showing where it succeeded or failed.
    """
    t0 = time.time()
    user = _validate_token(body.token)
    if not user:
        REQS.labels("/checkout", "auth_failed").inc()
        return {"ok": False, "stage": "auth", "message": "invalid token"}

    # Step 1: place order (covers reserve + notify; reuses existing /orders flow internals).
    try:
        order_stub = _stub_for("order", _channel("order"))
        place = order_stub.PlaceOrder(
            pb.PlaceOrderRequest(token=body.token, sku=body.sku, qty=body.qty),
            timeout=4.0,
        )
        if not place.ok:
            REQS.labels("/checkout", "place_failed").inc()
            return {"ok": False, "stage": "order", "order_id": place.order_id, "message": place.message}
        order_id = place.order_id
    except grpc.RpcError as e:
        REQS.labels("/checkout", "order_err").inc()
        return {"ok": False, "stage": "order", "message": f"order rpc {e.code().name}"}

    # Look up the order to get the amount.
    try:
        order_stub = _stub_for("order", _channel("order"))
        get_rep = order_stub.GetOrder(pb.GetOrderRequest(order_id=order_id), timeout=1.5)
        amount_cents = get_rep.amount_cents if get_rep.ok else (1999 * max(1, body.qty))
    except Exception:
        amount_cents = 1999 * max(1, body.qty)

    # Step 2: fraud screen.
    try:
        fraud_stub = _stub_for("fraud", _channel("fraud"))
        score = fraud_stub.Score(
            pb.ScoreRequest(user=user, order_id=order_id, amount_cents=amount_cents),
            timeout=2.0,
        )
        if not score.ok or score.decision == "deny":
            REQS.labels("/checkout", "fraud_deny").inc()
            try:
                order_stub.UpdateStatus(pb.UpdateOrderStatusRequest(order_id=order_id, status="held"), timeout=1.5)
            except Exception:
                pass
            return {"ok": False, "stage": "fraud", "order_id": order_id,
                    "message": score.reason or "fraud denied", "score": score.score}
    except grpc.RpcError as e:
        REQS.labels("/checkout", "fraud_err").inc()
        return {"ok": False, "stage": "fraud", "order_id": order_id,
                "message": f"fraud rpc {e.code().name}"}

    # Step 3: payments authorize + capture.
    try:
        pay_stub = _stub_for("payments", _channel("payments"))
        auth_rep = pay_stub.Authorize(
            pb.AuthorizeRequest(user=user, order_id=order_id, amount_cents=amount_cents),
            timeout=2.5,
        )
        if not auth_rep.ok:
            REQS.labels("/checkout", "pay_auth_fail").inc()
            return {"ok": False, "stage": "payments_authorize", "order_id": order_id,
                    "message": auth_rep.message}
        cap_rep = pay_stub.Capture(pb.CaptureRequest(charge_id=auth_rep.charge_id), timeout=2.5)
        if not cap_rep.ok:
            REQS.labels("/checkout", "pay_capture_fail").inc()
            return {"ok": False, "stage": "payments_capture", "order_id": order_id,
                    "charge_id": auth_rep.charge_id, "message": cap_rep.message}
        charge_id = auth_rep.charge_id
    except grpc.RpcError as e:
        REQS.labels("/checkout", "pay_err").inc()
        return {"ok": False, "stage": "payments", "order_id": order_id,
                "message": f"payments rpc {e.code().name}"}

    try:
        order_stub.UpdateStatus(pb.UpdateOrderStatusRequest(order_id=order_id, status="paid"), timeout=1.5)
    except Exception:
        pass

    # Step 4: shipping label.
    try:
        ship_stub = _stub_for("shipping", _channel("shipping"))
        label = ship_stub.CreateLabel(
            pb.LabelRequest(order_id=order_id, user=user, sku=body.sku, qty=body.qty),
            timeout=2.5,
        )
        if not label.ok:
            REQS.labels("/checkout", "ship_fail").inc()
            return {"ok": False, "stage": "shipping", "order_id": order_id,
                    "charge_id": charge_id, "message": label.message}
        tracking_id = label.tracking_id
    except grpc.RpcError as e:
        REQS.labels("/checkout", "ship_err").inc()
        return {"ok": False, "stage": "shipping", "order_id": order_id,
                "message": f"shipping rpc {e.code().name}"}

    try:
        order_stub.UpdateStatus(pb.UpdateOrderStatusRequest(order_id=order_id, status="shipped"), timeout=1.5)
    except Exception:
        pass

    # Step 5: best-effort notify (already done by PlaceOrder; we send a richer one here too).
    try:
        notif_stub = _stub_for("notification", _channel("notification"))
        notif_stub.Notify(pb.NotifyRequest(user=user, message=f"Order {order_id} shipped: {tracking_id}"), timeout=1.5)
    except Exception:
        pass

    REQS.labels("/checkout", "ok").inc()
    LAT.labels("/checkout").observe(time.time() - t0)
    return {
        "ok": True, "stage": "complete", "order_id": order_id,
        "charge_id": charge_id, "tracking_id": tracking_id,
        "amount_cents": amount_cents,
    }


# ============== Endpoint 3: refund ==============
@app.post("/refund")
def refund(body: RefundIn):
    t0 = time.time()
    user = _validate_token(body.token)
    if not user:
        REQS.labels("/refund", "auth_failed").inc()
        return {"ok": False, "stage": "auth", "message": "invalid token"}

    # Look up the order to know amount + sku.
    try:
        order_stub = _stub_for("order", _channel("order"))
        o = order_stub.GetOrder(pb.GetOrderRequest(order_id=body.order_id), timeout=1.5)
        if not o.ok:
            REQS.labels("/refund", "order_missing").inc()
            return {"ok": False, "stage": "order", "message": "order not found"}
    except grpc.RpcError as e:
        REQS.labels("/refund", "order_err").inc()
        return {"ok": False, "stage": "order", "message": f"order rpc {e.code().name}"}

    amount = body.amount_cents or o.amount_cents

    # Refund the charge. If the charge_id wasn't supplied, the demo fakes one
    # by issuing the refund against a synthetic id; the payments service is
    # tolerant about missing charges (returns ok=False, message="charge not found")
    # which lets the failure-injection demo still fail cleanly when payments is bad.
    charge_id = body.charge_id or f"ch_for_{body.order_id}"
    try:
        pay_stub = _stub_for("payments", _channel("payments"))
        ref = pay_stub.Refund(pb.RefundRequest(charge_id=charge_id, amount_cents=amount), timeout=2.5)
        if not ref.ok:
            REQS.labels("/refund", "pay_fail").inc()
            return {"ok": False, "stage": "payments", "order_id": body.order_id,
                    "message": ref.message}
    except grpc.RpcError as e:
        REQS.labels("/refund", "pay_err").inc()
        return {"ok": False, "stage": "payments", "order_id": body.order_id,
                "message": f"payments rpc {e.code().name}"}

    # Restock inventory.
    try:
        inv_stub = _stub_for("inventory", _channel("inventory"))
        inv_stub.Restock(pb.RestockRequest(sku=o.sku, qty=o.qty), timeout=2.0)
    except grpc.RpcError as e:
        REQS.labels("/refund", "inv_err").inc()
        return {"ok": False, "stage": "inventory", "order_id": body.order_id,
                "message": f"inventory rpc {e.code().name}"}

    try:
        order_stub.UpdateStatus(pb.UpdateOrderStatusRequest(order_id=body.order_id, status="refunded"), timeout=1.5)
    except Exception:
        pass

    # Notify (best-effort).
    try:
        notif_stub = _stub_for("notification", _channel("notification"))
        notif_stub.Notify(pb.NotifyRequest(user=o.user, message=f"Refunded {body.order_id}"), timeout=1.5)
    except Exception:
        pass

    REQS.labels("/refund", "ok").inc()
    LAT.labels("/refund").observe(time.time() - t0)
    return {"ok": True, "order_id": body.order_id, "amount_refunded_cents": amount}


# ============== Endpoint 4: cart merge ==============
@app.post("/cart/merge")
def cart_merge(body: CartMergeIn):
    t0 = time.time()
    try:
        order_stub = _stub_for("order", _channel("order"))
        rep = order_stub.MergeCart(
            pb.MergeCartRequest(token=body.token, guest_cart_id=body.guest_cart_id, skus=body.skus),
            timeout=4.0,
        )
        REQS.labels("/cart/merge", "ok" if rep.ok else "rejected").inc()
        LAT.labels("/cart/merge").observe(time.time() - t0)
        return {"ok": rep.ok, "merged_items": rep.merged_items, "message": rep.message}
    except grpc.RpcError as e:
        REQS.labels("/cart/merge", "err").inc()
        return {"ok": False, "merged_items": 0, "message": f"rpc {e.code().name}"}


# ============== Endpoint 5: restock ==============
@app.post("/inventory/restock")
def inventory_restock(body: RestockIn):
    t0 = time.time()
    user = _validate_token(body.token)
    if not user:
        REQS.labels("/inventory/restock", "auth_failed").inc()
        return {"ok": False, "stage": "auth", "message": "invalid token"}

    # Restock.
    try:
        inv_stub = _stub_for("inventory", _channel("inventory"))
        rep = inv_stub.Restock(pb.RestockRequest(sku=body.sku, qty=body.qty), timeout=2.0)
        if not rep.ok:
            REQS.labels("/inventory/restock", "inv_fail").inc()
            return {"ok": False, "stage": "inventory", "message": "restock failed"}
    except grpc.RpcError as e:
        REQS.labels("/inventory/restock", "inv_err").inc()
        return {"ok": False, "stage": "inventory", "message": f"inventory rpc {e.code().name}"}

    # Tell recommendations.
    try:
        rec_stub = _stub_for("recommendation", _channel("recommendation"))
        rec_stub.RecordEvent(pb.RecordEventRequest(user=user, event="restock", sku=body.sku), timeout=1.5)
    except grpc.RpcError as e:
        # Non-critical: degrade gracefully.
        publish_event_sync("mesh.events", {
            "type": "downstream_error", "service": SERVICE,
            "downstream": "recommendation", "err": f"rpc {e.code().name}",
        })

    REQS.labels("/inventory/restock", "ok").inc()
    LAT.labels("/inventory/restock").observe(time.time() - t0)
    return {"ok": True, "sku": body.sku, "qty": body.qty, "remaining": rep.remaining}


# ============== Endpoint 6: fraud review (re-score a placed order) ==============
@app.post("/fraud/review")
def fraud_review(body: FraudReviewIn):
    t0 = time.time()
    user = _validate_token(body.token)
    if not user:
        REQS.labels("/fraud/review", "auth_failed").inc()
        return {"ok": False, "stage": "auth", "message": "invalid token"}

    try:
        order_stub = _stub_for("order", _channel("order"))
        o = order_stub.GetOrder(pb.GetOrderRequest(order_id=body.order_id), timeout=1.5)
        if not o.ok:
            REQS.labels("/fraud/review", "order_missing").inc()
            return {"ok": False, "stage": "order", "message": "order not found"}
    except grpc.RpcError as e:
        REQS.labels("/fraud/review", "order_err").inc()
        return {"ok": False, "stage": "order", "message": f"order rpc {e.code().name}"}

    try:
        fraud_stub = _stub_for("fraud", _channel("fraud"))
        score = fraud_stub.Score(
            pb.ScoreRequest(user=o.user, order_id=o.order_id, amount_cents=o.amount_cents),
            timeout=2.0,
        )
        if not score.ok:
            REQS.labels("/fraud/review", "fraud_err").inc()
            return {"ok": False, "stage": "fraud", "message": score.reason}
    except grpc.RpcError as e:
        REQS.labels("/fraud/review", "fraud_rpc_err").inc()
        return {"ok": False, "stage": "fraud", "message": f"fraud rpc {e.code().name}"}

    new_status = {"approve": "paid", "review": "held", "deny": "held"}.get(score.decision, "held")
    try:
        order_stub.UpdateStatus(pb.UpdateOrderStatusRequest(order_id=o.order_id, status=new_status), timeout=1.5)
    except Exception:
        pass

    try:
        notif_stub = _stub_for("notification", _channel("notification"))
        notif_stub.Notify(
            pb.NotifyRequest(user="ops", message=f"Order {o.order_id} -> {new_status} (score={score.score})"),
            timeout=1.5,
        )
    except Exception:
        pass

    REQS.labels("/fraud/review", "ok").inc()
    LAT.labels("/fraud/review").observe(time.time() - t0)
    return {
        "ok": True, "order_id": o.order_id, "decision": score.decision,
        "score": score.score, "new_status": new_status,
    }


# ============== Endpoint 7: recommendations ==============
@app.get("/recommendations/{user}")
def recommendations(user: str, limit: int = 4):
    t0 = time.time()
    try:
        rec_stub = _stub_for("recommendation", _channel("recommendation"))
        rep = rec_stub.Suggest(pb.SuggestRequest(user=user, limit=limit), timeout=2.0)
        if not rep.ok:
            REQS.labels("/recommendations", "rec_fail").inc()
            return {"ok": False, "skus": [], "message": "rec service failed"}
    except grpc.RpcError as e:
        REQS.labels("/recommendations", "rec_err").inc()
        return {"ok": False, "skus": [], "message": f"rec rpc {e.code().name}"}

    # Cross-check stock so we don't recommend out-of-stock SKUs.
    try:
        inv_stub = _stub_for("inventory", _channel("inventory"))
        levels = inv_stub.StockCheck(pb.StockCheckRequest(skus=list(rep.skus)), timeout=1.5)
        in_stock = [lvl.sku for lvl in levels.levels if lvl.remaining > 0]
    except grpc.RpcError as e:
        # Inventory degraded -> return raw recs (graceful degradation).
        in_stock = list(rep.skus)
        publish_event_sync("mesh.events", {
            "type": "downstream_error", "service": SERVICE,
            "downstream": "inventory", "err": f"rpc {e.code().name}",
        })

    REQS.labels("/recommendations", "ok").inc()
    LAT.labels("/recommendations").observe(time.time() - t0)
    return {"ok": True, "skus": in_stock}


# ============== Chaos ==============
@app.post("/chaos/inject")
async def inject(body: FailureIn):
    if body.mode not in ("none", "latency", "errors", "grey"):
        raise HTTPException(400, "invalid mode")
    if body.service not in SERVICE_DEFAULTS:
        raise HTTPException(400, f"unknown service {body.service}")
    publish_event_sync("mesh.chaos", {
        "service": body.service, "mode": body.mode,
        "error_rate": body.error_rate, "latency_ms": body.latency_ms,
        "duration_s": body.duration_s,
    })
    return {"ok": True, "applied_to": body.service, "mode": body.mode}


@app.post("/chaos/clear")
async def clear_chaos(service: str):
    publish_event_sync("mesh.chaos", {
        "service": service, "mode": "none", "error_rate": 0.0,
        "latency_ms": 0, "duration_s": 0,
    })
    return {"ok": True}


# ============== Scripted demo orchestrator ==============
# Per-flow chaos profile + a small traffic burst. Runs in a daemon thread
# so the HTTP call returns immediately. A second call while one is running
# is rejected to keep behavior deterministic.
SCRIPT_LOCK = threading.Lock()
_script_running: dict[str, float] = {}  # flow -> end_ts


SCRIPT_PROFILES = {
    "checkout":        {"target": "payments",   "mode": "errors",  "error_rate": 0.7, "latency_ms": 0,    "duration_s": 30, "burst": 14, "rps": 1.4},
    "refund":          {"target": "payments",   "mode": "errors",  "error_rate": 0.6, "latency_ms": 0,    "duration_s": 30, "burst": 12, "rps": 1.0},
    "cart_merge":      {"target": "inventory",  "mode": "latency", "error_rate": 0.0, "latency_ms": 1700, "duration_s": 30, "burst": 12, "rps": 1.0},
    "restock":         {"target": "recommendation", "mode": "errors", "error_rate": 0.6, "latency_ms": 0, "duration_s": 30, "burst": 10, "rps": 1.0},
    "fraud_review":    {"target": "fraud",      "mode": "grey",    "error_rate": 0.5, "latency_ms": 700,  "duration_s": 30, "burst": 12, "rps": 1.0},
    "recommendations": {"target": "recommendation", "mode": "errors", "error_rate": 0.7, "latency_ms": 0, "duration_s": 30, "burst": 18, "rps": 1.6},
}


def _scripted_demo_thread(flow: str, token: str):
    profile = SCRIPT_PROFILES[flow]
    end_ts = time.time() + profile["duration_s"] + 10
    with SCRIPT_LOCK:
        _script_running[flow] = end_ts
    try:
        # Step 1: inject the curated failure.
        publish_event_sync("mesh.chaos", {
            "service": profile["target"], "mode": profile["mode"],
            "error_rate": profile["error_rate"], "latency_ms": profile["latency_ms"],
            "duration_s": profile["duration_s"],
        })
        log.info(f"scripted demo {flow}: injected {profile['mode']} on {profile['target']}")
        # Step 2: burst traffic against this flow.
        interval = 1.0 / max(0.1, profile["rps"])
        for i in range(profile["burst"]):
            try:
                _drive_flow(flow, token)
            except Exception as e:
                log.warning(f"scripted demo {flow}: drive error {e}")
            time.sleep(interval)
    finally:
        with SCRIPT_LOCK:
            _script_running.pop(flow, None)


def _drive_flow(flow: str, token: str):
    """Hit the right endpoint to exercise a flow. Used by scripted demo."""
    import httpx
    base = "http://localhost:8080"
    if flow == "checkout":
        httpx.post(f"{base}/checkout", json={"token": token, "sku": "sku-1", "qty": 1, "zip": "94103"}, timeout=6.0)
    elif flow == "refund":
        # Place a small order first, then refund it.
        r = httpx.post(f"{base}/orders", json={"token": token, "sku": "sku-1", "qty": 1}, timeout=6.0).json()
        if r.get("ok"):
            httpx.post(f"{base}/refund", json={"token": token, "order_id": r["order_id"]}, timeout=6.0)
    elif flow == "cart_merge":
        httpx.post(f"{base}/cart/merge", json={"token": token, "guest_cart_id": "g1", "skus": ["sku-1", "sku-2", "sku-3"]}, timeout=6.0)
    elif flow == "restock":
        httpx.post(f"{base}/inventory/restock", json={"token": token, "sku": "sku-2", "qty": 5}, timeout=6.0)
    elif flow == "fraud_review":
        r = httpx.post(f"{base}/orders", json={"token": token, "sku": "sku-1", "qty": 1}, timeout=6.0).json()
        if r.get("ok"):
            httpx.post(f"{base}/fraud/review", json={"token": token, "order_id": r["order_id"]}, timeout=6.0)
    elif flow == "recommendations":
        httpx.get(f"{base}/recommendations/demo", timeout=6.0)


@app.post("/demo/scripted")
def scripted_demo(body: ScriptedDemoIn):
    if body.flow not in SCRIPT_PROFILES:
        raise HTTPException(400, f"unknown flow {body.flow}")
    with SCRIPT_LOCK:
        if body.flow in _script_running:
            return {"ok": False, "message": "scripted demo already running for this flow"}
    # Login once to get a token for the burst.
    try:
        ch = _channel("auth")
        stub = pb_grpc.AuthServiceStub(ch)
        rep = stub.Login(pb.LoginRequest(user="demo", password="x"), timeout=2.0)
        token = rep.token
    except Exception as e:
        raise HTTPException(502, f"login failed: {e}")
    threading.Thread(target=_scripted_demo_thread, args=(body.flow, token), daemon=True).start()
    return {"ok": True, "flow": body.flow, "profile": SCRIPT_PROFILES[body.flow]}


@app.get("/demo/status")
def scripted_demo_status():
    now = time.time()
    with SCRIPT_LOCK:
        running = {f: max(0, int(end - now)) for f, end in _script_running.items() if end > now}
    return {"running": running}


# ============== Bootstrap ==============
def main():
    os.environ.setdefault("SERVICE_NAME", SERVICE)
    init_tracing(SERVICE)
    FastAPIInstrumentor.instrument_app(app)
    port = int(os.getenv("PORT", "8080"))
    register(SERVICE, f"{SERVICE}:{port}")
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")


if __name__ == "__main__":
    main()
