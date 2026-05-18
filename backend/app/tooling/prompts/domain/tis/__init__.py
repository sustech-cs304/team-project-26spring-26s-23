"""Prompts for TIS (Teaching Information System) integration tools.

Each tool prompt provides the LLM with comprehensive usage context:
when to use, parameter semantics, tool relationships, and constraints.
"""

from __future__ import annotations

from app.tooling.prompts._base import ToolPrompt


TIS_SELECTED_COURSES_FETCH_PROMPT = ToolPrompt(
    tool_id="tis.selected_courses.fetch",
    description=(
        "Fetch selected course records from TIS (南科大教务系统 / Teaching "
        "Information System) for the current or a specified semester. Returns "
        "course names, schedules, instructors, credits, and enrollment details."
    ),
    usage_guide=(
        "Use this tool when the user wants to:\n"
        "- See their currently enrolled courses for this semester\n"
        "- Check course schedules, instructors, and credit information\n"
        "- Get course context before querying grades or GPA\n"
        "- Look up course details for a specific semester\n"
        "\n"
        "Do NOT use this tool when:\n"
        "- Checking grades — use tis.personal_grades.fetch\n"
        "- Checking GPA — use tis.credit_gpa.fetch\n"
        "- Exploring synced data with custom queries — use tis.sql.query\n"
        "\n"
        "Typical workflow:\n"
        "1. Use this tool to get course enrollment\n"
        "2. Use tis.personal_grades.fetch for grades\n"
        "3. Use tis.credit_gpa.fetch for GPA summary"
    ),
    parameter_guide=(
        "username / password / usernameSecretName / passwordSecretName (optional): "
        "TIS/CAS credentials. Usually OMIT — auto-resolved from host secret store.\n"
        "semester (optional): Target semester. Accepts: empty (current), 'current', "
        "'当前学期', '2024-2025-1', or '2024-20251'. Default: current semester.\n"
        "roleCode (optional): TIS RoleCode header. Omit to auto-detect.\n"
        "page / pageSize (optional): Pagination params. Default: page=1, pageSize=19.\n"
        "persist (optional): Sync to local SQLite. Default: true when host database available.\n"
        "ownerKey (optional): Logical owner for persisted records.\n"
        "dbPath (optional): SQLite path. Omit for default TIS database.\n"
        "recreateSchema (optional): Recreate tables before sync.\n"
        "stateKey / artifactName (optional): Persist to host state/artifact store."
    ),
    constraints=(
        "- Requires valid TIS/CAS credentials (auto-resolved from host)\n"
        "- API pagination is 19 items per page by default\n"
        "- Semester format: 'YYYY-YYYY-X' where X is 1 or 2\n"
        "- persisted data is stored in local SQLite for subsequent SQL queries"
    ),
    relationships=(
        "Entry point for TIS data:\n"
        "- Use this tool FIRST to establish course context\n"
        "- Then use tis.personal_grades.fetch for detailed grades\n"
        "- Then use tis.credit_gpa.fetch for GPA summary\n"
        "- Use tis.sql.query to explore persisted data"
    ),
    examples=(
        "Fetch current semester courses:\n"
        '  {}\n'
        "\n"
        "Fetch specific semester:\n"
        '  {"semester": "2024-2025-1"}\n'
        "\n"
        "Fetch and persist:\n"
        '  {"persist": true}'
    ),
    annotations={
        "descriptionZh": (
            "从TIS（南科大教务系统）获取当前或指定学期的选课记录。返回课程名称、"
            "时间安排、教师、学分等信息。这是 TIS 数据的入口工具——先获取课程列表，"
            "再使用 tis.personal_grades.fetch 和 tis.credit_gpa.fetch 获取成绩信息。"
        ),
    },
)


