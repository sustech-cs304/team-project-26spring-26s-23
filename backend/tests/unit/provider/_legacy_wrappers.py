"""Thin wrapper helpers moved from agent_tools.py for test backward compatibility.

These were extracted from ``app.integrations.sustech.blackboard.provider.tools.agent_tools``
and exist solely for test fixture support.  Production code MUST use the canonical facade:

    from app.integrations.sustech.blackboard.facade import get_blackboard_tool_contracts
"""

from __future__ import annotations

from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any, cast

from app.integrations.sustech.blackboard.provider.use_cases.calendar_ics import (
    refresh_calendar_ics_subscription,
)
from app.integrations.sustech.blackboard.provider.use_cases.course_catalog import (
    search_course_catalog_with_credentials,
)
from app.integrations.sustech.blackboard.provider.use_cases.snapshot_sync import (
    run_blackboard_course_resources_sync,
    run_blackboard_snapshot_sync,
)


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
    verify_second_sync: bool = True,
) -> dict[str, Any]:
    report = run_blackboard_snapshot_sync(
        username,
        password,
        db_path=db_path,
        reset_schema=reset_schema,
        verify_second_sync=verify_second_sync,
    )
    return {
        "db_path": report.db_path.as_posix(),
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


def sync_blackboard_course_resources(
    *,
    username: str,
    password: str,
    course_ids: list[str],
    db_path: str | Path | None = None,
    reset_schema: bool = False,
) -> dict[str, Any]:
    report = run_blackboard_course_resources_sync(
        username,
        password,
        course_ids=course_ids,
        db_path=db_path,
        reset_schema=reset_schema,
    )
    return {
        "db_path": report.db_path.as_posix(),
        "requested_course_ids": list(report.requested_course_ids),
        "processed_course_ids": list(report.processed_course_ids),
        "missing_course_ids": list(report.missing_course_ids),
        "failed_course_ids": list(report.failed_course_ids),
        "scraped_counts": report.scraped_counts(),
        "sync_stats": _jsonable(report.sync_stats),
        "table_counts": _jsonable(report.table_counts),
        "logs": _jsonable(report.logs),
        "log_summary": _jsonable(report.log_summary),
    }
