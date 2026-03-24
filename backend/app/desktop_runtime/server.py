"""桌面宿主使用的最小本地 HTTP 服务。"""

from __future__ import annotations

import os
import sys
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, status

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.copilot_runtime import build_router, build_runtime_scaffold  # noqa: E402
from app.copilot_runtime.session_store import InMemorySessionStore  # noqa: E402
from app.desktop_runtime.config import (  # noqa: E402
    LOCAL_TOKEN_HEADER_NAME,
    DesktopRuntimeConfig,
    get_backend_version,
    parse_runtime_config,
)
from app.desktop_runtime.health import (  # noqa: E402
    DESKTOP_RUNTIME_SERVICE_NAME,
    build_diagnostics_contract,
    build_health_contract,
    build_readiness_contract,
    build_version_contract,
)
from app.desktop_runtime.lifecycle import RuntimeLifecycleManager  # noqa: E402


def create_app(config: DesktopRuntimeConfig | None = None) -> FastAPI:
    runtime_config = config
    if runtime_config is None:
        load_dotenv(BACKEND_DIR / ".env")
        runtime_config = parse_runtime_config([], env=os.environ, cwd=BACKEND_DIR)
    lifecycle_manager = RuntimeLifecycleManager(runtime_config)
    session_store = InMemorySessionStore()
    runtime_scaffold = build_runtime_scaffold(session_store_type=session_store.storage_type)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.runtime_config = runtime_config
        app.state.lifecycle_manager = lifecycle_manager
        app.state.copilot_runtime_scaffold = runtime_scaffold
        app.state.copilot_runtime_session_store = session_store
        lifecycle_manager.startup()
        try:
            yield
        finally:
            lifecycle_manager.shutdown()

    app = FastAPI(
        title=DESKTOP_RUNTIME_SERVICE_NAME,
        version=get_backend_version(),
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )

    app.include_router(build_router(runtime_scaffold, session_store))

    @app.get("/health")
    def get_health(request: Request) -> dict[str, object]:
        manager = _get_lifecycle_manager(request)
        return build_health_contract(manager).to_dict()

    @app.get("/ready")
    def get_ready(request: Request) -> dict[str, object]:
        manager = _get_lifecycle_manager(request)
        return build_readiness_contract(manager).to_dict()

    @app.get("/version")
    @app.get("/build-info")
    def get_version(request: Request) -> dict[str, object]:
        runtime_config = _get_runtime_config(request)
        return build_version_contract(runtime_config).to_dict()

    @app.get("/diagnostics")
    @app.get("/diagnostics/runtime-info")
    def get_runtime_diagnostics(request: Request) -> dict[str, object]:
        runtime_config = _get_runtime_config(request)
        _require_local_token(request, runtime_config)
        manager = _get_lifecycle_manager(request)
        return build_diagnostics_contract(
            runtime_config,
            manager,
            chat_runtime_summary=runtime_scaffold.diagnostics_summary(),
        ).to_dict()

    return app


def main(argv: Sequence[str] | None = None) -> int:
    load_dotenv(BACKEND_DIR / ".env")
    runtime_config = parse_runtime_config(argv, env=os.environ, cwd=BACKEND_DIR)
    uvicorn.run(
        create_app(runtime_config),
        host=runtime_config.host,
        port=runtime_config.port,
        log_level="info",
    )
    return 0


def _get_runtime_config(request: Request) -> DesktopRuntimeConfig:
    return request.app.state.runtime_config  # type: ignore[return-value]


def _get_lifecycle_manager(request: Request) -> RuntimeLifecycleManager:
    return request.app.state.lifecycle_manager  # type: ignore[return-value]


def _require_local_token(request: Request, runtime_config: DesktopRuntimeConfig) -> None:
    if not runtime_config.local_token:
        return

    received_token = request.headers.get(LOCAL_TOKEN_HEADER_NAME)
    if received_token == runtime_config.local_token:
        return

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail={
            "code": "invalid_local_token",
            "message": "Missing or invalid local runtime token.",
            "header_name": LOCAL_TOKEN_HEADER_NAME,
        },
    )


if __name__ == "__main__":
    raise SystemExit(main())
