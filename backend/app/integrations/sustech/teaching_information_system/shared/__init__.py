"""TIS 共享基础设施导出。"""

from .logging import (
    TISConsoleSink,
    TISLogCollector,
    TISLogEvent,
    TISLogger,
    TISLogSession,
    create_tis_log_session,
)
from .semesters import _TERM_CODE_TO_NAME, compose_semester_label
from .text import _clean_text, _jsonable, _normalize_mapping, _utcnow_iso

__all__ = [
    "TISConsoleSink",
    "TISLogCollector",
    "TISLogEvent",
    "TISLogger",
    "TISLogSession",
    "_TERM_CODE_TO_NAME",
    "_clean_text",
    "_jsonable",
    "_normalize_mapping",
    "_utcnow_iso",
    "compose_semester_label",
    "create_tis_log_session",
]
