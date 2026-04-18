from __future__ import annotations

from typing import Any
from urllib.parse import urljoin

from app.integrations.sustech.teaching_information_system import DEFAULT_TIS_SERVICE_CONFIG, TISSelectedCoursesQueryResult

from .reporting import find_probe, now_iso, report_json
from .tis_common import summarize_log_entries

_SELECTED_COURSES_PAGE_URL = urljoin(DEFAULT_TIS_SERVICE_CONFIG.base_url, "/Xsxk/query/1")
_SELECTED_COURSES_CURRENT_TERM_URL = urljoin(DEFAULT_TIS_SERVICE_CONFIG.base_url, "/Xsxk/queryXkdqXnxq")
_SELECTED_COURSES_API_URL = urljoin(DEFAULT_TIS_SERVICE_CONFIG.base_url, "/Xsxk/queryYxkc")



def build_selected_courses_report(
    default_result: TISSelectedCoursesQueryResult,
    explicit_result: TISSelectedCoursesQueryResult,
) -> dict[str, Any]:
    return {
        "run_at": now_iso(),
        "default_query": _build_result_report(default_result),
        "explicit_query": _build_result_report(explicit_result),
    }



def assert_selected_courses_results(
    default_result: TISSelectedCoursesQueryResult,
    explicit_result: TISSelectedCoursesQueryResult,
    report: dict[str, Any],
) -> None:
    message = report_json(report)
    default_page_probe = find_probe(default_result.probes, "selected-courses-page")
    default_current_term_probe = find_probe(default_result.probes, "selected-courses-current-term")
    default_api_probe = find_probe(default_result.probes, "selected-courses-api")
    explicit_api_probe = find_probe(explicit_result.probes, "selected-courses-api")
    first_course = default_result.courses[0] if default_result.courses else None

    assert default_result.success, message
    assert default_result.page_url == _SELECTED_COURSES_PAGE_URL, message
    assert default_result.api_url == _SELECTED_COURSES_API_URL, message
    assert default_result.semester_source == "default-current-term", message
    assert default_result.current_semester is not None, message
    assert default_result.semester.semester_id == default_result.current_semester.semester_id, message
    assert len(default_result.courses) > 0, message
    assert default_result.summary.course_count == len(default_result.courses), message

    assert default_page_probe is not None, message
    assert default_page_probe.requested_url == _SELECTED_COURSES_PAGE_URL, message
    assert 200 <= default_page_probe.status_code < 400, message

    assert default_current_term_probe is not None, message
    assert default_current_term_probe.requested_url == _SELECTED_COURSES_CURRENT_TERM_URL, message
    assert default_current_term_probe.requested_method == "POST", message
    assert default_current_term_probe.status_code == 200, message
    assert default_current_term_probe.request_headers.get("Referer") == _SELECTED_COURSES_PAGE_URL, message
    assert default_current_term_probe.request_headers.get("Content-Type", "").lower().startswith(
        "application/x-www-form-urlencoded"
    ), message
    assert default_current_term_probe.request_headers.get("X-Requested-With") == "XMLHttpRequest", message

    assert default_api_probe is not None, message
    assert default_api_probe.requested_url == _SELECTED_COURSES_API_URL, message
    assert default_api_probe.requested_method == "POST", message
    assert default_api_probe.status_code == 200, message
    assert default_api_probe.request_headers.get("Referer") == _SELECTED_COURSES_PAGE_URL, message
    assert default_api_probe.request_headers.get("Content-Type", "").lower().startswith(
        "application/x-www-form-urlencoded"
    ), message
    assert default_api_probe.request_headers.get("X-Requested-With") == "XMLHttpRequest", message
    assert default_api_probe.request_payload.get("p_xkfsdm") == "yixuan", message
    assert default_api_probe.request_payload.get("p_xnxq") == default_result.semester.semester_id, message
    assert default_api_probe.request_payload.get("p_dqxnxq") == default_result.current_semester.semester_id, message
    if default_result.resolved_role_code:
        assert default_api_probe.request_headers.get("RoleCode") == default_result.resolved_role_code, message

    assert explicit_result.success, message
    assert explicit_result.semester_source == "parameter", message
    assert explicit_result.semester.semester_id == default_result.semester.semester_id, message
    assert len(explicit_result.courses) > 0, message

    assert explicit_api_probe is not None, message
    assert explicit_api_probe.request_payload.get("p_xnxq") == default_result.semester.semester_id, message
    assert explicit_api_probe.request_payload.get("p_xn") == default_result.semester.academic_year, message
    assert explicit_api_probe.request_payload.get("p_xq") == default_result.semester.term_code, message

    assert first_course is not None, message
    assert bool(first_course.course_code), message
    assert bool(first_course.course_name), message
    assert first_course.credits is not None, message
    assert bool(first_course.selection_category), message
    assert isinstance(first_course.raw, dict) and bool(first_course.raw), message
    assert all(key in first_course.raw for key in ("kcdm", "kcmc", "xkfsdm")), message



def _build_result_report(result: TISSelectedCoursesQueryResult) -> dict[str, Any]:
    page_probe = find_probe(result.probes, "selected-courses-page")
    current_term_probe = find_probe(result.probes, "selected-courses-current-term")
    api_probe = find_probe(result.probes, "selected-courses-api")
    first_course = result.courses[0] if result.courses else None

    return {
        "success": result.success,
        "page_url": result.page_url,
        "api_url": result.api_url,
        "resolved_role_code": result.resolved_role_code,
        "resolved_pylx": result.resolved_pylx,
        "semester_source": result.semester_source,
        "semester": result.semester.to_dict(),
        "current_semester": None if result.current_semester is None else result.current_semester.to_dict(),
        "summary": result.summary.to_dict(),
        "probe_summary": [
            {
                "probe_label": probe.probe_label,
                "requested_method": probe.requested_method,
                "requested_url": probe.requested_url,
                "status_code": probe.status_code,
                "record_count": probe.record_count,
                "request_headers": probe.request_headers,
                "request_payload_keys": probe.request_payload_keys,
                "request_payload": probe.request_payload,
            }
            for probe in result.probes
        ],
        "page_probe": None
        if page_probe is None
        else {
            "requested_url": page_probe.requested_url,
            "status_code": page_probe.status_code,
        },
        "current_term_probe": None
        if current_term_probe is None
        else {
            "requested_url": current_term_probe.requested_url,
            "status_code": current_term_probe.status_code,
            "request_payload": current_term_probe.request_payload,
        },
        "api_probe": None
        if api_probe is None
        else {
            "requested_url": api_probe.requested_url,
            "status_code": api_probe.status_code,
            "request_payload": api_probe.request_payload,
        },
        "first_course": None
        if first_course is None
        else {
            "course_code": first_course.course_code,
            "course_name": first_course.course_name,
            "task_number": first_course.task_number,
            "course_sequence_number": first_course.course_sequence_number,
            "course_nature": first_course.course_nature,
            "course_category": first_course.course_category,
            "credits": first_course.credits,
            "hours": first_course.hours,
            "class_info": first_course.class_info,
            "offering_department": first_course.offering_department,
            "selection_category": first_course.selection_category,
            "selection_coefficient": first_course.selection_coefficient,
            "effective_flag": first_course.effective_flag,
            "effective_status": first_course.effective_status,
            "selected_at": first_course.selected_at,
            "campus": first_course.campus,
            "raw_keys": sorted(str(key) for key in first_course.raw.keys()),
        },
        "log_entries": summarize_log_entries(result.logs),
    }
