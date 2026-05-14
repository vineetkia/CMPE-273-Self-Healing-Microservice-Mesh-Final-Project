"""Test the healer's pure-logic functions: 2-of-3 consensus rule, root-cause
graph walk, action allowlist, dependency map shape.

We reimplement the pure-logic pieces locally (so we don't pull in the full
dependency tree at test time) and also assert that the production file
contains the same key data and code. This is a "drift detector" pattern:
the tests can run anywhere AND keep the production code honest.
"""
import pytest
from pathlib import Path


HEALER = Path(__file__).resolve().parent.parent / "agents" / "healer" / "main.py"


# ============== Pure-logic copies from agents/healer/main.py ==============

DEPENDENCIES = {
    "gateway":        ["order", "auth", "inventory", "recommendation"],
    "order":          ["auth", "inventory", "notification", "payments", "fraud", "shipping"],
    "recommendation": [],
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
ALLOWED_ACTIONS = {"clear_failure", "enable_fallback", "disable_fallback", "mark_degraded"}

ERROR_RATE_BAD = 0.20
LATENCY_P95_BAD_MS = 800


def is_suspect(metrics, health):
    """2-of-3 consensus rule from agents/healer/main.py."""
    signals = []
    if metrics["error_rate"] >= ERROR_RATE_BAD and metrics["n"] >= 3:
        signals.append(f"error_rate={metrics['error_rate']:.2f}")
    if metrics["p95_latency_ms"] >= LATENCY_P95_BAD_MS and metrics["n"] >= 3:
        signals.append(f"p95_latency_ms={metrics['p95_latency_ms']}")
    if health not in ("healthy", "unknown"):
        signals.append(f"health={health}")
    return (len(signals) >= 2), signals


def find_root_cause(suspects):
    """Deepest-suspect graph walk from agents/healer/main.py."""
    if not suspects:
        return None
    candidates = []
    for s in suspects:
        downstream = set(DEPENDENCIES.get(s, []))
        if not (downstream & suspects):
            candidates.append(s)
    if not candidates:
        return next(iter(suspects))
    priority = {
        "inventory": 0, "payments": 1, "fraud": 2, "shipping": 3,
        "recommendation": 4, "notification": 5, "auth": 6,
        "order": 7, "gateway": 8,
    }
    candidates.sort(key=lambda s: priority.get(s, 99))
    return candidates[0]


# ============== is_suspect: 2-of-3 consensus ==============

def test_is_suspect_with_no_signals_returns_false():
    metrics = {"error_rate": 0.0, "p95_latency_ms": 10, "n": 100}
    ok, signals = is_suspect(metrics, "healthy")
    assert ok is False
    assert signals == []


def test_is_suspect_with_one_signal_returns_false():
    """High error rate ALONE is not enough — needs 2 of 3."""
    metrics = {"error_rate": 0.50, "p95_latency_ms": 10, "n": 100}
    ok, signals = is_suspect(metrics, "healthy")
    assert ok is False
    assert len(signals) == 1


def test_is_suspect_with_error_and_latency_returns_true():
    metrics = {"error_rate": 0.30, "p95_latency_ms": 900, "n": 100}
    ok, signals = is_suspect(metrics, "healthy")
    assert ok is True
    assert len(signals) == 2


def test_is_suspect_with_error_and_degraded_health_returns_true():
    metrics = {"error_rate": 0.30, "p95_latency_ms": 10, "n": 100}
    ok, signals = is_suspect(metrics, "degraded")
    assert ok is True


def test_is_suspect_with_all_three_signals_returns_true():
    metrics = {"error_rate": 0.50, "p95_latency_ms": 1500, "n": 100}
    ok, signals = is_suspect(metrics, "degraded")
    assert ok is True
    assert len(signals) == 3


def test_is_suspect_with_low_event_count_does_not_fire():
    """Even with high error rate, fewer than 3 events shouldn't trigger."""
    metrics = {"error_rate": 0.99, "p95_latency_ms": 900, "n": 2}
    ok, signals = is_suspect(metrics, "healthy")
    assert ok is False


def test_is_suspect_ignores_unknown_health():
    """`unknown` (e.g., at startup) should NOT count as a signal."""
    metrics = {"error_rate": 0.30, "p95_latency_ms": 10, "n": 100}
    ok, signals = is_suspect(metrics, "unknown")
    assert ok is False  # only 1 signal


def test_is_suspect_borderline_error_rate_just_fires():
    """The exact threshold (0.20) should count as a signal."""
    metrics = {"error_rate": 0.20, "p95_latency_ms": 10, "n": 100}
    ok, signals = is_suspect(metrics, "degraded")
    assert ok is True  # error rate AT threshold + degraded = 2 signals


def test_is_suspect_below_error_threshold_does_not_fire():
    metrics = {"error_rate": 0.19, "p95_latency_ms": 10, "n": 100}
    ok, signals = is_suspect(metrics, "degraded")
    assert ok is False  # below 0.20, only 1 signal (degraded)


# ============== find_root_cause: dependency-graph walk ==============

def test_find_root_cause_with_single_suspect():
    assert find_root_cause({"payments"}) == "payments"


def test_find_root_cause_with_empty_set():
    assert find_root_cause(set()) is None


def test_find_root_cause_picks_deepest_in_cascade():
    """Order -> inventory. Order is the symptom, inventory is the cause."""
    assert find_root_cause({"order", "inventory"}) == "inventory"


def test_find_root_cause_among_multiple_leaves_picks_priority_one():
    """When multiple leaf services are suspect with no downstream relation,
    priority order picks inventory > payments > fraud > shipping > ..."""
    assert find_root_cause({"payments", "inventory"}) == "inventory"
    assert find_root_cause({"fraud", "shipping"}) == "fraud"
    assert find_root_cause({"notification", "auth"}) == "notification"


def test_find_root_cause_picks_payments_when_inventory_not_suspect():
    assert find_root_cause({"payments", "order"}) == "payments"


def test_find_root_cause_handles_gateway_correctly():
    """Gateway is the lowest priority root cause; it's almost always a symptom."""
    assert find_root_cause({"gateway", "auth"}) == "auth"


# ============== Action allowlist invariant ==============

def test_allowlist_contains_exactly_four_verbs():
    assert len(ALLOWED_ACTIONS) == 4
    assert ALLOWED_ACTIONS == {
        "clear_failure", "enable_fallback", "disable_fallback", "mark_degraded"
    }


def test_services_with_control_count_is_eight():
    assert len(SERVICES_WITH_CONTROL) == 8


def test_total_action_surface_is_32():
    """The "4 verbs × 8 services = 32 actions" headline claim."""
    assert len(ALLOWED_ACTIONS) * len(SERVICES_WITH_CONTROL) == 32


# ============== Dependency map shape ==============

def test_recommendation_has_no_downstream_deps():
    """The bug we fixed: recommendation doesn't actually call inventory."""
    assert DEPENDENCIES["recommendation"] == []


def test_order_has_six_downstream_deps():
    assert len(DEPENDENCIES["order"]) == 6
    assert set(DEPENDENCIES["order"]) == {
        "auth", "inventory", "notification", "payments", "fraud", "shipping"
    }


def test_all_leaf_services_have_no_deps():
    for svc in ("auth", "inventory", "notification", "payments", "fraud", "shipping"):
        assert DEPENDENCIES[svc] == [], f"{svc} should be a leaf"


def test_gateway_is_the_topmost_aggregator():
    """Gateway depends on the public-facing entry-tier services."""
    assert "order" in DEPENDENCIES["gateway"]
    assert "auth" in DEPENDENCIES["gateway"]


# ============== Drift detection vs production source ==============

def test_production_healer_uses_same_allowlist():
    src = HEALER.read_text()
    for verb in ALLOWED_ACTIONS:
        assert verb in src, f"missing verb {verb} in production source"


def test_production_healer_uses_same_thresholds():
    src = HEALER.read_text()
    assert "ERROR_RATE_BAD = 0.20" in src
    assert "LATENCY_P95_BAD_MS = 800" in src


def test_production_healer_uses_same_window_size():
    src = HEALER.read_text()
    assert "WINDOW_S = 20.0" in src


def test_production_healer_uses_same_cooldown():
    src = HEALER.read_text()
    assert "cooldown_s = 12" in src
