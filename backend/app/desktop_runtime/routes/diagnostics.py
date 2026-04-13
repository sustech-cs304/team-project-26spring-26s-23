"""桌面运行时诊断与基础状态路由。"""

from __future__ import annotations

from fastapi import APIRouter, Request

from ..config import DesktopRuntimeConfig
from ..health import (
    build_diagnostics_contract,
    build_health_contract,
    build_readiness_contract,
    build_version_contract,
)
from ..lifecycle import RuntimeLifecycleManager
from ..security import require_local_token


def build_diagnostics_router() -> APIRouter:
    router = APIRouter()

    @router.get("/health")
    def get_health(request: Request) -> dict[str, object]:
        manager = _get_lifecycle_manager(request)
        return build_health_contract(manager).to_dict()

    @router.get("/ready")
    def get_ready(request: Request) -> dict[str, object]:
        manager = _get_lifecycle_manager(request)
        return build_readiness_contract(manager).to_dict()

    @router.get("/version")
    @router.get("/build-info")
    def get_version(request: Request) -> dict[str, object]:
        runtime_config = _get_runtime_config(request)
        return build_version_contract(runtime_config).to_dict()

    @router.get("/diagnostics")
    @router.get("/diagnostics/runtime-info")
    def get_runtime_diagnostics(request: Request) -> dict[str, object]:
        runtime_config = _get_runtime_config(request)
        require_local_token(request, runtime_config)
        manager = _get_lifecycle_manager(request)
        runtime_scaffold = _get_runtime_scaffold(request)
        return build_diagnostics_contract(
            runtime_config,
            manager,
            chat_runtime_summary=runtime_scaffold.diagnostics_summary(),
        ).to_dict()

    return router


def _get_runtime_config(request: Request) -> DesktopRuntimeConfig:
    return request.app.state.runtime_config  # type: ignore[return-value]


def _get_lifecycle_manager(request: Request) -> RuntimeLifecycleManager:
    return request.app.state.lifecycle_manager  # type: ignore[return-value]


def _get_runtime_scaffold(request: Request):
    return request.app.state.copilot_runtime_scaffold  # type: ignore[return-value]


__all__ = ["build_diagnostics_router"]
