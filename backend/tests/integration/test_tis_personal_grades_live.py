from __future__ import annotations

from pathlib import Path

import pytest

from app.integrations.sustech.teaching_information_system import fetch_personal_grades_with_credentials, run_tis_link_diagnostic
from tests.helpers import require_live_credentials
from tests.integration.live_support.reporting import report_json, write_json_report
from tests.integration.live_support.tis_common import build_report_path, build_tis_service_config
from tests.integration.live_support.tis_personal_grades import (
    assert_personal_grades_result,
    build_personal_grades_failure_report,
    build_personal_grades_report,
)

pytestmark = pytest.mark.live



def test_tis_personal_grades_live_chain(tmp_path: Path) -> None:
    username, password = require_live_credentials()
    service_config = build_tis_service_config()
    report_path = build_report_path(tmp_path, "tis_personal_grades_live_report.json")

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
        failure_report = build_personal_grades_failure_report(ex, diagnostic)
        write_json_report(report_path, failure_report)
        pytest.fail(report_json(failure_report))

    report = build_personal_grades_report(result)
    write_json_report(report_path, report)

    assert_personal_grades_result(result, report)
    assert report_path.exists()
