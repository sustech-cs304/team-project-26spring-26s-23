from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from pathlib import Path

from app.integrations.sustech.blackboard.api import BlackboardCalendarICSParser
from app.integrations.sustech.blackboard.data import CalendarEvent, DatabaseManager
from app.integrations.sustech.blackboard.provider.results import CalendarICSSyncResult
from app.integrations.sustech.blackboard.provider.use_cases.calendar_ics import (
    refresh_calendar_ics_subscription_from_text,
)


def _assert_equal(actual: object, expected: object, message: str) -> None:
    if actual != expected:
        raise AssertionError(f"{message}: expected={expected!r}, actual={actual!r}")


def _assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _db_path(tmp_path: Path, name: str) -> Path:
    return tmp_path / f"{name}.db"


def test_parse_basic_vevent() -> None:
    parser = BlackboardCalendarICSParser()
    ics_text = """BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-1@example.com
SUMMARY:ICS Basic Event
DTSTART:20260305T100000Z
DTEND:20260305T113000Z
END:VEVENT
END:VCALENDAR
"""

    events = parser.parse_events(ics_text)
    _assert_equal(len(events), 1, "基础 VEVENT 数量")

    row = events[0]
    _assert_equal(row.title, "ICS Basic Event", "标题解析")
    _assert_equal(row.start_at, datetime(2026, 3, 5, 10, 0, 0), "开始时间 UTC 解析")
    _assert_equal(row.end_at, datetime(2026, 3, 5, 11, 30, 0), "结束时间 UTC 解析")
    _assert_true(str(row.uid).startswith("ics_"), "UID 应转换为稳定哈希ID")


def test_uid_fallback_when_missing_uid() -> None:
    parser = BlackboardCalendarICSParser()
    ics_text = """BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
SUMMARY:No UID Event
DTSTART:20260306T010000Z
DTEND:20260306T020000Z
END:VEVENT
END:VCALENDAR
"""

    events = parser.parse_events(ics_text)
    _assert_equal(len(events), 1, "无 UID VEVENT 数量")

    row = events[0]
    expected_fallback = hashlib.sha1("No UID Event::2026-03-06T02:00:00".encode("utf-8")).hexdigest()[:20]
    _assert_equal(row.uid, f"ics_{expected_fallback}", "回退 uid 生成策略")
    _assert_equal(row.raw_uid, None, "raw_uid 应为空")


def test_keep_done_status_after_refresh(tmp_path: Path) -> None:
    db_path = _db_path(tmp_path, "test_calendar_ics_done")
    manager = DatabaseManager(db_path, reset_schema=True)
    feed_url = "https://example.local/calendar.ics"

    ics_v1 = """BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:keep-done@example.com
SUMMARY:Keep Done Event V1
DTSTART:20260307T080000Z
DTEND:20260307T090000Z
END:VEVENT
END:VCALENDAR
"""

    refresh_calendar_ics_subscription_from_text(feed_url, ics_v1, db_path=db_path)

    uid = BlackboardCalendarICSParser().parse_events(ics_v1)[0].uid
    with manager._session_scope() as session:  # noqa: SLF001
        row = session.query(CalendarEvent).filter(CalendarEvent.uid == uid).one()
        row.done = True

    ics_v2 = """BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:keep-done@example.com
SUMMARY:Keep Done Event V2
DTSTART:20260307T081500Z
DTEND:20260307T091500Z
END:VEVENT
END:VCALENDAR
"""

    refresh_calendar_ics_subscription_from_text(feed_url, ics_v2, db_path=db_path)
    events = manager.list_calendar_events(feed_url)
    _assert_equal(len(events), 1, "done 保留场景事件数量")
    _assert_true(events[0].done, "刷新后应保留本地 done 状态")
    _assert_equal(events[0].title, "Keep Done Event V2", "非 done 字段仍应更新")


def test_timezone_to_utc_normalization() -> None:
    parser = BlackboardCalendarICSParser()
    ics_text = """BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:tz-event@example.com
SUMMARY:TZ Event
DTSTART;TZID=Asia/Shanghai:20260308T100000
DTEND;TZID=Asia/Shanghai:20260308T113000
END:VEVENT
END:VCALENDAR
"""

    events = parser.parse_events(ics_text)
    _assert_equal(len(events), 1, "时区 VEVENT 数量")

    row = events[0]
    expected_start = datetime(2026, 3, 8, 2, 0, 0, tzinfo=UTC).replace(tzinfo=None)
    expected_end = datetime(2026, 3, 8, 3, 30, 0, tzinfo=UTC).replace(tzinfo=None)

    _assert_equal(row.start_at, expected_start, "开始时间应归一化为 UTC")
    _assert_equal(row.end_at, expected_end, "结束时间应归一化为 UTC")


