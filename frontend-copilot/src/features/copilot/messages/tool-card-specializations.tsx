import type { ComponentType, ReactNode } from 'react'
import {
  BookOpen,
  CalendarDays,
  Camera,
  ClipboardList,
  Code2,
  Database,
  Eye,
  FilePenLine,
  FilePlus2,
  Files,
  FolderSymlink,
  Globe2,
  GraduationCap,
  PanelsTopLeft,
  Search,
  Sparkles,
  type LucideProps,
} from 'lucide-react'

import type { CopilotToolMessageItem } from '../run-segment-view-model'

type ToolSpecializedIcon = ComponentType<LucideProps>

interface SemanticMetric {
  label: string
  value: string
}

interface SemanticItem {
  title: string
  subtitle?: string | null
  meta?: string | null
}

export interface ToolCardSpecialization {
  title: string
  icon: ToolSpecializedIcon
  iconClassName: string
  panel: ReactNode
}

interface SpecializedToolPanelInput {
  index: number
  variant: 'file' | 'browser' | 'database' | 'school' | 'search'
  eyebrow: string
  description: string
  metrics?: SemanticMetric[]
  items?: SemanticItem[]
  codeSnippet?: {
    label: string
    value: string
  } | null
  emptyLabel?: string
}

interface FileReference {
  path: string
  name: string
  sizeBytes: number | null
  lineCount: number | null
  meta: string | null
}

export function resolveToolCardSpecialization(
  turn: CopilotToolMessageItem,
  index: number,
): ToolCardSpecialization | null {
  const toolId = normalizeText(turn.toolId)?.toLowerCase() ?? ''

  switch (toolId) {
    case 'tool.fs.read':
      return buildFileReadSpecialization(turn, index)
    case 'tool.fs.write':
      return buildFileMutationSpecialization(turn, index, {
        icon: FilePlus2,
        actionNoun: '写入文件',
        pendingTitle: '正在写入文件',
        completedTitle: '已写入文件',
        failedTitle: '写入文件失败',
        eyebrow: '文件写入',
        variant: 'file',
      })
    case 'tool.fs.edit':
    case 'tool.fs.notebook_edit':
      return buildFileMutationSpecialization(turn, index, {
        icon: FilePenLine,
        actionNoun: toolId === 'tool.fs.notebook_edit' ? '编辑 Notebook' : '编辑文件',
        pendingTitle: toolId === 'tool.fs.notebook_edit' ? '正在编辑 Notebook' : '正在编辑文件',
        completedTitle: toolId === 'tool.fs.notebook_edit' ? '已编辑 Notebook' : '已编辑文件',
        failedTitle: toolId === 'tool.fs.notebook_edit' ? 'Notebook 编辑失败' : '编辑文件失败',
        eyebrow: toolId === 'tool.fs.notebook_edit' ? 'Notebook 编辑' : '文件编辑',
        variant: 'file',
      })
    case 'tool.fs.glob':
      return buildFileSearchSpecialization(turn, index, {
        icon: Files,
        titleBase: '搜索文件',
        completedTitle: '文件搜索完成',
        failedTitle: '文件搜索失败',
        eyebrow: '文件搜索',
        queryKeys: ['pattern', 'glob', 'query'],
        countLabel: '匹配文件',
      })
    case 'tool.fs.grep':
      return buildFileSearchSpecialization(turn, index, {
        icon: Search,
        titleBase: '搜索内容',
        completedTitle: '内容搜索完成',
        failedTitle: '内容搜索失败',
        eyebrow: '内容搜索',
        queryKeys: ['pattern', 'regex', 'query'],
        countLabel: '匹配项',
      })
    case 'tool.fs.switch_root':
      return buildSwitchRootSpecialization(turn, index)
    default:
      break
  }

  if (toolId.startsWith('browser.')) {
    return buildBrowserSpecialization(turn, index, toolId)
  }

  if (toolId.endsWith('.sql.query')) {
    return buildSqlQuerySpecialization(turn, index)
  }

  if (toolId.startsWith('tis.')) {
    return buildSchoolSpecialization(turn, index, toolId, 'tis')
  }

  if (toolId.startsWith('blackboard.')) {
    return buildSchoolSpecialization(turn, index, toolId, 'blackboard')
  }

  return null
}

