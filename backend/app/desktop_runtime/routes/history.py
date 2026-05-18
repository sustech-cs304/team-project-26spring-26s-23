"""Persistent chat history query routes for the desktop runtime."""

from __future__ import annotations

from fastapi import APIRouter, Body, HTTPException, Request, status

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
    def get_history_thread_detail(
        thread_id: str, request: Request
    ) -> dict[str, object]:
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

    @router.post("/history/threads/{thread_id}/rename")
    def rename_history_thread(
        thread_id: str,
        request: Request,
        payload: dict[str, object] = Body(...),
    ) -> dict[str, object]:
        runtime_config = _get_runtime_config(request)
        require_local_token(request, runtime_config)
        service = _get_history_query_service(request)
        title = _coerce_optional_text(payload.get("title"))
        if title is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "rename_title_required",
                    "message": "Rename requests require a non-empty title.",
                    "threadId": thread_id,
                },
            )
        try:
            return service.rename_thread(thread_id, title=title).to_dict()
        except LookupError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "code": "thread_not_found",
                    "message": str(exc),
                    "threadId": thread_id,
                },
            ) from exc
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "invalid_rename_request",
                    "message": str(exc),
                    "threadId": thread_id,
                },
            ) from exc

    @router.post("/history/threads/{thread_id}/duplicate")
    def duplicate_history_thread(
        thread_id: str,
        request: Request,
        payload: dict[str, object] | None = Body(default=None),
    ) -> dict[str, object]:
        runtime_config = _get_runtime_config(request)
        require_local_token(request, runtime_config)
        service = _get_history_query_service(request)
        title = _coerce_optional_text(None if payload is None else payload.get("title"))
        try:
            return service.duplicate_thread(thread_id, title=title).to_dict()
        except LookupError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "code": "thread_not_found",
                    "message": str(exc),
                    "threadId": thread_id,
                },
            ) from exc
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "invalid_duplicate_request",
                    "message": str(exc),
                    "threadId": thread_id,
                },
            ) from exc

    @router.delete("/history/threads/{thread_id}")
    def delete_history_thread(thread_id: str, request: Request) -> dict[str, object]:
        runtime_config = _get_runtime_config(request)
        require_local_token(request, runtime_config)
        service = _get_history_query_service(request)
        try:
            return service.delete_thread(thread_id).to_dict()
        except LookupError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "code": "thread_not_found",
                    "message": str(exc),
                    "threadId": thread_id,
                },
            ) from exc

    @router.post("/history/database/backup")
    def backup_history_database(
        request: Request,
        payload: dict[str, object] | None = Body(default=None),
    ) -> dict[str, object]:
        runtime_config = _get_runtime_config(request)
        require_local_token(request, runtime_config)
        service = _get_history_query_service(request)
        target_path = _coerce_optional_text(
            None if payload is None else payload.get("targetPath")
        )
        try:
            return service.backup_database(target_path=target_path).to_dict()
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "invalid_backup_request",
                    "message": str(exc),
                    "targetPath": target_path,
                },
            ) from exc

    @router.post("/history/database/restore")
    def restore_history_database(
        request: Request,
        payload: dict[str, object] = Body(...),
    ) -> dict[str, object]:
        runtime_config = _get_runtime_config(request)
        require_local_token(request, runtime_config)
        service = _get_history_query_service(request)
        source_path = _coerce_optional_text(payload.get("sourcePath"))
        if source_path is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "restore_source_path_required",
                    "message": "Restore requests require a non-empty sourcePath.",
                },
            )
        try:
            return service.restore_database(source_path=source_path).to_dict()
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "invalid_restore_request",
                    "message": str(exc),
                    "sourcePath": source_path,
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


def _coerce_optional_text(value: object | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


__all__ = ["build_history_router"]
