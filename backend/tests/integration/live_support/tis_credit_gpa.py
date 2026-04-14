from __future__ import annotations

from typing import Any
from urllib.parse import urljoin

from app.integrations.sustech.teaching_information_system import DEFAULT_TIS_SERVICE_CONFIG, TISCreditGPAQueryResult

from .reporting import find_probe, now_iso, report_json
from .tis_common import summarize_log_entries

_CREDIT_GPA_PAGE_URL = urljoin(DEFAULT_TIS_SERVICE_CONFIG.base_url, "/cjgl/xscjgl/xsgrcjcx/xspjxfjcx")
_CREDIT_GPA_API_URL = urljoin(DEFAULT_TIS_SERVICE_CONFIG.base_url, "/cjgl/xscjgl/xsgrcjcx/queryXnAndXqXfj")



def build_credit_gpa_report(result: TISCreditGPAQueryResult) -> dict[str, Any]:
    page_probe = find_probe(result.probes, "credit-gpa-page")
    api_probe = find_probe(result.probes, "credit-gpa-api")
    first_term = result.term_records[0] if result.term_records else None
    first_year = result.year_records[0] if result.year_records else None

    return {
        "run_at": now_iso(),
        "success": result.success,
        "resolved_role_code": result.resolved_role_code,
        "page_url": result.page_url,
        "api_url": result.api_url,
        "homepage": {
            "page_url": result.homepage.page_url,
            "title": result.homepage.title,
            "role_codes": result.homepage.role_codes,
            "grade_related_endpoints": result.homepage.grade_related_endpoints[:10],
        },
        "summary": {
            "average_credit_gpa": result.summary.average_credit_gpa,
            "rank": result.summary.rank,
            "raw_keys": sorted(str(key) for key in result.summary.raw.keys()),
        },
        "page_probe": None
        if page_probe is None
        else {
            "status_code": page_probe.status_code,
            "requested_url": page_probe.requested_url,
            "url": page_probe.url,
            "redirect_count": page_probe.redirect_count,
        },
        "api_probe": None
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
        "term_summary": {
            "count": len(result.term_records),
            "first_term": None
            if first_term is None
            else {
                "academic_year_term": first_term.academic_year_term,
                "academic_year": first_term.academic_year,
                "term_code": first_term.term_code,
                "term_credit_gpa": first_term.term_credit_gpa,
                "year_credit_gpa": first_term.year_credit_gpa,
                "raw_keys": sorted(str(key) for key in first_term.raw.keys()),
            },
        },
        "year_summary": {
            "count": len(result.year_records),
            "first_year": None
            if first_year is None
            else {
                "academic_year": first_year.academic_year,
                "year_credit_gpa": first_year.year_credit_gpa,
                "raw_keys": sorted(str(key) for key in first_year.raw.keys()),
            },
        },
        "log_entries": summarize_log_entries(result.logs),
    }



def assert_credit_gpa_result(result: TISCreditGPAQueryResult, report: dict[str, Any]) -> None:
    message = report_json(report)
    page_probe = find_probe(result.probes, "credit-gpa-page")
    api_probe = find_probe(result.probes, "credit-gpa-api")
    first_term = result.term_records[0] if result.term_records else None
    first_year = result.year_records[0] if result.year_records else None

    assert result.success, message
    assert result.page_url == _CREDIT_GPA_PAGE_URL, message
    assert result.api_url == _CREDIT_GPA_API_URL, message

    assert page_probe is not None, message
    assert page_probe.requested_url == _CREDIT_GPA_PAGE_URL, message
    assert 200 <= page_probe.status_code < 400, message

    assert api_probe is not None, message
    assert api_probe.requested_url == _CREDIT_GPA_API_URL, message
    assert api_probe.requested_method == "POST", message
    assert api_probe.status_code == 200, message
    assert api_probe.request_headers.get("Referer") == _CREDIT_GPA_PAGE_URL, message
    assert api_probe.request_headers.get("Origin") == DEFAULT_TIS_SERVICE_CONFIG.base_url, message
    assert api_probe.request_headers.get("X-Requested-With") == "XMLHttpRequest", message
    if result.resolved_role_code:
        assert api_probe.request_headers.get("RoleCode") == result.resolved_role_code, message

    assert result.summary.average_credit_gpa is not None, message
    assert bool(result.summary.rank), message

    assert len(result.term_records) > 0, message
    assert len(result.year_records) > 0, message

    assert first_term is not None, message
    assert bool(first_term.academic_year_term), message
    assert first_term.term_credit_gpa is not None, message
    assert isinstance(first_term.raw, dict) and bool(first_term.raw), message
    assert any(key in first_term.raw for key in ("XNXQ", "XN", "XQ", "XQXFJ", "XNXFJ")), message

    assert first_year is not None, message
    assert bool(first_year.academic_year), message
    assert first_year.year_credit_gpa is not None, message
    assert isinstance(first_year.raw, dict) and bool(first_year.raw), message
