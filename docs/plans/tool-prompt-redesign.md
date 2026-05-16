# 工具提示词模块化重构设计方案

## 一、重构目标

1. **解决核心问题**：Agent 频繁选错/用错工具，根本原因是每个工具只有1句英文描述，缺乏使用场景指导、参数语义说明、工具间关系导航
2. **建立模块化结构**：参考竞品 Claude Code 的 `src/tools/*/prompt.ts` 模式，为每个工具配备独立的提示词模块
3. **清除过时/占位资产**：移除不再使用的工具和占位代码

---

## 二、当前工具清单与状态

### 2.1 核心文件工具（后端已实现，提示词缺失）

| tool_id | 当前 description | 行数 | 状态 |
|---------|-----------------|------|------|
| `tool.fs.read` | "Read UTF-8 text files from the workspace with line-based pagination." | 1句 | 🔴 需重写 |
| `tool.fs.write` | "Create or overwrite UTF-8 text files in the workspace with guarded overwrite semantics." | 1句 | 🔴 需重写 |
| `tool.fs.edit` | "Edit UTF-8 text files in the workspace using exact replacement semantics." | 1句 | 🔴 需重写 |
| `tool.fs.glob` | "Discover workspace files and directories by glob pattern without reading contents." | 1句 | 🔴 需重写 |
| `tool.fs.grep` | "Search workspace text files by literal or regex pattern with bounded line context." | 1句 | 🔴 需重写 |
| `tool.fs.notebook_edit` | "Edit workspace notebooks with transactional cell operations." | 1句 | 🔴 需重写 |
| `tool.fs.switch_root` | "Validate and resolve a new default file root directory for later tool calls." | 1句 | 🔴 需重写 |

### 2.2 领域集成工具（后端已实现，提示词缺失）

| tool_id | 当前 description | 状态 |
|---------|-----------------|------|
| `blackboard.course_catalog.search` | "Search Blackboard course catalog entries..." | 🔴 需重写 |
| `blackboard.calendar.refresh` | "Refresh a Blackboard ICS subscription..." | 🔴 需重写 |
| `blackboard.snapshot.sync` | "Fetch a Blackboard base snapshot..." | 🔴 需重写 |
| `blackboard.course_resources.sync` | "Sync Blackboard resources for explicit course IDs..." | 🔴 需重写 |
| `blackboard.sql.query` | "Execute raw SQL directly against the local Blackboard SQLite..." | 🔴 需重写 |
| `tis.credit_gpa.fetch` | "Fetch credit and GPA summaries from TIS..." | 🔴 需重写 |
| `tis.personal_grades.fetch` | "Fetch personal grade records from TIS..." | 🔴 需重写 |
| `tis.selected_courses.fetch` | "Fetch selected course records from TIS..." | 🔴 需重写 |
| `tis.sql.query` | "Execute raw SQL directly against the local TIS SQLite..." | 🔴 需重写 |

### 2.3 前端工具目录（仅5条，且描述不完整）

```typescript
// frontend-copilot/electron/tool-catalog/test-support.ts
{ toolId: 'tool.fs.read',   displayName: '读取文件', description: '读取项目内文件内容，用于理解上下文与定位实现细节。' }
{ toolId: 'tool.fs.write',  displayName: '写入文件', description: '创建或覆盖文件内容，用于输出生成结果与落盘修改。' }
{ toolId: 'tool.fs.edit',   displayName: '编辑文件', description: '对现有文件执行精确编辑，适用于补丁式修改与小范围更新。' }
{ toolId: 'mcp--fetch--fetch',                  displayName: '联网抓取',     description: '抓取网页内容...' }
{ toolId: 'mcp--puppeteer--puppeteer_navigate', displayName: '浏览器自动化', description: '驱动浏览器执行界面级操作...' }
```

**问题**：缺少 glob/grep/switch_root/notebook_edit，缺所有 Blackboard/TIS 工具

### 2.4 应清除的过时/占位资产

| 文件 | 原因 |
|------|------|
| `backend/app/tools/file_convert.py` | 测试辅助工具，不作为正式 tool contract 暴露；功能已被 pdf_reader/notebook_reader/image_reader 覆盖 |
| `frontend-copilot/builtin-skills/builtin-placeholder-skill/` | 明确标注为 "内置占位 Skill"，实际无功能 |
| `backend/app/integrations/sustech/blackboard/provider/tools/agent_tools.py` | 注释明确标注 "Legacy compatibility exports only"，正式入口在 facade |
| `frontend-copilot/electron/tool-catalog/test-support.ts` | 随 `default-tool-catalog.ts` 重构后更新，当前硬编码5条过时 |

