from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

from app.integrations.sustech.blackboard.api.dto import (
    AnnouncementDTO,
    AssignmentAttachmentDTO,
    AssignmentDTO,
    CalendarEventDTO,
    CourseCatalogResultDTO,
    CourseDTO,
    GradeDTO,
    ResourceDTO,
)
from app.integrations.sustech.blackboard.provider.results import (
    BlackboardSnapshotFetchResult,
    BlackboardSnapshotSyncReport,
    BlackboardSyncPayloads,
    CalendarICSSyncResult,
    CourseCatalogSearchResult,
)
from app.integrations.sustech.blackboard.provider.tools import agent_tools
from app.integrations.sustech.blackboard.shared import BlackboardLogEvent
from app.integrations.sustech.blackboard.provider.use_cases import course_catalog as course_catalog_use_case
from app.integrations.sustech.blackboard.provider.use_cases import snapshot_sync as snapshot_sync_use_case
from app.integrations.sustech.blackboard.provider.use_cases.calendar_ics import (
    refresh_calendar_ics_subscription_from_text,
)
from app.integrations.sustech.blackboard.provider.use_cases.snapshot_sync import (
    build_blackboard_sync_payloads,
    calculate_expected_active_counts,
    compare_active_counts,
    fetch_blackboard_snapshot,
)


def _assert_equal(actual: object, expected: object, message: str) -> None:
    if actual != expected:
        raise AssertionError(f"{message}: expected={expected!r}, actual={actual!r}")


def _assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def test_build_blackboard_sync_payloads_and_expected_counts() -> None:
    courses = [
        CourseDTO(
            course_id="_course_1",
            name="CS305 Database Systems",
            code="CS305",
            instructor="张老师",
            term="Spring 2026",
            url="https://bb.example/course/1",
        )
    ]
    assignments_by_course = {
        "_course_1": [
            AssignmentDTO(
                assignment_id=None,
                course_id="_course_1",
                title="Homework 1",
                due_date="2026-03-10 23:59",
                score="95/100",
                url="https://bb.example/asg/1",
                source_page="assignments",
                attachments=[
                    AssignmentAttachmentDTO(
                        name="spec.pdf",
                        url="https://bb.example/file/spec.pdf",
                        type="file",
                    )
                ],
            )
        ]
    }
    resources_by_course = {
        "_course_1": [
            ResourceDTO(
                resource_id=None,
                course_id="_course_1",
                title="Lecture 1",
                url="https://bb.example/file/lecture1.pdf",
                type="file",
                source_page="content",
            )
        ]
    }
    grades_by_course = {
        "_course_1": [
            GradeDTO(
                grade_id=None,
                course_id="_course_1",
                assignment_id=None,
                item_name="Homework 1",
                score="95/100",
                category="Homework",
                due_date="2026-03-10 23:59",
            )
        ]
    }
    announcements = [
        AnnouncementDTO(
            announcement_id=None,
            course_id=None,
            course_name="CS305 Database Systems",
            title="Welcome",
            detail="Hello class",
            publish_time="2026-03-01 10:00",
        )
    ]

    payloads = build_blackboard_sync_payloads(
        courses,
        assignments_by_course,
        resources_by_course,
        grades_by_course,
        announcements,
    )
    expected = calculate_expected_active_counts(payloads)

    _assert_equal(len(payloads.course_payload), 1, "course payload count")
    _assert_equal(len(payloads.assignment_payloads["_course_1"]), 1, "assignment payload count")
    _assert_equal(len(payloads.resource_payloads["_course_1"]), 2, "resource payload merges assignment attachment")
    _assert_equal(len(payloads.grade_payloads["_course_1"]), 1, "grade payload count")
    _assert_equal(len(payloads.announcements_payload), 1, "announcement payload count")
    _assert_equal(payloads.announcements_payload[0]["course_id"], "_course_1", "announcement course inferred")
    _assert_equal(
        payloads.grade_payloads["_course_1"][0]["assignment_id"],
        payloads.assignment_payloads["_course_1"][0]["assignment_id"],
        "grade linked to assignment",
    )
    _assert_equal(expected["courses"], 1, "expected courses")
    _assert_equal(expected["assignments"], 1, "expected assignments")
    _assert_equal(expected["resources"], 2, "expected resources")
    _assert_equal(expected["grades"], 1, "expected grades")
    _assert_equal(expected["announcements"], 1, "expected announcements")
    _assert_true(
        compare_active_counts(
            {
                "courses": {"active": 1},
                "assignments": {"active": 1},
                "resources": {"active": 2},
                "grades": {"active": 1},
                "announcements": {"active": 1},
            },
            expected,
        ),
        "compare_active_counts should pass when counts match",
    )


