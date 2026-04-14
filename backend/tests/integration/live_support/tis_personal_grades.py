from __future__ import annotations

from typing import Any
from urllib.parse import urljoin

from app.integrations.sustech.teaching_information_system import DEFAULT_TIS_SERVICE_CONFIG, TISGradeQueryResult

from .reporting import find_probe, now_iso, report_json
from .tis_common import summarize_log_entries

_GRADE_PAGE_URL = urljoin(DEFAULT_TIS_SERVICE_CONFIG.base_url, "/cjgl/grcjcx/go/1")
_GRADE_API_URL = urljoin(DEFAULT_TIS_SERVICE_CONFIG.base_url, "/cjgl/grcjcx/grcjcx")



def build_personal_grades_report(result: TISGradeQueryResult) -> dict[str, Any]:
    page_probe = find_probe(result.probes, "har-grade-page")
    api_probe = find_probe(result.probes, "har-grade-api")
    first_record = result.grade_records[0] if result.grade_records else None
    first_record_raw = first_record.raw if first_record is not None else {}

    return {
        "run_at": now_iso(),
        "success": result.success,
        "resolved_role_code": result.resolved_role_code,
        "homepage": {
            "page_url": result.homepage.page_url,
            "title": result.homepage.title,
            "role_codes": result.homepage.role_codes,
            "grade_related_endpoints": result.homepage.grade_related_endpoints[:10],
        },
        "probe_summary": [
            {
                "probe_label": probe.probe_label,
                "method": probe.method,
                "requested_method": probe.requested_method,
                "status_code": probe.status_code,
                "requested_url": probe.requested_url,
                "url": probe.url,
                "redirect_count": probe.redirect_count,
                "record_count": probe.record_count,
                "content_type": probe.content_type,
            }
            for probe in result.probes
        ],
        "grade_page": None
        if page_probe is None
        else {
            "status_code": page_probe.status_code,
            "requested_url": page_probe.requested_url,
            "url": page_probe.url,
            "redirect_count": page_probe.redirect_count,
        },
        "grade_api": None
        if api_probe is None
        else {
            "status_code": api_probe.status_code,
            "requested_method": api_probe.requested_method,
            "requested_url": api_probe.requested_url,
            "url": api_probe.url,
            "redirect_count": api_probe.redirect_count,
            "request_headers": api_probe.request_headers,
            "request_payload_keys": api_probe.request_payload_keys,
        },
        "record_summary": {
            "total_records": result.total_records,
            "first_record": None
            if first_record is None
            else {
                "course_name": first_record.course_name,
                "course_code": first_record.course_code,
                "term": first_record.term,
                "score": first_record.score,
                "credit": first_record.credit,
            },
            "first_record_keys": sorted(str(key) for key in first_record_raw.keys())[:20],
        },
        "log_entries": summarize_log_entries(result.logs),
    }



def build_personal_grades_failure_report(error: Exception, diagnostic: Any) -> dict[str, Any]:
    return {
        "run_at": now_iso(),
        "fetch_error": f"{type(error).__name__}: {error}",
        "diagnostic": diagnostic,
    }



def assert_personal_grades_result(result: TISGradeQueryResult, report: dict[str, Any]) -> None:
    message = report_json(report)
    page_probe = find_probe(result.probes, "har-grade-page")
    api_probe = find_probe(result.probes, "har-grade-api")
    first_record = result.grade_records[0] if result.grade_records else None

    assert result.success, message
    assert result.total_records > 0, message
    assert page_probe is not None, message
    assert page_probe.requested_url == _GRADE_PAGE_URL, message
    assert 200 <= page_probe.status_code < 400, message

    assert api_probe is not None, message
    assert api_probe.requested_url == _GRADE_API_URL, message
    assert api_probe.requested_method == "POST", message
    assert api_probe.status_code == 200, message
    assert api_probe.request_headers.get("Referer") == _GRADE_PAGE_URL, message
    assert api_probe.request_headers.get("Content-Type", "").lower().startswith("application/json"), message
    assert api_probe.request_headers.get("X-Requested-With") == "XMLHttpRequest", message
    if result.resolved_role_code:
        assert api_probe.request_headers.get("RoleCode") == result.resolved_role_code, message

    assert first_record is not None, message
    assert bool(first_record.course_name), message
    assert bool(first_record.score), message
    assert isinstance(first_record.raw, dict) and bool(first_record.raw), message
    assert any(key in first_record.raw for key in ("kcmc", "课程名称", "courseName")), message
    assert any(key in first_record.raw for key in ("zzcj", "成绩", "score", "grade")), message
