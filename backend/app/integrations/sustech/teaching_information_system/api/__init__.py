"""TIS API 层导出。"""

from .client import TISClient
from .constants import (
    _DEFAULT_TIS_CREDIT_GPA_API_PATH,
    _DEFAULT_TIS_CREDIT_GPA_PAGE_PATH,
    _DEFAULT_TIS_ENTRY_PATH,
    _DEFAULT_TIS_SELECTED_COURSES_API_PATH,
    _DEFAULT_TIS_SELECTED_COURSES_CURRENT_TERM_PATH,
    _DEFAULT_TIS_SELECTED_COURSES_PAGE_PATH,
)
from .credit_gpa import (
    extract_credit_gpa_summary_from_json,
    extract_credit_gpa_term_records_from_json,
    extract_credit_gpa_year_records_from_json,
)
from .context import TISAPIContext
from .dto import (
    DEFAULT_TIS_SERVICE_CONFIG,
    TISCreditGPAQueryResult,
    TISCreditGPASummary,
    TISCreditGPATermRecord,
    TISCreditGPAYearRecord,
    TISDTO,
    TISGradeQueryResult,
    TISGradeRecord,
    TISHomepageProfile,
    TISMenuEntry,
    TISProbeResult,
    TISSelectedCourseRecord,
    TISSelectedCourseSemester,
    TISSelectedCourseSummary,
    TISSelectedCoursesQueryResult,
    TISServiceConfig,
)
from .fetch_helpers import _is_authenticated_tis_response, _safe_parse_json_response
from .grades import (
    _build_tis_probe_result,
    build_grade_candidate_urls,
    extract_grade_records_from_html,
    extract_grade_records_from_json,
    probe_grade_candidates,
)
from .homepage import analyze_homepage_html
from .selected_courses import (
    _build_selected_courses_base_payload,
    _extract_selected_courses_current_semester,
    _parse_selected_course_semester_argument,
    build_selected_course_summary,
    extract_selected_course_records_from_json,
)

__all__ = [
    "DEFAULT_TIS_SERVICE_CONFIG",
    "TISAPIContext",
    "TISClient",
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
    "_DEFAULT_TIS_CREDIT_GPA_API_PATH",
    "_DEFAULT_TIS_CREDIT_GPA_PAGE_PATH",
    "_DEFAULT_TIS_ENTRY_PATH",
    "_DEFAULT_TIS_SELECTED_COURSES_API_PATH",
    "_DEFAULT_TIS_SELECTED_COURSES_CURRENT_TERM_PATH",
    "_DEFAULT_TIS_SELECTED_COURSES_PAGE_PATH",
    "_build_selected_courses_base_payload",
    "_build_tis_probe_result",
    "_extract_selected_courses_current_semester",
    "_is_authenticated_tis_response",
    "_parse_selected_course_semester_argument",
    "_safe_parse_json_response",
    "analyze_homepage_html",
    "build_grade_candidate_urls",
    "build_selected_course_summary",
    "extract_credit_gpa_summary_from_json",
    "extract_credit_gpa_term_records_from_json",
    "extract_credit_gpa_year_records_from_json",
    "extract_grade_records_from_html",
    "extract_grade_records_from_json",
    "extract_selected_course_records_from_json",
    "probe_grade_candidates",
]