function buildFileReadSpecialization(turn: CopilotToolMessageItem, index: number): ToolCardSpecialization {
  const input = parseJsonRecord(turn.inputSummary)
  const output = resolveToolOutputRecord(turn)
  const fileItems = collectFileReferences(output, input)
  const explicitCount = firstNumber([
    readNumber(output, 'count'),
    readNumber(output, 'fileCount'),
    readNumber(output, 'readCount'),
  ])
  const fileCount = Math.max(1, explicitCount ?? (fileItems.length || 1))
  const totalBytes = sumKnownNumbers(fileItems.map((item) => item.sizeBytes))
  const totalLines = sumKnownNumbers(fileItems.map((item) => item.lineCount))
  const lineRange = formatLineRange(input, output)
  const title = resolveLifecycleTitle(turn, {
    pending: `正在阅读 ${fileCount} 个文件`,
    completed: `已阅读 ${fileCount} 个文件`,
    failed: '读取文件失败',
    cancelled: '读取文件已取消',
  })

  return {
    title,
    icon: BookOpen,
    iconClassName: 'copilot-chat__step-icon--file',
    panel: (
      <SpecializedToolPanel
        index={index}
        variant="file"
        eyebrow="文件阅读"
        description={lineRange === null ? `读取了 ${fileCount} 个文件。` : `读取了 ${fileCount} 个文件，${lineRange}。`}
        metrics={compactMetrics([
          { label: '文件数', value: `${fileCount}` },
          totalBytes === null ? null : { label: '总大小', value: formatBytes(totalBytes) },
          totalLines === null ? null : { label: '读取行数', value: `${totalLines}` },
        ])}
        items={fileItems.map(fileReferenceToSemanticItem)}
        emptyLabel="未解析到具体文件路径"
      />
    ),
  }
}

function buildFileMutationSpecialization(
  turn: CopilotToolMessageItem,
  index: number,
  options: {
    icon: ToolSpecializedIcon
    actionNoun: string
    pendingTitle: string
    completedTitle: string
    failedTitle: string
    eyebrow: string
    variant: 'file'
  },
): ToolCardSpecialization {
  const input = parseJsonRecord(turn.inputSummary)
  const output = resolveToolOutputRecord(turn)
  const fileItems = collectFileReferences(output, input)
  const targetLabel = fileItems[0]?.name ?? readFirstString(input, ['path', 'file', 'notebookPath']) ?? options.actionNoun
  const bytes = firstNumber([
    readNumber(output, 'bytesWritten'),
    readNumber(output, 'sizeBytes'),
    readNumber(output, 'size'),
  ])
  const changedLines = firstNumber([
    readNumber(output, 'changedLines'),
    readNumber(output, 'lineCount'),
    readNumber(output, 'editedLineCount'),
  ])
  const title = resolveLifecycleTitle(turn, {
    pending: `${options.pendingTitle}：${targetLabel}`,
    completed: `${options.completedTitle}：${targetLabel}`,
    failed: options.failedTitle,
    cancelled: `${options.actionNoun}已取消`,
  })

  return {
    title,
    icon: options.icon,
    iconClassName: 'copilot-chat__step-icon--file',
    panel: (
      <SpecializedToolPanel
        index={index}
        variant={options.variant}
        eyebrow={options.eyebrow}
        description={`${options.actionNoun}目标已整理为文件摘要。`}
        metrics={compactMetrics([
          bytes === null ? null : { label: '写入大小', value: formatBytes(bytes) },
          changedLines === null ? null : { label: '影响行数', value: `${changedLines}` },
          fileItems.length === 0 ? null : { label: '文件数', value: `${fileItems.length}` },
        ])}
        items={fileItems.map(fileReferenceToSemanticItem)}
        emptyLabel="未解析到目标文件"
      />
    ),
  }
}

