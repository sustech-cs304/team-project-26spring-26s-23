from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable

from app.integrations.sustech.teaching_information_system import DEFAULT_TIS_SERVICE_CONFIG, TISServiceConfig

from .reporting import ensure_report_dir


def build_tis_service_config() -> TISServiceConfig:
    return TISServiceConfig(
        base_url=DEFAULT_TIS_SERVICE_CONFIG.base_url,
        entry_path="/cas",
        homepage_path="/student_index",
        grade_path_candidates=DEFAULT_TIS_SERVICE_CONFIG.grade_path_candidates,
    )



def build_report_path(tmp_path: Path, filename: str) -> Path:
    return ensure_report_dir(tmp_path) / filename



def summarize_log_entries(events: Iterable[Any]) -> list[dict[str, Any]]:
    return [
        {
            "message": event.message,
            "context": event.context,
            "payload": event.payload,
        }
        for event in events
    ]
