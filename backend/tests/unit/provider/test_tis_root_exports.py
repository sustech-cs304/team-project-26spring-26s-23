from __future__ import annotations

import app.teaching_information_system as tis
from app.teaching_information_system.api import (
    DEFAULT_TIS_SERVICE_CONFIG,
    TISCreditGPAQueryResult,
    TISGradeQueryResult,
    TISSelectedCoursesQueryResult,
    TISServiceConfig,
)
from app.teaching_information_system.facade import get_tis_tool_contracts
from app.teaching_information_system.provider import (
    fetch_credit_gpa_with_credentials,
    fetch_personal_grades_with_credentials,
    fetch_selected_courses_with_credentials,
    run_tis_link_diagnostic,
)
from app.tooling import assess_default_contract_mcp_readiness
from app.tooling.runtime_adapter.copilot_runtime import build_default_contract_runtime_bindings

_EXPECTED_ROOT_EXPORTS = (
    "DEFAULT_TIS_SERVICE_CONFIG",
    "TISCreditGPAQueryResult",
    "TISGradeQueryResult",
    "TISSelectedCoursesQueryResult",
    "TISServiceConfig",
    "fetch_credit_gpa_with_credentials",
    "fetch_personal_grades_with_credentials",
    "fetch_selected_courses_with_credentials",
    "get_tis_tool_contracts",
    "run_tis_link_diagnostic",
)

_REMOVED_ROOT_EXPORTS = {
    "TISAPIContext",
    "TISClient",
    "TISCreditGPAFetchTool",
    "TISCreditGPASummary",
    "TISCreditGPATermRecord",
    "TISCreditGPAYearRecord",
    "TISDTO",
    "TISGradeRecord",
    "TISHomepageProfile",
    "TISLogEvent",
    "TISLogger",
    "TISLogSession",
    "TISMenuEntry",
    "TISPersonalGradesFetchTool",
    "TISProbeResult",
    "TISSelectedCourseRecord",
    "TISSelectedCourseSemester",
    "TISSelectedCourseSummary",
    "TISSelectedCoursesFetchTool",
    "TIS_FACADE_TOOLS",
    "_TERM_CODE_TO_NAME",
    "_build_selected_courses_base_payload",
    "_build_tis_probe_result",
    "_DEFAULT_TIS_CREDIT_GPA_API_PATH",
    "_DEFAULT_TIS_CREDIT_GPA_PAGE_PATH",
    "_DEFAULT_TIS_ENTRY_PATH",
    "_DEFAULT_TIS_SELECTED_COURSES_API_PATH",
    "_DEFAULT_TIS_SELECTED_COURSES_CURRENT_TERM_PATH",
    "_DEFAULT_TIS_SELECTED_COURSES_PAGE_PATH",
    "_extract_selected_courses_current_semester",
    "_is_authenticated_tis_response",
    "_parse_selected_course_semester_argument",
    "_safe_parse_json_response",
    "_clean_text",
    "_jsonable",
    "_normalize_mapping",
    "_utcnow_iso",
    "analyze_homepage_html",
    "build_grade_candidate_urls",
    "build_selected_course_summary",
    "create_tis_log_session",
    "extract_credit_gpa_summary_from_json",
    "extract_credit_gpa_term_records_from_json",
    "extract_credit_gpa_year_records_from_json",
    "extract_grade_records_from_html",
    "extract_grade_records_from_json",
    "extract_selected_course_records_from_json",
    "probe_grade_candidates",
    "run_tis_link_diagnostic_from_env",
}

_EXPECTED_TIS_TOOL_IDS = {
    "tis.personal_grades.fetch",
    "tis.credit_gpa.fetch",
    "tis.selected_courses.fetch",
}


def test_tis_root_package_exports_minimal_stable_surface() -> None:
    assert tis.__all__ == list(_EXPECTED_ROOT_EXPORTS)
    assert tis.DEFAULT_TIS_SERVICE_CONFIG is DEFAULT_TIS_SERVICE_CONFIG
    assert tis.TISCreditGPAQueryResult is TISCreditGPAQueryResult
    assert tis.TISGradeQueryResult is TISGradeQueryResult
    assert tis.TISSelectedCoursesQueryResult is TISSelectedCoursesQueryResult
    assert tis.TISServiceConfig is TISServiceConfig
    assert tis.fetch_credit_gpa_with_credentials is fetch_credit_gpa_with_credentials
    assert tis.fetch_personal_grades_with_credentials is fetch_personal_grades_with_credentials
    assert tis.fetch_selected_courses_with_credentials is fetch_selected_courses_with_credentials
    assert tis.get_tis_tool_contracts is get_tis_tool_contracts
    assert tis.run_tis_link_diagnostic is run_tis_link_diagnostic


def test_tis_root_package_does_not_reexport_internal_helpers_or_facade_classes() -> None:
    for name in _REMOVED_ROOT_EXPORTS:
        assert name not in tis.__all__
        assert not hasattr(tis, name), name


def test_tis_root_package_still_supports_runtime_default_contract_bindings() -> None:
    bindings = build_default_contract_runtime_bindings()

    assert {
        binding.tool_id for binding in bindings if binding.tool_id.startswith("tis.")
    } == _EXPECTED_TIS_TOOL_IDS


def test_tis_root_package_still_supports_mcp_readiness_assessment() -> None:
    reports = assess_default_contract_mcp_readiness()

    assert {
        report.tool_id for report in reports if report.tool_id.startswith("tis.")
    } == _EXPECTED_TIS_TOOL_IDS