---

## 三、新文件结构设计

```
backend/app/tooling/prompts/          # 新增顶层目录
├── __init__.py                       # 公共API
├── _base.py                          # 基础抽象
├── _context.py                       # 动态上下文注入器
│
├── file_tools/                       # 核心文件工具提示词
│   ├── __init__.py                   # 注册表 + 工具间关系
│   ├── read.py
│   ├── write.py
│   ├── edit.py
│   ├── glob.py
│   ├── grep.py
│   ├── notebook_edit.py
│   └── switch_root.py
│
├── domain/                           # 领域集成工具提示词
│   ├── __init__.py
│   ├── blackboard/
│   │   ├── __init__.py
│   │   ├── course_catalog_search.py
│   │   ├── calendar_refresh.py
│   │   ├── snapshot_sync.py
│   │   ├── course_resources_sync.py
│   │   └── sql_query.py
│   └── tis/
│       ├── __init__.py
│       ├── credit_gpa_fetch.py
│       ├── personal_grades_fetch.py
│       ├── selected_courses_fetch.py
│       └── sql_query.py
│
└── system/                           # 系统级提示词组件
    ├── __init__.py
    ├── tool_selection_guide.py       # 全局工具选择导航（注入 system prompt）
    └── shared_conventions.py         # 跨工具共享约定
```

### 3.1 核心抽象 (`_base.py`)

```python
@dataclass(frozen=True, slots=True)
class ToolPrompt:
    """Structured tool prompt designed for LLM function-calling accuracy."""
    tool_id: str
    description: str           # 1-2句功能概述
    usage_guide: str           # 使用指南（何时用、何时不用、典型场景）
    parameter_guide: str       # 参数语义说明（超出 JSON Schema 的部分）
    constraints: str           # 前置条件、限制、防护规则
    relationships: str         # 与其他工具的关系（用X不用Y）
    examples: str              # JSON格式调用示例

    def render(self) -> str:
        """Render into the single description string sent to LLM."""
        ...

    def render_compact(self) -> str:
        """Render minimal version for tight context windows."""
        ...

    def render_full(self) -> str:
        """Render full tutorial-style prompt."""
        ...
```

### 3.2 公共API (`__init__.py`)

```python
def load_tool_prompts(*, context: PromptContext) -> dict[str, ToolPrompt]:
    """Load all registered tool prompts with dynamic context injection."""
    ...

def get_tool_prompt(tool_id: str, *, context: PromptContext) -> ToolPrompt | None:
    """Get a single tool's structured prompt."""
    ...

def get_system_tool_selection_guide(*, context: PromptContext) -> str:
    """Global tool selection guide for system prompt injection."""
    ...

def register_tool_prompt(prompt: ToolPrompt) -> None:
    """Register a tool prompt dynamically (for MCP tools)."""
    ...
```

### 3.3 动态上下文注入 (`_context.py`)

```python
@dataclass(frozen=True, slots=True)
class PromptContext:
    """Runtime context available for prompt rendering."""
    workspace_root: str
    max_read_lines: int = 2000
    default_timeout_ms: int = 600_000
    max_timeout_ms: int = 600_000
    available_tool_ids: tuple[str, ...] = ()
    database_path: str | None = None
    locale: str = "en"
```

---

## 四、各工具提示词设计纲要

### 4.1 核心文件工具

#### `tool.fs.read` (File Read)

```yaml
description: "Reads a file from the workspace. Supports UTF-8 text, images (PNG/JPG etc.), PDFs, and Jupyter notebooks (.ipynb)."
usage_guide: |
  Use this tool when you need to:
  - Inspect file contents before editing or writing
  - Understand existing code, configuration, or documentation
  - Read screenshots or images provided by the user
  Do NOT use this tool to:
  - List directory contents (use tool.fs.glob instead)
  - Search for patterns (use tool.fs.grep instead)
parameter_guide: |
  - path: Absolute path within the workspace. Required.
  - offset: 1-based line number to start reading from. Default: 1.
  - limit: Maximum lines to return. Default: 2000. Use for large files.
  - pages: For PDFs, specify page range as [start, end]. Required for PDFs over 10 pages.
  - parserHint: Optional hint for file type parsing.
constraints: |
  - Only reads files, not directories
  - Maximum 2000 lines per call; use offset for pagination
  - PDFs over 10 pages require the 'pages' parameter
relationships: |
  - Prefer this tool over directly reading files via shell commands (cat/head/tail)
  - Use tool.fs.glob to discover file paths first, then use this tool to read them
  - Use tool.fs.grep to search file contents, then use this tool to read specific files
examples: |
  Read a file: {"path": "src/main.py"}
  Read with offset: {"path": "src/main.py", "offset": 100, "limit": 50}
  Read PDF pages: {"path": "docs/report.pdf", "pages": [1, 5]}
```

