import type {
  McpRefreshCatalogResult,
  McpTestConnectionResult,
} from '../../../electron/mcp-registry/ipc'
import type {
  McpConnectionState,
  McpServerDraft,
  McpServerRecord,
  McpServerStateSummary,
  McpServerValidationError,
  McpTransportConfig,
} from '../../../electron/mcp-registry/types'

export type McpServerEditorMode = 'edit' | 'add'
export type McpBusyOperation = 'saving' | 'testing' | 'refreshing' | 'toggling' | 'deleting'

export interface McpRegistryServerViewModel {
  serverId: string
  displayName: string
  description: string
  transportLabel: string
  endpoint: string
  connectionState: McpConnectionState
  enabled: boolean
  toolCount: number
  message: string | null
  messageTone: 'info' | 'warning' | 'error' | 'success'
  busy: boolean
  busyOperation: McpBusyOperation | null
  activityLabel: string | null
  lastHandshakeAtLabel: string | null
  lastCatalogSyncAtLabel: string | null
}

export type McpRegistryEditorParseResult =
  | { ok: true, drafts: McpServerDraft[] }
  | { ok: false, validationErrors: McpServerValidationError[] }

export interface StandardMcpImportCandidate {
  serverId: string
  displayName: string
  draft: McpServerDraft
}

export type StandardMcpImportParseResult =
  | { ok: true, candidates: StandardMcpImportCandidate[] }
  | { ok: false, message: string }

