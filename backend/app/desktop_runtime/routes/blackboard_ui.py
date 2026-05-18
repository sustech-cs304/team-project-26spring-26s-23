"""Blackboard UI API — 为前端 SUSTech 工作区提供只读数据与同步触发端点。"""

from __future__ import annotations

import asyncio
import json
import os
import re
import threading
import time
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse
from uuid import uuid4

from fastapi import APIRouter, Body, Query, Request
from markdownify import markdownify as html_to_markdown

from app.desktop_runtime.capability_bridge_client import DesktopCapabilityBridgeClient
from app.integrations.sustech.blackboard.facade import tools as blackboard_facade_tools
from app.integrations.sustech.blackboard.data.db_manager import (
    DatabaseManager,
    resolve_default_blackboard_db_path,
)
from app.integrations.sustech.blackboard.provider.use_cases.snapshot_sync import (
    rebuild_announcement_assignment_links,
    run_blackboard_snapshot_sync,
)
from app.shared_integrations.sustech_auth.cas_client import CASClient
from app.tooling import ToolInvocationContext

_SYNC_LOCK = threading.Lock()
_MAX_PROGRESS_LOGS = 200
_SYNC_TIMEOUT_SECONDS = 60 * 8
_BLACKBOARD_LOGIN_SERVICE_URL = "https://bb.sustech.edu.cn/webapps/login/"
_sync_cancel_event = threading.Event()
_RESOURCE_DOWNLOAD_TASKS_LOCK = threading.Lock()
_RESOURCE_DOWNLOAD_TASKS_BY_ID: dict[str, "_ResourceDownloadTask"] = {}
_RESOURCE_DOWNLOAD_TASK_ID_BY_URL: dict[str, str] = {}


def _default_sync_status() -> dict[str, Any]:
    return {
        "status": "idle",
        "lastSyncAt": None,
        "lastSyncError": None,
        "progressStage": None,
        "progressMessage": None,
        "progressLogs": [],
        "canCancel": False,
        "timeoutSeconds": _SYNC_TIMEOUT_SECONDS,
        "updatedAt": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
    }


def _touch_sync_status(state: dict[str, Any]) -> None:
    state["updatedAt"] = datetime.now(UTC).isoformat().replace("+00:00", "Z")


def _apply_sync_status_patch(state: dict[str, Any], **patch: Any) -> None:
    state.update(patch)
    _touch_sync_status(state)


def _bridge_sync_status_key() -> str:
    context = _synthetic_invocation_context()
    return (
        f"{context.tool_id}:"
        f"{blackboard_facade_tools._STATE_NAMESPACE_SNAPSHOT_SYNC}:"
        f"{blackboard_facade_tools._LATEST_STATUS_STATE_KEY}"
    )


def _coerce_sync_status(value: Mapping[str, Any] | None) -> dict[str, Any]:
    coerced = _default_sync_status()
    if value is None:
        return coerced
    for field_name in (
        "status",
        "lastSyncAt",
        "lastSyncError",
        "progressStage",
        "progressMessage",
        "canCancel",
        "timeoutSeconds",
        "updatedAt",
    ):
        if field_name in value:
            coerced[field_name] = value[field_name]
    progress_logs = value.get("progressLogs")
    if isinstance(progress_logs, list):
        coerced["progressLogs"] = [str(item) for item in progress_logs if str(item).strip()]
    return coerced


async def _load_persisted_sync_status_via_bridge(
    bridge: Any,
) -> dict[str, Any] | None:
    if bridge is None or not hasattr(bridge, "get_state_value"):
        return None
    try:
        payload = await bridge.get_state_value(
            context=_synthetic_invocation_context(),
            scope="tool",
            key=_bridge_sync_status_key(),
        )
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    return _coerce_sync_status(payload)


async def _persist_sync_status_via_bridge(
    bridge: Any,
    state: Mapping[str, Any],
) -> None:
    if bridge is None or not hasattr(bridge, "put_state_value"):
        return
    try:
        await bridge.put_state_value(
            context=_synthetic_invocation_context(),
            scope="tool",
            key=_bridge_sync_status_key(),
            value=_coerce_sync_status(state),
        )
    except Exception:
        return


def _persist_sync_status_via_bridge_blocking(
    bridge: Any,
    state: Mapping[str, Any],
) -> None:
    if bridge is None or not hasattr(bridge, "put_state_value"):
        return
    try:
        asyncio.run(_persist_sync_status_via_bridge(bridge, state))
    except Exception:
        return


def _select_newer_sync_status(
    left: Mapping[str, Any],
    right: Mapping[str, Any] | None,
) -> dict[str, Any]:
    left_status = _coerce_sync_status(left)
    if right is None:
        return left_status
    right_status = _coerce_sync_status(right)
    left_updated = str(left_status.get("updatedAt") or "")
    right_updated = str(right_status.get("updatedAt") or "")
    if right_updated > left_updated:
        return right_status
    return left_status


_sync_status: dict[str, Any] = _default_sync_status()


@dataclass(slots=True)
class _ResourceDownloadTask:
    task_id: str
    course_id: str
    resource_url_key: str
    resource_title: str
    directory_path: str
    file_name: str
    state: str = "downloading"
    downloaded_bytes: int = 0
    total_bytes: int | None = None
    local_path: str | None = None
    error_message: str | None = None
    cancel_requested: bool = False
    cancel_event: threading.Event = field(default_factory=threading.Event)