#### `tool.fs.write` (File Write)

```yaml
description: "Creates a new file or completely overwrites an existing file in the workspace."
usage_guide: |
  Use this tool when:
  - Creating a new file from scratch
  - Rewriting an entire file (rarely needed)
  Do NOT use this tool when:
  - Modifying parts of an existing file (use tool.fs.edit instead)
  - The file already exists and you haven't read it yet
parameter_guide: |
  - path: Absolute path within the workspace. Required.
  - content: The complete file contents as a string. Required.
  - overwrite: Whether to overwrite existing file. Default: true.
  - expectedHash: Optional hash for optimistic concurrency control.
  - atomic: Use atomic write. Default: true.
constraints: |
  - CRITICAL: You MUST use tool.fs.read to read the file first if it already exists
  - Prefer tool.fs.edit for modifying existing files; this tool replaces the ENTIRE file
  - Never create .md documentation files unless explicitly requested
relationships: |
  - Prefer tool.fs.edit over this tool for partial modifications
  - Always use tool.fs.read first when modifying existing files
examples: |
  Create new file: {"path": "src/new_module.py", "content": "def hello():\\n    return 'world'\\n"}
```

#### `tool.fs.edit` (File Edit)

```yaml
description: "Performs exact string replacements in existing files. Only the changed parts are sent, not the entire file."
usage_guide: |
  Use this tool when:
  - Modifying existing files (adding/removing/changing code)
  - Renaming variables or strings across a file
  - Applying small, targeted changes
  Do NOT use this tool when:
  - Creating a brand new file (use tool.fs.write)
  - Replacing content that appears multiple times without using replaceAll
parameter_guide: |
  - path: Absolute path to the file. Required.
  - oldString: The exact text to replace. Must be unique in the file.
  - newString: The replacement text.
  - replaceAll: Set true to replace ALL occurrences (e.g., for variable renaming). Default: false.
  - expectedOccurrences: Optional expected match count for validation.
  - expectedHash: Optional file hash for concurrency control.
constraints: |
  - CRITICAL: You MUST use tool.fs.read first to read the file before editing
  - oldString must be EXACTLY unique in the file; otherwise the edit will FAIL
  - Use the smallest clearly-unique oldString (2-4 lines usually sufficient)
  - Preserve exact indentation (tabs/spaces) from the Read tool output
  - The line number prefix from Read output is NOT part of the file content
relationships: |
  - ALWAYS use tool.fs.read before this tool
  - Use this tool instead of tool.fs.write for partial modifications
  - Use replaceAll for variable/string renames across the file
examples: |
  Edit one occurrence: {"path": "src/main.py", "oldString": "def old_name():", "newString": "def new_name():"}
  Rename variable: {"path": "src/main.py", "oldString": "old_var", "newString": "new_var", "replaceAll": true}
```

#### `tool.fs.glob` (File Glob)

```yaml
description: "Finds files and directories by glob pattern matching. Returns paths sorted by modification time."
usage_guide: |
  Use this tool when you need to:
  - Discover what files exist in the project
  - Find files matching a name pattern (e.g., "*.py", "test_*.ts")
  - Explore project structure before reading files
  Do NOT use this tool when:
  - Searching file contents (use tool.fs.grep)
  - Reading file contents (use tool.fs.read)
  - You already know the exact file path
parameter_guide: |
  - pattern: Glob pattern (e.g., "**/*.py", "src/**/*.ts"). Required.
  - basePath: Starting directory for the search. Default: "." (workspace root).
  - includeHidden: Include hidden files (starting with .). Default: false.
  - maxResults: Maximum results to return. Default: 500.
constraints: |
  - This tool only returns file paths, not content
  - Use after exploring directory structure when you need multiple rounds of file discovery
relationships: |
  - Use this tool instead of shell 'find' or 'ls' for file discovery
  - After globbing, use tool.fs.read to read specific files
  - Use tool.fs.grep for content-based search
examples: |
  Find Python files: {"pattern": "**/*.py"}
  Find test files: {"pattern": "**/test_*.py", "basePath": "tests"}
```

