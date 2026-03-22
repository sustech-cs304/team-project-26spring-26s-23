from __future__ import annotations

from datetime import UTC, datetime

from app.blackboard.api import CalendarEventDTO, CourseDTO
from app.blackboard.shared import (
    BlackboardLogCollector,
    BlackboardConsoleSink,
    clean_text,
    create_logger,
    extract_blackboard_ids_from_url,
    extract_blackboard_token_from_text,
    extract_course_id_from_url,
    extract_date_text,
    extract_total_score,
    parse_ics_datetime,
    parse_loose_datetime,
    parse_score_metrics,
    split_score_text,
    summarize_log_events,
    to_utc_naive,
)


def _assert_equal(actual: object, expected: object, message: str) -> None:
    if actual != expected:
        raise AssertionError(f"{message}: expected={expected!r}, actual={actual!r}")


def _assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def test_extract_blackboard_ids_from_url() -> None:
    url = (
        "https://bb.sustech.edu.cn/webapps/blackboard/content/listContent.jsp?"
        "course_id=_12345_1&content_id=_67890_1"
    )
    ids = extract_blackboard_ids_from_url(url)
    _assert_equal(ids["course_id"], "_12345_1", "URL 中 course_id 提取")
    _assert_equal(ids["content_id"], "_67890_1", "URL 中 content_id 提取")
    _assert_equal(ids["source"], "query", "ID 来源应为 query")


def test_extract_course_id_alias_and_text_token() -> None:
    alias_url = "launcher?type=course&id=_99887_1"
    _assert_equal(extract_course_id_from_url(alias_url), "_99887_1", "课程 ID alias 提取")
    _assert_equal(
        extract_blackboard_token_from_text("Assignment", "course=_5566_1", None),
        "_5566_1",
        "文本中的 Blackboard token 提取",
    )


def test_text_and_score_helpers() -> None:
    raw_text = " A\u00a0B\n\u200bC "
    _assert_equal(clean_text(raw_text), "A B C", "文本清洗")
    _assert_equal(split_score_text("89 / 100"), ("89", "100"), "分数字段拆分")
    _assert_equal(extract_total_score("89 / 100"), "100", "总分提取")
    _assert_equal(parse_score_metrics("89 / 100"), (89.0, 100.0, 89.0), "分数指标解析")


def test_datetime_helpers() -> None:
    extracted = extract_date_text("Due: Wednesday, February 25, 2026 4:40:34 PM CST")
    _assert_equal(extracted, "February 25, 2026 4:40:34 PM", "日期文本提取")

    parsed = parse_loose_datetime("Posted on: 2026年03月15日 23:59")
    _assert_equal(parsed, datetime(2026, 3, 15, 23, 59), "宽松日期解析")

    ics_dt, all_day = parse_ics_datetime("20260308T100000", {"TZID": "Asia/Shanghai"})
    _assert_true(ics_dt is not None, "ICS datetime 不应为空")
    _assert_true(not all_day, "不应被识别为全天事件")
    _assert_equal(ics_dt, datetime(2026, 3, 8, 2, 0, tzinfo=UTC), "ICS 时区归一化")
    _assert_equal(to_utc_naive(ics_dt), datetime(2026, 3, 8, 2, 0), "UTC naive 转换")


def test_dto_shapes() -> None:
    course = CourseDTO(course_id="_1_1", name="CS304", url="https://bb.example/course")
    event = CalendarEventDTO(
        uid="ics_xxx",
        raw_uid="raw-uid",
        title="Assignment Due",
        start_at=datetime(2026, 3, 20, 10, 0),
        end_at=datetime(2026, 3, 20, 11, 0),
        course_id="_1_1",
    )
    _assert_equal(course.to_dict()["course_id"], "_1_1", "CourseDTO 序列化")
    _assert_equal(event.to_dict()["course_id"], "_1_1", "CalendarEventDTO 序列化")


def test_logging_collector_and_console_sink() -> None:
    collector = BlackboardLogCollector()
    console_lines: list[str] = []
    logger = create_logger(
        layer="provider",
        source="tests.logging",
        collector=collector,
        extra_sinks=[BlackboardConsoleSink(min_level="debug", writer=console_lines.append)],
        context={"test_case": "logging"},
    )

    logger.info("hello", payload={"count": 1})
    logger.warning("warn")

    events = collector.snapshot()
    summary = summarize_log_events(events)
    _assert_equal(len(events), 2, "should collect two log events")
    _assert_equal(events[0].context["test_case"], "logging", "logger context should be preserved")
    _assert_true(any("hello" in line for line in console_lines), "console sink should emit formatted line")
    _assert_equal(summary["by_level"].get("info"), 1, "summary info count")
    _assert_equal(summary["by_level"].get("warning"), 1, "summary warning count")
