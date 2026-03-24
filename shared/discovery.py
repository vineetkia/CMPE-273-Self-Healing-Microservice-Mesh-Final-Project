import os
import time
from etcd3 import Client
from .logging import get_logger

log = get_logger(__name__)

_PREFIX = "/mesh/services/"


def _client() -> Client:
    host = os.getenv("ETCD_HOST", "etcd")
    port = int(os.getenv("ETCD_PORT", "2379"))
    return Client(host=host, port=port)


def register(service_name: str, address: str, retries: int = 30) -> None:
    """Register service. Retries because etcd may not be ready yet."""
    last_err = None
    for _ in range(retries):
        try:
            c = _client()
            c.put(f"{_PREFIX}{service_name}", address)
            log.info(f"registered {service_name} -> {address}")
            return
        except Exception as e:
            last_err = e
            time.sleep(1)
    raise RuntimeError(f"could not register {service_name}: {last_err}")


def lookup(service_name: str) -> str | None:
    try:
        c = _client()
        resp = c.range(f"{_PREFIX}{service_name}")
        if resp.kvs:
            return resp.kvs[0].value.decode()
        return None
    except Exception as e:
        log.warning(f"lookup failed for {service_name}: {e}")
        return None


def list_services() -> dict[str, str]:
    out: dict[str, str] = {}
    try:
        c = _client()
        resp = c.range(_PREFIX, prefix=True)
        for kv in resp.kvs or []:
            key = kv.key.decode().removeprefix(_PREFIX)
            out[key] = kv.value.decode()
    except Exception as e:
        log.warning(f"list_services failed: {e}")
    return out