#### `tool.fs.grep` (Content Search)

```yaml
description: "Searches file contents using literal text or regex patterns. Built on ripgrep for fast, accurate results."
usage_guide: |
  Use this tool when you need to:
  - Find where a function/class/variable is defined or used
  - Search for TODO comments, error messages, or specific patterns
  - Locate all instances of a pattern across the codebase
  Do NOT use this tool when:
  - Finding files by name (use tool.fs.glob)
  - Reading full file contents (use tool.fs.read)
parameter_guide: |
  - pattern: Search pattern (literal or regex based on isRegex). Required.
  - basePath: Starting directory. Default: "." (workspace root).
  - fileGlob: Filter files to search (e.g., "*.py", "**/*.ts"). Default: "**/*".
  - isRegex: Treat pattern as regex. Default: false (literal search).
  - caseSensitive: Case-sensitive search. Default: false.
  - contextLines: Number of surrounding lines to include. Default: 0.
  - maxResults: Maximum results. Default: 100.
constraints: |
  - Maximum 100 results per call; narrow your search if truncated
  - By default searches are case-insensitive and literal (not regex)
relationships: |
  - Use this tool instead of shell 'grep' or 'rg' for content search
  - After finding matches with grep, use tool.fs.read to read the specific files
examples: |
  Search for function: {"pattern": "def calculate_total", "fileGlob": "*.py"}
  Regex search: {"pattern": "function\\s+handle\\w+", "isRegex": true, "fileGlob": "*.ts"}
```

### 4.2 领域工具

#### Blackboard 工具

```yaml
blackboard.course_catalog.search:
  description: "Search Blackboard (南科大 Blackboard) course catalog entries by keyword."
  usage_guide: |
    Use this tool when the user wants to:
    - Find courses by name or keyword on Blackboard
    - Look up course IDs before fetching resources or assignments
    - Explore what courses are available in the catalog
    Do NOT use this tool to:
    - Get course content, assignments, or grades (use blackboard.snapshot.sync or blackboard.course_resources.sync)
    - Query raw data (use blackboard.sql.query)
  parameter_guide: |
    - keyword: Search term (e.g., "计算机", "CS304"). Required.
    - searchField: Catalog field to search against. Default: "CourseName".
    - searchScope: "quick" (first pages only) or "full" (deep crawl). Default: "full".
    - maxPages: Maximum result pages to fetch. Default: 30.
    - maxResults: Optional cap on returned results.
    - username/password: Usually omit; credentials auto-resolved from host.
  relationships: |
    - Use this tool first to discover course IDs, then use blackboard.course_resources.sync
    - Use blackboard.snapshot.sync for a complete data pull of all enrolled courses
    - Use blackboard.sql.query to inspect synced data

blackboard.snapshot.sync:
  description: "Fetch and sync all Blackboard course data (announcements, assignments, grades) into local SQLite."
  usage_guide: |
    Use this tool when the user:
    - First connects to Blackboard and needs to pull all course data
    - Wants to refresh all course data after new content is posted
    - Needs a complete local mirror for offline analysis
    Do NOT use when:
    - Only need specific courses (use blackboard.course_resources.sync)
    - Only need to look up course info (use blackboard.course_catalog.search)
  parameter_guide: |
    - username/password: Usually omit; auto-resolved.
    - dbPath: SQLite path. Omit for default.
    - recreateSchema: Drop and recreate tables. Default: false.
    - verify: Run verification pass after sync. Default: true.
    - maxConcurrency: Worker threads for parallel fetching. Default: 1.
    - stateKey/artifactName: Optional host state persistence.
  relationships: |
    - This is the PRIMARY data sync tool — run it first before any SQL queries
    - After sync, use blackboard.sql.query for custom data exploration
    - Use blackboard.calendar.refresh for calendar data specifically
  constraints: |
    - This operation can take 1-3 minutes depending on course count
    - Requires valid Blackboard credentials (auto-resolved from host)
    - Data is stored locally in SQLite for subsequent queries

blackboard.course_resources.sync:
  description: "Fetch and sync resources for specific Blackboard courses by course ID."
  usage_guide: |
    Use this tool when:
    - Only need data for specific courses (more targeted than snapshot.sync)
    - Have course IDs from course_catalog.search or previous syncs
    - Want to update resources for a subset of courses
  parameter_guide: |
    - courseIds: List of Blackboard course IDs. Required.
    - username/password: Usually omit; auto-resolved.
  relationships: |
    - Use blackboard.course_catalog.search to find course IDs first
    - Use blackboard.snapshot.sync for bulk sync of ALL courses
    - After sync, use blackboard.sql.query to analyze the data

blackboard.calendar.refresh:
  description: "Refresh a Blackboard ICS calendar subscription into local SQLite store."
  usage_guide: |
    Use when the user needs updated calendar/schedule data from Blackboard.
  relationships: |
    - Complementary to blackboard.snapshot.sync (which doesn't include calendar data)
    - After refresh, use blackboard.sql.query to query calendar records

blackboard.sql.query:
  description: "Execute raw SQL queries against the local Blackboard SQLite database."
  usage_guide: |
    Use when you need to:
    - Inspect synced Blackboard data with custom queries
    - Find specific records across tables
    - Aggregate or analyze stored data
    YOU MUST run blackboard.snapshot.sync or calendar.refresh FIRST to populate data.
  constraints: |
    - READ-ONLY access; SELECT queries only
    - Database must be populated by prior sync operations
```

