"""Blackboard UI API — 为前端 SUSTech 工作区提供只读数据与同步触发端点。"""

from __future__ import annotations

import os
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, Request

from app.desktop_runtime.capability_bridge_client import DesktopCapabilityBridgeClient
from app.integrations.sustech.blackboard.data.db_manager import (
    DatabaseManager,
    resolve_default_blackboard_db_path,
)
from app.integrations.sustech.blackboard.provider.use_cases.snapshot_sync import (
    run_blackboard_snapshot_sync,
)
from app.tooling import ToolInvocationContext

_SYNC_LOCK = threading.Lock()
_MAX_PROGRESS_LOGS = 200
_sync_status: dict[str, Any] = {
    "status": "idle",
    "lastSyncAt": None,
    "lastSyncError": None,
    "progressStage": None,
    "progressMessage": None,
    "progressLogs": [],
}


def _get_db_manager(request: Request | None = None) -> DatabaseManager:
    if request is not None:
        runtime_config = getattr(request.app.state, "runtime_config", None)
        if runtime_config is not None:
            database_dir: Path | None = getattr(runtime_config, "database_dir", None)
            if database_dir is not None:
                return DatabaseManager(resolve_default_blackboard_db_path(database_dir))
    return DatabaseManager()


def _synthetic_invocation_context() -> ToolInvocationContext:
    return ToolInvocationContext(
        invocation_id="blackboard-ui-sync",
        tool_id="blackboard.snapshot.sync",
        run_id="blackboard-ui",
    )


async def _resolve_credentials_via_bridge(
    bridge: DesktopCapabilityBridgeClient,
) -> tuple[str | None, str | None]:
    ctx = _synthetic_invocation_context()
    try:
        username = await bridge.get_secret(context=ctx, name="sustech.username")
        password = await bridge.get_secret(context=ctx, name="sustech.casPassword")
        return username, password
    except Exception:
        return None, None


async def _resolve_credentials(
    request: Request,
    request_body: dict[str, Any] | None,
) -> tuple[str, str]:
    """Resolve credentials: POST body > Capability Bridge > env vars."""
    username = ""
    password = ""
    if request_body:
        username = str(request_body.get("username", "")).strip()
        password = str(request_body.get("password", "")).strip()

    if not username or not password:
        bridge = getattr(request.app.state, "host_capability_bridge_client", None)
        if isinstance(bridge, DesktopCapabilityBridgeClient) and bridge._bridge_url:
            bridge_user, bridge_pass = await _resolve_credentials_via_bridge(bridge)
            if bridge_user:
                username = str(bridge_user).strip()
            if bridge_pass:
                password = str(bridge_pass).strip()

    if not username:
        username = str(os.environ.get("SUSTECH_USERNAME", "")).strip()
    if not password:
        password = str(os.environ.get("SUSTECH_CAS_PASSWORD", "")).strip()
    return username, password