class _ResourceDownloadCancelled(Exception):
    pass


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
    username = ""  # nosec B105 -- default empty credential placeholder
    password = ""  # nosec B105 -- default empty credential placeholder
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


def _utc_now_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _sanitize_download_file_name(value: str) -> str:
    normalized = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", str(value or "").strip())
    collapsed = re.sub(r"\s+", " ", normalized).strip(" .")
    return collapsed or "download"


def _resolve_download_file_name(resource_title: str, resource_url: str) -> str:
    raw_title = str(resource_title or "").strip()
    basename = Path(urlparse(resource_url).path).name
    candidate = _sanitize_download_file_name(raw_title or basename)
    if "." in candidate:
        return candidate

    suffix = Path(basename).suffix.strip()
    if suffix:
        return f"{candidate}{suffix}"
    return candidate


def _task_to_dict(task: _ResourceDownloadTask) -> dict[str, Any]:
    total_bytes = task.total_bytes
    progress_percent: float | None = None
    if isinstance(total_bytes, int) and total_bytes > 0:
        progress_percent = round(
            min(100.0, (task.downloaded_bytes / total_bytes) * 100.0), 2
        )
    return {
        "task_id": task.task_id,
        "course_id": task.course_id,
        "resource_url": task.resource_url_key,
        "resource_title": task.resource_title,
        "directory_path": task.directory_path,
        "file_name": task.file_name,
        "state": task.state,
        "downloaded_bytes": task.downloaded_bytes,
        "total_bytes": total_bytes,
        "progress_percent": progress_percent,
        "local_path": task.local_path,
        "error_message": task.error_message,
        "cancel_requested": task.cancel_requested,
    }


def _get_download_task_by_url(resource_url_key: str) -> _ResourceDownloadTask | None:
    with _RESOURCE_DOWNLOAD_TASKS_LOCK:
        task_id = _RESOURCE_DOWNLOAD_TASK_ID_BY_URL.get(resource_url_key)
        if not task_id:
            return None
        return _RESOURCE_DOWNLOAD_TASKS_BY_ID.get(task_id)


def _get_download_task_by_id(task_id: str) -> _ResourceDownloadTask | None:
    with _RESOURCE_DOWNLOAD_TASKS_LOCK:
        return _RESOURCE_DOWNLOAD_TASKS_BY_ID.get(task_id)


def _register_download_task(task: _ResourceDownloadTask) -> None:
    with _RESOURCE_DOWNLOAD_TASKS_LOCK:
        previous_task_id = _RESOURCE_DOWNLOAD_TASK_ID_BY_URL.get(task.resource_url_key)
        if previous_task_id:
            _RESOURCE_DOWNLOAD_TASKS_BY_ID.pop(previous_task_id, None)
        _RESOURCE_DOWNLOAD_TASK_ID_BY_URL[task.resource_url_key] = task.task_id
        _RESOURCE_DOWNLOAD_TASKS_BY_ID[task.task_id] = task


def _upsert_download_directory_preferences(
    session: Any,
    *,
    course_id: str,
    resource_url_key: str,
    directory_path: str,
) -> None:
    from app.integrations.sustech.blackboard.data.models import (
        ResourceDownloadDirectoryPreference,
    )

    for scope_type, scope_key in (
        ("resource", resource_url_key),
        ("course", course_id),
    ):
        row = (
            session.query(ResourceDownloadDirectoryPreference)
            .filter(
                ResourceDownloadDirectoryPreference.scope_type == scope_type,
                ResourceDownloadDirectoryPreference.scope_key == scope_key,
            )
            .one_or_none()
        )
        if row is None:
            session.add(
                ResourceDownloadDirectoryPreference(
                    scope_type=scope_type,
                    scope_key=scope_key,
                    directory_path=directory_path,
                    is_deleted=False,
                )
            )
            continue
        row.directory_path = directory_path
        row.is_deleted = False


def _resolve_preferred_directory(
    session: Any,
    *,
    course_id: str,
    resource_url_key: str,
) -> str | None:
    from app.integrations.sustech.blackboard.data.models import (
        ResourceDownloadDirectoryPreference,
    )

    resource_row = (
        session.query(ResourceDownloadDirectoryPreference)
        .filter(
            ResourceDownloadDirectoryPreference.scope_type == "resource",
            ResourceDownloadDirectoryPreference.scope_key == resource_url_key,
            ResourceDownloadDirectoryPreference.is_deleted.is_(False),
        )
        .one_or_none()
    )
    if resource_row is not None:
        return str(resource_row.directory_path or "").strip() or None

    course_row = (
        session.query(ResourceDownloadDirectoryPreference)
        .filter(
            ResourceDownloadDirectoryPreference.scope_type == "course",
            ResourceDownloadDirectoryPreference.scope_key == course_id,
            ResourceDownloadDirectoryPreference.is_deleted.is_(False),
        )
        .one_or_none()
    )
    if course_row is not None:
        return str(course_row.directory_path or "").strip() or None
    return None