#### TIS 工具

```yaml
tis.selected_courses.fetch:
  description: "Fetch selected course records from TIS (南科大教务系统) for the current or specified semester."
  usage_guide: |
    Use when the user wants to:
    - See their currently enrolled courses
    - Check course schedules, instructors, and credits
    - Get course data before querying grades
  parameter_guide: |
    - semester: "current" (default), or specific like "2024-2025-1"
    - persist: Sync to local SQLite. Default: depends on context.
    - username/password: Usually omit; auto-resolved.

tis.personal_grades.fetch:
  description: "Fetch personal grade records from TIS."
  usage_guide: |
    Use when the user wants to check their grades for courses.
  relationships: |
    - Use tis.selected_courses.fetch first for course context
    - Use tis.credit_gpa.fetch for GPA summary

tis.credit_gpa.fetch:
  description: "Fetch credit and GPA summary from TIS."
  usage_guide: |
    Use when the user asks about their GPA, total credits, or academic standing.
  relationships: |
    - Use tis.selected_courses.fetch and tis.personal_grades.fetch for detailed data

tis.sql.query:
  description: "Execute raw SQL queries against the local TIS SQLite database."
  usage_guide: |
    Use to inspect synced TIS data with custom queries.
    MUST run relevant fetch tools first to populate data.
```

### 4.3 系统级工具选择导航

```yaml
tool_selection_guide:
  description: "Injected into the system prompt to help Agent navigate tool choices."
  content: |
    # Tool Selection Guide
    
    ## File Operations
    - File name search: Use tool.fs.glob (NOT shell find/ls)
    - Content search: Use tool.fs.grep (NOT shell grep/rg)
    - Read files: Use tool.fs.read (NOT shell cat/head/tail)
    - Edit files: Use tool.fs.edit (NOT shell sed/awk)
    - Write files: Use tool.fs.write (NOT shell echo/cat<<EOF)
    
    ## Workflow
    1. Use tool.fs.glob to discover file structure
    2. Use tool.fs.grep to find relevant content
    3. Use tool.fs.read to inspect files
    4. Use tool.fs.edit to modify (NOT tool.fs.write for partial changes)
    
    ## Blackboard Data
    1. Use blackboard.snapshot.sync for initial full data pull
    2. Use blackboard.course_catalog.search to find course IDs
    3. Use blackboard.course_resources.sync for targeted course sync
    4. Use blackboard.sql.query for custom data exploration
    5. Use blackboard.calendar.refresh for schedule data
    
    ## TIS Data  
    1. Use tis.selected_courses.fetch for course enrollment
    2. Use tis.personal_grades.fetch for grade records
    3. Use tis.credit_gpa.fetch for GPA summary
    4. Use tis.sql.query for custom data exploration
    
    ## Critical Rules
    - ALWAYS read a file (tool.fs.read) before editing it (tool.fs.edit)
    - For partial modifications, use tool.fs.edit, NOT tool.fs.write
    - Blackboard/TIS SQL tools can ONLY query — run sync tools first
```

---

## 五、需要清除的过时/占位资产

### 5.1 立即清除

