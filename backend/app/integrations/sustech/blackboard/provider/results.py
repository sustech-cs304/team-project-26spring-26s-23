from __future__ import annotations

from dataclasses import dataclass, field as dataclass_field
from pathlib import Path
from typing import Any, Callable

from app.integrations.sustech.blackboard.api.dto import (
    AnnouncementDTO,
    AssignmentDTO,
    CalendarEventDTO,
    CourseCatalogResultDTO,
    CourseDTO,
    GradeDTO,
    ResourceDTO,
)
from app.integrations.sustech.blackboard.data.results import SyncStats
from app.integrations.sustech.blackboard.shared.logging import (
    BlackboardLogEvent,
    summarize_log_events,
)

ProgressCallback = Callable[[str], None]


@dataclass(slots=True)
class CourseCatalogSearchResult:
    keyword: str
    field: str
    operator: str
    limit: int | None
    fetch_mode: str
    max_pages: int
    results: list[CourseCatalogResultDTO]
    logs: list[BlackboardLogEvent] = dataclass_field(default_factory=list)

    @property
    def total(self) -> int:
        return len(self.results)

    @property
    def log_summary(self) -> dict[str, Any]:
        return summarize_log_events(self.logs)


@dataclass(slots=True)
class CalendarICSSyncResult:
    feed_url: str
    refresh_mode: str
    db_path: Path
    stats: dict[str, Any]
    active_events: list[CalendarEventDTO]
    all_events: list[CalendarEventDTO]
    logs: list[BlackboardLogEvent] = dataclass_field(default_factory=list)
    unified_stats: dict[str, int] | None = None
    unified_error: str | None = None

    @property
    def unified_ok(self) -> bool:
        return self.unified_error is None and self.unified_stats is not None

    @property
    def active_event_count(self) -> int:
        return len(self.active_events)

    @property
    def all_event_count(self) -> int:
        return len(self.all_events)

    @property
    def log_summary(self) -> dict[str, Any]:
        return summarize_log_events(self.logs)


@dataclass(slots=True)
class BlackboardSnapshotFetchResult:
    courses: list[CourseDTO]
    assignments_by_course: dict[str, list[AssignmentDTO]]
    resources_by_course: dict[str, list[ResourceDTO]]
    grades_by_course: dict[str, list[GradeDTO]]
    announcements: list[AnnouncementDTO]
    logs: list[BlackboardLogEvent] = dataclass_field(default_factory=list)

    def scraped_counts(self) -> dict[str, int]:
        return {
            "courses": len(self.courses),
            "assignments": sum(
                len(rows) for rows in self.assignments_by_course.values()
            ),
            "resources": sum(len(rows) for rows in self.resources_by_course.values()),
            "grades": sum(len(rows) for rows in self.grades_by_course.values()),
            "announcements": len(self.announcements),
        }

    @property
    def log_summary(self) -> dict[str, Any]:
        return summarize_log_events(self.logs)


@dataclass(slots=True)
class BlackboardSyncPayloads:
    course_payload: list[dict[str, Any]]
    assignment_payloads: dict[str, list[dict[str, Any]]]
    resource_payloads: dict[str, list[dict[str, Any]]]
    grade_payloads: dict[str, list[dict[str, Any]]]
    announcements_payload: list[dict[str, Any]]
    announcement_assignment_link_payloads: list[dict[str, Any]] = dataclass_field(
        default_factory=list
    )


@dataclass(slots=True)
class BlackboardSnapshotSyncReport:
    db_path: Path
    snapshot: BlackboardSnapshotFetchResult
    payloads: BlackboardSyncPayloads
    first_sync_stats: dict[str, SyncStats]
    second_sync_stats: dict[str, SyncStats] | None
    table_counts: dict[str, dict[str, int]]
    expected_active_counts: dict[str, int]
    integrity_ok: bool
    logs: list[BlackboardLogEvent] = dataclass_field(default_factory=list)

    def second_sync_has_no_new_records(self) -> bool:
        if self.second_sync_stats is None:
            return False
        return all(
            int(item.get("inserted", 0)) == 0
            for item in self.second_sync_stats.values()
        )

    def second_sync_has_no_deleted_records(self) -> bool:
        if self.second_sync_stats is None:
            return False
        return all(
            int(item.get("deleted", 0)) == 0 for item in self.second_sync_stats.values()
        )

    @property
    def log_summary(self) -> dict[str, Any]:
        return summarize_log_events(self.logs)


@dataclass(slots=True)
class BlackboardCourseResourcesSyncReport:
    db_path: Path
    requested_course_ids: list[str]
    processed_course_ids: list[str]
    missing_course_ids: list[str]
    failed_course_ids: list[str]
    resource_payloads_by_course: dict[str, list[dict[str, Any]]]
    sync_stats: dict[str, SyncStats]
    table_counts: dict[str, dict[str, int]]
    logs: list[BlackboardLogEvent] = dataclass_field(default_factory=list)

    def scraped_counts(self) -> dict[str, int]:
        return {
            "courses": len(self.processed_course_ids),
            "resources": sum(
                len(rows) for rows in self.resource_payloads_by_course.values()
            ),
        }

    @property
    def log_summary(self) -> dict[str, Any]:
        return summarize_log_events(self.logs)