def _set_resource_projection_state(
    session: Any,
    *,
    course_id: str,
    resource_url_key: str,
    local_path: str | None,
    is_downloaded: bool,
    download_failed: bool,
) -> str | None:
    from app.integrations.sustech.blackboard.data.models import Resource

    matched_resource_id: str | None = None
    rows = (
        session.query(Resource)
        .filter(
            Resource.course_id == course_id,
            Resource.url == resource_url_key,
            Resource.is_deleted.is_(False),
        )
        .all()
    )
    for row in rows:
        row.local_path = local_path
        row.is_downloaded = is_downloaded
        row.download_failed = download_failed
        if matched_resource_id is None:
            matched_resource_id = str(row.resource_id or "").strip() or None
    return matched_resource_id


def _upsert_download_binding(
    session: Any,
    *,
    course_id: str,
    resource_url_key: str,
    local_path: str,
    directory_path: str,
    file_name: str,
    file_size_bytes: int | None,
) -> None:
    from app.integrations.sustech.blackboard.data.models import ResourceDownloadBinding

    resource_id = _set_resource_projection_state(
        session,
        course_id=course_id,
        resource_url_key=resource_url_key,
        local_path=local_path,
        is_downloaded=True,
        download_failed=False,
    )
    binding = (
        session.query(ResourceDownloadBinding)
        .filter(ResourceDownloadBinding.resource_url_key == resource_url_key)
        .one_or_none()
    )
    if binding is None:
        session.add(
            ResourceDownloadBinding(
                course_id=course_id,
                resource_id=resource_id,
                resource_url_key=resource_url_key,
                local_path=local_path,
                directory_path=directory_path,
                file_name=file_name,
                downloaded_at=_utc_now_naive(),
                verified_at=_utc_now_naive(),
                file_size_bytes=file_size_bytes,
                content_length=file_size_bytes,
                is_deleted=False,
            )
        )
        return
    binding.course_id = course_id
    binding.resource_id = resource_id
    binding.local_path = local_path
    binding.directory_path = directory_path
    binding.file_name = file_name
    binding.downloaded_at = _utc_now_naive()
    binding.verified_at = _utc_now_naive()
    binding.file_size_bytes = file_size_bytes
    binding.content_length = file_size_bytes
    binding.is_deleted = False


def _deactivate_download_binding(
    session: Any,
    *,
    course_id: str,
    resource_url_key: str,
    download_failed: bool,
) -> None:
    from app.integrations.sustech.blackboard.data.models import ResourceDownloadBinding

    _set_resource_projection_state(
        session,
        course_id=course_id,
        resource_url_key=resource_url_key,
        local_path=None,
        is_downloaded=False,
        download_failed=download_failed,
    )
    binding = (
        session.query(ResourceDownloadBinding)
        .filter(ResourceDownloadBinding.resource_url_key == resource_url_key)
        .one_or_none()
    )
    if binding is not None:
        binding.is_deleted = True
        binding.verified_at = _utc_now_naive()


def _build_binding_download_payload(
    binding: Any,
    task: Any,
    resources: list[Any],
    course_id: str,
    resource_url_key: str,
    preferred_directory: str | None,
) -> dict[str, Any]:
    """Build download status payload from a persistent binding record."""
    return {
        "task_id": task.task_id if task is not None else None,
        "course_id": course_id,
        "resource_url": resource_url_key,
        "resource_title": str(resources[0].title or "").strip() if resources else None,
        "directory_path": str(binding.directory_path or "").strip()
        or preferred_directory,
        "file_name": str(binding.file_name or "").strip() or None,
        "state": "downloaded",
        "downloaded_bytes": int(binding.file_size_bytes or 0),
        "total_bytes": binding.file_size_bytes,
        "progress_percent": 100.0,
        "local_path": str(binding.local_path or "").strip(),
        "error_message": task.error_message if task is not None else None,
        "cancel_requested": False,
        "preferred_directory": preferred_directory,
        "resource_id": str(resources[0].resource_id or "").strip()
        if resources
        else None,
    }


def _build_default_download_payload(
    task: Any,
    resources: list[Any],
    course_id: str,
    resource_url_key: str,
    preferred_directory: str | None,
    *,
    failed: bool = False,
) -> dict[str, Any]:
    """Build the default/idle download status payload."""
    return {
        "task_id": task.task_id if task is not None else None,
        "course_id": course_id,
        "resource_url": resource_url_key,
        "resource_title": str(resources[0].title or "").strip() if resources else None,
        "directory_path": preferred_directory,
        "file_name": task.file_name if task is not None else None,
        "state": "failed" if failed else "idle",
        "downloaded_bytes": 0,
        "total_bytes": None,
        "progress_percent": None,
        "local_path": None,
        "error_message": task.error_message if task is not None else None,
        "cancel_requested": bool(task.cancel_requested) if task is not None else False,
        "preferred_directory": preferred_directory,
        "resource_id": str(resources[0].resource_id or "").strip()
        if resources
        else None,
    }


