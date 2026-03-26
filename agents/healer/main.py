"""Self-Healing Agent.

Loop: Observe -> Analyze -> Plan -> Act -> Verify.

Observe:
  - Subscribe to mesh.events on NATS (rpc results, downstream errors, circuit_open).
  - Periodically poll Health() on each service via gRPC.

Analyze (rule-based by default):
  - Compute per-service window stats: error_rate, p95-ish latency, health.
  - 2-of-3 consensus rule: if at least 2 of {error_rate>threshold,
    latency>threshold, health!=healthy} are true -> service is "suspect".
  - Walk dependency graph: a suspect service whose downstream is also suspect
    is a *symptom*; the deepest suspect is the *root cause*.

Plan:
  - For root cause: prefer "clear_failure" (simulated restart). If still bad,
    "mark_degraded". For upstream symptoms: "enable_fallback".

Act: gRPC Control(...) call.

Verify: re-poll for 5s and emit incident summary.

Reasoning backend:
  - PRIMARY: LLM (Azure OpenAI compatible). Set OPENAI_BASE_URL,
    OPENAI_API_KEY, OPENAI_CHAT_MODEL. The LLM receives a telemetry
    snapshot and returns a structured JSON decision: root_cause, suspects,
    symptoms, reasoning, and a list of {service, action} pairs.
  - FALLBACK: deterministic rule engine (2-of-3 consensus + dependency-graph
    walk). Used when the LLM is unreachable, slow, returns invalid JSON, or
    proposes a disallowed action. Guarantees the demo always heals.

Action allowlist enforced regardless of source:
  clear_failure, enable_fallback, disable_fallback, mark_degraded
"""
import asyncio
import json
import os
import time
import threading
from collections import defaultdict, deque
from dataclasses import dataclass, field
from typing import Any

import grpc
import nats
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

import mesh_pb2 as pb
import mesh_pb2_grpc as pb_grpc

from shared.logging import get_logger
from shared.discovery import register, lookup, list_services
from shared.telemetry import init_tracing, publish_event_sync

# Logfire is optional. When the token is missing or the SDK isn't installed,
# all logfire.* calls become no-ops so the demo never depends on it.
try:
    import logfire  # type: ignore
    _LOGFIRE_AVAILABLE = True
except Exception:  # pragma: no cover
    logfire = None  # type: ignore
    _LOGFIRE_AVAILABLE = False

log = get_logger("healer")
SERVICE = "healer"

DEPENDENCIES = {
    "gateway":        ["order", "auth", "inventory", "recommendation"],
    "order":          ["auth", "inventory", "notification", "payments", "fraud", "shipping"],
    "recommendation": ["inventory"],
    "auth":           [],
    "inventory":      [],
    "notification":   [],
    "payments":       [],
    "fraud":          [],
    "shipping":       [],
}
SERVICES_WITH_CONTROL = [
    "auth", "order", "inventory", "notification",
    "payments", "fraud", "shipping", "recommendation",
]

DEFAULT_ADDR = {
    "auth":           "auth:50051",
    "order":          "order:50052",
    "inventory":      "inventory:50053",
    "notification":   "notification:50054",
    "payments":       "payments:50055",
    "fraud":          "fraud:50056",
    "shipping":       "shipping:50057",
    "recommendation": "recommendation:50058",
}

WINDOW_S = 20.0
LATENCY_P95_BAD_MS = 800
ERROR_RATE_BAD = 0.20


