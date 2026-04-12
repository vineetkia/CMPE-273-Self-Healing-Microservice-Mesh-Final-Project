import os
import time
import uuid
import hashlib
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

# In-memory user + token stores. Demo-only; lost on restart.
# user_id -> { display_name, email, password_hash, created_ts_ms }
_USERS: dict[str, dict] = {}
# token -> user_id
_TOKENS: dict[str, str] = {}
_USERS_LOCK = threading.Lock()


def _hash(pw: str) -> str:
    # SHA256 with a fixed salt — demo only, not production.
    return hashlib.sha256(("mesh-control:" + pw).encode()).hexdigest()


def _seed_demo_user():
    """Seed a known account so the dashboard's pre-baked demo flows can log in."""
    if "demo" in _USERS:
        return
    _USERS["demo"] = {
        "display_name": "Demo User",
        "email": "demo@meshcontrol.dev",
        "password_hash": _hash("x"),
        "created_ts_ms": int(time.time() * 1000),
    }


_seed_demo_user()


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
            return pb.LoginReply(ok=False, token="", message="service unavailable")

        with _USERS_LOCK:
            user = _USERS.get(request.user)
            ok = user is not None and user["password_hash"] == _hash(request.password)

        if not ok:
            REQS.labels("login", "denied").inc()
            publish_event_sync("mesh.events", {
                "type": "rpc", "service": SERVICE, "method": "Login",
                "ok": False, "latency_ms": int((time.time() - t0) * 1000),
            })
            return pb.LoginReply(ok=False, token="", message="invalid credentials")

        token = f"t-{request.user}-{uuid.uuid4().hex[:12]}"
        _TOKENS[token] = request.user
        REQS.labels("login", "ok").inc()
        publish_event_sync("mesh.events", {
            "type": "rpc", "service": SERVICE, "method": "Login",
            "ok": True, "latency_ms": int((time.time() - t0) * 1000),
        })
        return pb.LoginReply(ok=True, token=token, message="ok")

    def Register(self, request, context):
        t0 = time.time()
        if state.apply() == "error":
            REQS.labels("register", "err").inc()
            context.set_code(grpc.StatusCode.UNAVAILABLE)
            return pb.RegisterReply(ok=False, token="", user="", message="service unavailable")

        # Derive a user_id from the email's local-part. Lossy on collisions
        # — acceptable for a demo. Empty/invalid email → reject.
        email = (request.email or "").strip().lower()
        if "@" not in email or len(email) < 5:
            REQS.labels("register", "bad_email").inc()
            return pb.RegisterReply(ok=False, token="", user="", message="invalid email")
        if not request.password or len(request.password) < 4:
            REQS.labels("register", "weak_password").inc()
            return pb.RegisterReply(ok=False, token="", user="", message="password must be 4+ characters")

        user_id = email.split("@")[0]
        with _USERS_LOCK:
            if user_id in _USERS:
                REQS.labels("register", "conflict").inc()
                return pb.RegisterReply(ok=False, token="", user="", message="account already exists")
            _USERS[user_id] = {
                "display_name": request.display_name or user_id,
                "email": email,
                "password_hash": _hash(request.password),
                "created_ts_ms": int(time.time() * 1000),
            }
        token = f"t-{user_id}-{uuid.uuid4().hex[:12]}"
        _TOKENS[token] = user_id
        REQS.labels("register", "ok").inc()
        publish_event_sync("mesh.events", {
            "type": "rpc", "service": SERVICE, "method": "Register",
            "ok": True, "latency_ms": int((time.time() - t0) * 1000),
        })
        return pb.RegisterReply(ok=True, token=token, user=user_id, message="account created")

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

    def GetMe(self, request, context):
        user_id = _TOKENS.get(request.token)
        if not user_id:
            return pb.GetMeReply(ok=False)
        with _USERS_LOCK:
            u = _USERS.get(user_id)
        if not u:
            return pb.GetMeReply(ok=False)
        return pb.GetMeReply(
            ok=True, user=user_id,
            display_name=u["display_name"], email=u["email"],
            created_ts_ms=u["created_ts_ms"],
        )

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