def test_refresh_soft_delete_and_stats(tmp_path: Path) -> None:
    db_path = _db_path(tmp_path, "test_calendar_ics_soft_delete")
    feed_url = "https://example.local/calendar-delete.ics"

    ics_v1 = """BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-a@example.com
SUMMARY:Event A
DTSTART:20260309T010000Z
DTEND:20260309T020000Z
END:VEVENT
BEGIN:VEVENT
UID:event-b@example.com
SUMMARY:Event B
DTSTART:20260309T030000Z
DTEND:20260309T040000Z
END:VEVENT
END:VCALENDAR
"""

    stats1 = refresh_calendar_ics_subscription_from_text(feed_url, ics_v1, db_path=db_path, reset_schema=True)
    _assert_equal(stats1.stats["inserted"], 2, "首次插入数")
    _assert_equal(stats1.stats["deleted"], 0, "首次删除数")

    ics_v2 = """BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:event-a@example.com
SUMMARY:Event A Updated
DTSTART:20260309T010000Z
DTEND:20260309T021500Z
END:VEVENT
END:VCALENDAR
"""

    stats2 = refresh_calendar_ics_subscription_from_text(feed_url, ics_v2, db_path=db_path)
    _assert_equal(stats2.stats["inserted"], 0, "二次插入数")
    _assert_equal(stats2.stats["updated"], 1, "二次更新数")
    _assert_equal(stats2.stats["deleted"], 1, "二次删除数")
    _assert_equal(stats2.stats["total"], 1, "活跃总数")


def test_blackboard_uid_timestamp_prefix_is_ignored(tmp_path: Path) -> None:
    db_path = _db_path(tmp_path, "test_calendar_ics_blackboard_uid")
    manager = DatabaseManager(db_path, reset_schema=True)
    feed_url = "https://example.local/calendar-blackboard.ics"

    ics_v1 = """BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:20260306T042022Z-_blackboard.platform.gradebook2.GradableItem-_407181_1@bbapps7
SUMMARY:Assignment 0: Declaration Form
DTSTART:20260315T155900Z
DTEND:20260315T155900Z
END:VEVENT
END:VCALENDAR
"""

    ics_v2 = """BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:20260306T045155Z-_blackboard.platform.gradebook2.GradableItem-_407181_1@bbapps7
SUMMARY:Assignment 0: Declaration Form
DTSTART:20260315T155900Z
DTEND:20260315T155900Z
END:VEVENT
END:VCALENDAR
"""

    stats1 = refresh_calendar_ics_subscription_from_text(feed_url, ics_v1, db_path=db_path)
    _assert_equal(stats1.stats["inserted"], 1, "Blackboard 首次插入数")
    _assert_equal(stats1.stats["parsed"], 1, "Blackboard 首次解析数")

    stats2 = refresh_calendar_ics_subscription_from_text(feed_url, ics_v2, db_path=db_path)
    _assert_equal(stats2.stats["inserted"], 0, "Blackboard 二次插入数")
    _assert_equal(stats2.stats["updated"], 1, "Blackboard 二次更新数")
    _assert_equal(stats2.stats["deleted"], 0, "Blackboard 二次删除数")
    _assert_equal(stats2.stats["total"], 1, "Blackboard 活跃总数")

    events_all = manager.list_calendar_events(feed_url, include_deleted=True)
    _assert_equal(len(events_all), 1, "Blackboard 不应生成重复事件")


# ── CalendarICSSyncResult unified_* 字段 ─────────────────────────────

def test_calendar_ics_result_unified_ok_when_success() -> None:
    result = CalendarICSSyncResult(
        feed_url="https://example.ics",
        refresh_mode="force",
        db_path=Path("/tmp/test.db"),
        stats={"inserted": 1, "updated": 0, "deleted": 0},
        active_events=[],
        all_events=[],
        unified_stats={"inserted": 2, "updated": 0, "deleted": 0},
    )
    _assert_true(result.unified_ok, "unified_stats 存在且 unified_error 为 None，应返回 True")
    assert result.unified_stats is not None
    _assert_equal(result.unified_stats["inserted"], 2, "应能读取 unified_stats")
    _assert_true(result.unified_error is None, "unified_error 应为 None")


def test_calendar_ics_result_unified_not_ok_when_error() -> None:
    result = CalendarICSSyncResult(
        feed_url="https://example.ics",
        refresh_mode="force",
        db_path=Path("/tmp/test.db"),
        stats={"inserted": 1, "updated": 0, "deleted": 0},
        active_events=[],
        all_events=[],
        unified_error="database locked",
    )
    _assert_true(not result.unified_ok, "unified_error 存在时应返回 False")
    _assert_equal(result.unified_error, "database locked", "unified_error 应保留错误信息")
    _assert_true(result.unified_stats is None, "unified_stats 应为 None")


def test_calendar_ics_result_unified_ok_defaults_to_false() -> None:
    result = CalendarICSSyncResult(
        feed_url="https://example.ics",
        refresh_mode="force",
        db_path=Path("/tmp/test.db"),
        stats={"inserted": 0},
        active_events=[],
        all_events=[],
    )
    _assert_true(not result.unified_ok, "两个字段均为默认值 None 时应返回 False")


def test_calendar_ics_result_unified_field_in_return_value(tmp_path: Path) -> None:
    """从 ICS 刷新接口返回的结果应包含 unified_stats / unified_error。"""
    db_path = tmp_path / "test_ics.db"
    feed_url = "https://bb.example/calendar.ics"

    ics_text = """BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:unified-test@example.com
SUMMARY:Unified Test Event
DTSTART:20260501T100000Z
DTEND:20260501T120000Z
END:VEVENT
END:VCALENDAR"""

    result = refresh_calendar_ics_subscription_from_text(
        feed_url, ics_text, db_path=db_path
    )

    # unified_stats 和 unified_error 应存在（至少一个不为 None）
    _assert_true(
        result.unified_stats is not None or result.unified_error is not None,
        "返回结果应包含 unified_stats 或 unified_error",
    )