def test_refresh_calendar_ics_subscription_from_text_use_case(tmp_path: Path) -> None:
    db_path = tmp_path / "test_blackboard_provider_ics.db"
    result = refresh_calendar_ics_subscription_from_text(
        "https://example.local/provider.ics",
        """BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:provider-event@example.com
SUMMARY:Provider Event
DTSTART:20260311T010000Z
DTEND:20260311T020000Z
END:VEVENT
END:VCALENDAR
""",
        db_path=db_path,
        reset_schema=True,
        etag='"provider-v1"',
    )

    _assert_true(isinstance(result, CalendarICSSyncResult), "should return CalendarICSSyncResult")
    _assert_equal(result.feed_url, "https://example.local/provider.ics", "feed url")
    _assert_equal(int(result.stats.get("inserted", 0)), 1, "inserted stats")
    _assert_equal(result.active_event_count, 1, "active event count")
    _assert_equal(result.active_events[0].title, "Provider Event", "event title")
    _assert_true(bool(result.logs), "calendar ics use case should collect logs")
    _assert_equal(result.log_summary["by_layer"].get("provider"), result.log_summary["total"], "calendar logs should be provider-layer")


def test_search_course_catalog_use_case_delegates_to_api() -> None:
    original_cas_client = course_catalog_use_case.CASClient
    original_api = course_catalog_use_case.BlackboardCourseCatalogAPI

    class _FakeCASClient:
        def __init__(self, *_: Any, **__: Any) -> None:
            self.client = object()
            self.login_calls: list[tuple[str, str, str]] = []
            self.closed = False

        def login(self, username: str, password: str, service_url: str) -> bool:
            self.login_calls.append((username, password, service_url))
            return True

        def close(self) -> None:
            self.closed = True

    class _FakeCatalogAPI:
        def __init__(self, client: object) -> None:
            self.client = client

        def search_course_catalog(
            self,
            keyword: str,
            *,
            field: str = "CourseName",
            operator: str = "Contains",
            limit: int | None = None,
        ) -> list[CourseCatalogResultDTO]:
            return [
                CourseCatalogResultDTO(
                    course_id="_305_1",
                    course_identifier="CS305",
                    course_name=keyword,
                    instructor="张老师",
                    description=f"field={field}, operator={operator}, limit={limit}",
                )
            ]

    fake_cas_instances: list[_FakeCASClient] = []

    def _fake_cas_factory(*_: Any, **__: Any) -> _FakeCASClient:
        instance = _FakeCASClient()
        fake_cas_instances.append(instance)
        return instance

    try:
        course_catalog_use_case.CASClient = _fake_cas_factory  # type: ignore[assignment]
        course_catalog_use_case.BlackboardCourseCatalogAPI = _FakeCatalogAPI  # type: ignore[assignment]
        result = course_catalog_use_case.search_course_catalog_with_credentials(
            "alice",
            "secret",
            keyword="数据库系统",
            field="CourseName",
            operator="Contains",
            limit=5,
        )
    finally:
        course_catalog_use_case.CASClient = original_cas_client  # type: ignore[assignment]
        course_catalog_use_case.BlackboardCourseCatalogAPI = original_api  # type: ignore[assignment]

    _assert_true(isinstance(result, CourseCatalogSearchResult), "should return CourseCatalogSearchResult")
    _assert_equal(result.total, 1, "search result total")
    _assert_equal(result.results[0].course_name, "数据库系统", "search result payload")
    _assert_equal(result.results[0].course_identifier, "CS305", "typed search result kept")
    _assert_equal(len(fake_cas_instances), 1, "CAS client created once")
    _assert_equal(fake_cas_instances[0].login_calls[0][0], "alice", "username forwarded")
    _assert_true(fake_cas_instances[0].closed, "CAS client closed")
    _assert_true(bool(result.logs), "course catalog use case should collect logs")
    _assert_true(int(result.log_summary["total"]) >= 3, "course catalog should produce multiple logs")


