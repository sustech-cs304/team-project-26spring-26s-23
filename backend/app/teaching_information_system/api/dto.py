"""TIS API 层 DTO。"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any
from urllib.parse import urljoin

from ..shared import TISLogEvent, _jsonable
from .constants import _DEFAULT_GRADE_PATH_CANDIDATES, _DEFAULT_TIS_BASE_URL, _DEFAULT_TIS_ENTRY_PATH


@dataclass(slots=True)
class TISDTO:
    """TIS DTO 基类。"""

    def to_dict(self) -> dict[str, Any]:
        return _jsonable(asdict(self))


@dataclass(slots=True)
class TISMenuEntry(TISDTO):
    text: str
    href: str | None = None
    onclick: str | None = None
    target: str | None = None
    menu_type: str | None = None


@dataclass(slots=True)
class TISHomepageProfile(TISDTO):
    page_url: str
    title: str = ""
    iframe_urls: list[str] = field(default_factory=list)
    base_urls: list[str] = field(default_factory=list)
    menu_entries: list[TISMenuEntry] = field(default_factory=list)
    discovered_endpoints: list[str] = field(default_factory=list)
    schedule_related_endpoints: list[str] = field(default_factory=list)
    grade_related_endpoints: list[str] = field(default_factory=list)
    role_codes: list[str] = field(default_factory=list)
    prefers_json_api: bool = False
    raw_signals: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class TISGradeRecord(TISDTO):
    course_name: str
    score: str
    course_code: str | None = None
    term: str | None = None
    credit: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class TISProbeResult(TISDTO):
    url: str
    method: str
    status_code: int
    content_type: str | None = None
    record_count: int = 0
    grade_records: list[TISGradeRecord] = field(default_factory=list)
    is_json: bool = False
    preview: str | None = None
    probe_label: str | None = None
    requested_url: str | None = None
    requested_method: str | None = None
    redirect_count: int = 0
    request_headers: dict[str, Any] = field(default_factory=dict)
    request_payload_keys: list[str] = field(default_factory=list)
    request_payload: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class TISGradeQueryResult(TISDTO):
    success: bool
    source_url: str
    homepage: TISHomepageProfile
    grade_records: list[TISGradeRecord] = field(default_factory=list)
    probes: list[TISProbeResult] = field(default_factory=list)
    logs: list[TISLogEvent] = field(default_factory=list)
    resolved_role_code: str | None = None
    persistence: dict[str, Any] | None = None

    @property
    def total_records(self) -> int:
        return len(self.grade_records)


@dataclass(slots=True)
class TISCreditGPASummary(TISDTO):
    average_credit_gpa: float | None = None
    rank: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class TISCreditGPATermRecord(TISDTO):
    academic_year_term: str
    academic_year: str | None = None
    term_code: str | None = None
    term_credit_gpa: float | None = None
    year_credit_gpa: float | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class TISCreditGPAYearRecord(TISDTO):
    academic_year: str
    year_credit_gpa: float | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class TISCreditGPAQueryResult(TISDTO):
    success: bool
    source_url: str
    page_url: str
    api_url: str
    homepage: TISHomepageProfile
    summary: TISCreditGPASummary = field(default_factory=TISCreditGPASummary)
    term_records: list[TISCreditGPATermRecord] = field(default_factory=list)
    year_records: list[TISCreditGPAYearRecord] = field(default_factory=list)
    probes: list[TISProbeResult] = field(default_factory=list)
    logs: list[TISLogEvent] = field(default_factory=list)
    resolved_role_code: str | None = None
    persistence: dict[str, Any] | None = None


@dataclass(slots=True)
class TISSelectedCourseSemester(TISDTO):
    semester_id: str
    academic_year: str
    term_code: str
    label: str | None = None
    is_current: bool | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class TISSelectedCourseRecord(TISDTO):
    course_code: str
    course_name: str
    task_number: str | None = None
    course_sequence_number: str | None = None
    course_nature: str | None = None
    course_category: str | None = None
    credits: float | None = None
    hours: float | None = None
    class_time: str | None = None
    class_location: str | None = None
    class_info: str | None = None
    offering_department: str | None = None
    selection_category: str | None = None
    selection_coefficient: float | None = None
    effective_flag: bool | None = None
    effective_status: str | None = None
    selected_at: str | None = None
    campus: str | None = None
    term: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class TISSelectedCourseSummary(TISDTO):
    course_count: int = 0
    total_credits: float | None = None
    total_hours: float | None = None
    effective_course_count: int = 0
    page_num: int | None = None
    page_size: int | None = None
    raw_keys: list[str] = field(default_factory=list)


@dataclass(slots=True)
class TISSelectedCoursesQueryResult(TISDTO):
    success: bool
    source_url: str
    page_url: str
    api_url: str
    homepage: TISHomepageProfile
    semester: TISSelectedCourseSemester
    current_semester: TISSelectedCourseSemester | None = None
    courses: list[TISSelectedCourseRecord] = field(default_factory=list)
    summary: TISSelectedCourseSummary = field(default_factory=TISSelectedCourseSummary)
    probes: list[TISProbeResult] = field(default_factory=list)
    logs: list[TISLogEvent] = field(default_factory=list)
    resolved_role_code: str | None = None
    resolved_pylx: str | None = None
    semester_source: str | None = None
    persistence: dict[str, Any] | None = None


@dataclass(slots=True)
class TISServiceConfig(TISDTO):
    base_url: str = _DEFAULT_TIS_BASE_URL
    entry_path: str = _DEFAULT_TIS_ENTRY_PATH
    homepage_path: str = _DEFAULT_TIS_ENTRY_PATH
    grade_path_candidates: tuple[str, ...] = _DEFAULT_GRADE_PATH_CANDIDATES

    @property
    def entry_url(self) -> str:
        return urljoin(self.base_url, self.entry_path)

    @property
    def homepage_url(self) -> str:
        return urljoin(self.base_url, self.homepage_path)


DEFAULT_TIS_SERVICE_CONFIG = TISServiceConfig()


__all__ = [
    "DEFAULT_TIS_SERVICE_CONFIG",
    "TISCreditGPAQueryResult",
    "TISCreditGPASummary",
    "TISCreditGPATermRecord",
    "TISCreditGPAYearRecord",
    "TISDTO",
    "TISGradeQueryResult",
    "TISGradeRecord",
    "TISHomepageProfile",
    "TISMenuEntry",
    "TISProbeResult",
    "TISSelectedCourseRecord",
    "TISSelectedCourseSemester",
    "TISSelectedCourseSummary",
    "TISSelectedCoursesQueryResult",
    "TISServiceConfig",
]