function buildFileSearchSpecialization(
  turn: CopilotToolMessageItem,
  index: number,
  options: {
    icon: ToolSpecializedIcon
    titleBase: string
    completedTitle: string
    failedTitle: string
    eyebrow: string
    queryKeys: string[]
    countLabel: string
  },
): ToolCardSpecialization {
  const input = parseJsonRecord(turn.inputSummary)
  const output = resolveToolOutputRecord(turn)
  const query = readFirstString(input, options.queryKeys) ?? readFirstString(output, options.queryKeys)
  const matches = collectFileReferences(output, input)
  const count = firstNumber([
    readNumber(output, 'count'),
    readNumber(output, 'matchCount'),
    readNumber(output, 'totalMatches'),
    readNumber(output, 'total'),
  ]) ?? matches.length
  const title = resolveLifecycleTitle(turn, {
    pending: query === null ? `正在${options.titleBase}` : `正在${options.titleBase}：${truncateMiddle(query, 42)}`,
    completed: `${options.completedTitle}${count > 0 ? `（${count}）` : ''}`,
    failed: options.failedTitle,
    cancelled: `${options.titleBase}已取消`,
  })

  return {
    title,
    icon: options.icon,
    iconClassName: 'copilot-chat__step-icon--search',
    panel: (
      <SpecializedToolPanel
        index={index}
        variant="search"
        eyebrow={options.eyebrow}
        description={query === null ? `${options.titleBase}请求已执行。` : `搜索条件：${query}`}
        metrics={compactMetrics([
          { label: options.countLabel, value: `${count}` },
          matches.length === 0 ? null : { label: '展示条目', value: `${Math.min(matches.length, 6)}` },
        ])}
        items={matches.slice(0, 6).map(fileReferenceToSemanticItem)}
        codeSnippet={query === null ? null : { label: '搜索模式', value: query }}
        emptyLabel="暂无可展示的匹配条目"
      />
    ),
  }
}

function buildSwitchRootSpecialization(turn: CopilotToolMessageItem, index: number): ToolCardSpecialization {
  const input = parseJsonRecord(turn.inputSummary)
  const output = resolveToolOutputRecord(turn)
  const fromPath = readFirstString(output, ['previousRoot', 'oldRoot', 'from']) ?? readFirstString(input, ['previousRoot', 'oldRoot', 'from'])
  const toPath = readFirstString(output, ['root', 'newRoot', 'workspaceRoot', 'to', 'path']) ?? readFirstString(input, ['root', 'newRoot', 'workspaceRoot', 'to', 'path'])

  return {
    title: resolveLifecycleTitle(turn, {
      pending: '正在切换工作目录',
      completed: '已切换工作目录',
      failed: '切换工作目录失败',
      cancelled: '切换工作目录已取消',
    }),
    icon: FolderSymlink,
    iconClassName: 'copilot-chat__step-icon--file',
    panel: (
      <SpecializedToolPanel
        index={index}
        variant="file"
        eyebrow="工作目录"
        description="工具工作根目录已更新。"
        items={compactItems([
          fromPath === null ? null : { title: '原目录', subtitle: fromPath },
          toPath === null ? null : { title: '新目录', subtitle: toPath },
        ])}
        emptyLabel="未解析到目录变更详情"
      />
    ),
  }
}

function buildBrowserSpecialization(
  turn: CopilotToolMessageItem,
  index: number,
  toolId: string,
): ToolCardSpecialization {
  const input = parseJsonRecord(turn.inputSummary)
  const output = resolveToolOutputRecord(turn)
  const page = readRecord(output?.page) ?? output
  const url = readFirstString(page, ['url']) ?? readFirstString(input, ['url'])
  const pageTitle = readFirstString(page, ['title'])
  const tabs = readRecordArray(output?.tabs)
  const artifacts = resolveToolArtifacts(turn)
  const script = readFirstString(input, ['script'])
  const selector = readFirstString(input, ['selector']) ?? readFirstString(output, ['selector'])
  const operation = resolveBrowserOperation(toolId)
  const title = resolveLifecycleTitle(turn, {
    pending: operation.pending,
    completed: operation.completed,
    failed: operation.failed,
    cancelled: `${operation.noun}已取消`,
  })
  const tabItems = tabs.map((tab, tabIndex) => ({
    title: readFirstString(tab, ['title']) ?? `标签页 ${tabIndex + 1}`,
    subtitle: readFirstString(tab, ['url']) ?? readFirstString(tab, ['tabId', 'id']),
    meta: readFirstString(tab, ['active']) === 'true' ? '当前标签页' : null,
  }))
  const artifactItems = artifacts.map((artifact) => ({
    title: artifact.name ?? artifact.artifactId ?? '截图产物',
    subtitle: artifact.uri,
    meta: artifact.contentType,
  }))
  const items = compactItems([
    pageTitle === null && url === null ? null : {
      title: pageTitle ?? '当前页面',
      subtitle: url,
      meta: selector === null ? null : `选择器：${selector}`,
    },
    ...tabItems,
    ...artifactItems,
  ])

  return {
    title,
    icon: operation.icon,
    iconClassName: 'copilot-chat__step-icon--browser',
    panel: (
      <SpecializedToolPanel
        index={index}
        variant="browser"
        eyebrow="浏览器操作"
        description={buildBrowserDescription(operation.noun, url, pageTitle)}
        metrics={compactMetrics([
          tabs.length === 0 ? null : { label: '标签页', value: `${tabs.length}` },
          artifacts.length === 0 ? null : { label: '产物', value: `${artifacts.length}` },
          readFirstString(input, ['format']) === null ? null : { label: '格式', value: readFirstString(input, ['format'])! },
        ])}
        items={items}
        codeSnippet={script === null ? null : { label: '执行脚本', value: script }}
        emptyLabel="暂无页面详情"
      />
    ),
  }
}

