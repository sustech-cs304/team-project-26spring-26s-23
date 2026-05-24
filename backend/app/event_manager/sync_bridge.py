"""Blackboard → timeline.db 同步桥接。

调用方（例如 calendar_ics 用例或 Blackboard snapshot 同步）在 Blackboard
数据同步完成后调用这里的函数，即可将 Blackboard 侧时间型数据同步至
Electron timeline.db。
"""

from __future__ import annotations

import calendar
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any

from app.integrations.sustech.blackboard.shared import (
    parse_loose_datetime,
    to_utc_naive,
)
from app.timeline_db import (
    insert_timeline_event,
    query_timeline_events,
    resolve_timeline_db_path,
    sync_timeline_events,
)

if TYPE_CHECKING:
    from app.integrations.sustech.blackboard.data.db_manager import (
        DatabaseManager as BlackboardDatabaseManager,
    )

_SOURCE_BLACKBOARD = "bb"
_ASSIGNMENT_SOURCE_ID_PREFIX = "assignment:"
_ASSIGNMENT_START_FIELD_CANDIDATES = (
    "start_time",
    "start_at",
    "available_from",
    "open_at",
    "release_at",
    "release_date",
)
_ASSIGNMENT_END_FIELD_CANDIDATES = (
    "end_time",
    "end_at",
    "due_at",
    "due_date_parsed",
    "due_date",
    "close_at",
    "available_until",
)
_REAL_ASSIGNMENT_URL_MARKERS = (
    "/webapps/assignment/",
    "/bb-assignment-",
    "/bb-mygrades-",
)
_ASSIGNMENT_DEADLINE_WINDOW = timedelta(hours=1)
_ASSIGNMENT_EVENT_MAX_AGE_MONTHS = 3
_ASSIGNMENT_COMPLETED_MARKERS = (
    "submitted",
    "已提交",
    "graded",
    "已批改",
    "completed",
    "complete",
    "done",
    "turned in",
    "提交成功",
)
_ASSIGNMENT_INCOMPLETE_MARKERS = (
    "not submitted",
    "unsubmitted",
    "未提交",
    "missing",
    "缺交",
    "not complete",
    "incomplete",
)
_EMPTY_SCORE_MARKERS = {"", "-", "--", "—", "n/a", "none", "null"}


def _map_bb_event_to_timeline_row(bb_event: Any) -> dict[str, Any]:
    """将 Blackboard CalendarEventDTO 映射为 timeline_events 行。"""
    metadata: dict[str, Any] = {}
    if bb_event.location:
        metadata["location"] = bb_event.location
    if bb_event.course_id:
        metadata["course_id"] = bb_event.course_id

    return {
        "source_id": bb_event.uid,
        "title": bb_event.title,
        "start_time": _datetime_to_iso(bb_event.start_at),
        "end_time": _datetime_to_iso(bb_event.end_at) if bb_event.end_at else None,
        "description": bb_event.description,
        "is_all_day": bb_event.all_day,
        "location": bb_event.location,
        "status": "completed" if bb_event.done else "not_started",
        "metadata_payload": metadata if metadata else None,
    }


def sync_blackboard_to_unified(
    blackboard_db: BlackboardDatabaseManager,
) -> dict[str, int]:
    """将 Blackboard 全部活跃日历事件同步到 timeline.db。

    Returns:
        {"inserted": N, "updated": N, "deleted": N}
    """
    bb_events = blackboard_db.list_all_calendar_events(include_deleted=False)
    timeline_rows = [_map_bb_event_to_timeline_row(e) for e in bb_events]
    db_path = resolve_timeline_db_path()
    return sync_timeline_events(db_path, _SOURCE_BLACKBOARD, timeline_rows)