export function buildMcpRegistryServerViewModels(
  servers: readonly McpServerRecord[],
  states: readonly McpServerStateSummary[],
  operationMessages: Readonly<Record<string, string | null | undefined>>,
  busyOperations: Readonly<Record<string, McpBusyOperation | null | undefined>>,
): McpRegistryServerViewModel[] {
  const stateById = new Map(states.map((state) => [state.serverId, state]))

  return servers
    .map((server) => {
      const state = stateById.get(server.serverId)
      const busyOperation = busyOperations[server.serverId] ?? null
      const operationMessage = operationMessages[server.serverId] ?? null
      const lastErrorMessage = state?.lastError?.message ?? null
      return {
        serverId: server.serverId,
        displayName: server.displayName,
        description: server.description ?? '尚未填写说明。',
        transportLabel: server.transportKind === 'stdio' ? 'stdio' : 'HTTP / SSE',
        endpoint: resolveTransportEndpoint(server),
        connectionState: state?.connectionState ?? (server.enabled ? 'idle' : 'disabled'),
        enabled: server.enabled,
        toolCount: state?.toolCount ?? 0,
        message: operationMessage ?? lastErrorMessage,
        messageTone: resolveMessageTone(operationMessage, state?.lastError?.message ?? null),
        busy: busyOperation !== null,
        busyOperation,
        activityLabel: resolveBusyOperationLabel(busyOperation),
        lastHandshakeAtLabel: formatTimestamp(state?.lastHandshakeAt ?? null),
        lastCatalogSyncAtLabel: formatTimestamp(state?.lastCatalogSyncAt ?? null),
      }
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh-CN'))
}

export function resolveMcpConnectionStateLabel(state: McpConnectionState): string {
  switch (state) {
    case 'disabled':
      return '已禁用'
    case 'idle':
      return '已保存'
    case 'connecting':
      return '连接中'
    case 'connected':
      return '已就绪'
    case 'degraded':
      return '已降级'
    case 'error':
      return '错误'
  }
}

export function resolveMcpEditorSeed(
  mode: McpServerEditorMode,
  servers: readonly McpServerRecord[],
): string {
  if (mode === 'edit') {
    return JSON.stringify({
      mcpServers: Object.fromEntries(servers.map((server) => [server.serverId, serializeEditorServer(server)])),
    }, null, 2)
  }

  return JSON.stringify({
    serverId: 'new-server',
    displayName: 'new-server',
    enabled: true,
    description: '新增 MCP 服务器。',
    transportKind: 'stdio',
    transportConfig: {
      kind: 'stdio',
      command: 'uvx',
      args: ['example-mcp-server'],
      cwd: null,
      env: {},
    },
  }, null, 2)
}

export function parseMcpRegistryEditorValue(
  mode: McpServerEditorMode,
  value: string,
): McpRegistryEditorParseResult {
  let parsed: unknown

  try {
    parsed = JSON.parse(value)
  } catch (error) {
    return {
      ok: false,
      validationErrors: [{
        fieldPath: '$',
        message: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
        code: 'invalid_json',
      }],
    }
  }

  const drafts = mode === 'edit' ? parseRegistryDocument(parsed) : parseAddDocument(parsed)
  if (drafts === null) {
    return {
      ok: false,
      validationErrors: [{
        fieldPath: '$',
        message: mode === 'edit'
          ? '编辑模式需要形如 { "mcpServers": { ... } } 的 JSON 文档。'
          : '新增模式需要单个 MCP 服务器 JSON 对象。',
        code: 'invalid_shape',
      }],
    }
  }

  const validationErrors = drafts.flatMap(validateDraft)
  if (validationErrors.length > 0) {
    return { ok: false, validationErrors }
  }

  return { ok: true, drafts }
}

export function parseStandardMcpImportValue(value: string): StandardMcpImportParseResult {
  let parsed: unknown

  try {
    parsed = JSON.parse(value)
  } catch (error) {
    return {
      ok: false,
      message: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }

  const candidates = parseStandardImportCandidates(parsed)
  if (candidates === null || candidates.length === 0) {
    return {
      ok: false,
      message: '请输入标准 MCP 配置，支持 { "mcpServers": { ... } } 或单个服务器配置对象。',
    }
  }

  return { ok: true, candidates }
}

export function formatMcpTestConnectionMessage(result: McpTestConnectionResult): string {
  if (!result.ok) {
    return `测试连接失败：${result.error}`
  }

  if (result.success) {
    return `测试连接成功，可用工具 ${result.toolCount} 个。`
  }

  const detail = result.error?.message ?? result.warnings?.[0] ?? '测试连接未成功。'
  return `测试连接失败：${detail}`
}

export function formatMcpRefreshCatalogMessage(result: McpRefreshCatalogResult, serverId: string): string {
  if (!result.ok) {
    return `刷新工具列表失败：${result.error}`
  }

  const matchedResult = result.results.find((entry) => entry.serverId === serverId)
  if (matchedResult === undefined) {
    return '刷新工具列表已完成。'
  }

  if (matchedResult.error !== undefined && matchedResult.error !== null) {
    if (matchedResult.connectionState === 'degraded' && matchedResult.toolCount > 0) {
      return `刷新工具列表失败，已保留上次可用结果：${matchedResult.error.message}`
    }

    return `刷新工具列表失败：${matchedResult.error.message}`
  }

  return `工具列表已刷新，当前同步 ${matchedResult.toolCount} 个工具。`
}

export function formatMcpSaveServerMessage(
  server: McpServerRecord,
  state: McpServerStateSummary | null,
): string {
  if (!server.enabled) {
    return '配置已保存，服务器当前已禁用。'
  }

  if (state === null) {
    return '配置已保存。'
  }

  switch (state.connectionState) {
    case 'connected':
      return `配置已保存并连接成功，当前同步 ${state.toolCount} 个工具。`
    case 'connecting':
      return '配置已保存，正在建立连接。'
    case 'degraded':
      return '配置已保存，但工具列表刷新受限，已保留上次可用结果。'
    case 'error':
      return '配置已保存，但连接失败，请检查最近错误。'
    case 'disabled':
      return '配置已保存，服务器当前已禁用。'
    case 'idle':
    default:
      return '配置已保存，等待连接结果。'
  }
}

function resolveTransportEndpoint(server: McpServerRecord): string {
  if (server.transportConfig.kind === 'stdio') {
    const args = server.transportConfig.args.join(' ')
    return args.trim() === '' ? server.transportConfig.command : `${server.transportConfig.command} ${args}`
  }

  return server.transportConfig.baseUrl
}

function serializeEditorServer(server: McpServerRecord): Record<string, unknown> {
  return {
    displayName: server.displayName,
    enabled: server.enabled,
    description: server.description ?? null,
    transportKind: server.transportKind,
    transportConfig: cloneTransportConfig(server.transportConfig),
    ...(server.reservedSensitiveFields === undefined
      ? {}
      : { reservedSensitiveFields: [...server.reservedSensitiveFields] }),
  }
}

function parseRegistryDocument(value: unknown): McpServerDraft[] | null {
  if (!isPlainRecord(value) || !isPlainRecord(value.mcpServers)) {
    return null
  }

  return parseMcpServersMap(value.mcpServers)
}

function parseStandardImportCandidates(value: unknown): StandardMcpImportCandidate[] | null {
  if (!isPlainRecord(value)) {
    return null
  }

  if (isPlainRecord(value.mcpServers)) {
    const candidates = Object.entries(value.mcpServers).map(([serverId, entry]) => parseStandardImportCandidate(serverId, entry))
    return candidates.every((candidate) => candidate !== null)
      ? candidates as StandardMcpImportCandidate[]
      : null
  }

  const candidate = parseStandardImportCandidate(resolveSingleServerId(value), value)
  return candidate === null ? null : [candidate]
}

function parseStandardImportCandidate(serverId: string, value: unknown): StandardMcpImportCandidate | null {
  const draft = parseServerEntry(serverId, value)
  if (draft === null) {
    return null
  }

  return {
    serverId: draft.serverId,
    displayName: draft.displayName,
    draft,
  }
}

function resolveSingleServerId(value: Record<string, unknown>): string {
  if (typeof value.serverId === 'string' && value.serverId.trim() !== '') {
    return value.serverId.trim()
  }

  if (typeof value.displayName === 'string' && value.displayName.trim() !== '') {
    return value.displayName.trim()
  }

  if (typeof value.name === 'string' && value.name.trim() !== '') {
    return value.name.trim()
  }

  return ''
}

function parseAddDocument(value: unknown): McpServerDraft[] | null {
  if (isPlainRecord(value) && isPlainRecord(value.mcpServers)) {
    const parsedMap = parseMcpServersMap(value.mcpServers)
    return parsedMap !== null && parsedMap.length === 1 ? parsedMap : null
  }

  if (!isPlainRecord(value)) {
    return null
  }

  const serverId = typeof value.serverId === 'string' ? value.serverId : ''
  const draft = parseServerEntry(serverId, value)
  return draft === null ? null : [draft]
}

function parseMcpServersMap(value: Record<string, unknown>): McpServerDraft[] | null {
  const drafts: McpServerDraft[] = []
  for (const [serverId, entry] of Object.entries(value)) {
    const draft = parseServerEntry(serverId, entry)
    if (draft === null) {
      return null
    }

    drafts.push(draft)
  }

  return drafts
}

function parseServerEntry(serverId: string, value: unknown): McpServerDraft | null {
  if (!isPlainRecord(value)) {
    return null
  }

  const explicitTransportConfig = isPlainRecord(value.transportConfig) ? parseExplicitTransportConfig(value.transportConfig) : null
  const transportConfig = explicitTransportConfig ?? parseLegacyTransportConfig(value)
  if (transportConfig === null) {
    return null
  }

  const normalizedServerId = typeof value.serverId === 'string' && value.serverId.trim() !== ''
    ? value.serverId.trim()
    : serverId.trim()

  return {
    serverId: normalizedServerId,
    displayName: typeof value.displayName === 'string' && value.displayName.trim() !== ''
      ? value.displayName.trim()
      : normalizedServerId,
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    transportKind: explicitTransportConfig?.kind ?? transportConfig.kind,
    description: typeof value.description === 'string' && value.description.trim() !== '' ? value.description.trim() : null,
    transportConfig,
    reservedSensitiveFields: Array.isArray(value.reservedSensitiveFields)
      ? value.reservedSensitiveFields.filter((entry): entry is string => typeof entry === 'string')
      : undefined,
  }
}

function parseExplicitTransportConfig(value: Record<string, unknown>): McpTransportConfig | null {
  if (value.kind === 'stdio') {
    return {
      kind: 'stdio',
      command: typeof value.command === 'string' ? value.command : '',
      args: Array.isArray(value.args) ? value.args.filter((entry): entry is string => typeof entry === 'string') : [],
      cwd: typeof value.cwd === 'string' ? value.cwd : null,
      ...(isPlainRecord(value.env) ? { env: mapStringRecord(value.env) } : {}),
    }
  }

  if (value.kind === 'http-sse') {
    return {
      kind: 'http-sse',
      baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : '',
      ...(isPlainRecord(value.headers) ? { headers: mapStringRecord(value.headers) } : {}),
      ...(isPlainRecord(value.env) ? { env: mapStringRecord(value.env) } : {}),
      ssePathOverride: typeof value.ssePathOverride === 'string' ? value.ssePathOverride : null,
    }
  }

  return null
}

function parseLegacyTransportConfig(value: Record<string, unknown>): McpTransportConfig | null {
  const transport = typeof value.transport === 'string' ? value.transport.trim().toLowerCase() : ''

  if (transport === 'stdio' || typeof value.command === 'string') {
    return {
      kind: 'stdio',
      command: typeof value.command === 'string' ? value.command : '',
      args: Array.isArray(value.args) ? value.args.filter((entry): entry is string => typeof entry === 'string') : [],
      cwd: typeof value.cwd === 'string' ? value.cwd : null,
      ...(isPlainRecord(value.env) ? { env: mapStringRecord(value.env) } : {}),
    }
  }

  if (transport === 'http' || transport === 'http-sse' || typeof value.url === 'string' || typeof value.baseUrl === 'string') {
    return {
      kind: 'http-sse',
      baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : typeof value.url === 'string' ? value.url : '',
      ...(isPlainRecord(value.headers) ? { headers: mapStringRecord(value.headers) } : {}),
      ...(isPlainRecord(value.env) ? { env: mapStringRecord(value.env) } : {}),
      ssePathOverride: typeof value.ssePathOverride === 'string' ? value.ssePathOverride : null,
    }
  }

  return null
}

function validateDraft(draft: McpServerDraft): McpServerValidationError[] {
  const validationErrors: McpServerValidationError[] = []

  if (draft.serverId.trim() === '') {
    validationErrors.push({ fieldPath: 'serverId', message: 'serverId 不能为空。', code: 'required' })
  }

  if (draft.displayName.trim() === '') {
    validationErrors.push({ fieldPath: 'displayName', message: 'displayName 不能为空。', code: 'required' })
  }

  if (draft.transportKind !== draft.transportConfig.kind) {
    validationErrors.push({ fieldPath: 'transportKind', message: 'transportKind 必须与 transportConfig.kind 一致。', code: 'transport_kind_mismatch' })
  }

  if (draft.transportConfig.kind === 'stdio') {
    if (draft.transportConfig.command.trim() === '') {
      validationErrors.push({ fieldPath: 'transportConfig.command', message: 'stdio 服务器必须提供 command。', code: 'required' })
    }
  } else if (!isHttpUrl(draft.transportConfig.baseUrl)) {
    validationErrors.push({ fieldPath: 'transportConfig.baseUrl', message: 'HTTP / SSE 服务器必须提供有效的 http(s) URL。', code: 'invalid_url' })
  }

  return validationErrors
}

function cloneTransportConfig(config: McpTransportConfig): McpTransportConfig {
  if (config.kind === 'stdio') {
    return {
      ...config,
      args: [...config.args],
      ...(config.env === undefined ? {} : { env: { ...config.env } }),
    }
  }

  return {
    ...config,
    ...(config.headers === undefined ? {} : { headers: { ...config.headers } }),
    ...(config.env === undefined ? {} : { env: { ...config.env } }),
  }
}

function mapStringRecord(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => typeof entryValue === 'string')
      .map(([entryKey, entryValue]) => [entryKey, entryValue as string]),
  )
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function resolveMessageTone(
  operationMessage: string | null,
  lastErrorMessage: string | null,
): McpRegistryServerViewModel['messageTone'] {
  if (operationMessage !== null) {
    return inferMessageTone(operationMessage)
  }

  if (lastErrorMessage !== null) {
    return 'error'
  }

  return 'success'
}

function inferMessageTone(message: string): McpRegistryServerViewModel['messageTone'] {
  if (/失败|错误/iu.test(message)) {
    return 'error'
  }

  if (/受限|降级|保留上次/iu.test(message)) {
    return 'warning'
  }

  if (/成功|已保存|已禁用|已移除/iu.test(message)) {
    return 'success'
  }

  return 'info'
}

function resolveBusyOperationLabel(operation: McpBusyOperation | null): string | null {
  switch (operation) {
    case 'saving':
      return '保存中'
    case 'testing':
      return '测试中'
    case 'refreshing':
      return '刷新中'
    case 'toggling':
      return '更新中'
    case 'deleting':
      return '删除中'
    default:
      return null
  }
}

function formatTimestamp(value: string | null): string | null {
  if (typeof value !== 'string' || value.trim() === '') {
    return null
  }

  return value.replace('T', ' ').replace(/\.\d{3}Z$/, 'Z')
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
