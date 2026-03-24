"""Failure-mode state shared by services that support chaos injection."""
import os
import random
import time
from dataclasses import dataclass, field


@dataclass
class FailureState:
    mode: str = "none"          # none | latency | errors | grey
    error_rate: float = 0.0     # 0..1
    latency_ms: int = 0
    until_ts: float = 0.0       # 0 = forever, else absolute epoch
    fallback_enabled: bool = False
    health: str = "healthy"     # healthy | degraded | unhealthy

    def active(self) -> bool:
        if self.mode == "none":
            return False
        if self.until_ts and time.time() > self.until_ts:
            self.clear()
            return False
        return True

    def clear(self) -> None:
        self.mode = "none"
        self.error_rate = 0.0
        self.latency_ms = 0
        self.until_ts = 0.0
        self.health = "healthy"

    def apply(self) -> str | None:
        """Run the failure effect inline. Returns 'error' if request should fail.

        Caller decides how to translate into the rpc error.
        """
        if not self.active():
            return None
        if self.mode == "latency":
            time.sleep(self.latency_ms / 1000.0)
            return None
        if self.mode == "errors":
            if random.random() < self.error_rate:
                return "error"
            return None
        if self.mode == "grey":
            # Slow but not failing; partial errors.
            time.sleep(self.latency_ms / 1000.0)
            if random.random() < self.error_rate:
                return "error"
            return None
        return None