def _serialize_datetime(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.isoformat()


def _infer_progress_stage(message: str) -> str | None:
    normalized = message.strip()
    if not normalized:
        return None

    if "CASClient" in normalized or "认证" in normalized:
        return "authenticating"
    if "基础实时数据" in normalized or "课程列表" in normalized:
        return "fetching_courses"
    if any(
        token in normalized
        for token in ("处理课程", "作业", "成绩", "公告", "资源")
    ):
        return "fetching_details"
    if any(token in normalized for token in ("构建", "同步数据库", "首次同步")):
        return "syncing_db"
    if any(token in normalized for token in ("第二次同步验证", "校验", "验证")):
        return "verifying"
    return None


def _update_sync_progress(
    state: dict[str, Any],
    message: str,
    *,
    max_logs: int = _MAX_PROGRESS_LOGS,
) -> None:
    normalized = message.strip()
    if not normalized:
        return

    logs = state.setdefault("progressLogs", [])
    if not isinstance(logs, list):
        logs = []
        state["progressLogs"] = logs
    logs.append(normalized)
    if len(logs) > max_logs:
        del logs[: len(logs) - max_logs]

    state["progressMessage"] = normalized
    stage = _infer_progress_stage(normalized)
    if stage is not None:
        state["progressStage"] = stage


def _sync_status_snapshot() -> dict[str, Any]:
    logs = _sync_status.get("progressLogs", [])
    return {
        **_sync_status,
        "progressLogs": list(logs) if isinstance(logs, list) else [],
    }


def _run_blackboard_sync_job(username: str, password: str, db_path: Path) -> None:
    try:

        def progress_callback(message: str) -> None:
            _update_sync_progress(_sync_status, message)

        report = run_blackboard_snapshot_sync(
            username,
            password,
            db_path=db_path,
            reset_schema=False,
            verify_second_sync=True,
            progress=progress_callback,
        )
        _sync_status.update(
            status="completed",
            lastSyncAt=report.snapshot.logs[-1].timestamp if report.snapshot.logs else None,
            lastSyncError=None,
            progressStage=None,
            progressMessage=None,
        )
    except Exception as exc:
        error_message = str(exc)
        _sync_status.update(
            status="failed",
            lastSyncError=error_message,
            progressStage=None,
            progressMessage=error_message,
        )
        _update_sync_progress(_sync_status, error_message)
    finally:
        _SYNC_LOCK.release()


def build_blackboard_ui_router() -> APIRouter:
    router = APIRouter(prefix="/api/blackboard")

    @router.get("/sync/status")
    def get_sync_status() -> dict[str, Any]:
        return _sync_status_snapshot()

    @router.post("/sync/trigger")
    async def trigger_sync(
        request: Request,
        body: dict[str, Any] = Body(default={}),
    ) -> dict[str, Any]:
        if _sync_status["status"] == "running":
            return {"ok": True, "message": "sync already in progress", **_sync_status_snapshot()}
        if not _SYNC_LOCK.acquire(blocking=False):
            return {"ok": True, "message": "sync already in progress", **_sync_status_snapshot()}

        lock_owned_by_worker = False
        try:
            _sync_status.update(
                status="running",
                progressStage="authenticating",
                progressMessage="开始同步...",
                progressLogs=["开始同步..."],
                lastSyncError=None,
            )

            username, password = await _resolve_credentials(request, body)

            if not username or not password:
                error_message = "缺少 CAS 凭证，请在设置中配置 SUSTech 用户名和密码"
                _sync_status.update(
                    status="failed",
                    lastSyncError=error_message,
                    progressStage=None,
                    progressMessage=error_message,
                    progressLogs=[*_sync_status.get("progressLogs", []), error_message],
                )
                return {"ok": True, "message": "sync failed", **_sync_status_snapshot()}

            db_manager = _get_db_manager(request)
            worker = threading.Thread(
                target=_run_blackboard_sync_job,
                args=(username, password, db_manager.db_path),
                name="blackboard-ui-sync",
                daemon=True,
            )
            worker.start()
            lock_owned_by_worker = True
            return {"ok": True, "message": "sync started", **_sync_status_snapshot()}
        except Exception as exc:
            error_message = str(exc)
            _sync_status.update(
                status="failed",
                lastSyncError=error_message,
                progressStage=None,
                progressMessage=error_message,
            )
            _update_sync_progress(_sync_status, error_message)
            return {"ok": True, "message": "sync failed", **_sync_status_snapshot()}
        finally:
            if not lock_owned_by_worker:
                _SYNC_LOCK.release()

    @router.get("/data/summary")
    def get_data_summary(request: Request) -> dict[str, Any]:
        try:
            db = _get_db_manager(request)
            counts = db.get_table_counts()
            return {"ok": True, "counts": counts}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.get("/data/courses")
    def get_courses(request: Request) -> dict[str, Any]:
        try:
            db = _get_db_manager(request)
            with db._session_scope() as session:
                from app.integrations.sustech.blackboard.data.models import Course

                courses = (
                    session.query(Course)
                    .filter(Course.is_deleted.is_(False))
                    .order_by(Course.is_active.desc(), Course.term.desc(), Course.name.asc())
                    .all()
                )
                result = [
                    {
                        "id": c.id,
                        "course_id": c.course_id,
                        "name": c.name,
                        "code": c.code,
                        "instructor": c.instructor,
                        "term": c.term,
                        "url": c.url,
                        "is_active": c.is_active,
                        "total_grade": c.total_grade,
                        "listed_grade": c.listed_grade,
                        "total_assignments": c.total_assignments,
                        "total_resources": c.total_resources,
                        "total_announcements": c.total_announcements,
                    }
                    for c in courses
                ]
            return {"ok": True, "courses": result}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.get("/data/courses/{course_id}/announcements")
    def get_course_announcements(course_id: str, request: Request) -> dict[str, Any]:
        try:
            db = _get_db_manager(request)
            with db._session_scope() as session:
                from app.integrations.sustech.blackboard.data.models import Announcement

                announcements = (
                    session.query(Announcement)
                    .filter(
                        Announcement.course_id == course_id,
                        Announcement.is_deleted.is_(False),
                    )
                    .order_by(Announcement.posted_at.desc(), Announcement.title.asc())
                    .all()
                )
                result = [
                    {
                        "id": a.id,
                        "announcement_id": a.announcement_id,
                        "title": a.title,
                        "body": a.content,
                        "content": a.content,
                        "author": a.author,
                        "publish_time": _serialize_datetime(a.posted_at),
                        "posted_at": _serialize_datetime(a.posted_at),
                        "url": a.url,
                        "course_id": a.course_id,
                        "course_name": a.course_name,
                    }
                    for a in announcements
                ]
            return {"ok": True, "announcements": result}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.get("/data/courses/{course_id}/assignments")
    def get_course_assignments(course_id: str, request: Request) -> dict[str, Any]:
        try:
            db = _get_db_manager(request)
            with db._session_scope() as session:
                from app.integrations.sustech.blackboard.data.models import Assignment

                assignments = (
                    session.query(Assignment)
                    .filter(
                        Assignment.course_id == course_id,
                        Assignment.is_deleted.is_(False),
                    )
                    .order_by(Assignment.due_date_parsed.asc(), Assignment.title.asc())
                    .all()
                )
                result = [
                    {
                        "id": a.id,
                        "assignment_id": a.assignment_id,
                        "title": a.title,
                        "due_date": a.due_date,
                        "posted_date": a.posted_date,
                        "url": a.url,
                        "description": a.description,
                        "summary": a.summary,
                        "source_page": a.source_page,
                        "attachments_json": a.attachments_json,
                        "status": a.status,
                        "submission_status": a.submission_status,
                        "score": a.score,
                        "total_score": a.total_score,
                        "course_id": a.course_id,
                    }
                    for a in assignments
                ]
            return {"ok": True, "assignments": result}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.get("/data/courses/{course_id}/grades")
    def get_course_grades(course_id: str, request: Request) -> dict[str, Any]:
        try:
            db = _get_db_manager(request)
            with db._session_scope() as session:
                from app.integrations.sustech.blackboard.data.models import Grade

                grades = (
                    session.query(Grade)
                    .filter(
                        Grade.course_id == course_id,
                        Grade.is_deleted.is_(False),
                    )
                    .order_by(Grade.due_date_parsed.asc(), Grade.item_name.asc())
                    .all()
                )
                result = [
                    {
                        "id": g.id,
                        "grade_id": g.grade_id,
                        "name": g.item_name,
                        "item_name": g.item_name,
                        "score": g.score,
                        "total_score": g.total_score,
                        "score_numeric": g.score_numeric,
                        "max_score": g.max_score,
                        "percentage": g.percentage,
                        "feedback": None,
                        "status": g.status,
                        "grade_type": g.grade_type,
                        "category": g.category,
                        "due_date": g.due_date,
                        "graded_date": g.graded_date,
                        "weight": g.weight,
                        "is_counted": g.is_counted,
                        "source_url": g.source_url,
                        "course_id": g.course_id,
                    }
                    for g in grades
                ]
            return {"ok": True, "grades": result}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.get("/data/courses/{course_id}/resources")
    def get_course_resources(course_id: str, request: Request) -> dict[str, Any]:
        try:
            db = _get_db_manager(request)
            with db._session_scope() as session:
                from app.integrations.sustech.blackboard.data.models import Resource

                resources = (
                    session.query(Resource)
                    .filter(
                        Resource.course_id == course_id,
                        Resource.is_deleted.is_(False),
                    )
                    .order_by(Resource.title.asc())
                    .all()
                )
                result = [
                    {
                        "id": r.id,
                        "resource_id": r.resource_id,
                        "title": r.title,
                        "name": r.title,
                        "url": r.url,
                        "type": r.type,
                        "size": r.size,
                        "course_id": r.course_id,
                        "assignment_id": r.assignment_id,
                        "source_page": r.source_page,
                        "local_path": r.local_path,
                        "is_downloaded": r.is_downloaded,
                        "download_failed": r.download_failed,
                        "parent_id": r.parent_id,
                    }
                    for r in resources
                ]
            return {"ok": True, "resources": result}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    return router
