from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin

import pytest

from app.teaching_information_system import (
    DEFAULT_TIS_SERVICE_CONFIG,
    TISGradeQueryResult,
    TISServiceConfig,
    fetch_personal_grades_with_credentials,
    run_tis_link_diagnostic,
)
from tests.helpers import require_live_credentials

pytestmark = pytest.mark.live


_GRADE_PAGE_URL = urljoin(DEFAULT_TIS_SERVICE_CONFIG.base_url, "/cjgl/grcjcx/go/1")
_GRADE_API_URL = urljoin(DEFAULT_TIS_SERVICE_CONFIG.base_url, "/cjgl/grcjcx/grcjcx")


def _now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _build_report(result: TISGradeQueryResult) -> dict[str, object]:
    page_probe = next((probe for probe in result.probes if probe.probe_label == "har-grade-page"), None)
    api_probe = next((probe for probe in result.probes if probe.probe_label == "har-grade-api"), None)
    first_record = result.grade_records[0] if result.grade_records else None
    first_record_raw = first_record.raw if first_record is not None else {}

    return {
        "run_at": _now_iso(),
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
        "log_entries": [
            {
                "message": event.message,
                "context": event.context,
                "payload": event.payload,
            }
            for event in result.logs
        ],
    }


def test_tis_personal_grades_live_chain(tmp_path: Path) -> None:
    username, password = require_live_credentials()

    service_config = TISServiceConfig(
        base_url=DEFAULT_TIS_SERVICE_CONFIG.base_url,
        entry_path="/cas",
        homepage_path="/student_index",
        grade_path_candidates=DEFAULT_TIS_SERVICE_CONFIG.grade_path_candidates,
    )

    report_dir = tmp_path / "reports"
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / "tis_personal_grades_live_report.json"

    try:
        result = fetch_personal_grades_with_credentials(
            username,
            password,
            config=service_config,
            enable_console_logging=False,
            max_probe_count=12,
        )
    except Exception as ex:
        diagnostic = run_tis_link_diagnostic(
            username,
            password,
            config=service_config,
            enable_console_logging=False,
            max_probe_count=12,
        )
        failure_report = {
            "run_at": _now_iso(),
            "fetch_error": f"{type(ex).__name__}: {ex}",
            "diagnostic": diagnostic,
        }
        report_path.write_text(json.dumps(failure_report, ensure_ascii=False, indent=2), encoding="utf-8")
        pytest.fail(json.dumps(failure_report, ensure_ascii=False, indent=2))

    report = _build_report(result)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    page_probe = next((probe for probe in result.probes if probe.probe_label == "har-grade-page"), None)
    api_probe = next((probe for probe in result.probes if probe.probe_label == "har-grade-api"), None)
    first_record = result.grade_records[0] if result.grade_records else None

    assert result.success, json.dumps(report, ensure_ascii=False, indent=2)
    assert result.total_records > 0, json.dumps(report, ensure_ascii=False, indent=2)
    assert page_probe is not None, json.dumps(report, ensure_ascii=False, indent=2)
    assert page_probe.requested_url == _GRADE_PAGE_URL, json.dumps(report, ensure_ascii=False, indent=2)
    assert 200 <= page_probe.status_code < 400, json.dumps(report, ensure_ascii=False, indent=2)

    assert api_probe is not None, json.dumps(report, ensure_ascii=False, indent=2)
    assert api_probe.requested_url == _GRADE_API_URL, json.dumps(report, ensure_ascii=False, indent=2)
    assert api_probe.requested_method == "POST", json.dumps(report, ensure_ascii=False, indent=2)
    assert api_probe.status_code == 200, json.dumps(report, ensure_ascii=False, indent=2)
    assert api_probe.request_headers.get("Referer") == _GRADE_PAGE_URL, json.dumps(report, ensure_ascii=False, indent=2)
    assert api_probe.request_headers.get("Content-Type", "").lower().startswith(
        "application/json"
    ), json.dumps(report, ensure_ascii=False, indent=2)
    assert api_probe.request_headers.get("X-Requested-With") == "XMLHttpRequest", json.dumps(
        report, ensure_ascii=False, indent=2
    )
    if result.resolved_role_code:
        assert api_probe.request_headers.get("RoleCode") == result.resolved_role_code, json.dumps(
            report, ensure_ascii=False, indent=2
        )

    assert first_record is not None, json.dumps(report, ensure_ascii=False, indent=2)
    assert bool(first_record.course_name), json.dumps(report, ensure_ascii=False, indent=2)
    assert bool(first_record.score), json.dumps(report, ensure_ascii=False, indent=2)
    assert isinstance(first_record.raw, dict) and bool(first_record.raw), json.dumps(report, ensure_ascii=False, indent=2)
    assert any(key in first_record.raw for key in ("kcmc", "课程名称", "courseName")), json.dumps(
        report, ensure_ascii=False, indent=2
    )
    assert any(key in first_record.raw for key in ("zzcj", "成绩", "score", "grade")), json.dumps(
        report, ensure_ascii=False, indent=2
    )
    assert report_path.exists()