def test_fetch_blackboard_snapshot_uses_api_dtos_directly() -> None:
    original_cas_client = snapshot_sync_use_case.CASClient
    original_course_api = snapshot_sync_use_case.BlackboardCourseAPI
    original_assignment_api = snapshot_sync_use_case.BlackboardAssignmentAPI
    original_grade_api = snapshot_sync_use_case.BlackboardGradeAPI
    original_content_api = snapshot_sync_use_case.BlackboardContentAPI
    original_announcement_api = snapshot_sync_use_case.BlackboardAnnouncementAPI

    class _FakeCASClient:
        def __init__(self, *_: Any, **__: Any) -> None:
            self.client = object()
            self.closed = False

        def login(self, username: str, password: str, service_url: str) -> bool:
            _assert_equal(username, "alice", "snapshot username")
            _assert_equal(password, "secret", "snapshot password")
            _assert_true(bool(service_url), "snapshot service url should exist")
            return True

        def close(self) -> None:
            self.closed = True

    class _FakeCourseAPI:
        def __init__(self, *_: Any, **__: Any) -> None:
            pass

        def get_courses(self) -> list[CourseDTO]:
            return [CourseDTO(course_id="_course_1", name="CS305 Database Systems")]

    class _FakeAssignmentAPI:
        def __init__(self, *_: Any, **__: Any) -> None:
            pass

        def get_course_assignments(self, course_id: str) -> list[AssignmentDTO]:
            return [
                AssignmentDTO(
                    assignment_id="asg_1",
                    course_id=course_id,
                    title="Homework 1",
                    due_date="2026-03-10 23:59",
                    score="95/100",
                    attachments=[
                        AssignmentAttachmentDTO(
                            name="spec.pdf",
                            url="https://bb.example/file/spec.pdf",
                            type="file",
                            resource_id="res_att_1",
                        )
                    ],
                )
            ]

    class _FakeGradeAPI:
        def __init__(self, *_: Any, **__: Any) -> None:
            pass

        def get_course_grade_dtos(self, course_id: str) -> list[GradeDTO]:
            return [
                GradeDTO(
                    grade_id="grd_1",
                    course_id=course_id,
                    assignment_id="asg_1",
                    item_name="Homework 1",
                    score="95/100",
                    due_date="2026-03-10 23:59",
                )
            ]

    class _FakeContentAPI:
        def __init__(self, *_: Any, **__: Any) -> None:
            pass

        def get_course_content_dtos(self, course_id: str) -> list[ResourceDTO]:
            return [
                ResourceDTO(
                    resource_id="res_1",
                    course_id=course_id,
                    title="Lecture 1",
                    url="https://bb.example/file/lecture1.pdf",
                    type="file",
                )
            ]

    class _FakeAnnouncementAPI:
        def __init__(self, *_: Any, **__: Any) -> None:
            pass

        def get_all_announcement_dtos(self, **_: Any) -> list[AnnouncementDTO]:
            return [
                AnnouncementDTO(
                    announcement_id="ann_1",
                    course_id="_course_1",
                    course_name="CS305 Database Systems",
                    title="Welcome",
                    publish_time="2026-03-01 10:00",
                    detail="Hello class",
                )
            ]

    try:
        snapshot_sync_use_case.CASClient = _FakeCASClient  # type: ignore[assignment]
        snapshot_sync_use_case.BlackboardCourseAPI = _FakeCourseAPI  # type: ignore[assignment]
        snapshot_sync_use_case.BlackboardAssignmentAPI = _FakeAssignmentAPI  # type: ignore[assignment]
        snapshot_sync_use_case.BlackboardGradeAPI = _FakeGradeAPI  # type: ignore[assignment]
        snapshot_sync_use_case.BlackboardContentAPI = _FakeContentAPI  # type: ignore[assignment]
        snapshot_sync_use_case.BlackboardAnnouncementAPI = _FakeAnnouncementAPI  # type: ignore[assignment]
        snapshot = fetch_blackboard_snapshot("alice", "secret", resource_course_limit=1)
    finally:
        snapshot_sync_use_case.CASClient = original_cas_client  # type: ignore[assignment]
        snapshot_sync_use_case.BlackboardCourseAPI = original_course_api  # type: ignore[assignment]
        snapshot_sync_use_case.BlackboardAssignmentAPI = original_assignment_api  # type: ignore[assignment]
        snapshot_sync_use_case.BlackboardGradeAPI = original_grade_api  # type: ignore[assignment]
        snapshot_sync_use_case.BlackboardContentAPI = original_content_api  # type: ignore[assignment]
        snapshot_sync_use_case.BlackboardAnnouncementAPI = original_announcement_api  # type: ignore[assignment]

    _assert_equal(snapshot.courses[0].course_id, "_course_1", "snapshot keeps course dto")
    _assert_equal(snapshot.assignments_by_course["_course_1"][0].assignment_id, "asg_1", "snapshot keeps assignment dto")
    _assert_equal(snapshot.grades_by_course["_course_1"][0].grade_id, "grd_1", "snapshot keeps grade dto")
    _assert_equal(snapshot.resources_by_course["_course_1"][0].resource_id, "res_1", "snapshot keeps resource dto")
    _assert_equal(snapshot.announcements[0].announcement_id, "ann_1", "snapshot keeps announcement dto")
    _assert_true(bool(snapshot.logs), "snapshot fetch should collect logs")
    _assert_true(int(snapshot.log_summary["total"]) >= 5, "snapshot fetch should produce multiple logs")



