export interface CopilotToolPresentationSource {
  toolId: string
  displayName: string | null
  description: string | null
  kind: string
}

export interface CopilotToolPresentation {
  name: string
  description: string
  searchKeywords: string[]
}

export interface CopilotToolPlatformGroup {
  key: string
  title: string
  order: number
  sourceKind: 'builtin' | 'sustech-blackboard' | 'sustech-tis' | 'mcp-server' | 'fallback'
  searchKeywords: string[]
}

const TOOL_PRESENTATION_OVERRIDES: Record<string, { name: string, description: string }> = {
  'tool.file-convert': {
    name: '文件转换',
    description: '转换常见办公文档',
  },
  'tool.weather-current': {
    name: '天气查询',
    description: '获取当前天气情况',
  },
  'tool.remote-search': {
    name: '联网搜索',
    description: '搜索外部公开信息',
  },
  'blackboard.sql.query': {
    name: 'Blackboard 数据查询',
    description: '查询 Blackboard 本地数据',
  },
  'blackboard.course_catalog.search': {
    name: '课程目录搜索',
    description: '搜索 Blackboard 课程目录',
  },
  'blackboard.calendar.refresh': {
    name: '日历刷新',
    description: '刷新 Blackboard 课程日历',
  },
  'blackboard.snapshot.sync': {
    name: '快照同步',
    description: '同步 Blackboard 基础快照',
  },
  'blackboard.course_resources.sync': {
    name: '课程资源同步',
    description: '同步指定课程资源',
  },
  'tis.sql.query': {
    name: 'TIS 数据查询',
    description: '查询 TIS 本地数据',
  },
  'tis.personal_grades.fetch': {
    name: '成绩获取',
    description: '获取个人成绩记录',
  },
  'tis.credit_gpa.fetch': {
    name: '绩点概览',
    description: '获取学分与绩点概览',
  },
  'tis.selected_courses.fetch': {
    name: '已选课程',
    description: '获取当前已选课程',
  },
}

const TOOL_NAMESPACE_DESCRIPTIONS: Record<string, string> = {
  blackboard: 'Blackboard 相关操作',
  tis: 'TIS 相关操作',
  tool: '内建辅助能力',
}

const TOOL_TOKEN_LABELS: Record<string, string> = {
  blackboard: 'Blackboard',
  tis: 'TIS',
  tool: '工具',
  file: '文件',
  convert: '转换',
  weather: '天气',
  current: '当前',
  remote: '远程',
  search: '搜索',
  sql: 'SQL',
  query: '查询',
  course: '课程',
  courses: '课程',
  catalog: '目录',
  calendar: '日历',
  refresh: '刷新',
  snapshot: '快照',
  sync: '同步',
  resources: '资源',
  resource: '资源',
  personal: '个人',
  grades: '成绩',
  grade: '成绩',
  credit: '学分',
  gpa: '绩点',
  selected: '已选',
  fetch: '获取',
}

const STATIC_TOOL_PLATFORM_GROUPS: Record<string, Omit<CopilotToolPlatformGroup, 'searchKeywords'>> = {
  tool: {
    key: 'builtin',
    title: 'Candue 内建',
    order: 0,
    sourceKind: 'builtin',
  },
  blackboard: {
    key: 'sustech-blackboard',
    title: 'SUSTech Blackboard',
    order: 10,
    sourceKind: 'sustech-blackboard',
  },
  tis: {
    key: 'sustech-tis',
    title: 'SUSTech TIS',
    order: 20,
    sourceKind: 'sustech-tis',
  },
}

const PLATFORM_TOKEN_LABELS: Record<string, string> = {
  api: 'API',
  fs: 'FS',
  mcp: 'MCP',
  sql: 'SQL',
  sustech: 'SUSTech',
  tis: 'TIS',
}

const MCP_GROUP_ORDER = 100
const FALLBACK_GROUP_ORDER = 200

export function resolveCopilotToolPresentation(tool: CopilotToolPresentationSource): CopilotToolPresentation {
  const override = TOOL_PRESENTATION_OVERRIDES[tool.toolId]
  const platformGroup = resolveCopilotToolPlatformGroup(tool)
  const name = override?.name ?? buildFallbackToolName(tool)
  const description = override?.description ?? buildFallbackToolDescription(tool)

  return {
    name,
    description,
    searchKeywords: [
      tool.toolId,
      tool.displayName,
      tool.description,
      name,
      description,
      buildIdBasedToolName(tool.toolId),
      ...platformGroup.searchKeywords,
    ].flatMap((value) => {
      const normalizedValue = normalizeText(value)
      return normalizedValue === null ? [] : [normalizedValue]
    }),
  }
}