TIS_PERSONAL_GRADES_FETCH_PROMPT = ToolPrompt(
    tool_id="tis.personal_grades.fetch",
    description=(
        "Fetch personal grade records from TIS (南科大教务系统). Returns detailed "
        "grades for each course including scores, grade points, and course metadata."
    ),
    usage_guide=(
        "Use this tool when the user wants to:\n"
        "- Check their grades for specific courses or all courses\n"
        "- See detailed score breakdowns\n"
        "- View historical grade records\n"
        "\n"
        "Use tis.credit_gpa.fetch for GPA/credit summaries.\n"
        "Use tis.selected_courses.fetch first for course context."
    ),
    parameter_guide=(
        "username / password / usernameSecretName / passwordSecretName (optional): "
        "Credentials. Usually OMIT.\n"
        "roleCode (optional): TIS RoleCode. Omit to auto-detect.\n"
        "persist / ownerKey / dbPath / recreateSchema (optional): Persistence options.\n"
        "stateKey / artifactName (optional): Host state/artifact persistence."
    ),
    constraints=(
        "- Requires valid TIS/CAS credentials\n"
        "- Grade data is stored in local SQLite when persisted"
    ),
    relationships=(
        "Use after tis.selected_courses.fetch for course context.\n"
        "Complementary to tis.credit_gpa.fetch which provides summary statistics."
    ),
    examples=(
        "Fetch all grades:\n"
        '  {}\n'
        "\n"
        "Fetch and persist:\n"
        '  {"persist": true}'
    ),
    annotations={
        "descriptionZh": (
            "从TIS（南科大教务系统）获取个人成绩记录。返回每门课程的详细成绩、"
            "分数和学分绩点。建议先使用 tis.selected_courses.fetch 获取课程上下文，"
            "再使用此工具获取成绩详情。"
        ),
    },
)


TIS_CREDIT_GPA_FETCH_PROMPT = ToolPrompt(
    tool_id="tis.credit_gpa.fetch",
    description=(
        "Fetch credit and GPA summary from TIS (南科大教务系统). Returns total "
        "credits earned, GPA scores, and academic standing summaries."
    ),
    usage_guide=(
        "Use this tool when the user wants to:\n"
        "- Check their overall GPA\n"
        "- See total credits earned\n"
        "- View academic standing summaries\n"
        "\n"
        "Use tis.personal_grades.fetch for detailed per-course grades.\n"
        "Use tis.selected_courses.fetch for course enrollment details."
    ),
    parameter_guide=(
        "username / password / usernameSecretName / passwordSecretName (optional): "
        "Credentials. Usually OMIT.\n"
        "roleCode (optional): TIS RoleCode. Omit to auto-detect.\n"
        "persist / ownerKey / dbPath / recreateSchema (optional): Persistence options.\n"
        "stateKey / artifactName (optional): Host state/artifact persistence."
    ),
    constraints=(
        "- Requires valid TIS/CAS credentials\n"
        "- GPA data is a summary — use tis.personal_grades.fetch for per-course details"
    ),
    relationships=(
        "Summary tool — complements tis.personal_grades.fetch.\n"
        "Use after tis.selected_courses.fetch for full academic context."
    ),
    examples=(
        "Fetch GPA summary:\n"
        '  {}'
    ),
    annotations={
        "descriptionZh": (
            "从TIS（南科大教务系统）获取学分和GPA概览。返回总学分、GPA和学术状态摘要。"
            "配合 tis.personal_grades.fetch 使用可获取完整的成绩画像。"
        ),
    },
)


