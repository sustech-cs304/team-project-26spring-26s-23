"""桌面宿主使用的最小本地 HTTP 服务。"""

from __future__ import annotations

import os
import sys
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.copilot_runtime import (  # noqa: E402
    PydanticAIAgentExecutor,
    build_default_runtime_dependencies,
    build_router,
)
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


_DESKTOP_LOOPBACK_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$"
_DESKTOP_NULL_ORIGIN = "null"
_ELECTRON_USER_AGENT_MARKER = "electron/"
_CORS_ALLOW_METHODS = "DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT"


class DesktopNullOriginMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        origin = request.headers.get("origin")
        if origin != _DESKTOP_NULL_ORIGIN:
            return await call_next(request)

        is_preflight_request = _is_cors_preflight_request(request)
        if not _is_packaged_electron_request(request):
            return Response(status_code=status.HTTP_400_BAD_REQUEST, content="Disallowed CORS origin")

        if is_preflight_request:
            response = Response(status_code=status.HTTP_200_OK)
        else:
            response = await call_next(request)

        _apply_cors_headers(
            response,
            origin=origin,
            requested_headers=request.headers.get("access-control-request-headers"),
            is_preflight_request=is_preflight_request,
        )
        return response


def create_app(
    config: DesktopRuntimeConfig | None = None,
    *,
    session_store: InMemorySessionStore | None = None,
    agent_executor: PydanticAIAgentExecutor | None = None,
) -> FastAPI:
    runtime_config = config
    if runtime_config is None:
        load_dotenv(BACKEND_DIR / ".env")
        runtime_config = parse_runtime_config([], env=os.environ, cwd=BACKEND_DIR)

    lifecycle_manager = RuntimeLifecycleManager(runtime_config)
    runtime_dependencies = build_default_runtime_dependencies(
        runtime_config=runtime_config,
        session_store=session_store,
        agent_executor=agent_executor,
    )
    runtime_session_store = runtime_dependencies.session_store
    runtime_agent_executor = runtime_dependencies.agent_executor
    runtime_bridge = runtime_dependencies.runtime_bridge
    runtime_scaffold = runtime_dependencies.scaffold
    runtime_agent_registry = runtime_dependencies.agent_registry
    runtime_tool_registry = runtime_dependencies.tool_registry

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.runtime_config = runtime_config
        app.state.lifecycle_manager = lifecycle_manager
        app.state.copilot_runtime_dependencies = runtime_dependencies
        app.state.copilot_runtime_scaffold = runtime_scaffold
        app.state.copilot_runtime_session_store = runtime_session_store
        app.state.copilot_runtime_agent_registry = runtime_agent_registry
        app.state.copilot_runtime_tool_registry = runtime_tool_registry
        app.state.copilot_runtime_agent_executor = runtime_agent_executor
        app.state.copilot_runtime_bridge = runtime_bridge
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
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[],
        allow_origin_regex=_DESKTOP_LOOPBACK_ORIGIN_REGEX,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(DesktopNullOriginMiddleware)

    app.include_router(build_router(runtime_scaffold, runtime_session_store, runtime_bridge))

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


def _is_cors_preflight_request(request: Request) -> bool:
    return (
        request.method == "OPTIONS"
        and request.headers.get("origin") is not None
        and request.headers.get("access-control-request-method") is not None
    )



def _is_packaged_electron_request(request: Request) -> bool:
    user_agent = request.headers.get("user-agent", "")
    return _ELECTRON_USER_AGENT_MARKER in user_agent.lower()



def _apply_cors_headers(
    response: Response,
    *,
    origin: str,
    requested_headers: str | None,
    is_preflight_request: bool,
) -> None:
    response.headers["Access-Control-Allow-Origin"] = origin
    _append_vary_header(response, "Origin")

    if not is_preflight_request:
        return

    response.headers["Access-Control-Allow-Methods"] = _CORS_ALLOW_METHODS
    response.headers["Access-Control-Allow-Headers"] = requested_headers or "*"
    response.headers["Access-Control-Max-Age"] = "600"
    _append_vary_header(response, "Access-Control-Request-Method")
    _append_vary_header(response, "Access-Control-Request-Headers")



def _append_vary_header(response: Response, value: str) -> None:
    current_value = response.headers.get("Vary")
    if current_value is None:
        response.headers["Vary"] = value
        return

    vary_values = {item.strip() for item in current_value.split(",") if item.strip()}
    if value in vary_values:
        return

    response.headers["Vary"] = ", ".join([*vary_values, value])


if __name__ == "__main__":
    raise SystemExit(main())
