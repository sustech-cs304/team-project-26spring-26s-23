"""Prompts for Blackboard integration tools.

Each tool prompt provides the LLM with comprehensive usage context:
when to use, parameter semantics, tool relationships, and constraints.
"""

from __future__ import annotations

from app.tooling.prompts._base import ToolPrompt


BLACKBOARD_COURSE_CATALOG_SEARCH_PROMPT = ToolPrompt(
    tool_id="blackboard.course_catalog.search",
    description=(
        "Search the Blackboard course catalog by keyword. Returns matching courses "
        "with course IDs, names, instructors, and descriptions. This is the entry "
        "point for discovering what courses are available on Blackboard."
    ),
    usage_guide=(
        "Use this tool when the user wants to:\n"
        "- Find courses by name or keyword on Blackboard (南科大 Blackboard)\n"
        "- Look up course IDs required for fetching course resources\n"
        "- Explore what courses are available in a subject area\n"
        "- Find a specific course before pulling its data\n"
        "\n"
        "Do NOT use this tool to:\n"
        "- Get course content, assignments, or grades — use blackboard.snapshot.sync "
        "or blackboard.course_resources.sync instead\n"
        "- Query already-synced data — use blackboard.sql.query instead\n"
        "- Refresh calendar data — use blackboard.calendar.refresh\n"
        "\n"
        "Typical workflow:\n"
        "1. Use this tool to search and find course IDs\n"
        "2. Use blackboard.course_resources.sync with the discovered course IDs\n"
        "3. Use blackboard.sql.query to explore the synced data"
    ),
    parameter_guide=(
        "keyword (required): Search term for matching courses (e.g., '计算机', 'CS304'). "
        "Supports Chinese and English search terms.\n"
        "searchField (optional): Which catalog field to search. Default: 'CourseName'.\n"
        "searchScope (optional): 'quick' returns initial results only; 'full' performs "
        "a deep crawl across multiple pages. Default: 'full'.\n"
        "maxPages (optional): Maximum result pages to fetch. Default: 30.\n"
        "maxResults (optional): Hard cap on returned results.\n"
        "username / password (optional): Blackboard/CAS credentials. Usually OMIT — "
        "credentials are auto-resolved from the host secret store."
    ),
    constraints=(
        "- Requires valid Blackboard credentials (auto-resolved from host)\n"
        "- Searches the catalog, not course content\n"
        "- Results may be truncated by maxPages or maxResults settings"
    ),
    relationships=(
        "Upstream: None — this is an entry-point tool\n"
        "Downstream:\n"
        "- After finding course IDs, use blackboard.course_resources.sync to fetch data\n"
        "- Use blackboard.snapshot.sync for a complete data pull of all enrolled courses\n"
        "- Use blackboard.sql.query to inspect synced catalog data"
    ),
    examples=(
        'Search for courses: {"keyword": "计算机"}\n'
        'Search for a specific course: {"keyword": "CS304"}\n'
        'Quick search with limit: {"keyword": "数学", "searchScope": "quick", "maxResults": 10}'
    ),
    annotations={
        "descriptionZh": (
            "按关键词搜索 Blackboard 课程目录。返回匹配课程的名称、ID、教师和描述。"
            "这是发现 Blackboard 上可用课程的入口工具。搜索到课程 ID 后，使用 "
            "blackboard.course_resources.sync 拉取具体课程数据。"
        ),
    },
)


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
        "Do NOT use this tool when:\n"
        "- Only need specific courses — use blackboard.course_resources.sync (more targeted)\n"
        "- Only need to search course info — use blackboard.course_catalog.search\n"
        "- Only need calendar/schedule data — use blackboard.calendar.refresh\n"
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
        "2. blackboard.sql.query → explore and analyze the synced data\n"
        "3. blackboard.course_catalog.search → find specific courses\n"
        "4. blackboard.course_resources.sync → update specific courses\n"
        "5. blackboard.calendar.refresh → sync calendar/schedule data"
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


BLACKBOARD_COURSE_RESOURCES_SYNC_PROMPT = ToolPrompt(
    tool_id="blackboard.course_resources.sync",
    description=(
        "Fetch and sync Blackboard resources (announcements, assignments, materials) "
        "for specific courses by course ID. More targeted than blackboard.snapshot.sync — "
        "use this when you only need data for particular courses."
    ),
    usage_guide=(
        "Use this tool when:\n"
        "- You have specific course IDs and only need data for those courses\n"
        "- You want to update resources for a subset of courses without a full sync\n"
        "- You found course IDs via blackboard.course_catalog.search and now want "
        "their content\n"
        "\n"
        "Do NOT use this tool when:\n"
        "- You need ALL course data — use blackboard.snapshot.sync instead\n"
        "- You don't have course IDs yet — use blackboard.course_catalog.search first"
    ),
    parameter_guide=(
        "courseIds (required): List of Blackboard course IDs to sync.\n"
        "username / password / usernameSecretName / passwordSecretName (optional): "
        "Credentials. Usually OMIT — auto-resolved.\n"
        "dbPath (optional): SQLite database path. Omit for default.\n"
        "recreateSchema (optional): Recreate tables before sync. Default: false.\n"
        "stateKey / artifactName (optional): Persist results."
    ),
    constraints=(
        "- Course IDs must be exact and valid\n"
        "- Find course IDs using blackboard.course_catalog.search\n"
        "- Data is stored in the same SQLite database as snapshot sync"
    ),
    relationships=(
        "Upstream: blackboard.course_catalog.search (to find course IDs)\n"
        "Downstream: blackboard.sql.query (to explore synced data)\n"
        "Alternative: blackboard.snapshot.sync (for bulk sync of all courses)"
    ),
    examples=(
        'Sync specific courses: {"courseIds": ["CS304_2025", "MATH101_2025"]}'
    ),
    annotations={
        "descriptionZh": (
            "按课程 ID 拉取指定课程的 Blackboard 资源（公告、作业、资料）。"
            "比 blackboard.snapshot.sync 更精确——仅同步需要的课程。"
            "课程 ID 可通过 blackboard.course_catalog.search 获取。"
        ),
    },
)


