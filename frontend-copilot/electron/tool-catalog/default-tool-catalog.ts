import type { RuntimeToolDirectoryEntry } from '../../src/features/copilot/chat-contract'

export const DEFAULT_RUNTIME_TOOL_CATALOG: RuntimeToolDirectoryEntry[] =
  createDefaultToolCatalog()

export function cloneRuntimeToolCatalog(): RuntimeToolDirectoryEntry[] {
  return createDefaultToolCatalog()
}

function createDefaultToolCatalog(): RuntimeToolDirectoryEntry[] {
  return [
    // ---- Core File Tools ----
    {
      toolId: 'tool.fs.read',
      kind: 'builtin',
      availability: 'available',
      displayName: '读取文件',
      displayNameZh: '读取文件',
      displayNameEn: 'Read File',
      description: '读取项目内文件内容，用于理解上下文与定位实现细节。',
      descriptionZh: (
        '读取工作区内的文件内容。支持 UTF-8 文本、常见图片格式(PNG/JPG等)、' +
        'PDF 文档和 Jupyter 笔记本(.ipynb)。默认最多读取 2000 行，大文件请使用 ' +
        'offset/limit 参数分页读取。PDF 超过 10 页时必须指定 pages 参数。'
      ),
      descriptionEn: (
        'Reads a file from the workspace. Supports UTF-8 text, images (PNG, JPG, ' +
        'GIF, WebP), PDF documents, and Jupyter notebooks (.ipynb). You can access ' +
        'any workspace file directly by using this tool.'
      ),
      group: {
        id: 'builtin',
        label: '内建工具',
        labelZh: '内建工具',
        labelEn: 'Built-in Tools',
        order: 1,
        sourceKind: 'builtin',
      },
    },
    {
      toolId: 'tool.fs.write',
      kind: 'builtin',
      availability: 'available',
      displayName: '写入文件',
      displayNameZh: '写入文件',
      displayNameEn: 'Write File',
      description: '创建新文件或完全覆盖已有文件内容，用于输出生成结果与落盘修改。',
      descriptionZh: (
        '创建新文件或完整覆盖已有文件。仅用于创建全新文件或完全替换文件内容；' +
        '对已有文件的部分修改请使用 tool.fs.edit。覆盖已有文件前必须先使用 ' +
        'tool.fs.read 读取文件内容。'
      ),
      descriptionEn: (
        'Creates a new file or completely overwrites an existing file in the ' +
        'workspace. For partial modifications to existing files, prefer tool.fs.edit.'
      ),
      group: {
        id: 'builtin',
        label: '内建工具',
        labelZh: '内建工具',
        labelEn: 'Built-in Tools',
        order: 1,
        sourceKind: 'builtin',
      },
    },
    {
      toolId: 'tool.fs.edit',
      kind: 'builtin',
      availability: 'available',
      displayName: '编辑文件',
      displayNameZh: '编辑文件',
      displayNameEn: 'Edit File',
      description: '对已有文件执行精确编辑，适用于补丁式修改与小范围更新。',
      descriptionZh: (
        '对已有文件执行精确的字符串替换编辑。仅传输变更部分而非整个文件，' +
        '是修改已有文件的首选工具。oldString 必须在文件中唯一（除非使用 ' +
        'replaceAll），建议使用 2-4 行即可唯一定位目标。编辑前必须先使用 ' +
        'tool.fs.read 读取文件。'
      ),
      descriptionEn: (
        'Performs exact string replacements in an existing file. Only the changed ' +
        'parts are sent — not the entire file. This is the preferred tool for ' +
        'modifying existing files.'
      ),
      group: {
        id: 'builtin',
        label: '内建工具',
        labelZh: '内建工具',
        labelEn: 'Built-in Tools',
        order: 1,
        sourceKind: 'builtin',
      },
    },
    {
      toolId: 'tool.fs.glob',
      kind: 'builtin',
      availability: 'available',
      displayName: '文件搜索',
      displayNameZh: '文件搜索',
      displayNameEn: 'File Glob',
      description: '通过 glob 模式搜索工作区文件，用于快速发现与定位文件结构。',
      descriptionZh: (
        '通过 glob 模式在工作区中查找匹配的文件和目录。返回按修改时间排序的文件路径列表。' +
        '用于发现项目结构和定位特定类型的文件。不返回文件内容——找到文件后请使用 ' +
        'tool.fs.read 读取。'
      ),
      descriptionEn: (
        'Finds files and directories in the workspace by glob pattern matching. ' +
        'Returns matching file paths sorted by modification time. Works with any codebase size.'
      ),
      group: {
        id: 'builtin',
        label: '内建工具',
        labelZh: '内建工具',
        labelEn: 'Built-in Tools',
        order: 1,
        sourceKind: 'builtin',
      },
    },
    {
      toolId: 'tool.fs.grep',
      kind: 'builtin',
      availability: 'available',
      displayName: '内容检索',
      displayNameZh: '内容检索',
      displayNameEn: 'Content Search',
      description: '基于 ripgrep 在工作区文件中搜索文本内容，支持字面量和正则。',
      descriptionZh: (
        '基于 ripgrep 在工作区文件中搜索文本内容。支持字面量和正则表达式搜索，' +
        '可通过 fileGlob 过滤文件范围。默认大小写不敏感、字面量匹配。' +
        '找到匹配后使用 tool.fs.read 读取完整文件。'
      ),
      descriptionEn: (
        'Searches file contents across the workspace using literal text or regex ' +
        'patterns. Built on ripgrep for fast, accurate results. Supports full regex ' +
        'syntax, file filtering, and multiple output modes.'
      ),
      group: {
        id: 'builtin',
        label: '内建工具',
        labelZh: '内建工具',
        labelEn: 'Built-in Tools',
        order: 1,
        sourceKind: 'builtin',
      },
    },
    {
      toolId: 'tool.fs.notebook_edit',
      kind: 'builtin',
      availability: 'available',
      displayName: '笔记本编辑',
      displayNameZh: '笔记本编辑',
      displayNameEn: 'Notebook Edit',
      description: '对 Jupyter 笔记本文件进行事务性单元格编辑。',
      descriptionZh: (
        '以事务方式编辑 Jupyter 笔记本(.ipynb)的单元格。支持替换、插入和删除操作。' +
        '所有操作在同一调用中原子执行。操作前需先使用 tool.fs.read 读取笔记本以获取 cellId。'
      ),
      descriptionEn: (
        'Edits Jupyter notebook (.ipynb) files with transactional cell operations. ' +
        'Supports replacing, inserting, and deleting cells using cell IDs.'
      ),
      group: {
        id: 'builtin',
        label: '内建工具',
        labelZh: '内建工具',
        labelEn: 'Built-in Tools',
        order: 1,
        sourceKind: 'builtin',
      },
    },
    {
      toolId: 'tool.fs.switch_root',
      kind: 'builtin',
      availability: 'available',
      displayName: '切换根目录',
      displayNameZh: '切换根目录',
      displayNameEn: 'Switch Root',
      description: '切换后续文件工具操作的默认根目录。',
      descriptionZh: (
        '切换后续文件工具操作的默认根目录。切换后，read/write/edit/glob/grep 等工具' +
        '将以新根目录为基准解析相对路径。目标路径必须存在且为目录。'
      ),
      descriptionEn: (
        'Validates and switches the default root directory for subsequent file tool ' +
        'operations. All relative paths in later tool calls will be resolved against the new root.'
      ),
      group: {
        id: 'builtin',
        label: '内建工具',
        labelZh: '内建工具',
        labelEn: 'Built-in Tools',
        order: 1,
        sourceKind: 'builtin',
      },
    },
    // ---- Blackboard Tools ----
    {
      toolId: 'blackboard.course_catalog.search',
      kind: 'builtin',
      availability: 'available',
      displayName: '课程目录搜索',
      displayNameZh: '课程目录搜索',
      displayNameEn: 'Course Catalog Search',
      description: '按关键词搜索 Blackboard 课程目录。',
      descriptionZh: (
        '按关键词搜索 Blackboard 课程目录。返回匹配课程的名称、ID、教师和描述。' +
        '这是发现 Blackboard 上可用课程的入口工具。搜索到课程 ID 后，使用 ' +
        'blackboard.course_resources.sync 拉取具体课程数据。'
      ),
      descriptionEn: (
        'Search the Blackboard course catalog by keyword. Returns matching courses ' +
        'with course IDs, names, instructors, and descriptions.'
      ),
      group: {
        id: 'sustech-blackboard',
        label: 'Blackboard',
        labelZh: 'Blackboard',
        labelEn: 'Blackboard',
        order: 10,
        sourceKind: 'sustech-blackboard',
      },
    },
    {
      toolId: 'blackboard.snapshot.sync',
      kind: 'builtin',
      availability: 'available',
      displayName: '数据全量同步',
      displayNameZh: '数据全量同步',
      displayNameEn: 'Snapshot Sync',
      description: '从 Blackboard 拉取所有已选课程数据并同步到本地数据库。',
      descriptionZh: (
        '从 Blackboard 拉取所有已选课程数据（公告、作业、成绩）并同步到本地 SQLite ' +
        '数据库。这是主要的 Blackboard 数据同步工具——在执行任何 blackboard.sql.query ' +
        '查询之前必须先运行此工具。同步可能需要 1-3 分钟。'
      ),
      descriptionEn: (
        'Fetch and sync all Blackboard course data (announcements, assignments, grades) ' +
        'into a local SQLite database. This is the primary data sync tool.'
      ),
      group: {
        id: 'sustech-blackboard',
        label: 'Blackboard',
        labelZh: 'Blackboard',
        labelEn: 'Blackboard',
        order: 10,
        sourceKind: 'sustech-blackboard',
      },
    },
    {
      toolId: 'blackboard.course_resources.sync',
      kind: 'builtin',
      availability: 'available',
      displayName: '课程资源同步',
      displayNameZh: '课程资源同步',
      displayNameEn: 'Course Resources Sync',
      description: '按课程 ID 拉取指定课程的 Blackboard 资源。',
      descriptionZh: (
        '按课程 ID 拉取指定课程的 Blackboard 资源（公告、作业、资料）。' +
        '比 blackboard.snapshot.sync 更精确——仅同步需要的课程。' +
        '课程 ID 可通过 blackboard.course_catalog.search 获取。'
      ),
      descriptionEn: (
        'Fetch and sync Blackboard resources for specific courses by course ID. ' +
        'More targeted than blackboard.snapshot.sync.'
      ),
      group: {
        id: 'sustech-blackboard',
        label: 'Blackboard',
        labelZh: 'Blackboard',
        labelEn: 'Blackboard',
        order: 10,
        sourceKind: 'sustech-blackboard',
      },
    },
    {
      toolId: 'blackboard.calendar.refresh',
      kind: 'builtin',
      availability: 'available',
      displayName: '日历刷新',
      displayNameZh: '日历刷新',
      displayNameEn: 'Calendar Refresh',
      description: '刷新 Blackboard ICS 日历订阅到本地数据库。',
      descriptionZh: (
        '刷新 Blackboard ICS 日历订阅到本地 SQLite 存储。同步课程时间表、' +
        '截止日期和事件。日历数据与 blackboard.snapshot.sync 互补。'
      ),
      descriptionEn: (
        'Refresh a Blackboard ICS calendar subscription into the local SQLite calendar store.'
      ),
      group: {
        id: 'sustech-blackboard',
        label: 'Blackboard',
        labelZh: 'Blackboard',
        labelEn: 'Blackboard',
        order: 10,
        sourceKind: 'sustech-blackboard',
      },
    },
    {
      toolId: 'blackboard.sql.query',
      kind: 'builtin',
      availability: 'available',
      displayName: 'SQL 查询',
      displayNameZh: 'SQL 查询',
      displayNameEn: 'SQL Query',
      description: '对本地 Blackboard SQLite 数据库执行只读 SQL 查询。',
      descriptionZh: (
        '对本地 Blackboard SQLite 数据库执行只读 SQL 查询。必须先运行同步工具' +
        '（如 blackboard.snapshot.sync）填充数据后才能使用。仅支持 SELECT 查询。'
      ),
      descriptionEn: (
        'Execute read-only SQL queries against the local Blackboard SQLite database. ' +
        'Requires prior data sync.'
      ),
      group: {
        id: 'sustech-blackboard',
        label: 'Blackboard',
        labelZh: 'Blackboard',
        labelEn: 'Blackboard',
        order: 10,
        sourceKind: 'sustech-blackboard',
      },
    },
    // ---- TIS Tools ----
    {
      toolId: 'tis.selected_courses.fetch',
      kind: 'builtin',
      availability: 'available',
      displayName: '选课记录',
      displayNameZh: '选课记录',
      displayNameEn: 'Selected Courses',
      description: '从 TIS 获取当前或指定学期的选课记录。',
      descriptionZh: (
        '从TIS（南科大教务系统）获取当前或指定学期的选课记录。返回课程名称、' +
        '时间安排、教师、学分等信息。这是 TIS 数据的入口工具。'
      ),
      descriptionEn: (
        'Fetch selected course records from TIS for the current or a specified semester.'
      ),
      group: {
        id: 'sustech-tis',
        label: '教务系统',
        labelZh: '教务系统',
        labelEn: 'TIS',
        order: 20,
        sourceKind: 'sustech-tis',
      },
    },
    {
      toolId: 'tis.personal_grades.fetch',
      kind: 'builtin',
      availability: 'available',
      displayName: '成绩查询',
      displayNameZh: '成绩查询',
      displayNameEn: 'Personal Grades',
      description: '从 TIS 获取个人成绩记录。',
      descriptionZh: (
        '从TIS（南科大教务系统）获取个人成绩记录。返回每门课程的详细成绩、' +
        '分数和学分绩点。建议先使用 tis.selected_courses.fetch 获取课程上下文。'
      ),
      descriptionEn: (
        'Fetch personal grade records from TIS. Returns detailed grades for each course.'
      ),
      group: {
        id: 'sustech-tis',
        label: '教务系统',
        labelZh: '教务系统',
        labelEn: 'TIS',
        order: 20,
        sourceKind: 'sustech-tis',
      },
    },
    {
      toolId: 'tis.credit_gpa.fetch',
      kind: 'builtin',
      availability: 'available',
      displayName: '学分绩点',
      displayNameZh: '学分绩点',
      displayNameEn: 'Credit GPA',
      description: '从 TIS 获取学分和 GPA 概览。',
      descriptionZh: (
        '从TIS（南科大教务系统）获取学分和GPA概览。返回总学分、GPA和学术状态摘要。' +
        '配合 tis.personal_grades.fetch 使用可获取完整的成绩画像。'
      ),
      descriptionEn: (
        'Fetch credit and GPA summary from TIS. Returns total credits earned, GPA scores, ' +
        'and academic standing summaries.'
      ),
      group: {
        id: 'sustech-tis',
        label: '教务系统',
        labelZh: '教务系统',
        labelEn: 'TIS',
        order: 20,
        sourceKind: 'sustech-tis',
      },
    },
    {
      toolId: 'tis.sql.query',
      kind: 'builtin',
      availability: 'available',
      displayName: 'SQL 查询',
      displayNameZh: 'SQL 查询',
      displayNameEn: 'SQL Query',
      description: '对本地 TIS SQLite 数据库执行只读 SQL 查询。',
      descriptionZh: (
        '对本地 TIS SQLite 数据库执行只读 SQL 查询。必须先运行 TIS 数据获取工具' +
        '（如 tis.selected_courses.fetch）填充数据后才能使用。仅支持 SELECT 查询。'
      ),
      descriptionEn: (
        'Execute read-only SQL queries against the local TIS SQLite database. ' +
        'Requires prior data fetch.'
      ),
      group: {
        id: 'sustech-tis',
        label: '教务系统',
        labelZh: '教务系统',
        labelEn: 'TIS',
        order: 20,
        sourceKind: 'sustech-tis',
      },
    },
    // ---- MCP Tools ----
    {
      toolId: 'mcp--fetch--fetch',
      kind: 'external',
      availability: 'available',
      displayName: '联网抓取',
      displayNameZh: '联网抓取',
      displayNameEn: 'Web Fetch',
      description: '抓取网页内容，用于补充外部说明与页面上下文。',
      descriptionZh: '抓取网页内容并提取文本信息，用于补充外部说明与页面上下文。',
      descriptionEn: (
        'Fetches content from a specified URL and processes it. Takes a URL and a ' +
        'prompt as input, converts HTML to markdown, and returns the model\'s response.'
      ),
      group: {
        id: 'mcp-fetch',
        label: '联网工具',
        labelZh: '联网工具',
        labelEn: 'Web Tools',
        order: 30,
        sourceKind: 'mcp-server',
      },
    },
    {
      toolId: 'mcp--puppeteer--puppeteer_navigate',
      kind: 'external',
      availability: 'available',
      displayName: '浏览器导航',
      displayNameZh: '浏览器导航',
      displayNameEn: 'Browser Navigate',
      description: '驱动浏览器执行界面级操作与页面导航。',
      descriptionZh: '驱动浏览器导航到指定 URL，用于录制流程或验证可见交互。',
      descriptionEn: (
        'Navigate to a URL using browser automation. Supports taking screenshots, ' +
        'clicking elements, filling forms, and executing JavaScript.'
      ),
      group: {
        id: 'mcp-puppeteer',
        label: '联网工具',
        labelZh: '联网工具',
        labelEn: 'Web Tools',
        order: 30,
        sourceKind: 'mcp-server',
      },
    },
    {
      toolId: 'mcp--fetch--web_search_exa',
      kind: 'external',
      availability: 'available',
      displayName: '联网搜索',
      displayNameZh: '联网搜索',
      displayNameEn: 'Web Search',
      description: '搜索互联网获取最新信息与参考资料。',
      descriptionZh: '搜索互联网获取最新信息、新闻和参考资料。',
      descriptionEn: 'Search the web for current information, news, and reference materials.',
      group: {
        id: 'mcp-fetch',
        label: '联网工具',
        labelZh: '联网工具',
        labelEn: 'Web Tools',
        order: 30,
        sourceKind: 'mcp-server',
      },
    },
  ]
}