def test_fetch_blackboard_snapshot_raises_explicit_invalid_credentials_message() -> None:
    original_cas_client = snapshot_sync_use_case.CASClient

    class _FakeCASClient:
        def __init__(self, *_: Any, **__: Any) -> None:
            self.client = object()
            self.closed = False
            self.last_login_failure_reason = "invalid_credentials"
            self.last_login_failure_message = "CAS 登录失败：用户名或密码错误，请更新设置中的 CAS 密码。"

        def login(self, username: str, password: str, service_url: str) -> bool:
            _assert_equal(username, "alice", "snapshot username")
            _assert_equal(password, "secret", "snapshot password")
            _assert_true(bool(service_url), "snapshot service url should exist")
            return False

        def close(self) -> None:
            self.closed = True

    try:
        snapshot_sync_use_case.CASClient = _FakeCASClient  # type: ignore[assignment]
        try:
            fetch_blackboard_snapshot("alice", "secret")
        except RuntimeError as exc:
            _assert_equal(
                str(exc),
                "CAS 登录失败：用户名或密码错误，请更新设置中的 CAS 密码。",
                "snapshot invalid credential message",
            )
        else:
            raise AssertionError("snapshot should raise RuntimeError for invalid credentials")
    finally:
        snapshot_sync_use_case.CASClient = original_cas_client  # type: ignore[assignment]