export function resolveCopilotToolPlatformGroup(tool: CopilotToolPresentationSource): CopilotToolPlatformGroup {
  const namespace = extractToolNamespace(tool.toolId)
  if (namespace !== null) {
    const staticGroup = STATIC_TOOL_PLATFORM_GROUPS[namespace]
    if (staticGroup !== undefined) {
      return attachPlatformSearchKeywords(staticGroup, [namespace])
    }
  }

  const explicitServerIdentity = resolveExplicitServerIdentity(tool)
  if (explicitServerIdentity !== null) {
    return createDynamicPlatformGroup(explicitServerIdentity)
  }

  const mcpServerIdentity = resolveMcpServerIdentityFromToolId(tool.toolId)
  if (mcpServerIdentity !== null) {
    return createDynamicPlatformGroup(mcpServerIdentity)
  }

  if (isBuiltinToolKind(tool.kind)) {
    return attachPlatformSearchKeywords(STATIC_TOOL_PLATFORM_GROUPS.tool, ['builtin', 'candue'])
  }

  if (namespace !== null) {
    const fallbackTitle = formatPlatformLabel(namespace)
    return attachPlatformSearchKeywords({
      key: `platform:${normalizeGroupKey(namespace) ?? 'other'}`,
      title: fallbackTitle,
      order: FALLBACK_GROUP_ORDER,
      sourceKind: 'fallback',
    }, [namespace, fallbackTitle])
  }

  return attachPlatformSearchKeywords({
    key: `platform:${normalizeGroupKey(tool.kind) ?? 'other'}`,
    title: '其他工具',
    order: FALLBACK_GROUP_ORDER,
    sourceKind: 'fallback',
  }, ['其他工具', tool.kind])
}

function buildFallbackToolName(tool: CopilotToolPresentationSource): string {
  const displayName = normalizeText(tool.displayName)
  if (displayName !== null && containsCjk(displayName)) {
    return truncateText(displayName, 18)
  }

  const idBasedName = buildIdBasedToolName(tool.toolId)
  if (idBasedName !== null) {
    return idBasedName
  }

  if (displayName !== null) {
    return truncateText(displayName, 18)
  }

  return tool.kind === 'external' ? '外部工具' : '可选工具'
}

function buildFallbackToolDescription(tool: CopilotToolPresentationSource): string {
  const description = normalizeText(tool.description)
  if (description !== null && containsCjk(description)) {
    return truncateText(description, 26)
  }

  const namespace = extractToolNamespace(tool.toolId)
  if (namespace !== null && TOOL_NAMESPACE_DESCRIPTIONS[namespace] !== undefined) {
    return TOOL_NAMESPACE_DESCRIPTIONS[namespace]
  }

  return tool.kind === 'external' ? '外部扩展能力' : '内建辅助能力'
}

function createDynamicPlatformGroup(input: {
  key: string
  title: string
}): CopilotToolPlatformGroup {
  return attachPlatformSearchKeywords({
    key: `mcp:${input.key}`,
    title: input.title,
    order: MCP_GROUP_ORDER,
    sourceKind: 'mcp-server',
  }, [input.key, input.title, 'mcp'])
}

function attachPlatformSearchKeywords(
  platformGroup: Omit<CopilotToolPlatformGroup, 'searchKeywords'>,
  extraValues: Array<string | null | undefined>,
): CopilotToolPlatformGroup {
  return {
    ...platformGroup,
    searchKeywords: [
      platformGroup.key,
      platformGroup.title,
      ...extraValues,
    ].flatMap((value) => {
      const normalizedValue = normalizeText(value)
      return normalizedValue === null ? [] : [normalizedValue]
    }),
  }
}

function resolveExplicitServerIdentity(tool: CopilotToolPresentationSource): {
  key: string
  title: string
} | null {
  const toolRecord = readRecord(tool)
  const directId = firstNonEmptyString([
    readStringRecordField(toolRecord, 'mcpServerId'),
    readStringRecordField(toolRecord, 'serverId'),
    readStringRecordField(toolRecord, 'sourceId'),
    readStringRecordField(toolRecord, 'providerId'),
  ])
  const directTitle = firstNonEmptyString([
    readStringRecordField(toolRecord, 'mcpServerName'),
    readStringRecordField(toolRecord, 'serverName'),
    readStringRecordField(toolRecord, 'sourceName'),
    readStringRecordField(toolRecord, 'providerName'),
    readStringRecordField(toolRecord, 'groupName'),
    readStringRecordField(toolRecord, 'server'),
    readStringRecordField(toolRecord, 'mcpServer'),
  ])
  const nestedIdentity = [
    readNestedIdentity(toolRecord.mcpServer),
    readNestedIdentity(toolRecord.server),
    readNestedIdentity(toolRecord.source),
    readNestedIdentity(toolRecord.provider),
    readNestedIdentity(toolRecord.origin),
  ].find((value) => value !== null) ?? null
  const identityKeySource = directId ?? nestedIdentity?.key ?? directTitle ?? nestedIdentity?.title
  const identityTitleSource = directTitle ?? nestedIdentity?.title ?? directId ?? nestedIdentity?.key
  const identityKey = normalizeGroupKey(identityKeySource)
  const identityTitle = formatExplicitPlatformTitle(identityTitleSource)

  if (identityKey === null || identityTitle === null) {
    return null
  }

  return {
    key: identityKey,
    title: identityTitle,
  }
}

