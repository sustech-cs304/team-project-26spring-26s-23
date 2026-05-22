from __future__ import annotations

from datetime import datetime

from app.integrations.wakeup.api import WakeupCalendarICSParser


def _assert_equal(actual: object, expected: object, message: str) -> None:
    if actual != expected:
        raise AssertionError(f"{message}: expected={expected!r}, actual={actual!r}")


def _assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def test_wakeup_rrule_weekly_expansion() -> None:
    ics_text = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//WakeUpSchedule//icalendarkit//EN
CALSCALE:GREGORIAN
BEGIN:VEVENT
DTSTAMP:20260518T160437Z
UID:WakeUpSchedule-EA01F90C-D9B2-48DF-B011-D0DBE92D60D2
CREATED:20260518T160437Z
DESCRIPTION:第1 - 20周\\n第1 - 2节\\n\\n\\n
DTSTART:20260302T000000Z
LAST-MODIFIED:20260518T160437Z
LOCATION:
SUMMARY:q
DTEND:20260302T015000Z
RRULE:FREQ=WEEKLY;INTERVAL=1;UNTIL=20260719
END:VEVENT
END:VCALENDAR
"""
    parser = WakeupCalendarICSParser()
    events = sorted(
        parser.parse_to_unified_events(ics_text, source="wakeup"),
        key=lambda event: event.start_time,
    )

    _assert_equal(len(events), 20, "RRULE weekly 应展开为 20 次实例事件")
    _assert_equal(
        events[0].start_time, datetime(2026, 3, 2, 0, 0, 0), "首次开始时间 UTC 解析"
    )
    _assert_equal(
        events[0].end_time, datetime(2026, 3, 2, 1, 50, 0), "首次结束时间 UTC 解析"
    )
    _assert_true(all(event.source == "wakeup" for event in events), "来源应为 wakeup")
    _assert_true(
        len({event.source_id for event in events}) == 20, "每次实例事件应有不同 source_id"
    )
    _assert_true(
        all(
            isinstance((event.metadata_payload or {}).get("rrule"), dict) for event in events
        ),
        "metadata_payload 应包含 rrule",
    )


def test_wakeup_rrule_weekly_byday_expansion_applies_count_and_exdate() -> None:
    ics_text = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//WakeUpSchedule//icalendarkit//EN
CALSCALE:GREGORIAN
BEGIN:VEVENT
UID:WakeUpSchedule-BYDAY-TEST
DESCRIPTION:第1 - 2周\\n第1 - 2节\\n\\n\\n
DTSTART:20260302T000000Z
LOCATION:
SUMMARY:multi-day-course
DTEND:20260302T015000Z
RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=6;BYDAY=MO,WE,FR
EXDATE:20260304T000000Z
END:VEVENT
END:VCALENDAR
"""
    parser = WakeupCalendarICSParser()
    events = sorted(
        parser.parse_to_unified_events(ics_text, source="wakeup"),
        key=lambda event: event.start_time,
    )

    _assert_equal(len(events), 5, "BYDAY 周规则应展开多天并应用 EXDATE 过滤")
    _assert_equal(
        [event.start_time for event in events],
        [
            datetime(2026, 3, 2, 0, 0, 0),
            datetime(2026, 3, 6, 0, 0, 0),
            datetime(2026, 3, 9, 0, 0, 0),
            datetime(2026, 3, 11, 0, 0, 0),
            datetime(2026, 3, 13, 0, 0, 0),
        ],
        "BYDAY 应按周内星期顺序生成实例，COUNT 应在 EXDATE 前限制候选集",
    )
    _assert_true(
        all(event.end_time is not None for event in events), "BYDAY 实例应保留时长"
    )


def test_wakeup_rrule_weekly_count_terminates_when_all_candidates_are_exdates() -> None:
    ics_text = """BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//WakeUpSchedule//icalendarkit//EN
CALSCALE:GREGORIAN
BEGIN:VEVENT
UID:WakeUpSchedule-COUNT-EXDATE-TEST
DESCRIPTION:全部候选实例被 EXDATE 排除
DTSTART:20260302T000000Z
SUMMARY:excluded-course
DTEND:20260302T015000Z
RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=3
EXDATE:20260302T000000Z,20260309T000000Z,20260316T000000Z
END:VEVENT
END:VCALENDAR
"""
    parser = WakeupCalendarICSParser()
    events = parser.parse_to_unified_events(ics_text, source="wakeup")

    _assert_equal(
        len(events),
        0,
        "COUNT 应按已遍历候选实例终止，并允许 EXDATE 排除全部实例",
    )
