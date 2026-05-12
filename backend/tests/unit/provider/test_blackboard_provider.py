from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Any

import httpx

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
from app.integrations.sustech.blackboard.data import DatabaseManager
from app.integrations.sustech.blackboard.provider.results import (
    BlackboardCourseResourcesSyncReport,
    BlackboardSnapshotFetchResult,
    BlackboardSnapshotSyncReport,
    BlackboardSyncPayloads,
    CalendarICSSyncResult,
    CourseCatalogSearchResult,
)
from app.integrations.sustech.blackboard.provider.tools import agent_tools
from app.integrations.sustech.blackboard.shared import BlackboardLogEvent
from app.integrations.sustech.blackboard.provider.use_cases import calendar_ics as calendar_ics_use_case
from app.integrations.sustech.blackboard.provider.use_cases import course_catalog as course_catalog_use_case
from app.integrations.sustech.blackboard.provider.use_cases import snapshot_sync as snapshot_sync_use_case
from app.integrations.sustech.blackboard.api.course_parser import BlackboardCourseParser
from app.integrations.sustech.blackboard.provider.use_cases.calendar_ics import (
    refresh_calendar_ics_subscription_from_text,
)
from app.integrations.sustech.blackboard.provider.use_cases.snapshot_sync import (
    build_blackboard_sync_payloads,
    calculate_expected_active_counts,
    compare_active_counts,
    fetch_blackboard_snapshot,
    rebuild_announcement_assignment_links,
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
                description="Read the instructions",
                description_html="<p>Read the <strong>instructions</strong></p>",
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
            detail_html="<p>Hello <strong>class</strong></p>",
            publish_time="2026-03-01 10:00",
            linked_content_candidates=[
                {
                    "url": "https://bb.example/webapps/blackboard/content/launchLink.jsp?ann_id=_43635_1&course_id=_course_1&mode=view",
                    "path_text": "/Homework/Homework 1",
                    "ann_id": "_43635_1",
                    "course_id": "_course_1",
                    "is_launch_link": True,
                }
            ],
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
    _assert_equal(
        len(payloads.announcement_assignment_link_payloads),
        1,
        "announcement-assignment link payload count",
    )
    _assert_equal(payloads.announcements_payload[0]["course_id"], "_course_1", "announcement course inferred")
    _assert_equal(
        payloads.announcements_payload[0]["relation_type"],
        "assignment_notice",
        "announcement relation type derived from launch link",
    )
    _assert_equal(
        payloads.announcements_payload[0]["relation_confidence"],
        "high",
        "announcement relation confidence derived from launch link",
    )
    _assert_equal(
        payloads.assignment_payloads["_course_1"][0]["description_html"],
        "<p>Read the <strong>instructions</strong></p>",
        "assignment html retained in sync payload",
    )
    _assert_equal(
        payloads.announcements_payload[0]["content_html"],
        "<p>Hello <strong>class</strong></p>",
        "announcement html retained in sync payload",
    )
    _assert_equal(
        payloads.announcements_payload[0]["linked_content_candidates"][0]["ann_id"],
        "_43635_1",
        "announcement linked-content evidence retained in sync payload",
    )
    _assert_equal(
        payloads.announcement_assignment_link_payloads[0]["assignment_id"],
        payloads.assignment_payloads["_course_1"][0]["assignment_id"],
        "announcement link payload should target matched assignment",
    )
    _assert_equal(
        payloads.grade_payloads["_course_1"][0]["assignment_id"],
        payloads.assignment_payloads["_course_1"][0]["assignment_id"],
        "grade linked to assignment",
    )
    _assert_equal(expected["courses"], 1, "expected courses")
    _assert_equal(expected["assignments"], 1, "expected assignments")
    attachment_resource = next(
        row for row in payloads.resource_payloads["_course_1"] if row["title"] == "spec.pdf"
    )
    _assert_equal(
        attachment_resource["assignment_id"],
        payloads.assignment_payloads["_course_1"][0]["assignment_id"],
        "assignment attachment resource keeps assignment link",
    )
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


def test_build_blackboard_sync_payloads_merges_same_assignment_id_assignments() -> None:
    courses = [
        CourseDTO(
            course_id="_course_1",
            name="CS305 Database Systems",
        )
    ]
    assignments_by_course = {
        "_course_1": [
            AssignmentDTO(
                assignment_id="asg_homework_1",
                course_id="_course_1",
                title="Homework 1",
                url="https://bb.example/list#contentListItem:_1",
                summary="fragment summary",
                attachments=[
                    AssignmentAttachmentDTO(
                        name="spec.pdf",
                        url="https://bb.example/file/spec.pdf",
                        type="file",
                    )
                ],
            ),
            AssignmentDTO(
                assignment_id="asg_homework_1",
                course_id="_course_1",
                title="Homework 1",
                due_date="2026-03-10 23:59",
                url="https://bb.example/asg/1",
                description_html="<p>Read the <strong>instructions</strong></p>",
                submission_status="Submitted",
            ),
        ]
    }

    payloads = build_blackboard_sync_payloads(
        courses,
        assignments_by_course,
        {},
        {},
        [],
    )

    _assert_equal(len(payloads.assignment_payloads["_course_1"]), 1, "same-assignment-id rows should be merged into one payload row")
    merged = payloads.assignment_payloads["_course_1"][0]
    _assert_equal(merged["title"], "Homework 1", "merged row keeps exact title")
    _assert_equal(merged["description_html"], "<p>Read the <strong>instructions</strong></p>", "merged row keeps richer html")
    _assert_equal(merged["submission_status"], "Submitted", "merged row keeps richer submission status")
    _assert_equal(len(merged["attachments"]), 1, "merged row keeps attachments from duplicate sibling")


def test_build_blackboard_sync_payloads_keeps_distinct_same_title_assignments() -> None:
    courses = [
        CourseDTO(
            course_id="_course_1",
            name="CS305 Database Systems",
        )
    ]
    assignments_by_course = {
        "_course_1": [
            AssignmentDTO(
                assignment_id="asg_week_3",
                course_id="_course_1",
                title="Homework 1",
                due_date="2026-03-10 23:59",
                url="https://bb.example/asg/1",
            ),
            AssignmentDTO(
                assignment_id="asg_week_5",
                course_id="_course_1",
                title="Homework 1",
                due_date="2026-03-24 23:59",
                url="https://bb.example/asg/2",
            ),
        ]
    }

    payloads = build_blackboard_sync_payloads(
        courses,
        assignments_by_course,
        {},
        {},
        [],
    )

    _assert_equal(
        len(payloads.assignment_payloads["_course_1"]),
        2,
        "same-title assignments with different assignment_id should remain distinct",
    )


def test_rebuild_announcement_assignment_links_backfills_existing_database_rows(
    tmp_path: Path,
) -> None:
    db_path = tmp_path / "test_blackboard_rebuild_relations.db"
    manager = DatabaseManager(db_path, reset_schema=True)

    manager.sync_courses(
        [
            {
                "course_id": "_8132_1",
                "name": "Computer Organization Spring 2026",
                "url": "https://bb.sustech.edu.cn/course/_8132_1",
            }
        ]
    )
    manager.sync_assignments(
        "_8132_1",
        [
            {
                "assignment_id": "asg_hw2",
                "title": "Homework 2",
                "url": "https://bb.sustech.edu.cn/webapps/assignment/uploadAssignment?course_id=_8132_1&content_id=_596747_1",
                "source_page": "https://bb.sustech.edu.cn/webapps/blackboard/content/listContent.jsp?course_id=_8132_1#contentListItem:_596747_1",
            }
        ],
    )
    manager.sync_announcements(
        [
            {
                "announcement_id": "ann_hw2_release",
                "course_id": "_8132_1",
                "course_name": "Computer Organization Spring 2026",
                "title": "Lab assignment 2 released",
                "content": "Please open Homework 2 from Blackboard.",
                "content_html": '<p><a href="/webapps/blackboard/content/launchLink.jsp?ann_id=_43635_1&course_id=_8132_1&mode=view">/Homework/Homework 2</a></p>',
                "publish_time": "2026-04-19 16:48",
            }
        ],
        links_data=[],
    )

    result = rebuild_announcement_assignment_links(manager)
    _assert_equal(result["links"], 1, "rebuild should create one persisted link")

    session = manager.SessionLocal()
    try:
        from app.integrations.sustech.blackboard.data.models import (
            Announcement,
            AnnouncementAssignmentLink,
        )

        announcement = (
            session.query(Announcement)
            .filter(Announcement.announcement_id == "ann_hw2_release")
            .one()
        )
        link = (
            session.query(AnnouncementAssignmentLink)
            .filter(AnnouncementAssignmentLink.announcement_id == "ann_hw2_release")
            .one()
        )
    finally:
        session.close()

    _assert_equal(
        announcement.relation_type,
        "assignment_notice",
        "rebuild should classify historical announcement as assignment notice",
    )
    _assert_equal(
        announcement.relation_confidence,
        "high",
        "rebuild should mark high confidence for launch-link evidence",
    )
    _assert_equal(
        link.assignment_id,
        "asg_hw2",
        "rebuild should connect historical announcement to assignment",
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
    _assert_equal(result.refresh_mode, "auto", "default refresh mode")
    _assert_equal(int(result.stats.get("inserted", 0)), 1, "inserted stats")
    _assert_true(isinstance(result.stats.get("refreshed_at"), datetime), "refreshed_at should remain datetime")
    _assert_equal(result.stats["refreshed_at"].tzinfo, None, "refreshed_at should remain naive UTC")
    _assert_equal(result.active_event_count, 1, "active event count")
    _assert_equal(result.active_events[0].title, "Provider Event", "event title")
    _assert_true(bool(result.logs), "calendar ics use case should collect logs")
    _assert_equal(result.log_summary["by_layer"].get("provider"), result.log_summary["total"], "calendar logs should be provider-layer")



def test_refresh_calendar_ics_subscription_auto_uses_conditional_headers(
    tmp_path: Path,
    monkeypatch: Any,
) -> None:
    db_path = tmp_path / "test_blackboard_provider_ics_auto.db"
    feed_url = "https://example.local/provider-auto.ics"
    refresh_calendar_ics_subscription_from_text(
        feed_url,
        """BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:provider-auto@example.com
SUMMARY:Provider Auto Event
DTSTART:20260311T010000Z
DTEND:20260311T020000Z
END:VEVENT
END:VCALENDAR
""",
        db_path=db_path,
        reset_schema=True,
        etag='"provider-auto-v1"',
        last_modified="Wed, 15 Apr 2026 08:00:00 GMT",
    )

    captured_headers: list[dict[str, str]] = []

    class _FakeHTTPClient:
        def __init__(self, *_: Any, **__: Any) -> None:
            pass

        def __enter__(self) -> _FakeHTTPClient:
            return self

        def __exit__(self, *_: Any) -> None:
            return None

        def get(self, url: str, headers: dict[str, str] | None = None) -> httpx.Response:
            captured_headers.append(dict(headers or {}))
            return httpx.Response(status_code=304, request=httpx.Request("GET", url))

    monkeypatch.setattr(calendar_ics_use_case.httpx, "Client", _FakeHTTPClient)

    result = calendar_ics_use_case.refresh_calendar_ics_subscription(
        feed_url,
        db_path=db_path,
        refresh_mode="auto",
    )

    _assert_equal(
        captured_headers,
        [
            {
                "If-None-Match": '"provider-auto-v1"',
                "If-Modified-Since": "Wed, 15 Apr 2026 08:00:00 GMT",
            }
        ],
        "auto refresh should send conditional headers",
    )
    _assert_equal(result.refresh_mode, "auto", "auto refresh mode kept")
    _assert_true(bool(result.stats.get("not_modified")), "auto refresh should honor 304 responses")
    _assert_equal(result.active_event_count, 1, "auto refresh keeps cached events")



def test_refresh_calendar_ics_subscription_force_ignores_conditional_headers(
    tmp_path: Path,
    monkeypatch: Any,
) -> None:
    db_path = tmp_path / "test_blackboard_provider_ics_force.db"
    feed_url = "https://example.local/provider-force.ics"
    refresh_calendar_ics_subscription_from_text(
        feed_url,
        """BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:provider-force@example.com
SUMMARY:Provider Seed Event
DTSTART:20260311T010000Z
DTEND:20260311T020000Z
END:VEVENT
END:VCALENDAR
""",
        db_path=db_path,
        reset_schema=True,
        etag='"provider-force-v1"',
        last_modified="Wed, 15 Apr 2026 08:00:00 GMT",
    )

    captured_headers: list[dict[str, str]] = []

    class _FakeHTTPClient:
        def __init__(self, *_: Any, **__: Any) -> None:
            pass

        def __enter__(self) -> _FakeHTTPClient:
            return self

        def __exit__(self, *_: Any) -> None:
            return None

        def get(self, url: str, headers: dict[str, str] | None = None) -> httpx.Response:
            captured_headers.append(dict(headers or {}))
            return httpx.Response(
                status_code=200,
                text="""BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:provider-force@example.com
SUMMARY:Provider Forced Event
DTSTART:20260312T010000Z
DTEND:20260312T020000Z
END:VEVENT
END:VCALENDAR
""",
                headers={
                    "etag": '"provider-force-v2"',
                    "last-modified": "Thu, 16 Apr 2026 08:00:00 GMT",
                },
                request=httpx.Request("GET", url),
            )

    monkeypatch.setattr(calendar_ics_use_case.httpx, "Client", _FakeHTTPClient)

    result = calendar_ics_use_case.refresh_calendar_ics_subscription(
        feed_url,
        db_path=db_path,
        refresh_mode="force",
    )

    _assert_equal(captured_headers, [{}], "force refresh should ignore conditional headers")
    _assert_equal(result.refresh_mode, "force", "force refresh mode kept")
    _assert_equal(result.stats.get("etag"), '"provider-force-v2"', "force refresh should update etag")
    _assert_equal(result.active_events[0].title, "Provider Forced Event", "force refresh should reload ICS payload")


def test_search_course_catalog_use_case_delegates_to_api() -> None:
    original_cas_client = course_catalog_use_case.CASClient
    original_api = course_catalog_use_case.BlackboardCourseCatalogAPI
    captured: dict[str, Any] = {}

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
            fetch_mode: str = "full",
            max_pages: int | None = 30,
        ) -> list[CourseCatalogResultDTO]:
            captured.update(
                {
                    "keyword": keyword,
                    "field": field,
                    "operator": operator,
                    "limit": limit,
                    "fetch_mode": fetch_mode,
                    "max_pages": max_pages,
                }
            )
            return [
                CourseCatalogResultDTO(
                    course_id="_305_1",
                    course_identifier="CS305",
                    course_name=keyword,
                    instructor="张老师",
                    description=(
                        f"field={field}, operator={operator}, limit={limit}, "
                        f"fetch_mode={fetch_mode}, max_pages={max_pages}"
                    ),
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
            fetch_mode="quick",
            max_pages=7,
        )
    finally:
        course_catalog_use_case.CASClient = original_cas_client  # type: ignore[assignment]
        course_catalog_use_case.BlackboardCourseCatalogAPI = original_api  # type: ignore[assignment]

    _assert_true(isinstance(result, CourseCatalogSearchResult), "should return CourseCatalogSearchResult")
    _assert_equal(result.total, 1, "search result total")
    _assert_equal(result.results[0].course_name, "数据库系统", "search result payload")
    _assert_equal(result.results[0].course_identifier, "CS305", "typed search result kept")
    _assert_equal(result.fetch_mode, "quick", "fetch mode kept on result")
    _assert_equal(result.max_pages, 7, "max pages kept on result")
    _assert_equal(
        captured,
        {
            "keyword": "数据库系统",
            "field": "CourseName",
            "operator": "Contains",
            "limit": 5,
            "fetch_mode": "quick",
            "max_pages": 7,
        },
        "use case forwards fetch controls to api",
    )
    _assert_equal(len(fake_cas_instances), 1, "CAS client created once")
    _assert_equal(fake_cas_instances[0].login_calls[0][0], "alice", "username forwarded")
    _assert_true(fake_cas_instances[0].closed, "CAS client closed")
    _assert_true(bool(result.logs), "course catalog use case should collect logs")
    _assert_true(int(result.log_summary["total"]) >= 3, "course catalog should produce multiple logs")


def test_fetch_blackboard_snapshot_includes_course_resources() -> None:
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
                    source_page="content",
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
        snapshot = fetch_blackboard_snapshot("alice", "secret")
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


def test_fetch_blackboard_snapshot_filters_to_current_term_when_requested() -> None:
    original_cas_client = snapshot_sync_use_case.CASClient
    original_course_api = snapshot_sync_use_case.BlackboardCourseAPI
    original_assignment_api = snapshot_sync_use_case.BlackboardAssignmentAPI
    original_grade_api = snapshot_sync_use_case.BlackboardGradeAPI
    original_content_api = snapshot_sync_use_case.BlackboardContentAPI
    original_announcement_api = snapshot_sync_use_case.BlackboardAnnouncementAPI

    current_term = BlackboardCourseParser().current_term_label()
    assignment_calls: list[str] = []
    grade_calls: list[str] = []
    content_calls: list[str] = []

    class _FakeCASClient:
        def __init__(self, *_: Any, **__: Any) -> None:
            self.client = object()

        def login(self, *_args: Any, **_kwargs: Any) -> bool:
            return True

        def close(self) -> None:
            return None

    class _FakeCourseAPI:
        def __init__(self, *_: Any, **__: Any) -> None:
            pass

        def get_courses(self) -> list[CourseDTO]:
            return [
                CourseDTO(course_id="_current_1", name="Current Course", term=current_term),
                CourseDTO(course_id="_old_1", name="Old Course", term="Fall 1999"),
            ]

    class _FakeAssignmentAPI:
        def __init__(self, *_: Any, **__: Any) -> None:
            pass

        def get_course_assignments(self, course_id: str) -> list[AssignmentDTO]:
            assignment_calls.append(course_id)
            return []

    class _FakeGradeAPI:
        def __init__(self, *_: Any, **__: Any) -> None:
            pass

        def get_course_grade_dtos(self, course_id: str) -> list[GradeDTO]:
            grade_calls.append(course_id)
            return []

    class _FakeContentAPI:
        def __init__(self, *_: Any, **__: Any) -> None:
            pass

        def get_course_content_dtos(self, course_id: str) -> list[ResourceDTO]:
            content_calls.append(course_id)
            return []

    class _FakeAnnouncementAPI:
        def __init__(self, *_: Any, **__: Any) -> None:
            pass

        def get_all_announcement_dtos(self, **_: Any) -> list[AnnouncementDTO]:
            return []

    try:
        snapshot_sync_use_case.CASClient = _FakeCASClient  # type: ignore[assignment]
        snapshot_sync_use_case.BlackboardCourseAPI = _FakeCourseAPI  # type: ignore[assignment]
        snapshot_sync_use_case.BlackboardAssignmentAPI = _FakeAssignmentAPI  # type: ignore[assignment]
        snapshot_sync_use_case.BlackboardGradeAPI = _FakeGradeAPI  # type: ignore[assignment]
        snapshot_sync_use_case.BlackboardContentAPI = _FakeContentAPI  # type: ignore[assignment]
        snapshot_sync_use_case.BlackboardAnnouncementAPI = _FakeAnnouncementAPI  # type: ignore[assignment]
        snapshot = fetch_blackboard_snapshot(
            "alice",
            "secret",
            current_term_only=True,
        )
    finally:
        snapshot_sync_use_case.CASClient = original_cas_client  # type: ignore[assignment]
        snapshot_sync_use_case.BlackboardCourseAPI = original_course_api  # type: ignore[assignment]
        snapshot_sync_use_case.BlackboardAssignmentAPI = original_assignment_api  # type: ignore[assignment]
        snapshot_sync_use_case.BlackboardGradeAPI = original_grade_api  # type: ignore[assignment]
        snapshot_sync_use_case.BlackboardContentAPI = original_content_api  # type: ignore[assignment]
        snapshot_sync_use_case.BlackboardAnnouncementAPI = original_announcement_api  # type: ignore[assignment]

    _assert_equal([course.course_id for course in snapshot.courses], ["_current_1"], "snapshot should keep only current-term courses")
    _assert_equal(assignment_calls, ["_current_1"], "assignment fetch should run only for current-term courses")
    _assert_equal(grade_calls, ["_current_1"], "grade fetch should run only for current-term courses")
    _assert_equal(content_calls, ["_current_1"], "content fetch should run only for current-term courses")



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
    original_resource_sync = agent_tools.run_blackboard_course_resources_sync

    def _fake_search(*_: Any, **__: Any) -> CourseCatalogSearchResult:
        return CourseCatalogSearchResult(
            keyword="数据库",
            field="CourseName",
            operator="Contains",
            limit=3,
            fetch_mode="full",
            max_pages=30,
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
            start_at=datetime(2026, 4, 1, 10, 0),
            end_at=None,
        )
        return CalendarICSSyncResult(
            feed_url="https://example.local/tool.ics",
            refresh_mode="auto",
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
            resources_by_course={},
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
            logs=[BlackboardLogEvent(timestamp="2026-03-06T08:00:00Z", level="info", layer="provider", source="test.snapshot", message="ok")],
        )
        payloads = BlackboardSyncPayloads(
            course_payload=[{"course_id": "_course_1"}],
            assignment_payloads={"_course_1": [{"assignment_id": "asg_1"}]},
            resource_payloads={},
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
                "resources": {"inserted": 0, "updated": 0, "deleted": 0},
                "grades": {"inserted": 1, "updated": 0, "deleted": 0},
                "announcements": {"inserted": 1, "updated": 0, "deleted": 0},
            },
            second_sync_stats={
                "courses": {"inserted": 0, "updated": 1, "deleted": 0},
                "assignments": {"inserted": 0, "updated": 1, "deleted": 0},
                "resources": {"inserted": 0, "updated": 0, "deleted": 0},
                "grades": {"inserted": 0, "updated": 1, "deleted": 0},
                "announcements": {"inserted": 0, "updated": 1, "deleted": 0},
            },
            table_counts={
                "courses": {"total": 1, "active": 1},
                "assignments": {"total": 1, "active": 1},
                "resources": {"total": 0, "active": 0},
                "grades": {"total": 1, "active": 1},
                "announcements": {"total": 1, "active": 1},
            },
            expected_active_counts={
                "courses": 1,
                "assignments": 1,
                "resources": 0,
                "grades": 1,
                "announcements": 1,
            },
            integrity_ok=True,
            logs=[BlackboardLogEvent(timestamp="2026-03-06T08:00:01Z", level="info", layer="provider", source="test.sync", message="ok")],
        )

    def _fake_resource_sync(*_: Any, **__: Any) -> BlackboardCourseResourcesSyncReport:
        return BlackboardCourseResourcesSyncReport(
            db_path=Path("backend/data/resource-sync.db"),
            requested_course_ids=["_course_1", "_course_2"],
            processed_course_ids=["_course_1", "_course_2"],
            missing_course_ids=[],
            failed_course_ids=[],
            resource_payloads_by_course={
                "_course_1": [{"resource_id": "res_1"}],
                "_course_2": [{"resource_id": "res_2"}],
            },
            sync_stats={
                "courses": {"inserted": 2, "updated": 0, "deleted": 0},
                "assignments": {"inserted": 2, "updated": 0, "deleted": 0},
                "resources": {"inserted": 2, "updated": 0, "deleted": 0},
                "grades": {"inserted": 0, "updated": 0, "deleted": 0},
                "announcements": {"inserted": 0, "updated": 0, "deleted": 0},
            },
            table_counts={
                "courses": {"total": 2, "active": 2},
                "assignments": {"total": 2, "active": 2},
                "resources": {"total": 2, "active": 2},
                "grades": {"total": 0, "active": 0},
                "announcements": {"total": 0, "active": 0},
            },
            logs=[BlackboardLogEvent(timestamp="2026-03-06T08:00:02Z", level="info", layer="provider", source="test.resource_sync", message="ok")],
        )

    try:
        agent_tools.search_course_catalog_with_credentials = _fake_search  # type: ignore[assignment]
        agent_tools.refresh_calendar_ics_subscription = _fake_refresh  # type: ignore[assignment]
        agent_tools.run_blackboard_snapshot_sync = _fake_sync  # type: ignore[assignment]
        agent_tools.run_blackboard_course_resources_sync = _fake_resource_sync  # type: ignore[assignment]

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
        resource_result = agent_tools.sync_blackboard_course_resources(
            username="alice",
            password="secret",
            course_ids=["_course_1", "_course_2"],
        )
    finally:
        agent_tools.search_course_catalog_with_credentials = original_search  # type: ignore[assignment]
        agent_tools.refresh_calendar_ics_subscription = original_refresh  # type: ignore[assignment]
        agent_tools.run_blackboard_snapshot_sync = original_sync  # type: ignore[assignment]
        agent_tools.run_blackboard_course_resources_sync = original_resource_sync  # type: ignore[assignment]

    _assert_equal(search_result["total"], 1, "agent search total")
    _assert_true("log_summary" in search_result, "agent search should expose log summary")
    _assert_equal(refresh_result["db_path"], "backend/data/tool.db", "agent refresh path jsonable")
    _assert_equal(refresh_result["stats"]["refreshed_at"], "2026-03-06T08:00:00", "agent refresh datetime jsonable")
    _assert_true("logs" in refresh_result, "agent refresh should expose logs")
    _assert_true(snapshot_result["integrity_ok"], "agent snapshot integrity")
    _assert_equal(snapshot_result["scraped_counts"]["resources"], 0, "agent snapshot default resource count")
    _assert_true(snapshot_result["second_sync_has_no_new_records"], "agent snapshot no new records")
    _assert_true("logs" in snapshot_result, "agent snapshot should expose logs")
    _assert_equal(resource_result["requested_course_ids"], ["_course_1", "_course_2"], "agent resource requested course ids")
    _assert_equal(resource_result["db_path"], "backend/data/resource-sync.db", "agent resource path jsonable")
    _assert_equal(resource_result["scraped_counts"]["resources"], 2, "agent resource scraped count")
    _assert_true("logs" in resource_result, "agent resource sync should expose logs")
    _assert_true("log_summary" in resource_result, "agent resource sync should expose log summary")