def _build_download_status(
    session: Any,
    *,
    course_id: str,
    resource_url_key: str,
) -> dict[str, Any]:
    from app.integrations.sustech.blackboard.data.models import (
        Resource,
        ResourceDownloadBinding,
    )

    resources = (
        session.query(Resource)
        .filter(
            Resource.course_id == course_id,
            Resource.url == resource_url_key,
            Resource.is_deleted.is_(False),
        )
        .order_by(Resource.title.asc())
        .all()
    )
    preferred_directory = _resolve_preferred_directory(
        session,
        course_id=course_id,
        resource_url_key=resource_url_key,
    )
    task = _get_download_task_by_url(resource_url_key)
    if task is not None and task.state == "downloading":
        payload = _task_to_dict(task)
        payload["preferred_directory"] = preferred_directory
        payload["resource_id"] = (
            str(resources[0].resource_id or "").strip() if resources else None
        )
        return payload

    binding = (
        session.query(ResourceDownloadBinding)
        .filter(
            ResourceDownloadBinding.resource_url_key == resource_url_key,
            ResourceDownloadBinding.is_deleted.is_(False),
        )
        .one_or_none()
    )
    if binding is not None:
        binding_path = str(binding.local_path or "").strip()
        if binding_path and Path(binding_path).exists():
            return _build_binding_download_payload(
                binding,
                task,
                resources,
                course_id,
                resource_url_key,
                preferred_directory,
            )
        _deactivate_download_binding(
            session,
            course_id=course_id,
            resource_url_key=resource_url_key,
            download_failed=False,
        )

    failed = any(bool(item.download_failed) for item in resources)
    return _build_default_download_payload(
        task,
        resources,
        course_id,
        resource_url_key,
        preferred_directory,
        failed=failed,
    )


def _reconcile_download_bindings_for_course(session: Any, *, course_id: str) -> None:
    from app.integrations.sustech.blackboard.data.models import (
        Resource,
        ResourceDownloadBinding,
    )

    normalized_course_id = str(course_id or "").strip()
    if not normalized_course_id:
        return

    active_resources = (
        session.query(Resource)
        .filter(
            Resource.course_id == normalized_course_id,
            Resource.is_deleted.is_(False),
        )
        .all()
    )
    resources_by_url: dict[str, list[Any]] = {}
    for resource in active_resources:
        resource_url_key = _normalized_blackboard_url(getattr(resource, "url", None))
        if not resource_url_key:
            continue
        resources_by_url.setdefault(resource_url_key, []).append(resource)

    bindings = (
        session.query(ResourceDownloadBinding)
        .filter(
            ResourceDownloadBinding.course_id == normalized_course_id,
            ResourceDownloadBinding.is_deleted.is_(False),
        )
        .all()
    )
    for binding in bindings:
        resource_url_key = str(binding.resource_url_key or "").strip()
        if not resource_url_key:
            continue
        local_path = str(binding.local_path or "").strip()
        matched_resources = resources_by_url.get(resource_url_key, [])
        if not local_path or not Path(local_path).exists():
            binding.is_deleted = True
            binding.verified_at = _utc_now_naive()
            for resource in matched_resources:
                resource.local_path = None
                resource.is_downloaded = False
                resource.download_failed = False
            continue

        binding.verified_at = _utc_now_naive()
        if matched_resources:
            binding.resource_id = (
                str(getattr(matched_resources[0], "resource_id", "") or "").strip()
                or None
            )
        for resource in matched_resources:
            resource.local_path = local_path
            resource.is_downloaded = True
            resource.download_failed = False


def _reconcile_download_bindings_for_database(db_path: Path) -> None:
    manager = DatabaseManager(db_path)
    with manager._session_scope() as session:
        from app.integrations.sustech.blackboard.data.models import (
            ResourceDownloadBinding,
        )

        course_ids = {
            str(row.course_id or "").strip()
            for row in session.query(ResourceDownloadBinding)
            .filter(ResourceDownloadBinding.is_deleted.is_(False))
            .all()
            if str(row.course_id or "").strip()
        }
        for course_id in course_ids:
            _reconcile_download_bindings_for_course(session, course_id=course_id)


def _run_resource_download_task(
    task_id: str,
    username: str,
    password: str,
    db_path: Path,
) -> None:
    task = _get_download_task_by_id(task_id)
    if task is None:
        return

    target_directory = Path(task.directory_path)
    target_directory.mkdir(parents=True, exist_ok=True)
    target_path = target_directory / task.file_name
    temp_path = target_directory / f".{task.file_name}.{task.task_id}.part"
    cas_client = CASClient(logger=None)
    try:
        if not cas_client.login(username, password, _BLACKBOARD_LOGIN_SERVICE_URL):
            raise RuntimeError(
                str(cas_client.last_login_failure_message or "CAS 登录失败").strip()
                or "CAS 登录失败"
            )

        with cas_client.client.stream("GET", task.resource_url_key) as response:
            response.raise_for_status()
            content_length = response.headers.get("content-length")
            try:
                task.total_bytes = int(content_length) if content_length else None
            except (TypeError, ValueError):
                task.total_bytes = None

            with temp_path.open("wb") as handle:
                for chunk in response.iter_bytes():
                    if task.cancel_event.is_set():
                        raise _ResourceDownloadCancelled()
                    if not chunk:
                        continue
                    handle.write(chunk)
                    task.downloaded_bytes += len(chunk)

        os.replace(str(temp_path), str(target_path))
        task.local_path = str(target_path)
        if task.total_bytes is None:
            task.total_bytes = task.downloaded_bytes
        with DatabaseManager(db_path)._session_scope() as session:
            _upsert_download_binding(
                session,
                course_id=task.course_id,
                resource_url_key=task.resource_url_key,
                local_path=str(target_path),
                directory_path=task.directory_path,
                file_name=task.file_name,
                file_size_bytes=task.downloaded_bytes,
            )
        task.state = "downloaded"
        task.error_message = None
        task.cancel_requested = False
    except _ResourceDownloadCancelled:
        task.state = "idle"
        task.error_message = None
        with DatabaseManager(db_path)._session_scope() as session:
            _deactivate_download_binding(
                session,
                course_id=task.course_id,
                resource_url_key=task.resource_url_key,
                download_failed=False,
            )
    except Exception as exc:
        task.state = "failed"
        task.error_message = str(exc)
        with DatabaseManager(db_path)._session_scope() as session:
            _deactivate_download_binding(
                session,
                course_id=task.course_id,
                resource_url_key=task.resource_url_key,
                download_failed=True,
            )
    finally:
        try:
            if temp_path.exists():
                temp_path.unlink()
        except Exception:
            pass  # nosec B110 -- best-effort cleanup, safe to ignore
        cas_client.close()


