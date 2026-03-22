from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin

import pytest

from app.teaching_information_system import (
    DEFAULT_TIS_SERVICE_CONFIG,
    TISSelectedCoursesQueryResult,
    TISServiceConfig,
    fetch_selected_courses_with_credentials,
)
from tests.helpers import require_live_credentials

pytestmark = pytest.mark.live


_SELECTED_COURSES_PAGE_URL = urljoin(DEFAULT_TIS_SERVICE_CONFIG.base_url, "/Xsxk/query/1")
_SELECTED_COURSES_CURRENT_TERM_URL = urljoin(DEFAULT_TIS_SERVICE_CONFIG.base_url, "/Xsxk/queryXkdqXnxq")
_SELECTED_COURSES_API_URL = urljoin(DEFAULT_TIS_SERVICE_CONFIG.base_url, "/Xsxk/queryYxkc")


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _build_result_report(result: TISSelectedCoursesQueryResult) -> dict[str, object]:
    page_probe = next((probe for probe in result.probes if probe.probe_label == "selected-courses-page"), None)
    current_term_probe = next((probe for probe in result.probes if probe.probe_label == "selected-courses-current-term"), None)
    api_probe = next((probe for probe in result.probes if probe.probe_label == "selected-courses-api"), None)
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
        "log_entries": [
            {
                "message": event.message,
                "context": event.context,
                "payload": event.payload,
            }
            for event in result.logs
        ],
    }


def _build_report(default_result: TISSelectedCoursesQueryResult, explicit_result: TISSelectedCoursesQueryResult) -> dict[str, object]:
    return {
        "run_at": _now_iso(),
        "default_query": _build_result_report(default_result),
        "explicit_query": _build_result_report(explicit_result),
    }


