"""Legacy compatibility re-exports for older Blackboard provider-side tool imports.

Canonical runtime/tooling surface lives in `app.integrations.sustech.blackboard.facade` via
`get_blackboard_tool_contracts()`.
"""

from .agent_tools import (
    refresh_calendar_ics,
    search_course_catalog,
    sync_blackboard_course_resources,
    sync_blackboard_snapshot,
)

__all__ = [
    "search_course_catalog",
    "refresh_calendar_ics",
    "sync_blackboard_course_resources",
    "sync_blackboard_snapshot",
]

