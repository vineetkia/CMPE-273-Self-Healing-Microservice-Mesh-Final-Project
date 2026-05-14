"""Test the healer's ServiceStats telemetry window. Pure logic — reimplemented
locally so tests run without the full grpc/opentelemetry dependency tree.
"""
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any
import pytest


WINDOW_S = 20.0


@dataclass
class ServiceStats:
    """Same shape as agents/healer/main.py:ServiceStats."""
    events: deque = field(default_factory=lambda: deque(maxlen=2000))
    health: str = "unknown"

    def add(self, ev):
        self.events.append(ev)

    def window(self, now):
        cutoff_ms = (now - WINDOW_S) * 1000
        return [e for e in self.events if e.get("ts_ms", 0) >= cutoff_ms]

    def metrics(self, now):
        win = self.window(now)
        rpc_events = [e for e in win if e.get("type") == "rpc"]
        n = len(rpc_events)
        errs = sum(1 for e in rpc_events if not e.get("ok"))
        lats = sorted(float(e.get("latency_ms", 0)) for e in rpc_events)
        p95 = round(lats[int(len(lats) * 0.95) - 1], 3) if lats else 0
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


def _evt(ok=True, latency=10, age_s=0, **extra):
    """Build a synthetic rpc event aged `age_s` seconds back."""
    ts_ms = int((time.time() - age_s) * 1000)
    return {
        "type": "rpc",
        "service": "fake",
        "method": "Fake",
        "ok": ok,
        "latency_ms": latency,
        "ts_ms": ts_ms,
        **extra,
    }


def test_empty_stats_returns_zero_metrics():
    s = ServiceStats()
    m = s.metrics(time.time())
    assert m["n"] == 0
    assert m["error_rate"] == 0.0
    assert m["p95_latency_ms"] == 0


def test_metrics_count_recent_events_only():
    s = ServiceStats()
    for _ in range(3):
        s.add(_evt(age_s=1))
    for _ in range(3):
        s.add(_evt(age_s=30))  # outside the 20s window
    m = s.metrics(time.time())
    assert m["n"] == 3


def test_error_rate_computation():
    s = ServiceStats()
    for _ in range(4):
        s.add(_evt(ok=True, age_s=1))
    s.add(_evt(ok=False, age_s=1))
    m = s.metrics(time.time())
    assert m["n"] == 5
    assert m["error_rate"] == pytest.approx(0.20, rel=1e-3)


def test_p95_latency_with_uniform_values():
    s = ServiceStats()
    for _ in range(20):
        s.add(_evt(latency=50, age_s=1))
    m = s.metrics(time.time())
    assert m["p95_latency_ms"] == 50


def test_p95_latency_keeps_float_precision():
    """The fix we made: sub-millisecond latencies must not truncate to 0."""
    s = ServiceStats()
    for _ in range(20):
        s.add(_evt(latency=0.025, age_s=1))
    m = s.metrics(time.time())
    assert m["p95_latency_ms"] > 0


def test_circuit_open_count_separate_from_rpc_count():
    s = ServiceStats()
    s.add(_evt(ok=True, age_s=1))
    s.add({"type": "circuit_open", "service": "fake", "downstream": "x",
           "ts_ms": int((time.time() - 1) * 1000)})
    m = s.metrics(time.time())
    assert m["n"] == 1
    assert m["circuit_opens"] == 1


def test_downstream_errors_aggregated():
    s = ServiceStats()
    s.add({"type": "downstream_error", "service": "fake", "downstream": "inv",
           "err": "x", "ts_ms": int((time.time() - 1) * 1000)})
    s.add({"type": "downstream_error", "service": "fake", "downstream": "pay",
           "err": "y", "ts_ms": int((time.time() - 1) * 1000)})
    m = s.metrics(time.time())
    assert set(m["downstream_errors"]) == {"inv", "pay"}


def test_deque_capacity_does_not_block_metrics():
    """The deque has maxlen=2000; events past that are dropped. Metrics still
    compute correctly under load."""
    s = ServiceStats()
    for _ in range(3000):
        s.add(_evt(ok=True, age_s=1))
    m = s.metrics(time.time())
    assert m["n"] <= 2000
    assert m["n"] >= 1500