@dataclass
class ServiceStats:
    events: deque = field(default_factory=lambda: deque(maxlen=200))
    health: str = "unknown"

    def add(self, ev: dict[str, Any]) -> None:
        self.events.append(ev)

    def window(self, now: float) -> list[dict[str, Any]]:
        cutoff_ms = (now - WINDOW_S) * 1000
        return [e for e in self.events if e.get("ts_ms", 0) >= cutoff_ms]

    def metrics(self, now: float) -> dict[str, Any]:
        win = self.window(now)
        rpc_events = [e for e in win if e.get("type") == "rpc"]
        n = len(rpc_events)
        errs = sum(1 for e in rpc_events if not e.get("ok"))
        lats = sorted(int(e.get("latency_ms", 0)) for e in rpc_events)
        p95 = lats[int(len(lats) * 0.95) - 1] if lats else 0
        return {
            "n": n,
            "error_rate": (errs / n) if n else 0.0,
            "p95_latency_ms": p95,
            "circuit_opens": sum(1 for e in win if e.get("type") == "circuit_open"),
            "downstream_errors": [
                e.get("downstream") for e in win
                if e.get("type") == "downstream_error"
            ],
        }


@dataclass
class IncidentRecord:
    ts_ms: int
    suspects: list[str]
    root_cause: str
    actions: list[dict[str, Any]]
    reasoning: str
    llm_reasoning: str | None = None


# ============== Global state ==============
stats: dict[str, ServiceStats] = defaultdict(ServiceStats)
incidents: deque[IncidentRecord] = deque(maxlen=50)
agent_decisions: deque[dict[str, Any]] = deque(maxlen=200)
last_state: dict[str, Any] = {"running": True}


# ============== HTTP API for the dashboard ==============
api = FastAPI(title="Healer Agent")
api.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@api.get("/health")
def healer_health():
    return {"service": SERVICE, "status": "healthy", "ts_ms": int(time.time()*1000)}


@api.get("/state")
def healer_state():
    now = time.time()
    return {
        "ts_ms": int(now * 1000),
        "services": {s: {**stats[s].metrics(now), "health": stats[s].health}
                     for s in SERVICES_WITH_CONTROL},
        # Return up to 50 incidents so the dashboard's IncidentHistory card
        # can render its "last 50". Capacity matches the deque maxlen.
        "incidents": [vars(i) for i in list(incidents)[-50:]],
        "decisions": list(agent_decisions)[-30:],
    }


@api.get("/incidents")
def healer_incidents():
    return [vars(i) for i in list(incidents)]


# ============== NATS subscriber ==============
async def subscribe_events():
    url = os.getenv("NATS_URL", "nats://nats:4222")
    while True:
        try:
            nc = await nats.connect(url, max_reconnect_attempts=-1)
            log.info("healer connected to nats")

            async def cb(msg):
                try:
                    payload = json.loads(msg.data.decode())
                except Exception:
                    return
                svc = payload.get("service", "unknown")
                stats[svc].add(payload)

            await nc.subscribe("mesh.events", cb=cb)
            while nc.is_connected:
                await asyncio.sleep(1.0)
        except Exception as e:
            log.warning(f"nats connection error: {e}; retrying")
            await asyncio.sleep(2.0)


# ============== Health poller ==============
def _stub_for(svc: str, ch):
    if svc == "auth":           return pb_grpc.AuthServiceStub(ch)
    if svc == "order":          return pb_grpc.OrderServiceStub(ch)
    if svc == "inventory":      return pb_grpc.InventoryServiceStub(ch)
    if svc == "notification":   return pb_grpc.NotificationServiceStub(ch)
    if svc == "payments":       return pb_grpc.PaymentsServiceStub(ch)
    if svc == "fraud":          return pb_grpc.FraudServiceStub(ch)
    if svc == "shipping":       return pb_grpc.ShippingServiceStub(ch)
    if svc == "recommendation": return pb_grpc.RecommendationServiceStub(ch)
    raise ValueError(f"unknown service {svc}")


def poll_health():
    while True:
        for svc in SERVICES_WITH_CONTROL:
            addr = lookup(svc) or DEFAULT_ADDR.get(svc)
            try:
                ch = grpc.insecure_channel(addr)
                stub = _stub_for(svc, ch)
                rep = stub.Health(pb.Empty(), timeout=1.5)
                stats[svc].health = rep.status
            except Exception:
                stats[svc].health = "unreachable"
        time.sleep(2.0)


