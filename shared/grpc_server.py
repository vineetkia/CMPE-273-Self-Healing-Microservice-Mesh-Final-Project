import os
import time
from concurrent import futures
import grpc

from .logging import get_logger

log = get_logger(__name__)


def serve(register_servicer, port: int, service_name: str) -> None:
    """Start a gRPC server. register_servicer(server) wires the servicer in."""
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=20))
    register_servicer(server)
    server.add_insecure_port(f"0.0.0.0:{port}")
    server.start()
    log.info(f"{service_name} grpc listening on :{port}")
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        server.stop(0)