def sync_blackboard_assignments_to_unified(
    blackboard_db: BlackboardDatabaseManager,
    *,
    user_data_dir: str | Path | None = None,
    timeline_db_path: Path | None = None,
) -> dict[str, int]:
    """将 Blackboard assignment 轻量追加到统一日历。

    该函数只按 ``(source='bb', source_id='assignment:<assignment_id>')``
    检查重复并插入缺失事件；不会删除或更新已有 ``bb`` 来源事件，以免误删
    Blackboard ICS 同步出的日历事件。
    """
    db_path = timeline_db_path or resolve_timeline_db_path(user_data_dir=user_data_dir)
    existing_source_ids = {
        str(row.get("source_id") or "").strip()
        for row in query_timeline_events(db_path, source=_SOURCE_BLACKBOARD)
        if str(row.get("source_id") or "").strip()
    }
    stats = {
        "inserted": 0,
        "skipped_existing": 0,
        "skipped_invalid_time": 0,
        "skipped_too_old": 0,
        "skipped_missing_identity": 0,
    }
    assignment_age_cutoff = _assignment_event_cutoff()

    for assignment in _list_active_assignments(blackboard_db):
        source_id = _assignment_source_id(assignment)
        title = _optional_text(_assignment_value(assignment, "title"))
        if source_id is None or title is None:
            stats["skipped_missing_identity"] += 1
            continue
        if source_id in existing_source_ids:
            stats["skipped_existing"] += 1
            continue

        start_time, end_time = _resolve_assignment_time_range(assignment)
        if start_time is None or end_time is None or end_time <= start_time:
            stats["skipped_invalid_time"] += 1
            continue
        if end_time < assignment_age_cutoff:
            stats["skipped_too_old"] += 1
            continue

        status = "completed" if _assignment_is_completed(assignment) else "in_progress"
        insert_timeline_event(
            db_path,
            source=_SOURCE_BLACKBOARD,
            source_id=source_id,
            title=title,
            start_time=_datetime_to_iso(start_time),
            end_time=_datetime_to_iso(end_time),
            description=_assignment_description(assignment),
            is_all_day=False,
            location=None,
            status=status,
            metadata_payload=_assignment_metadata(assignment),
            progress=100 if status == "completed" else 50,
        )
        existing_source_ids.add(source_id)
        stats["inserted"] += 1

    return stats


def _list_active_assignments(blackboard_db: BlackboardDatabaseManager) -> list[dict[str, Any]]:
    db_path = Path(blackboard_db.db_path)
    if not db_path.exists():
        return []

    with sqlite3.connect(str(db_path)) as conn:
        conn.row_factory = sqlite3.Row
        table_exists = conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'assignments'"
        ).fetchone()
        if table_exists is None:
            return []

        columns = {
            str(row[1])
            for row in conn.execute("PRAGMA table_info(assignments)").fetchall()
        }
        selected_columns = [
            column
            for column in (
                "course_id",
                "assignment_id",
                "title",
                "url",
                "description",
                "summary",
                "source_page",
                "posted_date",
                "due_date",
                "due_date_parsed",
                "submission_status",
                "status",
                "score",
                *_ASSIGNMENT_START_FIELD_CANDIDATES,
                *_ASSIGNMENT_END_FIELD_CANDIDATES,
            )
            if column in columns
        ]
        if not selected_columns:
            return []

        deleted_filter = "WHERE is_deleted = 0" if "is_deleted" in columns else ""
        order_columns = [
            column for column in ("course_id", "assignment_id", "title") if column in columns
        ]
        order_clause = f" ORDER BY {', '.join(order_columns)}" if order_columns else ""
        cursor = conn.execute(
            f"SELECT {', '.join(selected_columns)} FROM assignments {deleted_filter}{order_clause}"
        )
        return [dict(row) for row in cursor.fetchall()]


def _assignment_source_id(assignment: Any) -> str | None:
    assignment_id = _optional_text(_assignment_value(assignment, "assignment_id"))
    if assignment_id is None:
        return None
    return f"{_ASSIGNMENT_SOURCE_ID_PREFIX}{assignment_id}"


