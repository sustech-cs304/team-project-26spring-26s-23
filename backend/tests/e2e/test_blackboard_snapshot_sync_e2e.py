from __future__ import annotations

from pathlib import Path

import pytest

from app.integrations.sustech.blackboard.provider.use_cases.snapshot_sync import run_blackboard_snapshot_sync
from tests.helpers import require_live_credentials

pytestmark = [pytest.mark.live, pytest.mark.e2e]


def _active_matches_expected(table_counts: dict[str, dict[str, int]], expected_active: dict[str, int]) -> bool:
    for table in ("courses", "assignments", "resources", "grades", "announcements"):
        active = int(table_counts.get(table, {}).get("active", 0))
        expected = int(expected_active.get(table, 0))
        if active != expected:
            return False
    return True


def test_blackboard_snapshot_sync_e2e(tmp_path: Path) -> None:
    username, password = require_live_credentials()
    db_path = tmp_path / "sustech_e2e.db"

    report = run_blackboard_snapshot_sync(
        username,
        password,
        db_path=db_path,
        reset_schema=True,
        verify_second_sync=True,
    )

    counts = report.snapshot.scraped_counts()
    assert counts["courses"] > 0
    assert _active_matches_expected(report.table_counts, report.expected_active_counts)
    assert report.second_sync_has_no_new_records()
    assert report.second_sync_has_no_deleted_records()
    assert report.db_path == Path(db_path)
