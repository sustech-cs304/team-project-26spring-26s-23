"""健康检查与 diagnostics 响应构造。"""

from __future__ import annotations

import platform
from pathlib import Path

from .config import DesktopRuntimeConfig, LOCAL_TOKEN_HEADER_NAME, get_backend_version
from .contracts import DiagnosticsContract, HealthContract, ReadinessContract, VersionContract
from .lifecycle import RuntimeLifecycleManager

DESKTOP_RUNTIME_SERVICE_NAME = "sustech-copilot-desktop-runtime"
ENTRYPOINT_MODULE = "app.desktop_runtime.server"
_DIAGNOSTICS_PATHS = ["/diagnostics", "/diagnostics/runtime-info"]
_BASE_CONTRACT_PATHS = [
    "/health",
    "/ready",
    "/version",
    "/build-info",
    "/diagnostics",
    "/diagnostics/runtime-info",
]


def build_health_contract(manager: RuntimeLifecycleManager) -> HealthContract:
    return HealthContract(
        service=DESKTOP_RUNTIME_SERVICE_NAME,
        status="ok",
        ready=manager.is_ready,
    )


def build_readiness_contract(manager: RuntimeLifecycleManager) -> ReadinessContract:
    return ReadinessContract(
        service=DESKTOP_RUNTIME_SERVICE_NAME,
        status=manager.status,
        ready=manager.is_ready,
        startup_complete=manager.state.startup_complete,
        last_error=manager.state.last_error,
    )


def build_version_contract(config: DesktopRuntimeConfig) -> VersionContract:
    return VersionContract(
        service=DESKTOP_RUNTIME_SERVICE_NAME,
        version=get_backend_version(),
        python_version=platform.python_version(),
        app_mode=config.app_mode,
        environment=config.environment,
        build={
            "transport": "loopback-http",
            "entrypoint": ENTRYPOINT_MODULE,
            "base_url": config.base_url,
        },
    )


def build_diagnostics_contract(
    config: DesktopRuntimeConfig,
    manager: RuntimeLifecycleManager,
) -> DiagnosticsContract:
    return DiagnosticsContract(
        service=DESKTOP_RUNTIME_SERVICE_NAME,
        status=manager.status,
        runtime={
            "working_directory": Path.cwd(),
            "backend_dir": config.backend_dir,
            "base_url": config.base_url,
            "started_at": manager.state.started_at,
            "stopped_at": manager.state.stopped_at,
            "initialized_directories": manager.state.initialized_directories,
            "ready": manager.is_ready,
        },
        configuration=config.sanitized_summary(),
        auth={
            "header_name": LOCAL_TOKEN_HEADER_NAME,
            "token_configured": bool(config.local_token),
            "protected_paths": _DIAGNOSTICS_PATHS,
        },
        capabilities={
            "domain_routes_registered": False,
            "contract_paths": _BASE_CONTRACT_PATHS,
        },
    )
