from __future__ import annotations

from pathlib import Path

import pytest

from app.integrations.sustech.teaching_information_system import fetch_selected_courses_with_credentials
from tests.helpers import require_live_credentials
from tests.integration.live_support.reporting import write_json_report
from tests.integration.live_support.tis_common import build_report_path, build_tis_service_config
from tests.integration.live_support.tis_selected_courses import (
    assert_selected_courses_results,
    build_selected_courses_report,
)

pytestmark = pytest.mark.live



def test_tis_selected_courses_live_chain(tmp_path: Path) -> None:
    username, password = require_live_credentials()
    service_config = build_tis_service_config()
    report_path = build_report_path(tmp_path, "tis_selected_courses_live_report.json")

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

    report = build_selected_courses_report(default_result, explicit_result)
    write_json_report(report_path, report)

    assert_selected_courses_results(default_result, explicit_result, report)
    assert report_path.exists()
