from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin

import pytest

from app.teaching_information_system import (
    DEFAULT_TIS_SERVICE_CONFIG,
    TISCreditGPAQueryResult,
    TISServiceConfig,
    fetch_credit_gpa_with_credentials,
)
from tests.helpers import require_live_credentials

pytestmark = pytest.mark.live


_CREDIT_GPA_PAGE_URL = urljoin(DEFAULT_TIS_SERVICE_CONFIG.base_url, "/cjgl/xscjgl/xsgrcjcx/xspjxfjcx")
_CREDIT_GPA_API_URL = urljoin(DEFAULT_TIS_SERVICE_CONFIG.base_url, "/cjgl/xscjgl/xsgrcjcx/queryXnAndXqXfj")


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _build_report(result: TISCreditGPAQueryResult) -> dict[str, object]:
    page_probe = next((probe for probe in result.probes if probe.probe_label == "credit-gpa-page"), None)
    api_probe = next((probe for probe in result.probes if probe.probe_label == "credit-gpa-api"), None)
    first_term = result.term_records[0] if result.term_records else None
    first_year = result.year_records[0] if result.year_records else None

    return {
        "run_at": _now_iso(),
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
        "log_entries": [
            {
                "message": event.message,
                "context": event.context,
                "payload": event.payload,
            }
            for event in result.logs
        ],
    }


def test_tis_credit_gpa_live_chain(tmp_path: Path) -> None:
    username, password = require_live_credentials()

    service_config = TISServiceConfig(
        base_url=DEFAULT_TIS_SERVICE_CONFIG.base_url,
        entry_path="/cas",
        homepage_path="/student_index",
        grade_path_candidates=DEFAULT_TIS_SERVICE_CONFIG.grade_path_candidates,
    )

    report_dir = tmp_path / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / "tis_credit_gpa_live_report.json"

    result = fetch_credit_gpa_with_credentials(
        username,
        password,
        config=service_config,
        enable_console_logging=False,
    )

    report = _build_report(result)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    page_probe = next((probe for probe in result.probes if probe.probe_label == "credit-gpa-page"), None)
    api_probe = next((probe for probe in result.probes if probe.probe_label == "credit-gpa-api"), None)
    first_term = result.term_records[0] if result.term_records else None
    first_year = result.year_records[0] if result.year_records else None

    assert result.success, json.dumps(report, ensure_ascii=False, indent=2)
    assert result.page_url == _CREDIT_GPA_PAGE_URL, json.dumps(report, ensure_ascii=False, indent=2)
    assert result.api_url == _CREDIT_GPA_API_URL, json.dumps(report, ensure_ascii=False, indent=2)

    assert page_probe is not None, json.dumps(report, ensure_ascii=False, indent=2)
    assert page_probe.requested_url == _CREDIT_GPA_PAGE_URL, json.dumps(report, ensure_ascii=False, indent=2)
    assert 200 <= page_probe.status_code < 400, json.dumps(report, ensure_ascii=False, indent=2)

    assert api_probe is not None, json.dumps(report, ensure_ascii=False, indent=2)
    assert api_probe.requested_url == _CREDIT_GPA_API_URL, json.dumps(report, ensure_ascii=False, indent=2)
    assert api_probe.requested_method == "POST", json.dumps(report, ensure_ascii=False, indent=2)
    assert api_probe.status_code == 200, json.dumps(report, ensure_ascii=False, indent=2)
    assert api_probe.request_headers.get("Referer") == _CREDIT_GPA_PAGE_URL, json.dumps(report, ensure_ascii=False, indent=2)
    assert api_probe.request_headers.get("Origin") == DEFAULT_TIS_SERVICE_CONFIG.base_url, json.dumps(
        report, ensure_ascii=False, indent=2
    )
    assert api_probe.request_headers.get("X-Requested-With") == "XMLHttpRequest", json.dumps(
        report, ensure_ascii=False, indent=2
    )
    if result.resolved_role_code:
        assert api_probe.request_headers.get("RoleCode") == result.resolved_role_code, json.dumps(
            report, ensure_ascii=False, indent=2
        )

    assert result.summary.average_credit_gpa is not None, json.dumps(report, ensure_ascii=False, indent=2)
    assert bool(result.summary.rank), json.dumps(report, ensure_ascii=False, indent=2)

    assert len(result.term_records) > 0, json.dumps(report, ensure_ascii=False, indent=2)
    assert len(result.year_records) > 0, json.dumps(report, ensure_ascii=False, indent=2)

    assert first_term is not None, json.dumps(report, ensure_ascii=False, indent=2)
    assert bool(first_term.academic_year_term), json.dumps(report, ensure_ascii=False, indent=2)
    assert first_term.term_credit_gpa is not None, json.dumps(report, ensure_ascii=False, indent=2)
    assert isinstance(first_term.raw, dict) and bool(first_term.raw), json.dumps(report, ensure_ascii=False, indent=2)
    assert any(key in first_term.raw for key in ("XNXQ", "XN", "XQ", "XQXFJ", "XNXFJ")), json.dumps(
        report, ensure_ascii=False, indent=2
    )

    assert first_year is not None, json.dumps(report, ensure_ascii=False, indent=2)
    assert bool(first_year.academic_year), json.dumps(report, ensure_ascii=False, indent=2)
    assert first_year.year_credit_gpa is not None, json.dumps(report, ensure_ascii=False, indent=2)
    assert isinstance(first_year.raw, dict) and bool(first_year.raw), json.dumps(report, ensure_ascii=False, indent=2)
    assert report_path.exists()
