"""Persistent chat history query routes for the desktop runtime."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status

from app.copilot_runtime.persistence import PersistedChatQueryService

from ..config import DesktopRuntimeConfig
from ..security import require_local_token



def build_history_router() -> APIRouter:
    router = APIRouter()

    @router.get("/history/threads")
    def list_history_threads(request: Request) -> dict[str, object]:
        runtime_config = _get_runtime_config(request)
        require_local_token(request, runtime_config)
        service = _get_history_query_service(request)
        return service.list_threads().to_dict()

    @router.get("/history/threads/{thread_id}")
    def get_history_thread_detail(thread_id: str, request: Request) -> dict[str, object]:
        runtime_config = _get_runtime_config(request)
        require_local_token(request, runtime_config)
        service = _get_history_query_service(request)
        try:
            return service.get_thread_detail(thread_id).to_dict()
        except LookupError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "code": "thread_not_found",
                    "message": str(exc),
                    "threadId": thread_id,
                },
            ) from exc

    @router.get("/history/runs/{run_id}/replay")
    def get_history_run_replay(run_id: str, request: Request) -> dict[str, object]:
        runtime_config = _get_runtime_config(request)
        require_local_token(request, runtime_config)
        service = _get_history_query_service(request)
        try:
            return service.get_run_replay(run_id).to_dict()
        except LookupError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "code": "run_not_found",
                    "message": str(exc),
                    "runId": run_id,
                },
            ) from exc

    return router



def _get_runtime_config(request: Request) -> DesktopRuntimeConfig:
    return request.app.state.runtime_config  # type: ignore[return-value]



def _get_history_query_service(request: Request) -> PersistedChatQueryService:
    service = getattr(request.app.state, "copilot_runtime_history_query_service", None)
    if isinstance(service, PersistedChatQueryService):
        return service
    raise HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail={
            "code": "history_query_service_unavailable",
            "message": "Persistent history queries require the SQLite chat session store.",
        },
    )


__all__ = ["build_history_router"]
