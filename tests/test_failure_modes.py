"""Test the FailureState chaos primitive in shared/failure_modes.py.

These tests cover the modes the README documents (errors, latency, grey, none)
and the auto-expiry behavior.
"""
import time
import pytest
from shared.failure_modes import FailureState


def test_default_state_is_inactive_and_healthy():
    s = FailureState()
    assert s.mode == "none"
    assert s.health == "healthy"
    assert s.active() is False
    assert s.apply() is None


def test_clear_resets_all_fields():
    s = FailureState(mode="errors", error_rate=0.5, latency_ms=200, health="degraded")
    s.clear()
    assert s.mode == "none"
    assert s.error_rate == 0.0
    assert s.latency_ms == 0
    assert s.health == "healthy"


def test_errors_mode_at_full_rate_always_returns_error():
    s = FailureState(mode="errors", error_rate=1.0)
    s.until_ts = time.time() + 60
    # 20 trials, all should return "error"
    results = [s.apply() for _ in range(20)]
    assert all(r == "error" for r in results)


def test_errors_mode_at_zero_rate_never_returns_error():
    s = FailureState(mode="errors", error_rate=0.0)
    s.until_ts = time.time() + 60
    results = [s.apply() for _ in range(20)]
    assert all(r is None for r in results)


def test_latency_mode_sleeps_before_returning_none():
    s = FailureState(mode="latency", latency_ms=120)
    s.until_ts = time.time() + 60
    t0 = time.time()
    result = s.apply()
    elapsed = time.time() - t0
    assert result is None  # latency-only never errors
    assert elapsed >= 0.10  # at least 100ms of the 120ms delay


def test_grey_mode_both_slows_and_can_fail():
    s = FailureState(mode="grey", error_rate=1.0, latency_ms=80)
    s.until_ts = time.time() + 60
    t0 = time.time()
    result = s.apply()
    elapsed = time.time() - t0
    assert result == "error"  # error_rate=1.0 means always error
    assert elapsed >= 0.05  # the latency was also applied


def test_state_auto_expires_after_until_ts():
    s = FailureState(mode="errors", error_rate=1.0)
    s.until_ts = time.time() - 1  # already past
    assert s.active() is False  # expired
    assert s.apply() is None  # past expiry -> no chaos
    assert s.mode == "none"  # active() called clear()


def test_state_with_until_ts_zero_means_no_expiry():
    """until_ts=0 is the sentinel for "no expiry"."""
    s = FailureState(mode="errors", error_rate=1.0, until_ts=0.0)
    # The implementation treats until_ts=0 as "forever" via the `if self.until_ts`
    # guard. We just verify that with a fresh state, active() returns True for
    # a chaos mode regardless of until_ts.
    assert s.active() is True