function buildSqlQuerySpecialization(turn: CopilotToolMessageItem, index: number): ToolCardSpecialization {
  const input = parseJsonRecord(turn.inputSummary)
  const output = resolveToolOutputRecord(turn)
  const sql = readFirstString(input, ['sql', 'query', 'statement']) ?? readFirstString(output, ['sql', 'query', 'statement'])
  const rows = readRecordArray(output?.rows)
  const columns = readStringArray(output?.columns)
  const rowCount = firstNumber([
    readNumber(output, 'rowCount'),
    readNumber(output, 'count'),
    readNumber(output, 'totalRows'),
  ]) ?? rows.length
  const title = resolveLifecycleTitle(turn, {
    pending: '正在执行查询',
    completed: `查询完成${rowCount > 0 ? `（${rowCount} 行）` : ''}`,
    failed: '查询失败',
    cancelled: '查询已取消',
  })

  return {
    title,
    icon: Database,
    iconClassName: 'copilot-chat__step-icon--database',
    panel: (
      <SpecializedToolPanel
        index={index}
        variant="database"
        eyebrow="数据查询"
        description={sql === null ? '数据库查询已执行。' : '已执行结构化数据查询。'}
        metrics={compactMetrics([
          { label: '行数', value: `${rowCount}` },
          columns.length === 0 ? null : { label: '列数', value: `${columns.length}` },
        ])}
        items={columns.slice(0, 8).map((column) => ({ title: column, subtitle: '结果列' }))}
        codeSnippet={sql === null ? null : { label: 'SQL', value: sql }}
        emptyLabel="暂无结果列摘要"
      />
    ),
  }
}

function buildSchoolSpecialization(
  turn: CopilotToolMessageItem,
  index: number,
  toolId: string,
  platform: 'tis' | 'blackboard',
): ToolCardSpecialization {
  const output = resolveToolOutputRecord(turn)
  const input = parseJsonRecord(turn.inputSummary)
  const operation = resolveSchoolOperation(toolId, platform)
  const metrics = inferRecordMetrics(output)
  const query = readFirstString(input, ['query', 'courseCode', 'term', 'semester', 'courseId'])
  const title = resolveLifecycleTitle(turn, {
    pending: operation.pending,
    completed: operation.completed,
    failed: operation.failed,
    cancelled: `${operation.noun}已取消`,
  })

  return {
    title,
    icon: operation.icon,
    iconClassName: 'copilot-chat__step-icon--school',
    panel: (
      <SpecializedToolPanel
        index={index}
        variant="school"
        eyebrow={operation.eyebrow}
        description={query === null ? operation.description : `${operation.description} 查询条件：${query}`}
        metrics={metrics}
        items={inferPreviewItems(output).slice(0, 6)}
        emptyLabel="暂无可展示的数据摘要"
      />
    ),
  }
}