def _start_resource_download_worker(
    task_id: str,
    username: str,
    password: str,
    db_path: Path,
) -> None:
    worker = threading.Thread(
        target=_run_resource_download_task,
        args=(task_id, username, password, db_path),
        name=f"blackboard-resource-download-{task_id}",
        daemon=True,
    )
    worker.start()


def _normalize_markdown_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.replace("\r\n", "\n").replace("\r", "\n")
    normalized_lines = [line.strip() for line in normalized.split("\n")]
    collapsed: list[str] = []
    previous_blank = False
    for line in normalized_lines:
        if line == "":
            if previous_blank:
                continue
            previous_blank = True
            collapsed.append("")
            continue
        previous_blank = False
        collapsed.append(line)

    cleaned = "\n".join(collapsed).strip()
    if not cleaned:
        return None
    return cleaned


def _normalized_blackboard_url(value: str | None) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = urlparse(text)
    except Exception:
        return text
    if parsed.scheme in {"http", "https"} and parsed.netloc:
        return parsed._replace(fragment="").geturl()
    return text


def _assignment_dedupe_rank(row: Any) -> tuple[int, int, int, int, int, int, int, int]:
    assignment_id = str(getattr(row, "assignment_id", "") or "").strip()
    url = _normalized_blackboard_url(getattr(row, "url", None)) or ""
    source_page = _normalized_blackboard_url(getattr(row, "source_page", None)) or ""
    status = str(getattr(row, "status", "") or "").strip()
    submission_status = str(getattr(row, "submission_status", "") or "").strip()
    lowered_url = url.lower()
    lowered_source = source_page.lower()
    return (
        1 if submission_status else 0,
        1 if status else 0,
        1 if assignment_id and not assignment_id.startswith("asg_") else 0,
        1 if "/webapps/assignment/" in lowered_url else 0,
        1 if "content_id=" in lowered_url else 0,
        1 if "content_id=" in lowered_source else 0,
        1 if bool(getattr(row, "description_html", None)) else 0,
        1 if bool(getattr(row, "attachments_json", None)) else 0,
    )


def _announcement_html_to_markdown(value: str | None) -> str | None:
    html = str(value or "").strip()
    if not html:
        return None
    try:
        markdown = html_to_markdown(
            html,
            heading_style="ATX",
            bullets="-",
            strong_em_symbol="*",
        )
    except Exception:
        return None
    return _normalize_markdown_text(markdown)


def _deserialize_evidence_json(value: str | None) -> Any:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except Exception:
        return text


def _normalize_parallel_workers(value: Any, fallback: int = 1) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return fallback
    return max(1, min(6, parsed))