TIS_SQL_QUERY_PROMPT = ToolPrompt(
    tool_id="tis.sql.query",
    description=(
        "Execute read-only SQL queries against the local TIS SQLite database. "
        "Use this to explore synced TIS data after running fetch tools."
    ),
    usage_guide=(
        "Use this tool when you need to:\n"
        "- Find specific records across TIS tables (courses, grades, GPA)\n"
        "- Aggregate or analyze synced TIS data with custom queries\n"
        "- Answer user questions requiring cross-referencing multiple data points\n"
        "\n"
        "CRITICAL: You MUST run tis.selected_courses.fetch, tis.personal_grades.fetch, "
        "or tis.credit_gpa.fetch FIRST to populate the database. This tool only "
        "queries — it does not fetch data from TIS."
    ),
    parameter_guide=(
        "sql (required): The SQL SELECT query to execute. Only SELECT statements "
        "are allowed.\n"
        "dbPath (optional): SQLite database path. Omit for default TIS database.\n"
        "maxRows (optional): Maximum rows in inline preview before truncation. "
        "Default: 50.\n"
        "saveFullResult (optional): Save full result as JSON artifact when truncated."
    ),
    constraints=(
        "- READ-ONLY — only SELECT queries are permitted\n"
        "- Database must be populated by prior fetch operations\n"
        "- SQLite dialect — use SQLite-compatible SQL\n"
        "- Results truncated at maxRows; use saveFullResult for large results"
    ),
    relationships=(
        "Upstream (REQUIRED): tis.selected_courses.fetch, tis.personal_grades.fetch, "
        "or tis.credit_gpa.fetch\n"
        "This tool depends entirely on data populated by fetch operations.\n"
        "Do NOT call this tool before running at least one fetch."
    ),
    examples=(
        "List all courses:\n"
        '  {"sql": "SELECT DISTINCT course_name, semester FROM courses"}\n'
        "\n"
        "Calculate average grade:\n"
        '  {"sql": "SELECT course_name, AVG(score) as avg_score FROM grades GROUP BY course_name"}\n'
        "\n"
        "Find courses with grades above 90:\n"
        '  {"sql": "SELECT course_name, score FROM grades WHERE score > 90 ORDER BY score DESC"}'
    ),
    annotations={
        "descriptionZh": (
            "对本地 TIS SQLite 数据库执行只读 SQL 查询。必须先运行 TIS 数据获取工具"
            "（如 tis.selected_courses.fetch）填充数据后才能使用。仅支持 SELECT 查询。"
        ),
    },
)


TIS_PROMPTS: tuple = (
    TIS_SELECTED_COURSES_FETCH_PROMPT,
    TIS_PERSONAL_GRADES_FETCH_PROMPT,
    TIS_CREDIT_GPA_FETCH_PROMPT,
    TIS_SQL_QUERY_PROMPT,
)


# ---------------------------------------------------------------------------
# TIS tool workflow guidance (for system prompt injection)
# ---------------------------------------------------------------------------

TIS_TOOL_PREFERENCE_GUIDE = """\
## TIS (教务系统) Data Tools

TIS tools access 南科大 Teaching Information System. All data flows through
local SQLite — fetch first, then query.

### Tool Selection

| Task | Use This Tool |
|------|--------------|
| Course enrollment | {courses} |
| Grade records | {grades} |
| GPA / credits summary | {gpa} |
| Explore synced data | {sql} |

### Workflow

1. **Courses first**: Run `{courses}` to get current enrollment
2. **Grades**: Use `{grades}` for per-course grade details
3. **GPA**: Use `{gpa}` for overall academic summary
4. **Query**: Use `{sql}` to explore all persisted data

### Critical Rules

- `{sql}` is READ-ONLY and requires prior fetch
- Fetch tools auto-resolve credentials from host — omit username/password
- Persisted data is shared across fetch tools in the same SQLite database
""".format(
    courses=TIS_SELECTED_COURSES_FETCH_PROMPT.tool_id,
    grades=TIS_PERSONAL_GRADES_FETCH_PROMPT.tool_id,
    gpa=TIS_CREDIT_GPA_FETCH_PROMPT.tool_id,
    sql=TIS_SQL_QUERY_PROMPT.tool_id,
)


__all__ = [
    "TIS_CREDIT_GPA_FETCH_PROMPT",
    "TIS_PERSONAL_GRADES_FETCH_PROMPT",
    "TIS_PROMPTS",
    "TIS_SELECTED_COURSES_FETCH_PROMPT",
    "TIS_SQL_QUERY_PROMPT",
    "TIS_TOOL_PREFERENCE_GUIDE",
]