function SpecializedToolPanel({
  index,
  variant,
  eyebrow,
  description,
  metrics = [],
  items = [],
  codeSnippet = null,
  emptyLabel = '暂无详情',
}: SpecializedToolPanelInput) {
  return (
    <section
      className={`copilot-chat__tool-specialized copilot-chat__tool-specialized--${variant}`}
      data-testid={`chat-message-tool-specialized-${index}`}
    >
      <div className="copilot-chat__tool-specialized-head">
        <span className="copilot-chat__tool-specialized-eyebrow">{eyebrow}</span>
        <p className="copilot-chat__tool-specialized-description">{description}</p>
      </div>
      {metrics.length > 0 && (
        <div className="copilot-chat__tool-specialized-metrics">
          {metrics.map((metric) => (
            <div className="copilot-chat__tool-specialized-metric" key={`${metric.label}:${metric.value}`}>
              <span className="copilot-chat__tool-specialized-metric-value">{metric.value}</span>
              <span className="copilot-chat__tool-specialized-metric-label">{metric.label}</span>
            </div>
          ))}
        </div>
      )}
      {items.length > 0
        ? (
            <div className="copilot-chat__tool-specialized-list">
              {items.map((item, itemIndex) => (
                <div className="copilot-chat__tool-specialized-item" key={`${item.title}:${item.subtitle ?? ''}:${itemIndex}`}>
                  <div className="copilot-chat__tool-specialized-item-main">
                    <span className="copilot-chat__tool-specialized-item-title">{item.title}</span>
                    {item.subtitle !== null && item.subtitle !== undefined && item.subtitle !== '' && (
                      <span className="copilot-chat__tool-specialized-item-subtitle">{item.subtitle}</span>
                    )}
                  </div>
                  {item.meta !== null && item.meta !== undefined && item.meta !== '' && (
                    <span className="copilot-chat__tool-specialized-item-meta">{item.meta}</span>
                  )}
                </div>
              ))}
            </div>
          )
        : (
            <p className="copilot-chat__tool-specialized-empty">{emptyLabel}</p>
          )}
      {codeSnippet !== null && codeSnippet.value.trim() !== '' && (
        <div className="copilot-chat__tool-specialized-code">
          <span className="copilot-chat__tool-specialized-code-label">{codeSnippet.label}</span>
          <code>{truncateMiddle(codeSnippet.value, 420)}</code>
        </div>
      )}
    </section>
  )
}

function resolveLifecycleTitle(
  turn: CopilotToolMessageItem,
  labels: {
    pending: string
    completed: string
    failed: string
    cancelled: string
  },
): string {
  if (turn.toolPhase === 'waiting_approval') {
    return `等待批准：${labels.pending.replace(/^正在/u, '')}`
  }

  switch (turn.status) {
    case 'streaming':
      return labels.pending
    case 'completed':
      return labels.completed
    case 'failed':
      return labels.failed
    case 'cancelled':
      return labels.cancelled
  }
}

function resolveBrowserOperation(toolId: string): {
  noun: string
  pending: string
  completed: string
  failed: string
  icon: ToolSpecializedIcon
} {
  switch (toolId) {
    case 'browser.open':
      return { noun: '打开网页', pending: '正在打开网页', completed: '已打开网页', failed: '打开网页失败', icon: Globe2 }
    case 'browser.screenshot':
      return { noun: '浏览器截图', pending: '正在截图', completed: '截图完成', failed: '截图失败', icon: Camera }
    case 'browser.snapshot':
      return { noun: '页面结构读取', pending: '正在读取页面结构', completed: '页面结构已读取', failed: '页面结构读取失败', icon: Eye }
    case 'browser.execute':
      return { noun: '执行脚本', pending: '正在执行脚本', completed: '脚本执行完成', failed: '脚本执行失败', icon: Code2 }
    case 'browser.list_tabs':
      return { noun: '列出标签页', pending: '正在列出标签页', completed: '已列出标签页', failed: '列出标签页失败', icon: PanelsTopLeft }
    case 'browser.close_tab':
      return { noun: '关闭标签页', pending: '正在关闭标签页', completed: '已关闭标签页', failed: '关闭标签页失败', icon: PanelsTopLeft }
    case 'browser.switch_tab':
      return { noun: '切换标签页', pending: '正在切换标签页', completed: '已切换标签页', failed: '切换标签页失败', icon: PanelsTopLeft }
    case 'browser.reset':
      return { noun: '重置浏览器', pending: '正在重置浏览器', completed: '浏览器已重置', failed: '重置浏览器失败', icon: Sparkles }
    default:
      return { noun: '浏览器操作', pending: '正在操作浏览器', completed: '浏览器操作完成', failed: '浏览器操作失败', icon: Globe2 }
  }
}

