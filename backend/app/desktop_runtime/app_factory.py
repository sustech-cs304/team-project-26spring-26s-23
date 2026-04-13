"""桌面运行时应用装配入口。"""

from __future__ import annotations

import os
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ..copilot_runtime import PydanticAIAgentExecutor, build_default_runtime_dependencies, build_router
from ..copilot_runtime.model_routes import RuntimeModelRouteResolver
from ..copilot_runtime.runtime_session_store import RuntimeSessionStore
from .config import BACKEND_DIR, DesktopRuntimeConfig, get_backend_version, parse_runtime_config
from .host_model_route_bridge import HostModelRouteBridgeClient
from .health import DESKTOP_RUNTIME_SERVICE_NAME
from .lifecycle import RuntimeLifecycleManager
from .middlewares import DesktopNullOriginMiddleware, DesktopRuntimeFailureEnvelopeMiddleware
from .routes.diagnostics import build_diagnostics_router
from .routes.history import build_history_router

_DESKTOP_LOOPBACK_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$"


def create_app(
    config: DesktopRuntimeConfig | None = None,
    *,
    session_store: RuntimeSessionStore | None = None,
    agent_executor: PydanticAIAgentExecutor | None = None,
    model_route_resolver: RuntimeModelRouteResolver | None = None,
) -> FastAPI:
    runtime_config = config
    if runtime_config is None:
        load_dotenv(BACKEND_DIR / ".env")
        runtime_config = parse_runtime_config([], env=os.environ, cwd=BACKEND_DIR)

    lifecycle_manager = RuntimeLifecycleManager(runtime_config)
    host_model_route_bridge_client = HostModelRouteBridgeClient(
        bridge_url=runtime_config.host_model_route_bridge_url,
        bridge_token=runtime_config.host_model_route_bridge_token,
    )
    runtime_dependencies = build_default_runtime_dependencies(
        runtime_config=runtime_config,
        session_store=session_store,
        agent_executor=agent_executor,
        model_route_resolver=model_route_resolver or host_model_route_bridge_client,
    )
    runtime_session_store = runtime_dependencies.session_store
    runtime_agent_executor = runtime_dependencies.agent_executor
    runtime_bridge = runtime_dependencies.runtime_bridge
    runtime_scaffold = runtime_dependencies.scaffold
    runtime_agent_registry = runtime_dependencies.agent_registry
    runtime_tool_registry = runtime_dependencies.tool_registry
    history_query_service_factory = getattr(runtime_session_store, "create_history_query_service", None)
    runtime_history_query_service = (
        history_query_service_factory() if callable(history_query_service_factory) else None
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.runtime_config = runtime_config
        app.state.lifecycle_manager = lifecycle_manager
        app.state.host_model_route_bridge_client = host_model_route_bridge_client
        app.state.copilot_runtime_dependencies = runtime_dependencies
        app.state.copilot_runtime_scaffold = runtime_scaffold
        app.state.copilot_runtime_session_store = runtime_session_store
        app.state.copilot_runtime_agent_registry = runtime_agent_registry
        app.state.copilot_runtime_tool_registry = runtime_tool_registry
        app.state.copilot_runtime_agent_executor = runtime_agent_executor
        app.state.copilot_runtime_bridge = runtime_bridge
        app.state.copilot_runtime_history_query_service = runtime_history_query_service
        lifecycle_manager.startup()
        try:
            yield
        finally:
            try:
                await host_model_route_bridge_client.aclose()
            finally:
                dispose = getattr(runtime_session_store, "dispose", None)
                if callable(dispose):
                    dispose()
                lifecycle_manager.shutdown()

    app = FastAPI(
        title=DESKTOP_RUNTIME_SERVICE_NAME,
        version=get_backend_version(),
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )
    app.add_middleware(DesktopRuntimeFailureEnvelopeMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[],
        allow_origin_regex=_DESKTOP_LOOPBACK_ORIGIN_REGEX,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(DesktopNullOriginMiddleware)

    app.include_router(build_router(runtime_scaffold, runtime_bridge))
    app.include_router(build_diagnostics_router())
    app.include_router(build_history_router())
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


__all__ = ["create_app", "main"]