# ============== Analysis ==============
def is_suspect(metrics: dict[str, Any], health: str) -> tuple[bool, list[str]]:
    """2-of-3 consensus: error_rate > threshold, p95 > threshold, health != healthy."""
    signals = []
    if metrics["error_rate"] >= ERROR_RATE_BAD and metrics["n"] >= 3:
        signals.append(f"error_rate={metrics['error_rate']:.2f}")
    if metrics["p95_latency_ms"] >= LATENCY_P95_BAD_MS and metrics["n"] >= 3:
        signals.append(f"p95_latency_ms={metrics['p95_latency_ms']}")
    if health not in ("healthy", "unknown"):
        signals.append(f"health={health}")
    return (len(signals) >= 2), signals


def find_root_cause(suspects: set[str]) -> str | None:
    """Walk dependency graph. The deepest suspect (no suspect dependency below)
    is the root cause. Among multiple candidates, prefer the one with no
    healthy alternatives.
    """
    if not suspects:
        return None
    # A suspect is root if none of its downstream deps are also suspect.
    candidates = []
    for s in suspects:
        downstream = set(DEPENDENCIES.get(s, []))
        if not (downstream & suspects):
            candidates.append(s)
    if not candidates:
        return next(iter(suspects))
    # Prefer leaf services first; ties broken by historical likelihood.
    priority = {
        "inventory": 0, "payments": 1, "fraud": 2, "shipping": 3,
        "recommendation": 4, "notification": 5, "auth": 6,
        "order": 7, "gateway": 8,
    }
    candidates.sort(key=lambda s: priority.get(s, 99))
    return candidates[0]


# ============== Action ==============
def send_control(svc: str, action: str) -> dict[str, Any]:
    addr = lookup(svc) or DEFAULT_ADDR.get(svc)
    with _lf_span("send_control", service=svc, action=action, addr=addr) as span:
        try:
            ch = grpc.insecure_channel(addr)
            stub = _stub_for(svc, ch)
            rep = stub.Control(pb.ControlRequest(action=action), timeout=2.0)
            span.set_attribute("ok", bool(rep.ok))
            span.set_attribute("message", rep.message)
            return {"service": svc, "action": action, "ok": rep.ok, "message": rep.message}
        except Exception as e:
            span.set_attribute("ok", False)
            span.set_attribute("error", str(e)[:300])
            return {"service": svc, "action": action, "ok": False, "message": str(e)[:200]}


# ============== LLM-driven diagnosis ==============
ALLOWED_ACTIONS = {"clear_failure", "enable_fallback", "disable_fallback", "mark_degraded"}


def _build_observation(now: float) -> dict[str, Any]:
    """Snapshot per-service metrics + health for the LLM to reason over."""
    obs = {}
    for svc in SERVICES_WITH_CONTROL:
        m = stats[svc].metrics(now)
        obs[svc] = {
            "health": stats[svc].health,
            "request_count": m["n"],
            "error_rate": round(m["error_rate"], 3),
            "p95_latency_ms": m["p95_latency_ms"],
            "circuit_opens_in_window": m["circuit_opens"],
            "downstream_errors": m["downstream_errors"],
        }
    return obs


