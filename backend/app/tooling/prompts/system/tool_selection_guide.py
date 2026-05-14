"""System-level tool selection guide and shared conventions.

Inject into the agent system prompt to provide global navigation across
all tool categories. Mirrors Claude Code's tool preference matrix pattern.
"""

from __future__ import annotations

from app.tooling.prompts.file_tools import FILE_TOOL_PREFERENCE_GUIDE
from app.tooling.prompts.domain.blackboard import BLACKBOARD_TOOL_PREFERENCE_GUIDE
from app.tooling.prompts.domain.tis import TIS_TOOL_PREFERENCE_GUIDE

# ---------------------------------------------------------------------------
# Combined tool selection guide — injected into system prompt
# ---------------------------------------------------------------------------

TOOL_SELECTION_GUIDE = f"""\
# Tool Selection Guide

This guide helps you choose the right tool for each task. Dedicated tools
provide a much better experience than shell commands — use them whenever
possible.

{FILE_TOOL_PREFERENCE_GUIDE}

{BLACKBOARD_TOOL_PREFERENCE_GUIDE}

{TIS_TOOL_PREFERENCE_GUIDE}

## General Rules

- **Current date**: The current month/year is {{{{current_month_year}}}}.
  Use this for date-aware queries and context.
- **Always read before editing**: Use tool.fs.read before tool.fs.edit or tool.fs.write
- **Edit for partial changes**: Use tool.fs.edit for any modification to existing files
- **Write for new files only**: Use tool.fs.write only for creating files from scratch
- **Search before reading**: Use tool.fs.glob (filenames) and tool.fs.grep (content) to
  locate relevant files before reading them
- **Sync before querying**: For Blackboard and TIS data, run sync/fetch tools first,
  then use SQL query tools to explore the data
"""

# ---------------------------------------------------------------------------
# Shared conventions across all tools
# ---------------------------------------------------------------------------

SHARED_CONVENTIONS = """\
## Shared File Operation Conventions

1. **Path format**: Always use absolute paths within the workspace.
   Use tool.fs.glob to discover paths if unsure.

2. **Read before modify**: ALWAYS read a file's contents (tool.fs.read) before
   editing (tool.fs.edit) or overwriting (tool.fs.write) it.

3. **Emoji policy**: Only use emojis in file content if the user explicitly
   requests it. Avoid adding emojis to code or configuration files.

4. **Documentation policy**: NEVER create README or .md documentation files
   unless explicitly requested by the user.

5. **Shell command avoidance**: Do NOT use shell commands (cat, grep, sed, awk,
   find, ls) for file operations. Use the dedicated tools instead.

6. **Idempotent checks**: When overwriting files, use expectedHash for safe
   concurrent edits when possible.

7. **Parallel execution**: When you need to run multiple independent tool calls
   (e.g., reading several different files, searching across unrelated directories,
   running independent domain queries), make them ALL in a SINGLE message with
   parallel tool calls. Do NOT sequence independent calls one at a time — this
   wastes the user's time. Only chain tools sequentially when the later tool
   DEPENDS on the earlier tool's output. Examples:
   - Reading three unrelated files → three tool.fs.read calls in ONE message
   - Searching file names AND content → tool.fs.glob + tool.fs.grep in ONE message
   - Sync Blackboard AND fetch TIS courses → both in ONE message (they are independent)
   - Read file THEN edit it → sequential (edit depends on read output)

## Data Tool Conventions

8. **Credentials**: Blackboard and TIS credentials are auto-resolved from the
   host secret store. Omit username/password parameters unless explicitly needed.

9. **Sync-first**: Blackboard and TIS SQL query tools require prior data sync.
   Always run the appropriate sync/fetch tool before querying.

10. **State persistence**: Use stateKey and artifactName to persist results for
    later retrieval when processing large datasets.
"""


__all__ = [
    "SHARED_CONVENTIONS",
    "TOOL_SELECTION_GUIDE",
    "BLACKBOARD_TOOL_PREFERENCE_GUIDE",
    "FILE_TOOL_PREFERENCE_GUIDE",
    "TIS_TOOL_PREFERENCE_GUIDE",
]