function resolveSchoolOperation(toolId: string, platform: 'tis' | 'blackboard'): {
  noun: string
  pending: string
  completed: string
  failed: string
  eyebrow: string
  description: string
  icon: ToolSpecializedIcon
} {
  if (platform === 'tis') {
    if (toolId.includes('selected_courses')) {
      return { noun: '获取已选课程', pending: '正在获取已选课程', completed: '已获取已选课程', failed: '获取已选课程失败', eyebrow: 'TIS 课程', description: '教务课程数据已整理为摘要。', icon: CalendarDays }
    }
    if (toolId.includes('personal_grades')) {
      return { noun: '获取个人成绩', pending: '正在获取个人成绩', completed: '已获取个人成绩', failed: '获取个人成绩失败', eyebrow: 'TIS 成绩', description: '个人成绩数据已整理为摘要。', icon: ClipboardList }
    }
    if (toolId.includes('credit_gpa')) {
      return { noun: '获取学分绩点', pending: '正在获取学分绩点', completed: '已获取学分绩点', failed: '获取学分绩点失败', eyebrow: 'TIS 绩点', description: '学分与 GPA 数据已整理为摘要。', icon: GraduationCap }
    }
    return { noun: '读取 TIS 数据', pending: '正在读取 TIS 数据', completed: 'TIS 数据已读取', failed: 'TIS 数据读取失败', eyebrow: 'TIS 数据', description: '教务系统数据已整理为摘要。', icon: GraduationCap }
  }

  if (toolId.includes('snapshot.sync')) {
    return { noun: '同步 Blackboard 快照', pending: '正在同步 Blackboard 快照', completed: 'Blackboard 快照已同步', failed: 'Blackboard 快照同步失败', eyebrow: 'Blackboard 同步', description: '课程站点快照同步结果已整理。', icon: Sparkles }
  }
  if (toolId.includes('course_catalog')) {
    return { noun: '搜索课程目录', pending: '正在搜索课程目录', completed: '课程目录搜索完成', failed: '课程目录搜索失败', eyebrow: 'Blackboard 课程', description: '课程目录搜索结果已整理。', icon: BookOpen }
  }
  if (toolId.includes('course_resources')) {
    return { noun: '同步课程资源', pending: '正在同步课程资源', completed: '课程资源已同步', failed: '课程资源同步失败', eyebrow: 'Blackboard 资源', description: '课程资源同步结果已整理。', icon: Files }
  }
  if (toolId.includes('calendar')) {
    return { noun: '刷新课程日历', pending: '正在刷新课程日历', completed: '课程日历已刷新', failed: '课程日历刷新失败', eyebrow: 'Blackboard 日历', description: '课程日历刷新结果已整理。', icon: CalendarDays }
  }
  return { noun: '读取 Blackboard 数据', pending: '正在读取 Blackboard 数据', completed: 'Blackboard 数据已读取', failed: 'Blackboard 数据读取失败', eyebrow: 'Blackboard 数据', description: 'Blackboard 数据已整理为摘要。', icon: BookOpen }
}

function buildBrowserDescription(noun: string, url: string | null, pageTitle: string | null): string {
  if (pageTitle !== null && url !== null) {
    return `${noun}：${pageTitle}（${url}）`
  }
  if (url !== null) {
    return `${noun}：${url}`
  }
  if (pageTitle !== null) {
    return `${noun}：${pageTitle}`
  }
  return `${noun}已执行。`
}

function resolveToolOutputRecord(turn: CopilotToolMessageItem): Record<string, unknown> | null {
  const parsed = parseJsonRecord(turn.resultSummary) ?? parseJsonRecord(turn.content)
  if (parsed === null) {
    return null
  }

  const output = readRecord(parsed.output)
  return output ?? parsed
}

function resolveToolEnvelopeRecord(turn: CopilotToolMessageItem): Record<string, unknown> | null {
  return parseJsonRecord(turn.resultSummary) ?? parseJsonRecord(turn.content)
}

function resolveToolArtifacts(turn: CopilotToolMessageItem): Array<{
  artifactId: string | null
  name: string | null
  contentType: string | null
  uri: string | null
}> {
  const envelope = resolveToolEnvelopeRecord(turn)
  const artifacts = readArray(envelope?.artifacts)
  return artifacts.flatMap((artifact) => {
    const record = readRecord(artifact)
    if (record === null) {
      return []
    }
    return [{
      artifactId: readFirstString(record, ['artifact_id', 'artifactId', 'id']),
      name: readFirstString(record, ['name', 'filename', 'fileName']),
      contentType: readFirstString(record, ['content_type', 'contentType', 'mimeType']),
      uri: readFirstString(record, ['uri', 'url', 'path']),
    }]
  })
}