def _infer_progress_stage(message: str) -> str | None:
    normalized = message.strip()
    if not normalized:
        return None

    if "CASClient" in normalized or "认证" in normalized:
        return "authenticating"
    if (
        "基础实时数据" in normalized
        or "课程列表" in normalized
        or "当前学期" in normalized
    ):
        return "fetching_courses"
    if any(
        token in normalized for token in ("处理课程", "作业", "成绩", "公告", "资源")
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
    _touch_sync_status(state)


def _sync_status_snapshot(
    persisted_status: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    merged = _select_newer_sync_status(_sync_status, persisted_status)
    logs = merged.get("progressLogs", [])
    return {
        **merged,
        "progressLogs": list(logs) if isinstance(logs, list) else [],
    }


def _run_blackboard_sync_job(
    username: str,
    password: str,
    db_path: Path,
    current_term_only: bool,
    parallel_workers: int,
    bridge: Any = None,
) -> None:
    try:
        started_at = time.monotonic()

        def progress_callback(message: str) -> None:
            if _sync_cancel_event.is_set():
                raise TimeoutError("同步已取消")
            if time.monotonic() - started_at > _SYNC_TIMEOUT_SECONDS:
                raise TimeoutError(f"同步超时（>{_SYNC_TIMEOUT_SECONDS} 秒）")
            _update_sync_progress(_sync_status, message)
            _persist_sync_status_via_bridge_blocking(bridge, _sync_status_snapshot())

        report = run_blackboard_snapshot_sync(
            username,
            password,
            db_path=db_path,
            reset_schema=False,
            verify_second_sync=True,
            current_term_only=current_term_only,
            parallel_workers=parallel_workers,
            progress=progress_callback,
        )
        _reconcile_download_bindings_for_database(db_path)
        _apply_sync_status_patch(
            _sync_status,
            status="completed",
            lastSyncAt=report.snapshot.logs[-1].timestamp
            if report.snapshot.logs
            else None,
            lastSyncError=None,
            progressStage=None,
            progressMessage=None,
            canCancel=False,
        )
        _persist_sync_status_via_bridge_blocking(bridge, _sync_status_snapshot())
    except Exception as exc:
        error_message = str(exc)
        if _sync_cancel_event.is_set() and error_message == "同步已取消":
            _apply_sync_status_patch(
                _sync_status,
                status="failed",
                lastSyncError=error_message,
                progressStage=None,
                progressMessage=error_message,
                canCancel=False,
            )
            _update_sync_progress(_sync_status, error_message)
        else:
            _apply_sync_status_patch(
                _sync_status,
                status="failed",
                lastSyncError=error_message,
                progressStage=None,
                progressMessage=error_message,
                canCancel=False,
            )
            _update_sync_progress(_sync_status, error_message)
        _persist_sync_status_via_bridge_blocking(bridge, _sync_status_snapshot())
    finally:
        _sync_cancel_event.clear()
        _SYNC_LOCK.release()


def build_blackboard_ui_router() -> APIRouter:
    router = APIRouter(prefix="/api/blackboard")

    @router.get("/sync/status")
    async def get_sync_status(request: Request) -> dict[str, Any]:
        bridge = getattr(request.app.state, "host_capability_bridge_client", None)
        persisted_status = await _load_persisted_sync_status_via_bridge(bridge)
        return _sync_status_snapshot(persisted_status)

    @router.post("/sync/trigger")
    async def trigger_sync(
        request: Request,
        body: dict[str, Any] = Body(default={}),
    ) -> dict[str, Any]:
        bridge = getattr(request.app.state, "host_capability_bridge_client", None)
        persisted_status = await _load_persisted_sync_status_via_bridge(bridge)
        current_status = _sync_status_snapshot(persisted_status)
        if current_status["status"] == "running":
            return {
                "ok": True,
                "message": "sync already in progress",
                **current_status,
            }
        if not _SYNC_LOCK.acquire(blocking=False):
            return {
                "ok": True,
                "message": "sync already in progress",
                **_sync_status_snapshot(persisted_status),
            }

        lock_owned_by_worker = False
        try:
            _apply_sync_status_patch(
                _sync_status,
                status="running",
                progressStage="authenticating",
                progressMessage="开始同步...",
                progressLogs=["开始同步..."],
                lastSyncError=None,
                canCancel=True,
                timeoutSeconds=_SYNC_TIMEOUT_SECONDS,
            )
            _sync_cancel_event.clear()
            await _persist_sync_status_via_bridge(bridge, _sync_status_snapshot())

            username, password = await _resolve_credentials(request, body)
            current_term_only = bool(
                body.get("currentTermOnly") if isinstance(body, dict) else False
            )
            parallel_workers = _normalize_parallel_workers(
                body.get("parallelWorkers") if isinstance(body, dict) else None,
                fallback=1,
            )

            if not username or not password:
                error_message = "缺少 CAS 凭证，请在设置中配置 SUSTech 用户名和密码"
                _apply_sync_status_patch(
                    _sync_status,
                    status="failed",
                    lastSyncError=error_message,
                    progressStage=None,
                    progressMessage=error_message,
                    progressLogs=[*_sync_status.get("progressLogs", []), error_message],
                    canCancel=False,
                )
                await _persist_sync_status_via_bridge(bridge, _sync_status_snapshot())
                return {"ok": True, "message": "sync failed", **_sync_status_snapshot()}

            db_manager = _get_db_manager(request)
            worker = threading.Thread(
                target=_run_blackboard_sync_job,
                args=(
                    username,
                    password,
                    db_manager.db_path,
                    current_term_only,
                    parallel_workers,
                    bridge,
                ),
                name="blackboard-ui-sync",
                daemon=True,
            )
            worker.start()
            lock_owned_by_worker = True
            return {"ok": True, "message": "sync started", **_sync_status_snapshot()}
        except Exception as exc:
            error_message = str(exc)
            _apply_sync_status_patch(
                _sync_status,
                status="failed",
                lastSyncError=error_message,
                progressStage=None,
                progressMessage=error_message,
                canCancel=False,
            )
            _update_sync_progress(_sync_status, error_message)
            await _persist_sync_status_via_bridge(bridge, _sync_status_snapshot())
            return {"ok": True, "message": "sync failed", **_sync_status_snapshot()}
        finally:
            if not lock_owned_by_worker:
                _SYNC_LOCK.release()

    @router.post("/sync/cancel")
    async def cancel_sync(request: Request) -> dict[str, Any]:
        if _sync_status.get("status") != "running":
            return {
                "ok": True,
                "message": "sync not running",
                **_sync_status_snapshot(),
            }
        _sync_cancel_event.set()
        _apply_sync_status_patch(
            _sync_status,
            progressMessage="正在取消同步...",
            canCancel=False,
        )
        _update_sync_progress(_sync_status, "正在取消同步...")
        bridge = getattr(request.app.state, "host_capability_bridge_client", None)
        await _persist_sync_status_via_bridge(bridge, _sync_status_snapshot())
        return {
            "ok": True,
            "message": "sync cancellation requested",
            **_sync_status_snapshot(),
        }

    @router.post("/sync/rebuild-announcement-links")
    def rebuild_announcement_links(
        request: Request,
        body: dict[str, Any] = Body(default={}),
    ) -> dict[str, Any]:
        try:
            db = _get_db_manager(request)
            selected_course_id = (
                str(body.get("course_id") or "").strip()
                if isinstance(body, dict)
                else ""
            ) or None
            result = rebuild_announcement_assignment_links(
                db,
                course_id=selected_course_id,
            )
            return {"ok": True, **result}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.post("/resources/downloads/select-start")
    async def select_and_start_resource_download(
        request: Request,
        body: dict[str, Any] = Body(default={}),
    ) -> dict[str, Any]:
        try:
            course_id = str(body.get("course_id") or "").strip()
            resource_url_key = _normalized_blackboard_url(body.get("resource_url"))
            resource_title = str(body.get("resource_title") or "").strip()
            directory_path = str(body.get("directory_path") or "").strip()
            if not course_id:
                raise ValueError("course_id is required")
            if not resource_url_key:
                raise ValueError("resource_url is required")
            if not directory_path:
                raise ValueError("directory_path is required")
            directory = Path(directory_path)
            if not directory.exists() or not directory.is_dir():
                raise ValueError("directory_path must point to an existing directory")

            username, password = await _resolve_credentials(request, body)
            if not username or not password:
                raise ValueError("缺少 CAS 凭证，请在设置中配置 SUSTech 用户名和密码")

            db = _get_db_manager(request)
            with db._session_scope() as session:
                _upsert_download_directory_preferences(
                    session,
                    course_id=course_id,
                    resource_url_key=resource_url_key,
                    directory_path=str(directory),
                )

            existing_task = _get_download_task_by_url(resource_url_key)
            if existing_task is not None and existing_task.state == "downloading":
                payload = _task_to_dict(existing_task)
                payload["preferred_directory"] = str(directory)
                return {"ok": True, "task": payload}

            task = _ResourceDownloadTask(
                task_id=uuid4().hex,
                course_id=course_id,
                resource_url_key=resource_url_key,
                resource_title=resource_title,
                directory_path=str(directory),
                file_name=_resolve_download_file_name(resource_title, resource_url_key),
            )
            _register_download_task(task)
            _start_resource_download_worker(
                task.task_id, username, password, db.db_path
            )
            payload = _task_to_dict(task)
            payload["preferred_directory"] = str(directory)
            return {"ok": True, "task": payload}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.post("/resources/downloads/cancel")
    def cancel_resource_download(
        body: dict[str, Any] = Body(default={}),
    ) -> dict[str, Any]:
        try:
            task_id = str(body.get("task_id") or "").strip()
            resource_url_key = _normalized_blackboard_url(body.get("resource_url"))
            task = None
            if task_id:
                task = _get_download_task_by_id(task_id)
            if task is None and resource_url_key:
                task = _get_download_task_by_url(resource_url_key)
            if task is None:
                return {"ok": True, "accepted": False, "task": None}
            task.cancel_requested = True
            task.cancel_event.set()
            return {"ok": True, "accepted": True, "task": _task_to_dict(task)}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.get("/resources/downloads/status")
    def get_resource_download_status(
        course_id: str,
        request: Request,
        resource_urls: list[str] = Query(default=[]),
    ) -> dict[str, Any]:
        try:
            normalized_course_id = str(course_id or "").strip()
            if not normalized_course_id:
                raise ValueError("course_id is required")
            normalized_urls = [
                normalized
                for raw in resource_urls
                if (normalized := _normalized_blackboard_url(raw))
            ]
            db = _get_db_manager(request)
            with db._session_scope() as session:
                if not normalized_urls:
                    from app.integrations.sustech.blackboard.data.models import Resource

                    normalized_urls = [
                        str(row.url or "").strip()
                        for row in session.query(Resource)
                        .filter(
                            Resource.course_id == normalized_course_id,
                            Resource.is_deleted.is_(False),
                        )
                        .order_by(Resource.title.asc())
                        .all()
                        if str(row.url or "").strip()
                    ]

                seen_urls: set[str] = set()
                statuses: list[dict[str, Any]] = []
                for resource_url_key in normalized_urls:
                    if resource_url_key in seen_urls:
                        continue
                    seen_urls.add(resource_url_key)
                    statuses.append(
                        _build_download_status(
                            session,
                            course_id=normalized_course_id,
                            resource_url_key=resource_url_key,
                        )
                    )
            return {"ok": True, "course_id": normalized_course_id, "statuses": statuses}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

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
                    .order_by(
                        Course.is_active.desc(), Course.term.desc(), Course.name.asc()
                    )
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
    def get_course_announcements(
        course_id: str,
        request: Request,
        scope: str = Query(default="all"),
    ) -> dict[str, Any]:
        try:
            normalized_scope = str(scope or "all").strip().lower() or "all"
            if normalized_scope not in {"all", "course_only"}:
                raise ValueError("scope must be one of: all, course_only")

            db = _get_db_manager(request)
            with db._session_scope() as session:
                from app.integrations.sustech.blackboard.data.models import Announcement

                query = session.query(Announcement).filter(
                    Announcement.course_id == course_id,
                    Announcement.is_deleted.is_(False),
                )
                if normalized_scope == "course_only":
                    query = query.filter(
                        Announcement.relation_type == "plain_course_announcement"
                    )

                announcements = query.order_by(
                    Announcement.posted_at.desc(), Announcement.title.asc()
                ).all()
                result = [
                    {
                        "id": a.id,
                        "announcement_id": a.announcement_id,
                        "title": a.title,
                        "body": a.content,
                        "content": a.content,
                        "body_html": a.content_html,
                        "content_html": a.content_html,
                        "body_markdown": _announcement_html_to_markdown(a.content_html),
                        "content_markdown": _announcement_html_to_markdown(
                            a.content_html
                        ),
                        "author": a.author,
                        "publish_time": _serialize_datetime(a.posted_at),
                        "posted_at": _serialize_datetime(a.posted_at),
                        "url": a.url,
                        "course_id": a.course_id,
                        "course_name": a.course_name,
                        "relation_type": a.relation_type,
                        "relation_confidence": a.relation_confidence,
                        "linked_assignment_count": len(
                            [link for link in a.assignment_links if not link.is_deleted]
                        ),
                        "linked_assignments": [
                            {
                                "assignment_id": link.assignment_id,
                                "title": link.assignment.title,
                                "url": link.assignment.url,
                                "confidence": link.confidence,
                                "link_source": link.link_source,
                            }
                            for link in a.assignment_links
                            if not link.is_deleted
                        ],
                    }
                    for a in announcements
                ]
            return {
                "ok": True,
                "scope": normalized_scope,
                "announcements": result,
            }
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
                deduped_assignments: list[Assignment] = []
                dedupe_index: dict[tuple[str, str], int] = {}
                for row in assignments:
                    dedupe_key = (
                        str(row.course_id or "").strip(),
                        str(row.title or "").strip(),
                    )
                    existing_index = dedupe_index.get(dedupe_key)
                    if existing_index is None:
                        dedupe_index[dedupe_key] = len(deduped_assignments)
                        deduped_assignments.append(row)
                        continue
                    existing = deduped_assignments[existing_index]
                    if _assignment_dedupe_rank(row) > _assignment_dedupe_rank(existing):
                        deduped_assignments[existing_index] = row
                result = [
                    {
                        "id": a.id,
                        "assignment_id": a.assignment_id,
                        "title": a.title,
                        "due_date": a.due_date,
                        "posted_date": a.posted_date,
                        "url": a.url,
                        "description": a.description,
                        "description_html": a.description_html,
                        "summary": a.summary,
                        "source_page": a.source_page,
                        "attachments_json": a.attachments_json,
                        "status": a.status,
                        "submission_status": a.submission_status,
                        "score": a.score,
                        "total_score": a.total_score,
                        "course_id": a.course_id,
                        "linked_announcements_count": len(
                            [
                                link
                                for link in a.announcement_links
                                if not link.is_deleted
                            ]
                        ),
                        "linked_announcements": [
                            {
                                "announcement_id": link.announcement.announcement_id,
                                "title": link.announcement.title,
                                "posted_at": _serialize_datetime(
                                    link.announcement.posted_at
                                ),
                                "publish_time": _serialize_datetime(
                                    link.announcement.posted_at
                                ),
                                "content": link.announcement.content,
                                "content_html": link.announcement.content_html,
                                "content_markdown": _announcement_html_to_markdown(
                                    link.announcement.content_html
                                ),
                                "relation_confidence": link.confidence,
                                "link_source": link.link_source,
                            }
                            for link in sorted(
                                [
                                    item
                                    for item in a.announcement_links
                                    if not item.is_deleted
                                ],
                                key=lambda item: (
                                    item.announcement.posted_at or datetime.min,
                                    item.announcement.title,
                                ),
                                reverse=True,
                            )
                        ],
                    }
                    for a in deduped_assignments
                ]
            return {"ok": True, "assignments": result}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    @router.get("/data/courses/{course_id}/announcement-assignment-links")
    def get_course_announcement_assignment_links(
        course_id: str,
        request: Request,
    ) -> dict[str, Any]:
        try:
            db = _get_db_manager(request)
            with db._session_scope() as session:
                from app.integrations.sustech.blackboard.data.models import (
                    AnnouncementAssignmentLink,
                )

                links = (
                    session.query(AnnouncementAssignmentLink)
                    .filter(
                        AnnouncementAssignmentLink.course_id == course_id,
                        AnnouncementAssignmentLink.is_deleted.is_(False),
                    )
                    .order_by(
                        AnnouncementAssignmentLink.updated_at.desc(),
                        AnnouncementAssignmentLink.announcement_id.asc(),
                    )
                    .all()
                )
                result = [
                    {
                        "id": link.id,
                        "announcement_id": link.announcement_id,
                        "announcement_title": link.announcement.title,
                        "assignment_id": link.assignment_id,
                        "assignment_title": link.assignment.title,
                        "course_id": link.course_id,
                        "link_source": link.link_source,
                        "confidence": link.confidence,
                        "evidence": _deserialize_evidence_json(link.evidence_json),
                        "created_at": _serialize_datetime(link.created_at),
                        "updated_at": _serialize_datetime(link.updated_at),
                        "last_synced_at": _serialize_datetime(link.last_synced_at),
                    }
                    for link in links
                ]
            return {"ok": True, "links": result}
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

                _reconcile_download_bindings_for_course(session, course_id=course_id)
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
