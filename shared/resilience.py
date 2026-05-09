import time
from dataclasses import dataclass, field
from typing import Callable, TypeVar

T = TypeVar("T")


def retry_with_backoff(
    fn: Callable[[], T],
    attempts: int = 3,
    base_delay: float = 0.1,
    max_delay: float = 1.0,
) -> T:
    last_err: Exception | None = None
    delay = base_delay
    for i in range(attempts):
        try:
            return fn()
        except Exception as e:
            last_err = e
            if i == attempts - 1:
                break
            time.sleep(min(delay, max_delay))
            delay *= 2
    assert last_err is not None
    raise last_err


@dataclass
class CircuitBreaker:
    """Simple counter-based circuit breaker.

    States: closed (normal) -> open (fail fast) -> half_open (probe) -> closed.
    """
    name: str
    fail_threshold: int = 5
    reset_after_s: float = 10.0

    state: str = "closed"
    failures: int = 0
    opened_at: float = 0.0
    successes_in_half: int = 0

    def allow(self) -> bool:
        if self.state == "open":
            if time.time() - self.opened_at >= self.reset_after_s:
                self.state = "half_open"
                self.successes_in_half = 0
                return True
            return False
        return True

    def on_success(self) -> None:
        if self.state == "half_open":
            self.successes_in_half += 1
            if self.successes_in_half >= 2:
                self.state = "closed"
                self.failures = 0
        else:
            self.failures = 0

    def on_failure(self) -> None:
        self.failures += 1
        if self.state == "half_open" or self.failures >= self.fail_threshold:
            self.state = "open"
            self.opened_at = time.time()


class CircuitOpenError(RuntimeError):
    pass