function collectFileReferences(...records: Array<Record<string, unknown> | null>): FileReference[] {
  const collected: FileReference[] = []
  const seen = new Set<string>()

  for (const record of records) {
    if (record === null) {
      continue
    }

    appendFileReference(collected, seen, record)
    for (const key of ['file', 'target', 'metadata', 'pathMetadata', 'request']) {
      const nested = readRecord(record[key])
      if (nested !== null) {
        appendFileReference(collected, seen, nested)
      }
    }

    for (const key of ['files', 'paths', 'matches', 'results', 'entries']) {
      for (const entry of readArray(record[key])) {
        if (typeof entry === 'string') {
          appendPathReference(collected, seen, entry, null)
          continue
        }
        const entryRecord = readRecord(entry)
        if (entryRecord !== null) {
          appendFileReference(collected, seen, entryRecord)
        }
      }
    }
  }

  return collected
}

function appendFileReference(collected: FileReference[], seen: Set<string>, record: Record<string, unknown>): void {
  const path = readFirstString(record, ['path', 'filePath', 'relativePath', 'absolutePath', 'name', 'filename'])
  if (path === null) {
    return
  }

  appendPathReference(collected, seen, path, record)
}

function appendPathReference(
  collected: FileReference[],
  seen: Set<string>,
  path: string,
  record: Record<string, unknown> | null,
): void {
  const normalizedPath = path.trim()
  if (normalizedPath === '' || seen.has(normalizedPath)) {
    return
  }

  seen.add(normalizedPath)
  const sizeBytes = firstNumber([
    readNumber(record, 'sizeBytes'),
    readNumber(record, 'size'),
    readNumber(record, 'byteLength'),
    readNumber(record, 'bytes'),
  ])
  const lineCount = firstNumber([
    readNumber(record, 'lineCount'),
    readNumber(record, 'lines'),
    readNumber(record, 'matchedLines'),
  ])
  collected.push({
    path: normalizedPath,
    name: basename(normalizedPath),
    sizeBytes,
    lineCount,
    meta: compactText([
      sizeBytes === null ? null : formatBytes(sizeBytes),
      lineCount === null ? null : `${lineCount} 行`,
    ], ' · '),
  })
}

function fileReferenceToSemanticItem(file: FileReference): SemanticItem {
  return {
    title: file.name,
    subtitle: file.path === file.name ? null : file.path,
    meta: file.meta,
  }
}

function inferRecordMetrics(record: Record<string, unknown> | null): SemanticMetric[] {
  if (record === null) {
    return []
  }

  const metricCandidates: Array<[string, string[]]> = [
    ['课程数', ['courseCount', 'coursesCount', 'selectedCourseCount']],
    ['成绩数', ['gradeCount', 'gradesCount']],
    ['事件数', ['eventCount', 'eventsCount']],
    ['资源数', ['resourceCount', 'resourcesCount']],
    ['新增', ['created', 'createdCount', 'added', 'addedCount', 'insertedCount']],
    ['更新', ['updated', 'updatedCount', 'changedCount']],
    ['跳过', ['skipped', 'skippedCount']],
    ['GPA', ['gpa', 'GPA']],
    ['总学分', ['credit', 'credits', 'totalCredits']],
  ]

  const metrics = metricCandidates.flatMap(([label, keys]) => {
    const value = readFirstValue(record, keys)
    return value === null ? [] : [{ label, value }]
  })

  if (metrics.length > 0) {
    return metrics.slice(0, 6)
  }

  const arrays = Object.entries(record)
    .filter(([, value]) => Array.isArray(value))
    .slice(0, 3)
    .map(([key, value]) => ({ label: formatMetricLabel(key), value: `${(value as unknown[]).length}` }))

  return arrays
}

function inferPreviewItems(record: Record<string, unknown> | null): SemanticItem[] {
  if (record === null) {
    return []
  }

  const arrays = ['courses', 'grades', 'events', 'resources', 'results', 'items', 'rows']
    .flatMap((key) => readRecordArray(record[key]))
  return arrays.map((item, index) => {
    const title = readFirstString(item, ['name', 'title', 'courseName', 'courseTitle', 'assignmentTitle', 'resourceName'])
      ?? `条目 ${index + 1}`
    const subtitle = readFirstString(item, ['courseCode', 'code', 'url', 'time', 'term', 'semester'])
    const meta = readFirstValue(item, ['grade', 'score', 'credit', 'credits', 'status'])
    return { title, subtitle, meta }
  })
}

