"""桌面运行时应用装配入口。"""

from __future__ import annotations

import logging
import os
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager

import uvicorn
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from ..copilot_runtime import (
    PydanticAIAgentExecutor,
    build_default_runtime_dependencies,
    build_router,
)
from ..copilot_runtime.debug_log_store import (
    DebugLogCategory,
    DebugLogEnvironmentMode,
    DebugLogLevel,
    DebugLogQueryService,
    DebugLogStore,
    RetentionCoordinator,
    RuntimeDebugLogWriter,
    Sanitizer,
)
from ..copilot_runtime.model_routes import RuntimeModelRouteResolver
from ..copilot_runtime.runtime_session_store import RuntimeSessionStore
from .capability_bridge_client import DesktopCapabilityBridgeClient
from .capability_bridge_host_capabilities import (
    build_desktop_bridge_host_capabilities_factory,
)
from .config import (
    BACKEND_DIR,
    DesktopRuntimeConfig,
    get_backend_version,
    parse_runtime_config,
)
from .host_model_route_bridge import HostModelRouteBridgeClient
from .health import DESKTOP_RUNTIME_SERVICE_NAME
from .lifecycle import RuntimeLifecycleManager
from .middlewares import (
    DesktopNullOriginMiddleware,
    DesktopRuntimeFailureEnvelopeMiddleware,
)
from .routes.diagnostics import build_diagnostics_router
from .routes.debug_logs import build_debug_log_router
from .routes.history import build_history_router

_DESKTOP_LOOPBACK_ORIGIN_REGEX = r"^https?://(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$"
_RUNTIME_LOGGER = logging.getLogger("uvicorn.error")


def _resolve_debug_log_environment(environment: str) -> DebugLogEnvironmentMode:
    normalized = environment.strip().lower()
    if normalized == "development":
        return DebugLogEnvironmentMode.DEVELOPMENT
    if normalized == "production":
        return DebugLogEnvironmentMode.PRODUCTION
    if normalized == "test":
        return DebugLogEnvironmentMode.TEST
    return DebugLogEnvironmentMode.UNKNOWN


