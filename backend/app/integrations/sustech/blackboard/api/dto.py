"""Blackboard API 层最小可用 DTO 定义。"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Any


def _jsonable(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.isoformat(timespec="seconds")
        return (
            value.astimezone(UTC).isoformat(timespec="seconds").replace("+00:00", "Z")
        )
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_jsonable(item) for item in value]
    return value


@dataclass(slots=True)
class BlackboardDTO:
    """DTO 基类，提供轻量序列化能力。"""

    def to_dict(self) -> dict[str, Any]:
        return _jsonable(asdict(self))


@dataclass(slots=True)
class CourseDTO(BlackboardDTO):
    course_id: str
    name: str
    url: str | None = None
    code: str | None = None
    term: str | None = None
    instructor: str | None = None
    is_archived: bool = False
    is_active: bool = True
    total_grade: str | None = None
    listed_grade: str | None = None


@dataclass(slots=True)
class AssignmentAttachmentDTO(BlackboardDTO):
    name: str
    url: str | None = None
    size: str | None = None
    type: str | None = None
    resource_id: str | None = None


@dataclass(slots=True)
class AssignmentDTO(BlackboardDTO):
    assignment_id: str | None
    course_id: str | None
    title: str
    start_time: datetime | None = None
    end_time: datetime | None = None
    due_date: str | None = None
    due_date_parsed: datetime | None = None
    status: str | None = None
    submission_status: str | None = None
    score: str | None = None
    total_score: str | None = None
    url: str | None = None
    summary: str | None = None
    description: str | None = None
    description_html: str | None = None
    source_page: str | None = None
    attachments: list[AssignmentAttachmentDTO] = field(default_factory=list)


@dataclass(slots=True)
class ResourceDTO(BlackboardDTO):
    resource_id: str | None
    course_id: str | None
    title: str
    url: str | None = None
    type: str | None = None
    size: str | None = None
    parent_id: str | None = None
    source_page: str | None = None
    assignment_id: str | None = None
    local_path: str | None = None


@dataclass(slots=True)
class AnnouncementDTO(BlackboardDTO):
    announcement_id: str | None
    course_id: str | None
    course_name: str | None
    title: str
    publish_time: str | None = None
    publish_time_parsed: datetime | None = None
    detail: str | None = None
    detail_html: str | None = None
    author: str | None = None
    url: str | None = None
    source_page: str | None = None
    linked_content_candidates: list[dict[str, Any]] = field(default_factory=list)


@dataclass(slots=True)
class GradeDTO(BlackboardDTO):
    grade_id: str | None
    course_id: str | None
    assignment_id: str | None
    item_name: str
    score: str | None = None
    total_score: str | None = None
    percentage: float | None = None
    weight: str | None = None
    category: str | None = None
    grade_type: str | None = None
    status: str | None = None
    due_date: str | None = None
    due_date_parsed: datetime | None = None
    graded_date: str | None = None
    graded_at: datetime | None = None
    source_url: str | None = None


@dataclass(slots=True)
class CourseGradesDTO(BlackboardDTO):
    course_id: str
    total_grade: str
    items: list[GradeDTO] = field(default_factory=list)
    stats: dict[str, int | float | None] = field(default_factory=dict)
    source_url: str = ""


@dataclass(slots=True)
class AllGradesCourseDTO(BlackboardDTO):
    course_id: str
    course_name: str
    listed_grade: str = ""
    total_grade: str = ""
    items: list[GradeDTO] = field(default_factory=list)
    stats: dict[str, int | float | None] = field(default_factory=dict)
    source_url: str = ""


@dataclass(slots=True)
class AllGradesDTO(BlackboardDTO):
    source_url: str
    total_courses: int
    course_order: list[str] = field(default_factory=list)
    courses: dict[str, AllGradesCourseDTO] = field(default_factory=dict)


@dataclass(slots=True)
class CourseCatalogResultDTO(BlackboardDTO):
    course_id: str | None
    course_identifier: str | None
    course_name: str
    instructor: str | None = None
    term: str | None = None
    url: str | None = None
    description: str | None = None


@dataclass(slots=True)
class CalendarEventDTO(BlackboardDTO):
    uid: str
    raw_uid: str | None
    title: str
    start_at: datetime
    end_at: datetime | None
    all_day: bool = False
    description: str | None = None
    location: str | None = None
    course_id: str | None = None
    done: bool = False
