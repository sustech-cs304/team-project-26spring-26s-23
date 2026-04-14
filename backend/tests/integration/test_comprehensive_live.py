from __future__ import annotations

from pathlib import Path

import pytest

from app.blackboard.api import (
    BlackboardAPIContext,
    BlackboardAnnouncementAPI,
    BlackboardAssignmentAPI,
    BlackboardContentAPI,
    BlackboardCourseAPI,
    BlackboardGradeAPI,
)
from app.shared_integrations.sustech_auth.cas_client import CASClient
from tests.helpers import require_live_credentials
from tests.integration.live_support.blackboard_comprehensive import (
    build_initial_report,
    build_markdown_report,
    populate_comprehensive_report,
)
from tests.integration.live_support.reporting import (
    build_timestamped_report_paths,
    record_failure,
    write_json_report,
    write_text_report,
)

pytestmark = pytest.mark.live



def test_comprehensive_live(tmp_path: Path) -> None:
    username, password = require_live_credentials()
    json_path, md_path = build_timestamped_report_paths(tmp_path, "comprehensive", include_markdown=True)
    assert md_path is not None

    report = build_initial_report()
    cas_client = CASClient()
    try:
        bb_service_url = "https://bb.sustech.edu.cn/webapps/login/"
        assert cas_client.login(username, password, bb_service_url)

        context = BlackboardAPIContext(client=cas_client.client, debug_enabled=False)
        populate_comprehensive_report(
            report,
            course_api=BlackboardCourseAPI(cas_client.client),
            assignment_api=BlackboardAssignmentAPI(context),
            grade_api=BlackboardGradeAPI(context),
            announcement_api=BlackboardAnnouncementAPI(context),
            content_api=BlackboardContentAPI(context),
        )
    except Exception as ex:
        record_failure(report, ex)
        raise
    finally:
        cas_client.close()
        write_json_report(json_path, report)
        write_text_report(md_path, build_markdown_report(report))

    assert report["status"] == "completed"
    assert json_path.exists()
    assert md_path.exists()
