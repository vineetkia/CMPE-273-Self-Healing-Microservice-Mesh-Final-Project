"""Subscribe to mesh.chaos NATS events and update FailureState."""
import asyncio
import json
import os
import threading
import time
import nats

from .logging import get_logger
from .failure_modes import FailureState

log = get_logger(__name__)


def start(service_name: str, state: FailureState) -> None:
    """Run a daemon thread that listens for chaos events for this service."""
    def _run():
        asyncio.run(_loop(service_name, state))
    threading.Thread(target=_run, daemon=True).start()


async def _loop(service_name: str, state: FailureState) -> None:
    url = os.getenv("NATS_URL", "nats://nats:4222")
    while True:
        try:
            nc = await nats.connect(url, max_reconnect_attempts=-1)
            log.info(f"chaos listener connected for {service_name}")

            async def handler(msg):
                try:
                    payload = json.loads(msg.data.decode())
                except Exception:
                    return
                if payload.get("service") != service_name:
                    return
                mode = payload.get("mode", "none")
                if mode == "none":
                    state.clear()
                    log.info(f"chaos cleared for {service_name}")
                    return
                state.mode = mode
                state.error_rate = float(payload.get("error_rate", 0.0))
                state.latency_ms = int(payload.get("latency_ms", 0))
                duration = int(payload.get("duration_s", 0))
                state.until_ts = time.time() + duration if duration > 0 else 0.0
                if mode in ("errors", "grey"):
                    state.health = "degraded"
                log.info(f"chaos applied to {service_name}: mode={mode} "
                         f"err={state.error_rate} lat={state.latency_ms}ms dur={duration}s")

            await nc.subscribe("mesh.chaos", cb=handler)
            # Keep connection open.
            while nc.is_connected:
                await asyncio.sleep(1.0)
        except Exception as e:
            log.warning(f"chaos listener error: {e}; retrying in 2s")
            await asyncio.sleep(2.0)
