"""Protected read-only diagnostic routes for runtime debug log queries."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, HTTPException, Query, Request, status

from app.copilot_runtime.debug_log_store import DebugLogQueryService

from ..config import DesktopRuntimeConfig
from ..security import require_local_token


def build_debug_log_router() -> APIRouter:
    router = APIRouter()

    @router.get("/diagnostics/debug-logs/recent")
    def list_recent_debug_logs(
        request: Request,
        limit: int = Query(default=20, ge=1, le=200),
        run_id: str | None = Query(default=None, alias="runId"),
        thread_id: str | None = Query(default=None, alias="threadId"),
        request_id: str | None = Query(default=None, alias="requestId"),
        correlation_id: str | None = Query(default=None, alias="correlationId"),
        level: str | None = Query(default=None),
        category: str | None = Query(default=None),
        occurred_from: datetime | None = Query(default=None, alias="occurredFrom"),
        occurred_to: datetime | None = Query(default=None, alias="occurredTo"),
    ) -> dict[str, object]:
        runtime_config = _get_runtime_config(request)
        require_local_token(request, runtime_config)
        service = _get_debug_log_query_service(request)
        try:
            return service.list_recent_events(
                limit=limit,
                run_id=run_id,
                thread_id=thread_id,
                request_id=request_id,
                correlation_id=correlation_id,
                level=level,
                category=category,
                occurred_from=occurred_from,
                occurred_to=occurred_to,
            ).to_dict()
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "invalid_debug_log_query",
                    "message": str(exc),
                },
            ) from exc

    @router.get("/diagnostics/debug-logs/chain")
    def get_debug_log_chain(
        request: Request,
        limit: int = Query(default=100, ge=1, le=200),
        run_id: str | None = Query(default=None, alias="runId"),
        thread_id: str | None = Query(default=None, alias="threadId"),
        request_id: str | None = Query(default=None, alias="requestId"),
        correlation_id: str | None = Query(default=None, alias="correlationId"),
    ) -> dict[str, object]:
        runtime_config = _get_runtime_config(request)
        require_local_token(request, runtime_config)
        service = _get_debug_log_query_service(request)
        try:
            return service.list_correlation_chain(
                limit=limit,
                run_id=run_id,
                thread_id=thread_id,
                request_id=request_id,
                correlation_id=correlation_id,
            ).to_dict()
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "debug_log_chain_filter_required",
                    "message": str(exc),
                },
            ) from exc

    @router.get("/diagnostics/debug-logs/events/{event_id}")
    def get_debug_log_event_detail(event_id: int, request: Request) -> dict[str, object]:
        runtime_config = _get_runtime_config(request)
        require_local_token(request, runtime_config)
        service = _get_debug_log_query_service(request)
        try:
            return service.get_event_detail(event_id).to_dict()
        except LookupError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "code": "debug_log_event_not_found",
                    "message": str(exc),
                    "eventId": event_id,
                },
            ) from exc

    @router.get("/diagnostics/debug-logs/maintenance-status")
    def get_debug_log_maintenance_status(request: Request) -> dict[str, object]:
        runtime_config = _get_runtime_config(request)
        require_local_token(request, runtime_config)
        service = _get_debug_log_query_service(request)
        return service.get_maintenance_status().to_dict()

    return router


def _get_runtime_config(request: Request) -> DesktopRuntimeConfig:
    return request.app.state.runtime_config  # type: ignore[return-value]


def _get_debug_log_query_service(request: Request) -> DebugLogQueryService:
    service = getattr(request.app.state, "copilot_runtime_debug_log_query_service", None)
    if isinstance(service, DebugLogQueryService):
        return service
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={
            "code": "debug_log_query_service_unavailable",
            "message": "Runtime debug log queries are unavailable.",
        },
    )


__all__ = ["build_debug_log_router"]
