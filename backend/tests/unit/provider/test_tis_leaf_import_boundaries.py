from __future__ import annotations

import inspect

from app.teaching_information_system.api import client as api_client
from app.teaching_information_system.api import constants as api_constants
from app.teaching_information_system.api import credit_gpa as api_credit_gpa
from app.teaching_information_system.api import dto as api_dto
from app.teaching_information_system.api import fetch_helpers as api_fetch_helpers
from app.teaching_information_system.api import grades as api_grades
from app.teaching_information_system.api import homepage as api_homepage
from app.teaching_information_system.api import selected_courses as api_selected_courses
from app.teaching_information_system.facade import get_tis_tool_contracts
from app.teaching_information_system.provider.use_cases import credit_gpa as credit_gpa_use_case
from app.teaching_information_system.provider.use_cases import diagnostics as diagnostics_use_case
from app.teaching_information_system.provider.use_cases import personal_grades as personal_grades_use_case
from app.teaching_information_system.provider.use_cases import selected_courses as selected_courses_use_case
from app.tooling import assess_default_contract_mcp_readiness
from app.tooling.runtime_adapter.copilot_runtime import build_default_contract_runtime_bindings

_EXPECTED_TIS_TOOL_IDS = {
    "tis.personal_grades.fetch",
    "tis.credit_gpa.fetch",
    "tis.selected_courses.fetch",
}

_TIS_USE_CASE_MODULES = (
    credit_gpa_use_case,
    diagnostics_use_case,
    personal_grades_use_case,
    selected_courses_use_case,
)


def test_tis_provider_use_cases_avoid_api_aggregate_imports() -> None:
    forbidden = "from app.teaching_information_system.api import"

    for module in _TIS_USE_CASE_MODULES:
        assert forbidden not in inspect.getsource(module), module.__name__