function formatLineRange(input: Record<string, unknown> | null, output: Record<string, unknown> | null): string | null {
  const offset = firstNumber([readNumber(input, 'offset'), readNumber(output, 'offset'), readNumber(output, 'startLine')])
  const limit = firstNumber([readNumber(input, 'limit'), readNumber(output, 'limit')])
  const endLine = firstNumber([readNumber(output, 'endLine')])
  if (offset === null && limit === null && endLine === null) {
    return null
  }

  if (offset !== null && endLine !== null) {
    return `第 ${offset}–${endLine} 行`
  }
  if (offset !== null && limit !== null) {
    return `从第 ${offset} 行开始，最多 ${limit} 行`
  }
  if (limit !== null) {
    return `最多 ${limit} 行`
  }
  return null
}

function parseJsonRecord(value: string | null | undefined): Record<string, unknown> | null {
  const trimmed = value?.trim() ?? ''
  if (trimmed === '') {
    return null
  }

  try {
    return readRecord(JSON.parse(trimmed))
  } catch {
    return null
  }
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function readRecordArray(value: unknown): Record<string, unknown>[] {
  return readArray(value).flatMap((item) => {
    const record = readRecord(item)
    return record === null ? [] : [record]
  })
}

function readStringArray(value: unknown): string[] {
  return readArray(value).flatMap((item) => {
    if (typeof item === 'string' && item.trim() !== '') {
      return [item.trim()]
    }
    return []
  })
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function readNumber(record: Record<string, unknown> | null | undefined, key: string): number | null {
  const value = record?.[key]
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function readFirstString(record: Record<string, unknown> | null | undefined, keys: string[]): string | null {
  for (const key of keys) {
    const value = record?.[key]
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim()
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }
    if (typeof value === 'boolean') {
      return String(value)
    }
  }
  return null
}

function readFirstValue(record: Record<string, unknown> | null | undefined, keys: string[]): string | null {
  for (const key of keys) {
    const value = record?.[key]
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim()
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.00$/u, '')
    }
    if (typeof value === 'boolean') {
      return value ? '是' : '否'
    }
  }
  return null
}

function firstNumber(values: Array<number | null | undefined>): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
  }
  return null
}

function sumKnownNumbers(values: Array<number | null>): number | null {
  const knownValues = values.filter((value): value is number => value !== null)
  if (knownValues.length === 0) {
    return null
  }
  return knownValues.reduce((sum, value) => sum + value, 0)
}

function compactMetrics(values: Array<SemanticMetric | null>): SemanticMetric[] {
  return values.filter((value): value is SemanticMetric => value !== null && value.value.trim() !== '')
}

function compactItems(values: Array<SemanticItem | null>): SemanticItem[] {
  return values.filter((value): value is SemanticItem => value !== null && value.title.trim() !== '')
}

function compactText(values: Array<string | null>, separator: string): string | null {
  const compacted = values.filter((value): value is string => value !== null && value.trim() !== '')
  return compacted.length === 0 ? null : compacted.join(separator)
}

function normalizeText(value: string | null | undefined): string | null {
  const normalized = value?.trim()
  return normalized === undefined || normalized === '' ? null : normalized
}

function basename(value: string): string {
  const normalized = value.replace(/\\/gu, '/')
  const segments = normalized.split('/').filter((segment) => segment.trim() !== '')
  return segments[segments.length - 1] ?? value
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${Math.max(0, value)} B`
  }

  const units = ['KB', 'MB', 'GB']
  let scaled = value / 1024
  for (const unit of units) {
    if (scaled < 1024 || unit === units[units.length - 1]) {
      return `${scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(1)} ${unit}`
    }
    scaled /= 1024
  }

  return `${value} B`
}

function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  const headLength = Math.max(8, Math.floor((maxLength - 1) * 0.62))
  const tailLength = Math.max(6, maxLength - headLength - 1)
  return `${value.slice(0, headLength)}…${value.slice(-tailLength)}`
}

function formatMetricLabel(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/gu, '$1 $2')
    .replace(/[_-]+/gu, ' ')
    .replace(/^\w/u, (match) => match.toUpperCase())
}
