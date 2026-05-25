"""Calendar toolset — runtime-agnostic calendar tool contracts.

Tools operate on the Electron timeline.db (timeline_events table),
the single source of truth for calendar data.
"""

from __future__ import annotations

from .sql_query import CalendarSQLQueryTool, get_calendar_tool_contracts

__all__ = [
    "CalendarSQLQueryTool",
    "get_calendar_tool_contracts",
]
