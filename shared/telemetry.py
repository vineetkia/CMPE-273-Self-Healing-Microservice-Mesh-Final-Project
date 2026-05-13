import asyncio
import json
import os
import queue
import threading
import time
from typing import Any

import nats
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.instrumentation.grpc import GrpcInstrumentorClient, GrpcInstrumentorServer

from .logging import get_logger

log = get_logger(__name__)

_tracer_initialized = False


def init_tracing(service_name: str) -> trace.Tracer:
    """Initialize OpenTelemetry tracing exporting to OTel collector via OTLP/gRPC."""
    global _tracer_initialized
    if _tracer_initialized:
        return trace.get_tracer(service_name)
    endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://otel-collector:4317")
    resource = Resource.create({"service.name": service_name})
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(
        BatchSpanProcessor(OTLPSpanExporter(endpoint=endpoint, insecure=True))
    )
    trace.set_tracer_provider(provider)
    try:
        GrpcInstrumentorServer().instrument()
        GrpcInstrumentorClient().instrument()
    except Exception as e:
        log.warning(f"grpc instrumentation failed: {e}")
    _tracer_initialized = True
    return trace.get_tracer(service_name)


# ============== Async-style publisher used by async code (gateway routes) ==============
# A dedicated background thread owns one persistent NATS connection. Sync code
# (gRPC handlers) calls publish_event_sync() which enqueues to this thread.
# Async code (FastAPI routes) calls publish_event() which awaits a future
# resolved on the same background loop.

_pub_q: queue.Queue[tuple[str, dict[str, Any]]] = queue.Queue(maxsize=10000)
_pub_thread_started = False
_pub_lock = threading.Lock()


async def _publisher_loop() -> None:
    url = os.getenv("NATS_URL", "nats://nats:4222")
    nc: nats.NATS | None = None
    loop = asyncio.get_event_loop()
    while True:
        try:
            if nc is None or not nc.is_connected:
                nc = await nats.connect(url, max_reconnect_attempts=-1)
                log.info("telemetry publisher connected to nats")
            try:
                subject, payload = await loop.run_in_executor(
                    None, lambda: _pub_q.get(timeout=0.5)
                )
            except queue.Empty:
                continue
            try:
                await nc.publish(subject, json.dumps(payload).encode())
            except Exception as e:
                log.warning(f"nats publish failed: {e}")
        except Exception as e:
            log.warning(f"telemetry publisher error: {e}; retrying")
            await asyncio.sleep(2.0)


def _ensure_publisher() -> None:
    global _pub_thread_started
    with _pub_lock:
        if _pub_thread_started:
            return

        def _run():
            asyncio.run(_publisher_loop())

        threading.Thread(target=_run, daemon=True).start()
        _pub_thread_started = True


def elapsed_ms(t0: float) -> float:
    """Return wall-clock elapsed since t0 in milliseconds, with sub-ms precision.

    Most of our gRPC handlers complete in <1 ms; the old `int((now-t0)*1000)`
    truncated those to 0, which made the dashboard's p95 read 0 for every
    leaf service. Returning a float preserves the actual signal — the healer
    averages and percentiles over it, and the UI rounds for display.
    """
    return (time.time() - t0) * 1000.0


def publish_event_sync(subject: str, payload: dict[str, Any]) -> None:
    """Fire-and-forget. Safe to call from any sync context."""
    payload.setdefault("ts_ms", int(time.time() * 1000))
    payload.setdefault("service", os.getenv("SERVICE_NAME", "unknown"))
    _ensure_publisher()
    try:
        _pub_q.put_nowait((subject, payload))
    except queue.Full:
        pass  # drop on overflow


async def publish_event(subject: str, payload: dict[str, Any]) -> None:
    """Async-style API; under the hood it's the same fire-and-forget queue."""
    publish_event_sync(subject, payload)