function resolveMcpServerIdentityFromToolId(toolId: string): {
  key: string
  title: string
} | null {
  const normalizedToolId = normalizeText(toolId)
  if (normalizedToolId === null) {
    return null
  }

  const match = normalizedToolId.match(/^mcp[.:/]+([^.:/]+)[.:/]+.+$/iu)
  const serverId = normalizeText(match?.[1])
  const serverKey = normalizeGroupKey(serverId)
  if (serverKey === null || serverId === null) {
    return null
  }

  return {
    key: serverKey,
    title: formatPlatformLabel(serverId),
  }
}

function readNestedIdentity(value: unknown): {
  key: string | null
  title: string | null
} | null {
  const record = readRecord(value)
  if (record === null) {
    return null
  }

  const key = firstNonEmptyString([
    readStringRecordField(record, 'id'),
    readStringRecordField(record, 'key'),
    readStringRecordField(record, 'serverId'),
    readStringRecordField(record, 'providerId'),
  ])
  const title = firstNonEmptyString([
    readStringRecordField(record, 'title'),
    readStringRecordField(record, 'name'),
    readStringRecordField(record, 'label'),
    readStringRecordField(record, 'serverName'),
    readStringRecordField(record, 'providerName'),
  ])

  if (key === null && title === null) {
    return null
  }

  return {
    key,
    title,
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return value as Record<string, unknown>
}

function readStringRecordField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' ? normalizeText(value) : null
}

function firstNonEmptyString(values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalizedValue = normalizeText(value)
    if (normalizedValue !== null) {
      return normalizedValue
    }
  }

  return null
}

function buildIdBasedToolName(toolId: string): string | null {
  const normalizedToolId = normalizeText(toolId)
  if (normalizedToolId === null) {
    return null
  }

  const tokens = normalizedToolId
    .split(/[.:/_-]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token !== '')
  if (tokens.length === 0) {
    return null
  }

  const translatedTokens = tokens
    .map((token) => TOOL_TOKEN_LABELS[token])
    .filter((token): token is string => token !== undefined)
  if (translatedTokens.length === 0) {
    return null
  }

  if (tokens[0] === 'blackboard') {
    const coreTokens = translatedTokens.filter((token) => token !== 'Blackboard').slice(-3)
    return coreTokens.length > 0 ? truncateText(coreTokens.join(''), 18) : 'Blackboard 工具'
  }

  if (tokens[0] === 'tis') {
    const coreTokens = translatedTokens.filter((token) => token !== 'TIS').slice(-3)
    return coreTokens.length > 0 ? truncateText(coreTokens.join(''), 18) : 'TIS 工具'
  }

  const coreTokens = translatedTokens.filter((token) => token !== '工具').slice(-3)
  if (coreTokens.length > 0) {
    return truncateText(coreTokens.join(''), 18)
  }

  return truncateText(translatedTokens.join(''), 18)
}

function extractToolNamespace(toolId: string): string | null {
  const normalizedToolId = normalizeText(toolId)
  if (normalizedToolId === null) {
    return null
  }

  const [namespace] = normalizedToolId.split(/[.:/]+/)
  return namespace ? namespace.toLowerCase() : null
}

function isBuiltinToolKind(kind: string): boolean {
  return normalizeText(kind)?.toLowerCase() === 'builtin'
}

function formatExplicitPlatformTitle(value: string | null | undefined): string | null {
  const normalizedValue = normalizeText(value)
  if (normalizedValue === null) {
    return null
  }

  if (containsCjk(normalizedValue) || /\s/u.test(normalizedValue) || /[A-Z]/u.test(normalizedValue)) {
    return normalizedValue
  }

  return formatPlatformLabel(normalizedValue)
}

function formatPlatformLabel(value: string): string {
  const normalizedValue = normalizeText(value)
  if (normalizedValue === null) {
    return '其他工具'
  }

  const tokens = normalizedValue
    .split(/[.:/_-]+/)
    .map((token) => token.trim())
    .filter((token) => token !== '')
  if (tokens.length === 0) {
    return normalizedValue
  }

  return tokens.map((token) => formatPlatformToken(token)).join(' ')
}

function formatPlatformToken(token: string): string {
  const lowerToken = token.toLowerCase()
  if (PLATFORM_TOKEN_LABELS[lowerToken] !== undefined) {
    return PLATFORM_TOKEN_LABELS[lowerToken]
  }

  if (/^[A-Z0-9]+$/u.test(token)) {
    return token
  }

  return `${token.slice(0, 1).toUpperCase()}${token.slice(1)}`
}

function normalizeGroupKey(value: string | null | undefined): string | null {
  const normalizedValue = normalizeText(value)
  if (normalizedValue === null) {
    return null
  }

  const normalizedKey = normalizedValue
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')

  return normalizedKey === '' ? null : normalizedKey
}

function normalizeText(value: string | null | undefined): string | null {
  const normalizedValue = value?.trim()
  return normalizedValue ? normalizedValue : null
}

function containsCjk(value: string): boolean {
  return /[\u4e00-\u9fff]/u.test(value)
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`
}
