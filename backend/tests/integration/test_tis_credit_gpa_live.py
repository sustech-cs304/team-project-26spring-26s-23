from __future__ import annotations

from pathlib import Path

import pytest

from app.teaching_information_system import fetch_credit_gpa_with_credentials
from tests.helpers import require_live_credentials
from tests.integration.live_support.reporting import write_json_report
from tests.integration.live_support.tis_common import build_report_path, build_tis_service_config
from tests.integration.live_support.tis_credit_gpa import assert_credit_gpa_result, build_credit_gpa_report

pytestmark = pytest.mark.live



def test_tis_credit_gpa_live_chain(tmp_path: Path) -> None:
    username, password = require_live_credentials()
    report_path = build_report_path(tmp_path, "tis_credit_gpa_live_report.json")

    result = fetch_credit_gpa_with_credentials(
        username,
        password,
        config=build_tis_service_config(),
        enable_console_logging=False,
    )

    report = build_credit_gpa_report(result)
    write_json_report(report_path, report)

    assert_credit_gpa_result(result, report)
    assert report_path.exists()
