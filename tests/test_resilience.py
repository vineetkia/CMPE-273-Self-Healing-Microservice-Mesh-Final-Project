"""Test the retry-with-backoff and circuit-breaker primitives in shared/resilience.py.

These are the resilience patterns the README claims the system implements
(Distributed-Systems Concepts table). Test coverage proves they actually work.
"""
import time
import pytest
from shared.resilience import retry_with_backoff, CircuitBreaker, CircuitOpenError


# ============== retry_with_backoff ==============

def test_retry_succeeds_on_first_attempt():
    """No retry should fire if the function succeeds immediately."""
    calls = []
    def fn():
        calls.append(1)
        return "ok"
    assert retry_with_backoff(fn, attempts=3) == "ok"
    assert len(calls) == 1


def test_retry_succeeds_after_transient_failures():
    """The function fails twice, then succeeds; should be called 3 times total."""
    calls = []
    def fn():
        calls.append(1)
        if len(calls) < 3:
            raise RuntimeError("transient")
        return "ok"
    result = retry_with_backoff(fn, attempts=3, base_delay=0.01, max_delay=0.05)
    assert result == "ok"
    assert len(calls) == 3


def test_retry_exhausts_and_raises_last_exception():
    """All attempts fail; the last exception bubbles up."""
    def fn():
        raise ValueError("always broken")
    with pytest.raises(ValueError, match="always broken"):
        retry_with_backoff(fn, attempts=3, base_delay=0.01, max_delay=0.05)


def test_retry_uses_exponential_backoff():
    """100ms, 200ms, 400ms — confirm the wait grows between attempts."""
    timestamps = []
    def fn():
        timestamps.append(time.time())
        raise RuntimeError("nope")
    with pytest.raises(RuntimeError):
        retry_with_backoff(fn, attempts=3, base_delay=0.1, max_delay=1.0)
    # Three attempts, two gaps; second gap should be ~2x the first
    gap1 = timestamps[1] - timestamps[0]
    gap2 = timestamps[2] - timestamps[1]
    assert gap1 >= 0.08  # ~100ms with scheduler jitter
    assert gap2 >= gap1 * 1.5  # second gap is meaningfully longer


# ============== CircuitBreaker ==============

def test_circuit_breaker_starts_closed_and_allows_traffic():
    cb = CircuitBreaker(name="test", fail_threshold=3, reset_after_s=1.0)
    assert cb.state == "closed"
    assert cb.allow() is True


def test_circuit_breaker_opens_after_threshold_failures():
    cb = CircuitBreaker(name="test", fail_threshold=3, reset_after_s=1.0)
    cb.on_failure()
    cb.on_failure()
    assert cb.state == "closed"  # not yet
    cb.on_failure()
    assert cb.state == "open"  # 3rd failure trips it


def test_circuit_breaker_fail_fasts_when_open():
    cb = CircuitBreaker(name="test", fail_threshold=2, reset_after_s=10.0)
    cb.on_failure()
    cb.on_failure()
    assert cb.state == "open"
    assert cb.allow() is False  # would not even probe downstream


def test_circuit_breaker_half_opens_after_reset_window():
    cb = CircuitBreaker(name="test", fail_threshold=2, reset_after_s=0.2)
    cb.on_failure()
    cb.on_failure()
    assert cb.state == "open"
    time.sleep(0.25)
    assert cb.allow() is True
    assert cb.state == "half_open"


def test_circuit_breaker_closes_after_two_successes_in_half_open():
    cb = CircuitBreaker(name="test", fail_threshold=2, reset_after_s=0.1)
    cb.on_failure()
    cb.on_failure()
    time.sleep(0.15)
    cb.allow()  # half_open
    cb.on_success()
    assert cb.state == "half_open"
    cb.on_success()
    assert cb.state == "closed"
    assert cb.failures == 0


def test_circuit_breaker_reopens_on_failure_during_half_open():
    cb = CircuitBreaker(name="test", fail_threshold=2, reset_after_s=0.1)
    cb.on_failure()
    cb.on_failure()
    time.sleep(0.15)
    cb.allow()  # half_open
    cb.on_failure()
    assert cb.state == "open"  # any failure in half_open re-trips
