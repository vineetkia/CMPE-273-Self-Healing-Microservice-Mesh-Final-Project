"""Test the elapsed_ms helper from shared/telemetry.py — reimplemented locally
so tests don't pull in the OpenTelemetry stack.
"""
import time
from pathlib import Path


def elapsed_ms(t0: float) -> float:
    """Same as shared/telemetry.elapsed_ms — sub-ms precision via float."""
    return (time.time() - t0) * 1000.0


def test_elapsed_ms_returns_a_float():
    t0 = time.time()
    result = elapsed_ms(t0)
    assert isinstance(result, float)


def test_elapsed_ms_value_is_close_to_zero_immediately():
    t0 = time.time()
    result = elapsed_ms(t0)
    assert 0 <= result < 5.0


def test_elapsed_ms_value_is_close_to_sleep_duration():
    t0 = time.time()
    time.sleep(0.05)  # 50 ms
    result = elapsed_ms(t0)
    assert 40 <= result <= 90  # wall-clock jitter


def test_elapsed_ms_preserves_sub_millisecond_precision():
    """The original bug: int((time.time() - t0) * 1000) truncated to 0."""
    samples = []
    for _ in range(100):
        t = time.time()
        samples.append(elapsed_ms(t))
    # At least some samples should be < 1.0 (sub-ms)
    assert any(s < 1.0 for s in samples)
    # All samples are floats
    assert all(isinstance(s, float) for s in samples)


def test_production_telemetry_file_uses_float_math():
    """Drift check: shared/telemetry.py still uses the float-based helper."""
    p = Path(__file__).resolve().parent.parent / "shared" / "telemetry.py"
    src = p.read_text()
    assert "def elapsed_ms" in src
    assert "1000.0" in src
