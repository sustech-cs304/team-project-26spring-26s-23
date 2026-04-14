"""Legacy compatibility wrappers for older Blackboard provider-side tool imports.

Canonical runtime/tooling surface lives in `app.blackboard.facade` via
`get_blackboard_tool_contracts()`. Keep this module thin and compatibility-only.
"""

from __future__ import annotations

from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any, cast

from app.blackboard.provider.use_cases.calendar_ics import (
    refresh_calendar_ics_subscription,
)
from app.blackboard.provider.use_cases.course_catalog import (
    search_course_catalog_with_credentials,
)
from app.blackboard.provider.use_cases.snapshot_sync import run_blackboard_snapshot_sync


def _jsonable(value: Any) -> Any:
    if isinstance(value, Path):
        return value.as_posix()
    if isinstance(value, datetime):
        return value.isoformat(timespec="seconds")
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_jsonable(item) for item in value]
    if hasattr(value, "__dataclass_fields__"):
        return _jsonable(asdict(cast(Any, value)))
    return value


def search_course_catalog(
    *,
    username: str,
    password: str,
    keyword: str,
    field: str = "CourseName",
    operator: str = "Contains",
    limit: int | None = None,
) -> dict[str, Any]:
    result = search_course_catalog_with_credentials(
        username,
        password,
        keyword=keyword,
        field=field,
        operator=operator,
        limit=limit,
    )
    return {
        "keyword": result.keyword,
        "field": result.field,
        "operator": result.operator,
        "limit": result.limit,
        "total": result.total,
        "results": _jsonable(result.results),
        "logs": _jsonable(result.logs),
        "log_summary": _jsonable(result.log_summary),
    }


def refresh_calendar_ics(
    *,
    feed_url: str,
    db_path: str | Path | None = None,
    reset_schema: bool = False,
) -> dict[str, Any]:
    result = refresh_calendar_ics_subscription(
        feed_url,
        db_path=db_path,
        reset_schema=reset_schema,
    )
    return {
        "feed_url": result.feed_url,
        "db_path": result.db_path.as_posix(),
        "stats": _jsonable(result.stats),
        "active_event_count": result.active_event_count,
        "all_event_count": result.all_event_count,
        "active_events": _jsonable(result.active_events),
        "logs": _jsonable(result.logs),
        "log_summary": _jsonable(result.log_summary),
    }


def sync_blackboard_snapshot(
    *,
    username: str,
    password: str,
    db_path: str | Path | None = None,
    reset_schema: bool = False,
    resource_course_limit: int = 3,
    verify_second_sync: bool = True,
) -> dict[str, Any]:
    report = run_blackboard_snapshot_sync(
        username,
        password,
        db_path=db_path,
        reset_schema=reset_schema,
        resource_course_limit=resource_course_limit,
        verify_second_sync=verify_second_sync,
    )
    return {
        "db_path": report.db_path.as_posix(),
        "resource_course_limit": report.snapshot.resource_course_limit,
        "scraped_counts": report.snapshot.scraped_counts(),
        "first_sync_stats": _jsonable(report.first_sync_stats),
        "second_sync_stats": _jsonable(report.second_sync_stats),
        "table_counts": _jsonable(report.table_counts),
        "expected_active_counts": _jsonable(report.expected_active_counts),
        "integrity_ok": report.integrity_ok,
        "second_sync_has_no_new_records": report.second_sync_has_no_new_records(),
        "second_sync_has_no_deleted_records": report.second_sync_has_no_deleted_records(),
        "logs": _jsonable(report.logs),
        "log_summary": _jsonable(report.log_summary),
    }


# Legacy compatibility exports only; canonical runtime/tooling surface lives in
# app.blackboard.facade via get_blackboard_tool_contracts().
__all__ = [
    "search_course_catalog",
    "refresh_calendar_ics",
    "sync_blackboard_snapshot",
]