| # | 文件 | 操作 | 原因 |
|---|------|------|------|
| 1 | `frontend-copilot/builtin-skills/builtin-placeholder-skill/` | 删除整个目录 | 明确标注 "内置占位 Skill"，无实际功能 |
| 2 | `backend/app/integrations/sustech/blackboard/provider/tools/agent_tools.py` | 删除 | 注释标记 "Legacy compatibility exports only"；正式面在 facade |
| 3 | `backend/app/integrations/sustech/blackboard/provider/tools/__init__.py` | 清理对 agent_tools 的引用 | 随上条联动 |

### 5.2 重构（保留功能，修改位置）

| # | 文件 | 操作 | 原因 |
|---|------|------|------|
| 4 | `backend/app/tools/file_convert.py` | 移动功能到 `app/tooling/file_tools/` 下，原位置删除 | 测试用工具函数，不属于正式 tools 目录 |
| 5 | `frontend-copilot/electron/tool-catalog/default-tool-catalog.ts` | 重写，包含所有工具及 prompt 字段 | 当前仅5条硬编码数据 |
| 6 | `frontend-copilot/electron/tool-catalog/test-support.ts` | 同步更新 fixture | 随 default-tool-catalog 重构 |

### 5.3 数据流水线确认

以下文件依赖上述被删除/移动的文件，需要在重构时同步更新：

| 文件 | 依赖项 | 操作 |
|------|--------|------|
| `backend/tests/unit/tools/test_convert_file.py` | `app.tools.file_convert` | 更新 import 路径 |
| `backend/app/integrations/sustech/blackboard/__init__.py` | `provider/tools` legacy | 确认仅从 facade 导出 |
| `backend/app/integrations/sustech/blackboard/facade/__init__.py` | 内部引用 | 确认无变动 |

---

## 六、实施路线图

```
Phase 1: 基础设施 (P0)
├── 创建 backend/app/tooling/prompts/ 目录结构
├── 实现 _base.py (ToolPrompt, render/compact/full)
├── 实现 _context.py (PromptContext)
├── 实现 __init__.py (公共API)
├── 在 ToolMetadata 中增加 detailed_prompt 字段 (或在 annotations 中承载)
└── 更新 RuntimeExecutableToolBinding 以携带提示词

Phase 2: 核心文件工具提示词 (P0)
├── file_tools/read.py
├── file_tools/write.py
├── file_tools/edit.py
├── file_tools/glob.py
├── file_tools/grep.py
├── file_tools/__init__.py (包含工具间关系矩阵)
└── 更新 runtime_bindings.py 中的 ToolMetadata 引用新提示词

Phase 3: 系统级提示词 (P1)
├── system/tool_selection_guide.py
├── system/shared_conventions.py
└── 关注入点：在 agent system prompt 中注入 tool_selection_guide

Phase 4: 领域工具提示词 (P1)
├── domain/blackboard/*.py (5个工具)
├── domain/tis/*.py (4个工具)
└── 更新 facade 中的 ToolMetadata 引用

Phase 5: 前端对齐与清理 (P1)
├── 更新 default-tool-catalog.ts (包含全部工具 + prompt 字段)
├── 更新 test-support.ts fixture
├── 删除 builtin-placeholder-skill/
├── 清理 legacy provider/tools/
└── 移动 file_convert.py 到 file_tools/

Phase 6: 验证 (P2)
├── 运行现有测试套件确认无回归
├── 手动验证 Agent 工具调用准确率
└── 更新相关文档
```

---

## 七、关键设计决策

1. **提示词存储位置**：存储在 backend 的 `app/tooling/prompts/` 下，作为 tooling 层的一部分。前端通过 `tool-catalog` 的 `prompt` 字段获取并转发给 LLM。

2. **与现有 ToolMetadata 的关系**：保持 `ToolMetadata.description` 为简短版本（用于 UI 展示），新增 `detailed_prompt` 字段承载完整提示词（用于 LLM）。两者并行，由 adapter 层按需选择。

3. **语言策略**：核心提示词使用英文（与 LLM 工具调用原始语境一致），在 `annotations` 中提供 `descriptionZh` 中文版本用于前端展示。

4. **动态上下文**：`PromptContext` 在运行时由 adapter 填充（workspace_root、超时配置等），渲染时注入到提示词中。

5. **MCP 工具**：MCP 工具提示词优先使用 MCP server 自身提供的 description；如需增强，通过 `register_tool_prompt()` 注册覆盖。