def test_tis_provider_use_cases_bind_leaf_api_symbols() -> None:
    assert diagnostics_use_case.DEFAULT_TIS_SERVICE_CONFIG is api_dto.DEFAULT_TIS_SERVICE_CONFIG
    assert diagnostics_use_case.TISClient is api_client.TISClient
    assert diagnostics_use_case.TISServiceConfig is api_dto.TISServiceConfig
    assert diagnostics_use_case.analyze_homepage_html is api_homepage.analyze_homepage_html
    assert diagnostics_use_case.build_grade_candidate_urls is api_grades.build_grade_candidate_urls
    assert diagnostics_use_case.probe_grade_candidates is api_grades.probe_grade_candidates

    assert personal_grades_use_case.DEFAULT_TIS_SERVICE_CONFIG is api_dto.DEFAULT_TIS_SERVICE_CONFIG
    assert personal_grades_use_case.TISClient is api_client.TISClient
    assert personal_grades_use_case.TISGradeQueryResult is api_dto.TISGradeQueryResult
    assert personal_grades_use_case.TISServiceConfig is api_dto.TISServiceConfig
    assert personal_grades_use_case.analyze_homepage_html is api_homepage.analyze_homepage_html
    assert personal_grades_use_case.probe_grade_candidates is api_grades.probe_grade_candidates

    assert credit_gpa_use_case.DEFAULT_TIS_SERVICE_CONFIG is api_dto.DEFAULT_TIS_SERVICE_CONFIG
    assert credit_gpa_use_case.TISClient is api_client.TISClient
    assert credit_gpa_use_case.TISCreditGPAQueryResult is api_dto.TISCreditGPAQueryResult
    assert credit_gpa_use_case.TISServiceConfig is api_dto.TISServiceConfig
    assert credit_gpa_use_case._DEFAULT_TIS_CREDIT_GPA_API_PATH == api_constants._DEFAULT_TIS_CREDIT_GPA_API_PATH
    assert credit_gpa_use_case._DEFAULT_TIS_CREDIT_GPA_PAGE_PATH == api_constants._DEFAULT_TIS_CREDIT_GPA_PAGE_PATH
    assert credit_gpa_use_case._DEFAULT_TIS_ENTRY_PATH == api_constants._DEFAULT_TIS_ENTRY_PATH
    assert credit_gpa_use_case._is_authenticated_tis_response is api_fetch_helpers._is_authenticated_tis_response
    assert credit_gpa_use_case._safe_parse_json_response is api_fetch_helpers._safe_parse_json_response
    assert credit_gpa_use_case._build_tis_probe_result is api_grades._build_tis_probe_result
    assert credit_gpa_use_case.analyze_homepage_html is api_homepage.analyze_homepage_html
    assert credit_gpa_use_case.extract_credit_gpa_summary_from_json is api_credit_gpa.extract_credit_gpa_summary_from_json
    assert credit_gpa_use_case.extract_credit_gpa_term_records_from_json is api_credit_gpa.extract_credit_gpa_term_records_from_json
    assert credit_gpa_use_case.extract_credit_gpa_year_records_from_json is api_credit_gpa.extract_credit_gpa_year_records_from_json

    assert selected_courses_use_case.DEFAULT_TIS_SERVICE_CONFIG is api_dto.DEFAULT_TIS_SERVICE_CONFIG
    assert selected_courses_use_case.TISClient is api_client.TISClient
    assert selected_courses_use_case.TISSelectedCoursesQueryResult is api_dto.TISSelectedCoursesQueryResult
    assert selected_courses_use_case.TISServiceConfig is api_dto.TISServiceConfig
    assert selected_courses_use_case._DEFAULT_TIS_ENTRY_PATH == api_constants._DEFAULT_TIS_ENTRY_PATH
    assert selected_courses_use_case._DEFAULT_TIS_SELECTED_COURSES_API_PATH == api_constants._DEFAULT_TIS_SELECTED_COURSES_API_PATH
    assert selected_courses_use_case._DEFAULT_TIS_SELECTED_COURSES_CURRENT_TERM_PATH == api_constants._DEFAULT_TIS_SELECTED_COURSES_CURRENT_TERM_PATH
    assert selected_courses_use_case._DEFAULT_TIS_SELECTED_COURSES_PAGE_PATH == api_constants._DEFAULT_TIS_SELECTED_COURSES_PAGE_PATH
    assert selected_courses_use_case._is_authenticated_tis_response is api_fetch_helpers._is_authenticated_tis_response
    assert selected_courses_use_case._safe_parse_json_response is api_fetch_helpers._safe_parse_json_response
    assert selected_courses_use_case._build_tis_probe_result is api_grades._build_tis_probe_result
    assert selected_courses_use_case.analyze_homepage_html is api_homepage.analyze_homepage_html
    assert selected_courses_use_case._build_selected_courses_base_payload is api_selected_courses._build_selected_courses_base_payload
    assert selected_courses_use_case._extract_selected_courses_current_semester is api_selected_courses._extract_selected_courses_current_semester
    assert selected_courses_use_case._parse_selected_course_semester_argument is api_selected_courses._parse_selected_course_semester_argument
    assert selected_courses_use_case.build_selected_course_summary is api_selected_courses.build_selected_course_summary
    assert selected_courses_use_case.extract_selected_course_records_from_json is api_selected_courses.extract_selected_course_records_from_json



def test_tis_facade_runtime_and_tooling_paths_remain_stable_after_leaf_import_cleanup() -> None:
    assert {tool.metadata.tool_id for tool in get_tis_tool_contracts()} == _EXPECTED_TIS_TOOL_IDS
    assert {
        binding.tool_id for binding in build_default_contract_runtime_bindings() if binding.tool_id.startswith("tis.")
    } == _EXPECTED_TIS_TOOL_IDS
    assert {
        report.tool_id for report in assess_default_contract_mcp_readiness() if report.tool_id.startswith("tis.")
    } == _EXPECTED_TIS_TOOL_IDS
