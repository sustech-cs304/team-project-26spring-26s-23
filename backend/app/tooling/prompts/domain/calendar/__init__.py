"""Calendar tool prompt descriptions for the LLM-facing tool selection guide."""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Calendar tool preference guide — injected into system prompt
# ---------------------------------------------------------------------------

CALENDAR_TOOL_PREFERENCE_GUIDE = """\
## Calendar Tools

Calendar tools provide direct SQL access to the unified calendar database
(`event_unified_calendar` table). Use them to inspect, modify, and manage all
calendar events across Blackboard, WakeUp, course schedules, and custom entries.

### calendar.sql.query — Unified Calendar SQL

**Use this tool for ALL calendar operations:**

- **Inspect events**: SELECT from event_unified_calendar to understand the
  current calendar state. Always read before modifying.
- **Modify events**: UPDATE any event's title, description, time, status,
  or metadata regardless of source.
- **Delete events**: DELETE any event from the calendar.
- **Add custom events**: INSERT new events with source='custom' only.
  Blackboard (source='bb'), WakeUp (source='wakeup'), and course
  (source='course') events are managed by their own sync tools.

**Important rules:**
- All SELECT, UPDATE, DELETE operations work on any source (bb, wakeup, course, custom).
- INSERT is ONLY allowed for source='custom'. Attempting to insert events with
  other sources will be rejected — those sources are managed by sync tools.
- Use SELECT first to inspect the current calendar before making changes.
- The status field supports: not_started, in_progress, completed.
- Dates use ISO-8601 UTC format.
- For sub-day events, set is_all_day=0 and provide precise start_time/end_time.
"""

__all__ = [
    "CALENDAR_TOOL_PREFERENCE_GUIDE",
]