BLACKBOARD_CALENDAR_REFRESH_PROMPT = ToolPrompt(
    tool_id="blackboard.calendar.refresh",
    description=(
        "Refresh a Blackboard ICS calendar subscription into the local SQLite "
        "calendar store. Syncs course schedules, deadlines, and events from "
        "Blackboard calendar feeds."
    ),
    usage_guide=(
        "Use this tool when the user wants to:\n"
        "- Update their Blackboard calendar/schedule data\n"
        "- Check upcoming deadlines, class times, or events\n"
        "- Sync calendar data that isn't included in blackboard.snapshot.sync\n"
        "\n"
        "Use blackboard.snapshot.sync for assignments, announcements, and grades. "
        "This tool is for calendar data specifically."
    ),
    parameter_guide=(
        "icsUrl (required): The Blackboard ICS subscription URL.\n"
        "refreshMode (optional): 'auto' reuses saved ETag/Last-Modified headers; "
        "'force' always re-fetches. Default: 'auto'.\n"
        "dbPath (optional): SQLite path. Omit for default.\n"
        "recreateSchema (optional): Recreate tables. Default: false.\n"
        "stateKey (optional): Persist refresh status to host state store."
    ),
    constraints=(
        "- Requires a valid ICS subscription URL from Blackboard\n"
        "- Calendar data is separate from snapshot sync data\n"
        "- Use auto refresh mode to avoid unnecessary re-fetches"
    ),
    relationships=(
        "Complementary to blackboard.snapshot.sync — calendar data is not included "
        "in snapshot sync.\n"
        "After refresh, use blackboard.sql.query to query calendar records."
    ),
    examples=(
        'Refresh calendar: {"icsUrl": "https://blackboard.sustech.edu.cn/..."}'
    ),
    annotations={
        "descriptionZh": (
            "刷新 Blackboard ICS 日历订阅到本地 SQLite 存储。同步课程时间表、"
            "截止日期和事件。日历数据与 blackboard.snapshot.sync 互补——后者不包含"
            "日历信息。"
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
    BLACKBOARD_COURSE_CATALOG_SEARCH_PROMPT,
    BLACKBOARD_SNAPSHOT_SYNC_PROMPT,
    BLACKBOARD_COURSE_RESOURCES_SYNC_PROMPT,
    BLACKBOARD_CALENDAR_REFRESH_PROMPT,
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
| Specific course data | {resources} |
| Find course by name/keyword | {catalog} |
| Calendar / schedule | {calendar} |
| Explore synced data | {sql} |

### Workflow

1. **First time**: Run `{snapshot}` to pull all enrolled course data
2. **Search**: Use `{catalog}` to find specific courses by keyword
3. **Targeted sync**: Use `{resources}` to update specific courses
4. **Calendar**: Use `{calendar}` to sync schedule data
5. **Query**: Use `{sql}` to explore and analyze synced data

### Critical Rules

- `{sql}` is READ-ONLY and requires prior sync
- `{snapshot}` is the primary data sync tool — run it first
- `{resources}` is for targeted updates — use course IDs from `{catalog}`
""".format(
    snapshot=BLACKBOARD_SNAPSHOT_SYNC_PROMPT.tool_id,
    resources=BLACKBOARD_COURSE_RESOURCES_SYNC_PROMPT.tool_id,
    catalog=BLACKBOARD_COURSE_CATALOG_SEARCH_PROMPT.tool_id,
    calendar=BLACKBOARD_CALENDAR_REFRESH_PROMPT.tool_id,
    sql=BLACKBOARD_SQL_QUERY_PROMPT.tool_id,
)


__all__ = [
    "BLACKBOARD_CALENDAR_REFRESH_PROMPT",
    "BLACKBOARD_COURSE_CATALOG_SEARCH_PROMPT",
    "BLACKBOARD_COURSE_RESOURCES_SYNC_PROMPT",
    "BLACKBOARD_PROMPTS",
    "BLACKBOARD_SNAPSHOT_SYNC_PROMPT",
    "BLACKBOARD_SQL_QUERY_PROMPT",
    "BLACKBOARD_TOOL_PREFERENCE_GUIDE",
]