def create_app(
    config: DesktopRuntimeConfig | None = None,
    *,
    session_store: RuntimeSessionStore | None = None,
    agent_executor: PydanticAIAgentExecutor | None = None,
    model_route_resolver: RuntimeModelRouteResolver | None = None,
    host_capability_bridge_client: DesktopCapabilityBridgeClient | None = None,
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
    resolved_host_capability_bridge_client = (
        host_capability_bridge_client
        or DesktopCapabilityBridgeClient(
            bridge_url=runtime_config.host_capability_bridge_url,
            bridge_token=runtime_config.host_capability_bridge_token,
        )
    )
    host_capabilities_factory = build_desktop_bridge_host_capabilities_factory(
        bridge_client=resolved_host_capability_bridge_client,
    )
    runtime_dependencies = build_default_runtime_dependencies(
        runtime_config=runtime_config,
        session_store=session_store,
        agent_executor=agent_executor,
        model_route_resolver=model_route_resolver or host_model_route_bridge_client,
        host_capabilities_factory=host_capabilities_factory,
        host_capability_bridge_client=resolved_host_capability_bridge_client,
    )
    runtime_session_store = runtime_dependencies.session_store
    runtime_agent_executor = runtime_dependencies.agent_executor
    runtime_bridge = runtime_dependencies.runtime_bridge
    runtime_scaffold = runtime_dependencies.scaffold
    runtime_agent_registry = runtime_dependencies.agent_registry
    runtime_tool_registry = runtime_dependencies.tool_registry
    debug_log_store = DebugLogStore(
        runtime_config=runtime_config,
        sanitizer=Sanitizer(),
    )
    debug_log_retention_coordinator = RetentionCoordinator.from_runtime_config(
        debug_log_store, runtime_config
    )
    debug_log_query_service = DebugLogQueryService(
        debug_log_store,
        retention_config=debug_log_retention_coordinator.config,
    )
    debug_log_environment = _resolve_debug_log_environment(runtime_config.environment)
    runtime_debug_log_writer = RuntimeDebugLogWriter(
        store=debug_log_store,
        environment=debug_log_environment,
    )
    runtime_bridge.set_debug_event_logger(runtime_debug_log_writer)
    set_debug_event_logger = getattr(
        runtime_agent_executor, "set_debug_event_logger", None
    )
    if callable(set_debug_event_logger):
        set_debug_event_logger(runtime_debug_log_writer)
    history_query_service_factory = getattr(
        runtime_session_store, "create_history_query_service", None
    )
    runtime_history_query_service = (
        history_query_service_factory(
            agent_registry=runtime_agent_registry,
            tool_registry=runtime_tool_registry,
            model_route_resolver=model_route_resolver or host_model_route_bridge_client,
            provider_adapter_registry=runtime_agent_executor.provider_adapter_registry,
        )
        if callable(history_query_service_factory)
        else None
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.runtime_config = runtime_config
        app.state.lifecycle_manager = lifecycle_manager
        app.state.host_model_route_bridge_client = host_model_route_bridge_client
        app.state.host_capability_bridge_client = resolved_host_capability_bridge_client
        app.state.copilot_runtime_host_capabilities_factory = host_capabilities_factory
        app.state.copilot_runtime_dependencies = runtime_dependencies
        app.state.copilot_runtime_scaffold = runtime_scaffold
        app.state.copilot_runtime_session_store = runtime_session_store
        app.state.copilot_runtime_agent_registry = runtime_agent_registry
        app.state.copilot_runtime_tool_registry = runtime_tool_registry
        app.state.copilot_runtime_agent_executor = runtime_agent_executor
        app.state.copilot_runtime_bridge = runtime_bridge
        app.state.copilot_runtime_history_query_service = runtime_history_query_service
        app.state.copilot_runtime_debug_log_store = debug_log_store
        app.state.copilot_runtime_debug_log_retention_coordinator = (
            debug_log_retention_coordinator
        )
        app.state.copilot_runtime_debug_log_query_service = debug_log_query_service
        app.state.copilot_runtime_debug_log_environment = debug_log_environment
        runtime_debug_log_writer.write(
            category=DebugLogCategory.LIFECYCLE,
            level=DebugLogLevel.INFO,
            event_name="desktop_runtime.startup.initialized",
            message="Desktop runtime debug log infrastructure initialized.",
            component="desktop_runtime",
            operation="create_app",
            phase="startup",
            summary={
                "debugLogDatabaseFile": runtime_config.debug_log_database_file.as_posix(),
                "appMode": runtime_config.app_mode,
                "environment": runtime_config.environment,
            },
        )
        try:
            debug_log_retention_coordinator.run_due_maintenance(trigger="startup")
        except Exception:
            _RUNTIME_LOGGER.exception(
                "desktop-runtime startup retention maintenance failed; continuing startup"
            )
        lifecycle_manager.startup()
        try:
            yield
        finally:
            for resource_name, close in (
                (
                    "host capability bridge client",
                    resolved_host_capability_bridge_client.aclose,
                ),
                (
                    "host model route bridge client",
                    host_model_route_bridge_client.aclose,
                ),
            ):
                try:
                    await close()
                except Exception:  # pragma: no cover - defensive shutdown path
                    _RUNTIME_LOGGER.exception(
                        "desktop-runtime shutdown failed while closing %s",
                        resource_name,
                    )
            try:
                runtime_debug_log_writer.write(
                    category=DebugLogCategory.LIFECYCLE,
                    level=DebugLogLevel.INFO,
                    event_name="desktop_runtime.shutdown.completed",
                    message="Desktop runtime shutdown completed.",
                    component="desktop_runtime",
                    operation="lifespan",
                    phase="shutdown",
                )
                dispose = getattr(runtime_session_store, "dispose", None)
                if callable(dispose):
                    dispose()
                lifecycle_manager.shutdown()
            except Exception:  # pragma: no cover - defensive shutdown path
                _RUNTIME_LOGGER.exception("desktop-runtime lifecycle shutdown failed")

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

    app.include_router(
        build_router(runtime_scaffold, runtime_bridge, runtime_debug_log_writer)
    )
    app.include_router(build_diagnostics_router())
    app.include_router(build_debug_log_router())
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