_LLM_SYSTEM_PROMPT = """You are the reasoning core of an autonomous Site Reliability Engineering agent for a microservice mesh.

Your job: given a snapshot of per-service telemetry, identify the root cause of any incident and decide what remediation actions to take.

Topology (caller -> dependencies):
  gateway        -> [order, auth, inventory, recommendation]
  order          -> [auth, inventory, notification, payments, fraud, shipping]
  recommendation -> [inventory]
  auth, inventory, notification, payments, fraud, shipping -> []

The mesh exposes several real e-commerce flows: checkout (order+fraud+payments+shipping+notify), refund (payments+inventory+notify), cart_merge (inventory), restock (inventory+recommendation), fraud_review (fraud+notify), recommendations (recommendation+inventory).

Rules of thumb:
- A service is "suspect" if at least 2 of these are true: error_rate >= 0.20, p95_latency_ms >= 800, health is "degraded" or "unhealthy".
- Among suspects, the ROOT CAUSE is the one whose downstream dependencies are NOT also suspect (deepest in the graph). Upstream suspects are SYMPTOMS, not root causes.
- Prefer leaf services (inventory, payments, fraud, shipping, recommendation, notification, auth) as root causes when ambiguous; gateway and order should rarely be root causes — they aggregate symptoms.

Allowed remediation actions (you MUST only choose from these):
- {"service": "<svc>", "action": "clear_failure"}    # simulate a restart, root cause healing
- {"service": "<svc>", "action": "enable_fallback"}  # tell upstream to degrade gracefully when downstream is bad
- {"service": "<svc>", "action": "disable_fallback"} # turn fallback off
- {"service": "<svc>", "action": "mark_degraded"}    # mark service as degraded

Standard response when there IS an incident:
- Send `clear_failure` to the root cause.
- Send `enable_fallback` to every direct upstream of the root cause that itself appears in the topology.

If no service is suspect, return an empty incident.

You MUST respond with ONLY a JSON object, no prose, matching:
{
  "incident": true | false,
  "root_cause": "<service-name or empty string>",
  "suspects": ["<svc>", ...],
  "symptoms": ["<svc>", ...],
  "reasoning": "<one paragraph explaining the diagnosis>",
  "actions": [{"service": "<svc>", "action": "<allowed-action>"}, ...]
}
"""


def llm_diagnose(observation: dict[str, Any]) -> dict[str, Any] | None:
    """Ask the LLM to diagnose. Returns parsed dict or None on any failure."""
    base = os.getenv("OPENAI_BASE_URL")
    key = os.getenv("OPENAI_API_KEY")
    model = os.getenv("OPENAI_CHAT_MODEL")
    if not (base and key and model):
        return None

    with _lf_span("llm_diagnose", model=model) as span:
        t0 = time.time()
        try:
            import httpx
            url = base.rstrip("/") + "/chat/completions"
            body = {
                "model": model,
                "messages": [
                    {"role": "system", "content": _LLM_SYSTEM_PROMPT},
                    {"role": "user", "content": "Telemetry snapshot:\n" + json.dumps(observation, indent=2)},
                ],
                "response_format": {"type": "json_object"},
            }
            span.set_attribute("observation", observation)
            r = httpx.post(
                url,
                headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json", "api-key": key},
                json=body,
                timeout=20.0,
            )
            r.raise_for_status()
            data = r.json()
            content = data["choices"][0]["message"]["content"]
            usage = data.get("usage", {}) or {}
            span.set_attribute("prompt_tokens", usage.get("prompt_tokens"))
            span.set_attribute("completion_tokens", usage.get("completion_tokens"))
            span.set_attribute("total_tokens", usage.get("total_tokens"))
            span.set_attribute("latency_ms", int((time.time() - t0) * 1000))

            parsed = json.loads(content)
            # Validate shape and action allowlist.
            if not isinstance(parsed, dict):
                span.set_attribute("rejected", "non_dict_response")
                return None
            for a in parsed.get("actions", []):
                if not isinstance(a, dict):
                    span.set_attribute("rejected", "non_dict_action")
                    return None
                if a.get("service") not in SERVICES_WITH_CONTROL:
                    log.warning(f"llm: rejecting action on unknown service {a.get('service')}")
                    span.set_attribute("rejected", f"unknown_service:{a.get('service')}")
                    return None
                if a.get("action") not in ALLOWED_ACTIONS:
                    log.warning(f"llm: rejecting disallowed action {a.get('action')}")
                    span.set_attribute("rejected", f"disallowed_action:{a.get('action')}")
                    return None
            span.set_attribute("root_cause", parsed.get("root_cause"))
            span.set_attribute("suspects", parsed.get("suspects"))
            span.set_attribute("actions", parsed.get("actions"))
            span.set_attribute("reasoning", parsed.get("reasoning"))
            return parsed
        except Exception as e:
            log.warning(f"llm_diagnose failed: {e}")
            span.set_attribute("error", str(e)[:300])
            span.set_attribute("latency_ms", int((time.time() - t0) * 1000))
            return None


