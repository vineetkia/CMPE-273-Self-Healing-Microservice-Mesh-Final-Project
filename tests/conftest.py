"""Pytest configuration.

Tests are designed to run without Docker AND without the production service
dependency tree (opentelemetry, nats, grpc, etc.) being installed. We achieve
this in two ways:

1. The `shared` package is added to sys.path (it's a real Python package).
2. For modules under `agents/` and `services/` that aren't packages, we
   expose `load_module(path)` which imports them from a file path via
   importlib. Stubs for the generated gRPC modules are pre-installed.

If you want to run the tests in a venv with the full dependency tree
(`pip install -r shared/requirements.txt`), they still work — `load_module`
will use the real modules instead of the stubs.
"""
import importlib.util
import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def _stub(name: str):
    """Install a placeholder module so `import name` succeeds."""
    if name not in sys.modules:
        sys.modules[name] = types.ModuleType(name)


# Generated proto stubs (only exist after Docker codegens them)
_stub("mesh_pb2")
_stub("mesh_pb2_grpc")


def load_module(relative_path: str, module_name: str):
    """Load a Python module from a file path inside the repo.

    Used to import `agents/healer/main.py` and `services/auth/main.py` as
    standalone modules without making them packages.
    """
    full_path = ROOT / relative_path
    spec = importlib.util.spec_from_file_location(module_name, full_path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module
