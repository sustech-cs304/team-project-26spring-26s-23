from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

import httpx

from app.blackboard.api.calendar_ics_parser import BlackboardCalendarICSParser
from app.blackboard.api.dto import CalendarEventDTO
from app.blackboard.provider.results import CalendarICSSyncResult
from app.blackboard.shared import BlackboardLogEvent, BlackboardLogSession, create_log_session
from app.core.database import DatabaseManager


_ics_parser = BlackboardCalendarICSParser()


def _normalize_feed_url(feed_url: str) -> str:
    normalized_feed_url = str(feed_url or "").strip()
    if not normalized_feed_url:
        raise ValueError("feed_url 不能为空")
    return normalized_feed_url


def _event_rows(events: list[CalendarEventDTO]) -> list[dict[str, Any]]:
    return [
        {
            "uid": event.uid,
            "raw_uid": event.raw_uid,
            "title": event.title,
            "start_at": event.start_at,
            "end_at": event.end_at,
            "all_day": event.all_day,
            "description": event.description,
            "location": event.location,
            "course_id": event.course_id,
        }
        for event in events
    ]


def _event_dto_from_row(row: dict[str, Any]) -> CalendarEventDTO:
    start_at = row.get("start_at")
    end_at = row.get("end_at")
    return CalendarEventDTO(
        uid=str(row.get("uid") or ""),
        raw_uid=str(row.get("raw_uid") or "") or None,
        title=str(row.get("title") or ""),
        start_at=start_at if isinstance(start_at, datetime) else None,
        end_at=end_at if isinstance(end_at, datetime) else None,
        all_day=bool(row.get("all_day")),
        description=str(row.get("description") or "") or None,
        location=str(row.get("location") or "") or None,
        course_id=str(row.get("course_id") or "") or None,
    )


def _build_result(
    db_manager: DatabaseManager,
    feed_url: str,
    stats: dict[str, Any],
    *,
    logs: list[BlackboardLogEvent] | None = None,
) -> CalendarICSSyncResult:
    active_event_rows = db_manager.list_calendar_events(feed_url, include_deleted=False)
    all_event_rows = db_manager.list_calendar_events(feed_url, include_deleted=True)
    return CalendarICSSyncResult(
        feed_url=feed_url,
        db_path=db_manager.db_path.resolve(),
        stats=stats,
        active_events=[_event_dto_from_row(row) for row in active_event_rows],
        all_events=[_event_dto_from_row(row) for row in all_event_rows],
        logs=[] if logs is None else logs,
    )


def refresh_calendar_ics_subscription(
    feed_url: str,
    *,
    db_path: str | Path | None = None,
    reset_schema: bool = False,
    enable_console_logging: bool = False,
) -> CalendarICSSyncResult:
    normalized_feed_url = _normalize_feed_url(feed_url)
    log_session = create_log_session(console=enable_console_logging)
    logger = log_session.make_logger(
        layer="provider",
        source="provider.use_cases.calendar_ics",
        context={"feed_url": normalized_feed_url},
    )
    db_manager = DatabaseManager(db_path, reset_schema=reset_schema)
    previous = db_manager.get_calendar_subscription(normalized_feed_url) or {}
    headers: dict[str, str] = {}

    if previous.get("etag"):
        headers["If-None-Match"] = str(previous["etag"])
    if previous.get("last_modified"):
        headers["If-Modified-Since"] = str(previous["last_modified"])

    now = datetime.utcnow()

    try:
        logger.info(
            "开始刷新 ICS 订阅",
            payload={"db_path": db_manager.db_path.resolve().as_posix(), "conditional_headers": sorted(headers.keys())},
        )
        with httpx.Client(timeout=30.0, follow_redirects=True) as client:
            response = client.get(normalized_feed_url, headers=headers)

        if response.status_code == 304:
            db_manager.upsert_calendar_subscription(
                normalized_feed_url,
                etag=str(previous.get("etag") or "") or None,
                last_modified=str(previous.get("last_modified") or "") or None,
                last_refreshed_at=now,
                last_error=None,
                is_active=True,
            )
            total = len(db_manager.list_calendar_events(normalized_feed_url, include_deleted=False))
            logger.info(
                "ICS 订阅未变化",
                payload={"total": total, "etag": previous.get("etag"), "last_modified": previous.get("last_modified")},
            )
            return _build_result(
                db_manager,
                normalized_feed_url,
                {
                    "inserted": 0,
                    "updated": 0,
                    "deleted": 0,
                    "parsed": 0,
                    "total": total,
                    "not_modified": True,
                    "feed_url": normalized_feed_url,
                    "etag": previous.get("etag"),
                    "last_modified": previous.get("last_modified"),
                    "refreshed_at": now,
                },
                logs=log_session.snapshot(),
            )

        response.raise_for_status()
        logger.info(
            "ICS 文本下载成功",
            payload={
                "status_code": response.status_code,
                "etag": response.headers.get("etag"),
                "last_modified": response.headers.get("last-modified"),
            },
        )
        return refresh_calendar_ics_subscription_from_text(
            normalized_feed_url,
            response.text,
            db_path=db_manager.db_path,
            etag=response.headers.get("etag"),
            last_modified=response.headers.get("last-modified"),
            _log_session=log_session,
        )
    except Exception as ex:
        logger.exception("ICS 刷新失败", ex)
        db_manager.upsert_calendar_subscription(
            normalized_feed_url,
            etag=str(previous.get("etag") or "") or None,
            last_modified=str(previous.get("last_modified") or "") or None,
            last_refreshed_at=now,
            last_error=str(ex),
            is_active=True,
        )
        raise


def refresh_calendar_ics_subscription_from_text(
    feed_url: str,
    ics_text: str,
    *,
    db_path: str | Path | None = None,
    reset_schema: bool = False,
    etag: str | None = None,
    last_modified: str | None = None,
    enable_console_logging: bool = False,
    _log_session: BlackboardLogSession | None = None,
) -> CalendarICSSyncResult:
    normalized_feed_url = _normalize_feed_url(feed_url)
    log_session = _log_session or create_log_session(console=enable_console_logging)
    logger = log_session.make_logger(
        layer="provider",
        source="provider.use_cases.calendar_ics",
        context={"feed_url": normalized_feed_url},
    )
    db_manager = DatabaseManager(db_path, reset_schema=reset_schema)
    logger.info("开始解析 ICS 文本", payload={"text_length": len(ics_text)})
    events = _ics_parser.parse_events(ics_text)
    logger.info("ICS 解析完成", payload={"parsed": len(events)})
    stats = db_manager.sync_calendar_events(
        normalized_feed_url,
        _event_rows(events),
        logger=logger.child("provider.use_cases.calendar_ics.data.calendar_events"),
    )
    now = datetime.utcnow()
    db_manager.upsert_calendar_subscription(
        normalized_feed_url,
        etag=etag,
        last_modified=last_modified,
        last_refreshed_at=now,
        last_error=None,
        is_active=True,
    )

    total = len(db_manager.list_calendar_events(normalized_feed_url, include_deleted=False))
    logger.info(
        "ICS 订阅同步完成",
        payload={
            "stats": dict(stats),
            "total": total,
            "etag": etag,
            "last_modified": last_modified,
        },
    )
    return _build_result(
        db_manager,
        normalized_feed_url,
        {
            **stats,
            "parsed": len(events),
            "total": total,
            "feed_url": normalized_feed_url,
            "etag": etag,
            "last_modified": last_modified,
            "refreshed_at": now,
        },
        logs=log_session.snapshot(),
    )
