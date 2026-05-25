"""Prompts for Blackboard integration tools.

Each tool prompt provides the LLM with comprehensive usage context:
when to use, parameter semantics, tool relationships, and constraints.
"""

from __future__ import annotations

from app.tooling.prompts._base import ToolPrompt


BLACKBOARD_SNAPSHOT_SYNC_PROMPT = ToolPrompt(
    tool_id="blackboard.snapshot.sync",
    description=(
        "Fetch and sync all Blackboard course data (announcements, assignments, "
        "grades) into a local SQLite database. This is the PRIMARY data sync tool — "
        "run it first before any Blackboard SQL queries. Creates a complete local "
        "mirror of all enrolled courses."
    ),
    usage_guide=(
        "Use this tool when the user:\n"
        "- First connects to Blackboard and needs to pull all course data\n"
        "- Wants to refresh all data after new content is posted\n"
        "- Needs a complete local mirror for offline analysis and SQL queries\n"
        "- Asks about assignments, announcements, or grades from Blackboard\n"
        "\n"
        "After running this tool, use blackboard.sql.query to explore the data."
    ),
    parameter_guide=(
        "username / password / usernameSecretName / passwordSecretName (optional): "
        "Blackboard/CAS credentials. Usually OMIT — credentials are auto-resolved "
        "from the host secret store.\n"
        "dbPath (optional): SQLite database path relative to host database directory. "
        "Omit to use the default Blackboard database.\n"
        "recreateSchema (optional): Drop and recreate all SQLite tables before syncing. "
        "Default: false.\n"
        "verify (optional): Run a second verification pass after sync to confirm data "
        "integrity. Default: true.\n"
        "maxConcurrency (optional): Number of worker threads for parallel course data "
        "fetching. Higher values are faster but use more resources. Default: 1 (max: 6).\n"
        "stateKey / artifactName (optional): Persist results to host state store or "
        "artifact store for later retrieval."
    ),
    constraints=(
        "- This operation can take 1-3 minutes depending on course count\n"
        "- Requires valid Blackboard credentials (auto-resolved from host)\n"
        "- Data is stored locally in SQLite for subsequent queries\n"
        "- Concurrent syncs on the same database are not supported"
    ),
    relationships=(
        "This is the PRIMARY data sync tool for Blackboard.\n"
        "Workflow:\n"
        "1. blackboard.snapshot.sync → pull all course data into local SQLite\n"
        "2. blackboard.sql.query → explore and analyze the synced data"
    ),
    examples=(
        "Basic full sync:\n"
        '  {}\n'
        "\n"
        "Sync with fresh schema:\n"
        '  {"recreateSchema": true}\n'
        "\n"
        "Fast sync with parallelism:\n"
        '  {"maxConcurrency": 3}'
    ),
    annotations={
        "descriptionZh": (
            "从 Blackboard 拉取所有已选课程数据（公告、作业、成绩）并同步到本地 "
            "SQLite 数据库。这是主要的 Blackboard 数据同步工具——在执行任何 "
            "blackboard.sql.query 查询之前必须先运行此工具。同步可能需要 1-3 分钟。"
        ),
    },
)


BLACKBOARD_SQL_QUERY_PROMPT = ToolPrompt(
    tool_id="blackboard.sql.query",
    description=(
        "Execute read-only SQL queries against the local Blackboard SQLite database. "
        "Use this to explore and analyze synced Blackboard data after running sync tools."
    ),
    usage_guide=(
        "Use this tool when you need to:\n"
        "- Find specific records across tables (courses, assignments, announcements, grades)\n"
        "- Aggregate or analyze synced Blackboard data\n"
        "- Answer user questions that require custom data exploration\n"
        "\n"
        "CRITICAL: You MUST run blackboard.snapshot.sync or other sync tools FIRST "
        "to populate the database. This tool only queries — it does not fetch data "
        "from Blackboard.\n"
        "\n"
        "Typical workflow:\n"
        "1. blackboard.snapshot.sync → populate the database\n"
        "2. blackboard.sql.query → explore with SQL\n"
        "3. Present findings to the user"
    ),
    parameter_guide=(
        "sql (required): The SQL SELECT query to execute. Only SELECT statements "
        "are allowed.\n"
        "dbPath (optional): SQLite database path. Omit for default Blackboard database.\n"
        "maxRows (optional): Maximum rows in the inline preview before truncation. "
        "Default: 50.\n"
        "saveFullResult (optional): When true and preview is truncated, save the full "
        "result as a JSON artifact. Default: false."
    ),
    constraints=(
        "- READ-ONLY access — only SELECT queries are permitted\n"
        "- The database must be populated by prior sync operations\n"
        "- SQLite dialect — use SQLite-compatible SQL syntax\n"
        "- Results may be truncated at maxRows; use saveFullResult for large results"
    ),
    relationships=(
        "Upstream (REQUIRED): blackboard.snapshot.sync or other sync tools\n"
        "This tool depends entirely on data populated by sync operations.\n"
        "Do NOT call this tool before running at least one sync."
    ),
    examples=(
        "List all courses:\n"
        '  {"sql": "SELECT DISTINCT course_id, course_name FROM courses"}\n'
        "\n"
        "Find recent announcements:\n"
        '  {"sql": "SELECT title, posted_date FROM announcements ORDER BY posted_date DESC LIMIT 10"}\n'
        "\n"
        "Count assignments by course:\n"
        '  {"sql": "SELECT course_id, COUNT(*) as count FROM assignments GROUP BY course_id"}'
    ),
    annotations={
        "descriptionZh": (
            "对本地 Blackboard SQLite 数据库执行只读 SQL 查询。必须先运行同步工具"
            "（如 blackboard.snapshot.sync）填充数据后才能使用。仅支持 SELECT 查询。"
        ),
    },
)


BLACKBOARD_PROMPTS: tuple = (
    BLACKBOARD_SNAPSHOT_SYNC_PROMPT,
    BLACKBOARD_SQL_QUERY_PROMPT,
)


# ---------------------------------------------------------------------------
# Blackboard tool workflow guidance (for system prompt injection)
# ---------------------------------------------------------------------------

BLACKBOARD_TOOL_PREFERENCE_GUIDE = """\
## Blackboard Data Tools

Blackboard tools access 南科大 Blackboard course data. All data flows through
local SQLite — sync first, then query.

### Tool Selection

| Task | Use This Tool |
|------|--------------|
| Full data pull (all courses) | {snapshot} |
| Explore synced data | {sql} |

### Workflow

1. **First time**: Run `{snapshot}` to pull all enrolled course data
2. **Query**: Use `{sql}` to explore and analyze synced data

### Critical Rules

- `{sql}` is READ-ONLY and requires prior sync
- `{snapshot}` is the primary data sync tool — run it first
""".format(
    snapshot=BLACKBOARD_SNAPSHOT_SYNC_PROMPT.tool_id,
    sql=BLACKBOARD_SQL_QUERY_PROMPT.tool_id,
)


__all__ = [
    "BLACKBOARD_PROMPTS",
    "BLACKBOARD_SNAPSHOT_SYNC_PROMPT",
    "BLACKBOARD_SQL_QUERY_PROMPT",
    "BLACKBOARD_TOOL_PREFERENCE_GUIDE",
]