def rule_based_diagnose(now: float) -> dict[str, Any]:
    """The original deterministic logic, kept as fallback."""
    suspects: dict[str, dict[str, Any]] = {}
    for svc in SERVICES_WITH_CONTROL:
        m = stats[svc].metrics(now)
        ok, signals = is_suspect(m, stats[svc].health)
        if ok:
            suspects[svc] = {"signals": signals, "metrics": m, "health": stats[svc].health}

    if not suspects:
        return {"incident": False, "root_cause": "", "suspects": [], "symptoms": [],
                "reasoning": "no suspects (rules)", "actions": []}

    root = find_root_cause(set(suspects.keys()))
    symptoms = [s for s in suspects if s != root]

    actions = []
    if root:
        actions.append({"service": root, "action": "clear_failure"})
        for upstream, deps in DEPENDENCIES.items():
            if root in deps and upstream in SERVICES_WITH_CONTROL:
                actions.append({"service": upstream, "action": "enable_fallback"})

    reasoning = (
        f"rule-based RCA: suspects={list(suspects.keys())}, "
        f"root_cause={root} (deepest in dependency graph), "
        f"symptoms={symptoms}, signals={ {s: suspects[s]['signals'] for s in suspects} }"
    )
    return {
        "incident": True, "root_cause": root or "", "suspects": list(suspects.keys()),
        "symptoms": symptoms, "reasoning": reasoning, "actions": actions,
    }


# ============== Main loop ==============
def control_loop():
    last_action_ts: dict[str, float] = {}
    cooldown_s = 12.0
    llm_enabled = bool(os.getenv("OPENAI_API_KEY") and os.getenv("OPENAI_BASE_URL")
                       and os.getenv("OPENAI_CHAT_MODEL"))
    log.info(f"control loop starting; llm_enabled={llm_enabled}")

    while True:
        try:
            now = time.time()
            observation = _build_observation(now)

            # Cheap pre-check: if no service shows any anomaly signals, skip the LLM.
            anomaly = any(
                o["error_rate"] >= 0.10
                or o["p95_latency_ms"] >= 500
                or o["health"] not in ("healthy", "unknown")
                for o in observation.values()
            )
            if not anomaly:
                time.sleep(2.0)
                continue

            with _lf_span("incident_iteration") as span:
                span.set_attribute("anomaly_observation", observation)

                decision: dict[str, Any] | None = None
                decision_source = "rules"

                if llm_enabled:
                    decision = llm_diagnose(observation)
                    if decision is not None:
                        decision_source = "llm"
                    else:
                        log.warning("LLM diagnosis unavailable; falling back to rules")
                        _lf_warn("llm fallback to rules")

                if decision is None:
                    decision = rule_based_diagnose(now)

                if not decision.get("incident"):
                    span.set_attribute("incident", False)
                    span.set_attribute("decision_source", decision_source)
                    time.sleep(2.0)
                    continue

                root = decision.get("root_cause") or ""
                suspects = decision.get("suspects") or []
                symptoms = decision.get("symptoms") or []
                reasoning = decision.get("reasoning") or ""
                planned_actions = decision.get("actions") or []

                span.set_attribute("incident", True)
                span.set_attribute("decision_source", decision_source)
                span.set_attribute("root_cause", root)
                span.set_attribute("suspects", suspects)
                span.set_attribute("symptoms", symptoms)
                span.set_attribute("reasoning", reasoning)

                log.info(f"[{decision_source}] RCA: root={root} suspects={suspects} "
                         f"symptoms={symptoms} actions={planned_actions}")

                executed: list[dict[str, Any]] = []
                skipped_cooldown: list[dict[str, Any]] = []
                for a in planned_actions:
                    svc = a.get("service")
                    act = a.get("action")
                    if svc not in SERVICES_WITH_CONTROL or act not in ALLOWED_ACTIONS:
                        continue
                    if (now - last_action_ts.get(svc, 0)) <= cooldown_s:
                        skipped_cooldown.append({"service": svc, "action": act})
                        continue
                    executed.append(send_control(svc, act))
                    last_action_ts[svc] = now

                span.set_attribute("executed_actions", executed)
                span.set_attribute("skipped_cooldown", skipped_cooldown)

                inc = IncidentRecord(
                    ts_ms=int(now * 1000),
                    suspects=suspects,
                    root_cause=root,
                    actions=executed,
                    reasoning=f"[{decision_source}] {reasoning}",
                    llm_reasoning=reasoning if decision_source == "llm" else None,
                )
                incidents.append(inc)
                for a in executed:
                    agent_decisions.append({"ts_ms": int(now * 1000), "source": decision_source, **a})
                publish_event_sync("mesh.events", {
                    "type": "agent_action", "service": SERVICE,
                    "source": decision_source, "root_cause": root, "actions": executed,
                })

            # Verify: short pause and let next iteration re-evaluate.
            time.sleep(5.0)
        except Exception as e:
            log.warning(f"control loop error: {e}")
            time.sleep(2.0)