def test_agent_tools_return_stable_shapes() -> None:
    original_search = agent_tools.search_course_catalog_with_credentials
    original_refresh = agent_tools.refresh_calendar_ics_subscription
    original_sync = agent_tools.run_blackboard_snapshot_sync

    def _fake_search(*_: Any, **__: Any) -> CourseCatalogSearchResult:
        return CourseCatalogSearchResult(
            keyword="数据库",
            field="CourseName",
            operator="Contains",
            limit=3,
            results=[
                CourseCatalogResultDTO(
                    course_id="_course_1",
                    course_identifier="CS305",
                    course_name="数据库系统",
                )
            ],
        )

    def _fake_refresh(*_: Any, **__: Any) -> CalendarICSSyncResult:
        tool_event = CalendarEventDTO(
            uid="ics_1",
            raw_uid=None,
            title="Tool Event",
            start_at=None,
            end_at=None,
        )
        return CalendarICSSyncResult(
            feed_url="https://example.local/tool.ics",
            db_path=Path("backend/data/tool.db"),
            stats={"parsed": 1, "inserted": 1, "updated": 0, "deleted": 0, "refreshed_at": datetime(2026, 3, 6, 8, 0, 0)},
            active_events=[tool_event],
            all_events=[tool_event],
            logs=[BlackboardLogEvent(timestamp="2026-03-06T08:00:00Z", level="info", layer="provider", source="test.refresh", message="ok")],
        )

    def _fake_sync(*_: Any, **__: Any) -> BlackboardSnapshotSyncReport:
        snapshot = BlackboardSnapshotFetchResult(
            courses=[CourseDTO(course_id="_course_1", name="CS305 Database Systems")],
            assignments_by_course={
                "_course_1": [
                    AssignmentDTO(
                        assignment_id="asg_1",
                        course_id="_course_1",
                        title="Homework 1",
                    )
                ]
            },
            resources_by_course={
                "_course_1": [
                    ResourceDTO(
                        resource_id="res_1",
                        course_id="_course_1",
                        title="Lecture 1",
                    )
                ]
            },
            grades_by_course={
                "_course_1": [
                    GradeDTO(
                        grade_id="grd_1",
                        course_id="_course_1",
                        assignment_id="asg_1",
                        item_name="Homework 1",
                    )
                ]
            },
            announcements=[
                AnnouncementDTO(
                    announcement_id="ann_1",
                    course_id="_course_1",
                    course_name="CS305 Database Systems",
                    title="Welcome",
                )
            ],
            resource_course_limit=3,
            logs=[BlackboardLogEvent(timestamp="2026-03-06T08:00:00Z", level="info", layer="provider", source="test.snapshot", message="ok")],
        )
        payloads = BlackboardSyncPayloads(
            course_payload=[{"course_id": "_course_1"}],
            assignment_payloads={"_course_1": [{"assignment_id": "asg_1"}]},
            resource_payloads={"_course_1": [{"resource_id": "res_1"}]},
            grade_payloads={"_course_1": [{"grade_id": "grd_1"}]},
            announcements_payload=[{"announcement_id": "ann_1"}],
        )
        return BlackboardSnapshotSyncReport(
            db_path=Path("backend/data/snapshot.db"),
            snapshot=snapshot,
            payloads=payloads,
            first_sync_stats={
                "courses": {"inserted": 1, "updated": 0, "deleted": 0},
                "assignments": {"inserted": 1, "updated": 0, "deleted": 0},
                "resources": {"inserted": 1, "updated": 0, "deleted": 0},
                "grades": {"inserted": 1, "updated": 0, "deleted": 0},
                "announcements": {"inserted": 1, "updated": 0, "deleted": 0},
            },
            second_sync_stats={
                "courses": {"inserted": 0, "updated": 1, "deleted": 0},
                "assignments": {"inserted": 0, "updated": 1, "deleted": 0},
                "resources": {"inserted": 0, "updated": 1, "deleted": 0},
                "grades": {"inserted": 0, "updated": 1, "deleted": 0},
                "announcements": {"inserted": 0, "updated": 1, "deleted": 0},
            },
            table_counts={
                "courses": {"total": 1, "active": 1},
                "assignments": {"total": 1, "active": 1},
                "resources": {"total": 1, "active": 1},
                "grades": {"total": 1, "active": 1},
                "announcements": {"total": 1, "active": 1},
            },
            expected_active_counts={
                "courses": 1,
                "assignments": 1,
                "resources": 1,
                "grades": 1,
                "announcements": 1,
            },
            integrity_ok=True,
            logs=[BlackboardLogEvent(timestamp="2026-03-06T08:00:01Z", level="info", layer="provider", source="test.sync", message="ok")],
        )

    try:
        agent_tools.search_course_catalog_with_credentials = _fake_search  # type: ignore[assignment]
        agent_tools.refresh_calendar_ics_subscription = _fake_refresh  # type: ignore[assignment]
        agent_tools.run_blackboard_snapshot_sync = _fake_sync  # type: ignore[assignment]

        search_result = agent_tools.search_course_catalog(
            username="alice",
            password="secret",
            keyword="数据库",
            limit=3,
        )
        refresh_result = agent_tools.refresh_calendar_ics(feed_url="https://example.local/tool.ics")
        snapshot_result = agent_tools.sync_blackboard_snapshot(
            username="alice",
            password="secret",
        )
    finally:
        agent_tools.search_course_catalog_with_credentials = original_search  # type: ignore[assignment]
        agent_tools.refresh_calendar_ics_subscription = original_refresh  # type: ignore[assignment]
        agent_tools.run_blackboard_snapshot_sync = original_sync  # type: ignore[assignment]

    _assert_equal(search_result["total"], 1, "agent search total")
    _assert_true("log_summary" in search_result, "agent search should expose log summary")
    _assert_equal(refresh_result["db_path"], "backend/data/tool.db", "agent refresh path jsonable")
    _assert_equal(refresh_result["stats"]["refreshed_at"], "2026-03-06T08:00:00", "agent refresh datetime jsonable")
    _assert_true("logs" in refresh_result, "agent refresh should expose logs")
    _assert_true(snapshot_result["integrity_ok"], "agent snapshot integrity")
    _assert_true(snapshot_result["second_sync_has_no_new_records"], "agent snapshot no new records")
    _assert_true("logs" in snapshot_result, "agent snapshot should expose logs")