def test_tis_selected_courses_live_chain(tmp_path: Path) -> None:
    username, password = require_live_credentials()

    service_config = TISServiceConfig(
        base_url=DEFAULT_TIS_SERVICE_CONFIG.base_url,
        entry_path="/cas",
        homepage_path="/student_index",
        grade_path_candidates=DEFAULT_TIS_SERVICE_CONFIG.grade_path_candidates,
    )

    report_dir = tmp_path / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / "tis_selected_courses_live_report.json"

    default_result = fetch_selected_courses_with_credentials(
        username,
        password,
        config=service_config,
        enable_console_logging=False,
    )
    explicit_result = fetch_selected_courses_with_credentials(
        username,
        password,
        semester=default_result.semester.semester_id,
        config=service_config,
        enable_console_logging=False,
    )

    report = _build_report(default_result, explicit_result)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    default_page_probe = next(
        (probe for probe in default_result.probes if probe.probe_label == "selected-courses-page"),
        None,
    )
    default_current_term_probe = next(
        (probe for probe in default_result.probes if probe.probe_label == "selected-courses-current-term"),
        None,
    )
    default_api_probe = next(
        (probe for probe in default_result.probes if probe.probe_label == "selected-courses-api"),
        None,
    )
    explicit_api_probe = next(
        (probe for probe in explicit_result.probes if probe.probe_label == "selected-courses-api"),
        None,
    )
    first_course = default_result.courses[0] if default_result.courses else None

    assert default_result.success, json.dumps(report, ensure_ascii=False, indent=2)
    assert default_result.page_url == _SELECTED_COURSES_PAGE_URL, json.dumps(report, ensure_ascii=False, indent=2)
    assert default_result.api_url == _SELECTED_COURSES_API_URL, json.dumps(report, ensure_ascii=False, indent=2)
    assert default_result.semester_source == "default-current-term", json.dumps(report, ensure_ascii=False, indent=2)
    assert default_result.current_semester is not None, json.dumps(report, ensure_ascii=False, indent=2)
    assert default_result.semester.semester_id == default_result.current_semester.semester_id, json.dumps(
        report, ensure_ascii=False, indent=2
    )
    assert len(default_result.courses) > 0, json.dumps(report, ensure_ascii=False, indent=2)
    assert default_result.summary.course_count == len(default_result.courses), json.dumps(report, ensure_ascii=False, indent=2)

    assert default_page_probe is not None, json.dumps(report, ensure_ascii=False, indent=2)
    assert default_page_probe.requested_url == _SELECTED_COURSES_PAGE_URL, json.dumps(report, ensure_ascii=False, indent=2)
    assert 200 <= default_page_probe.status_code < 400, json.dumps(report, ensure_ascii=False, indent=2)

    assert default_current_term_probe is not None, json.dumps(report, ensure_ascii=False, indent=2)
    assert default_current_term_probe.requested_url == _SELECTED_COURSES_CURRENT_TERM_URL, json.dumps(
        report, ensure_ascii=False, indent=2
    )
    assert default_current_term_probe.requested_method == "POST", json.dumps(report, ensure_ascii=False, indent=2)
    assert default_current_term_probe.status_code == 200, json.dumps(report, ensure_ascii=False, indent=2)
    assert default_current_term_probe.request_headers.get("Referer") == _SELECTED_COURSES_PAGE_URL, json.dumps(
        report, ensure_ascii=False, indent=2
    )
    assert default_current_term_probe.request_headers.get("Content-Type", "").lower().startswith(
        "application/x-www-form-urlencoded"
    ), json.dumps(report, ensure_ascii=False, indent=2)
    assert default_current_term_probe.request_headers.get("X-Requested-With") == "XMLHttpRequest", json.dumps(
        report, ensure_ascii=False, indent=2
    )

    assert default_api_probe is not None, json.dumps(report, ensure_ascii=False, indent=2)
    assert default_api_probe.requested_url == _SELECTED_COURSES_API_URL, json.dumps(report, ensure_ascii=False, indent=2)
    assert default_api_probe.requested_method == "POST", json.dumps(report, ensure_ascii=False, indent=2)
    assert default_api_probe.status_code == 200, json.dumps(report, ensure_ascii=False, indent=2)
    assert default_api_probe.request_headers.get("Referer") == _SELECTED_COURSES_PAGE_URL, json.dumps(
        report, ensure_ascii=False, indent=2
    )
    assert default_api_probe.request_headers.get("Content-Type", "").lower().startswith(
        "application/x-www-form-urlencoded"
    ), json.dumps(report, ensure_ascii=False, indent=2)
    assert default_api_probe.request_headers.get("X-Requested-With") == "XMLHttpRequest", json.dumps(
        report, ensure_ascii=False, indent=2
    )
    assert default_api_probe.request_payload.get("p_xkfsdm") == "yixuan", json.dumps(report, ensure_ascii=False, indent=2)
    assert default_api_probe.request_payload.get("p_xnxq") == default_result.semester.semester_id, json.dumps(
        report, ensure_ascii=False, indent=2
    )
    assert default_api_probe.request_payload.get("p_dqxnxq") == default_result.current_semester.semester_id, json.dumps(
        report, ensure_ascii=False, indent=2
    )
    if default_result.resolved_role_code:
        assert default_api_probe.request_headers.get("RoleCode") == default_result.resolved_role_code, json.dumps(
            report, ensure_ascii=False, indent=2
        )

    assert explicit_result.success, json.dumps(report, ensure_ascii=False, indent=2)
    assert explicit_result.semester_source == "parameter", json.dumps(report, ensure_ascii=False, indent=2)
    assert explicit_result.semester.semester_id == default_result.semester.semester_id, json.dumps(
        report, ensure_ascii=False, indent=2
    )
    assert len(explicit_result.courses) > 0, json.dumps(report, ensure_ascii=False, indent=2)

    assert explicit_api_probe is not None, json.dumps(report, ensure_ascii=False, indent=2)
    assert explicit_api_probe.request_payload.get("p_xnxq") == default_result.semester.semester_id, json.dumps(
        report, ensure_ascii=False, indent=2
    )
    assert explicit_api_probe.request_payload.get("p_xn") == default_result.semester.academic_year, json.dumps(
        report, ensure_ascii=False, indent=2
    )
    assert explicit_api_probe.request_payload.get("p_xq") == default_result.semester.term_code, json.dumps(
        report, ensure_ascii=False, indent=2
    )

    assert first_course is not None, json.dumps(report, ensure_ascii=False, indent=2)
    assert bool(first_course.course_code), json.dumps(report, ensure_ascii=False, indent=2)
    assert bool(first_course.course_name), json.dumps(report, ensure_ascii=False, indent=2)
    assert first_course.credits is not None, json.dumps(report, ensure_ascii=False, indent=2)
    assert bool(first_course.selection_category), json.dumps(report, ensure_ascii=False, indent=2)
    assert isinstance(first_course.raw, dict) and bool(first_course.raw), json.dumps(report, ensure_ascii=False, indent=2)
    assert all(key in first_course.raw for key in ("kcdm", "kcmc", "xkfsdm")), json.dumps(
        report, ensure_ascii=False, indent=2
    )
    assert report_path.exists()