def init_logfire() -> bool:
    """Configure Logfire if the SDK is installed and a token is available.

    Returns True when Logfire is fully wired up, False otherwise. When False,
    every logfire.* call we make in this module is guarded so it becomes a
    no-op; the demo continues to run identically.
    """
    if not _LOGFIRE_AVAILABLE:
        log.info("logfire SDK not installed; skipping")
        return False
    token = os.getenv("LOGFIRE_TOKEN", "").strip()
    if not token:
        log.info("LOGFIRE_TOKEN not set; logfire disabled")
        return False
    try:
        logfire.configure(
            service_name=SERVICE,
            token=token,
            send_to_logfire=True,
            console=False,
        )
        # We intentionally do NOT call logfire.instrument_httpx() here:
        # Logfire registers its own MeterProvider on top of the existing
        # OTel SDK and the auto-instrumentation collides. The manual spans
        # on llm_diagnose already capture token usage and latency.
        #
        # The OTel SDK logs "Transient error ... Connection reset by peer"
        # at WARNING when an exporter retries — common when shipping to
        # Logfire under load. Drop those to ERROR so they only show on
        # genuine, unrecoverable failures.
        import logging
        logging.getLogger("opentelemetry.sdk.trace.export").setLevel(logging.ERROR)
        logging.getLogger("opentelemetry.sdk.metrics.export").setLevel(logging.ERROR)
        log.info("logfire configured")
        return True
    except Exception as e:
        log.warning(f"logfire configure failed: {e}")
        return False


_LOGFIRE_ENABLED = False  # set in main()


def _lf_span(name: str, **attrs):
    """Return a Logfire span context manager, or a no-op when disabled."""
    if _LOGFIRE_ENABLED:
        return logfire.span(name, **attrs)

    class _Noop:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def set_attribute(self, *a, **k): pass

    return _Noop()


def _lf_info(msg: str, **attrs):
    if _LOGFIRE_ENABLED:
        try:
            logfire.info(msg, **attrs)
        except Exception:
            pass


def _lf_warn(msg: str, **attrs):
    if _LOGFIRE_ENABLED:
        try:
            logfire.warn(msg, **attrs)
        except Exception:
            pass


def main():
    global _LOGFIRE_ENABLED
    os.environ.setdefault("SERVICE_NAME", SERVICE)
    init_tracing(SERVICE)
    _LOGFIRE_ENABLED = init_logfire()
    api_port = int(os.getenv("PORT", "8090"))
    register(SERVICE, f"{SERVICE}:{api_port}")

    # NATS subscriber in its own thread (async loop).
    def _nats_thread():
        asyncio.run(subscribe_events())
    threading.Thread(target=_nats_thread, daemon=True).start()

    threading.Thread(target=poll_health, daemon=True).start()
    threading.Thread(target=control_loop, daemon=True).start()

    uvicorn.run(api, host="0.0.0.0", port=api_port, log_level="info")


if __name__ == "__main__":
    main()