def _resolve_assignment_time_range(assignment: Any) -> tuple[datetime | None, datetime | None]:
    start_time = _first_assignment_datetime(
        assignment,
        _ASSIGNMENT_START_FIELD_CANDIDATES,
    )
    end_time = _first_assignment_datetime(
        assignment,
        _ASSIGNMENT_END_FIELD_CANDIDATES,
    )
    if start_time is None and end_time is not None and _is_real_assignment_row(assignment):
        start_time = end_time - _ASSIGNMENT_DEADLINE_WINDOW
    return start_time, end_time


def _is_real_assignment_row(assignment: Any) -> bool:
    url_text = " ".join(
        filter(
            None,
            (
                _optional_text(_assignment_value(assignment, "url")),
                _optional_text(_assignment_value(assignment, "source_page")),
            ),
        )
    ).lower()
    return any(marker in url_text for marker in _REAL_ASSIGNMENT_URL_MARKERS)


def _assignment_event_cutoff(now: datetime | None = None) -> datetime:
    reference = to_utc_naive(now) if now is not None else datetime.now(UTC).replace(tzinfo=None)
    return _subtract_months(reference, _ASSIGNMENT_EVENT_MAX_AGE_MONTHS)


def _subtract_months(value: datetime, months: int) -> datetime:
    year = value.year
    month = value.month - months
    while month <= 0:
        month += 12
        year -= 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return value.replace(year=year, month=month, day=day)


def _first_assignment_datetime(
    assignment: Any,
    field_names: tuple[str, ...],
) -> datetime | None:
    for field_name in field_names:
        parsed = _parse_assignment_datetime(_assignment_value(assignment, field_name))
        if parsed is not None:
            return parsed
    return None


def _parse_assignment_datetime(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return to_utc_naive(value)

    text = str(value).strip()
    if not text:
        return None

    try:
        return to_utc_naive(datetime.fromisoformat(text.replace("Z", "+00:00")))
    except ValueError:
        parsed = parse_loose_datetime(text)
        return to_utc_naive(parsed)


def _datetime_to_iso(value: datetime) -> str:
    normalized = to_utc_naive(value) or value
    return normalized.isoformat()


def _assignment_is_completed(assignment: Any) -> bool:
    status_text = " ".join(
        filter(
            None,
            [
                _optional_text(_assignment_value(assignment, "submission_status")),
                _optional_text(_assignment_value(assignment, "status")),
            ],
        )
    ).lower()
    if any(marker in status_text for marker in _ASSIGNMENT_INCOMPLETE_MARKERS):
        return False
    if any(marker in status_text for marker in _ASSIGNMENT_COMPLETED_MARKERS):
        return True

    score = _optional_text(_assignment_value(assignment, "score"))
    return score is not None and score.lower() not in _EMPTY_SCORE_MARKERS


def _assignment_description(assignment: Any) -> str | None:
    return _optional_text(_assignment_value(assignment, "description")) or _optional_text(
        _assignment_value(assignment, "summary")
    )


def _assignment_metadata(assignment: Any) -> dict[str, Any]:
    return {
        "kind": "assignment",
        "course_id": _optional_text(_assignment_value(assignment, "course_id")),
        "assignment_id": _optional_text(_assignment_value(assignment, "assignment_id")),
        "url": _optional_text(_assignment_value(assignment, "url")),
        "source_page": _optional_text(_assignment_value(assignment, "source_page")),
        "posted_date": _optional_text(_assignment_value(assignment, "posted_date")),
        "due_date": _optional_text(_assignment_value(assignment, "due_date")),
        "submission_status": _optional_text(
            _assignment_value(assignment, "submission_status")
        ),
        "raw_status": _optional_text(_assignment_value(assignment, "status")),
    }


def _assignment_value(assignment: Any, field_name: str) -> Any:
    if isinstance(assignment, dict):
        return assignment.get(field_name)
    return getattr(assignment, field_name, None)


def _optional_text(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


__all__ = [
    "sync_blackboard_to_unified",
    "sync_blackboard_assignments_to_unified",
]
