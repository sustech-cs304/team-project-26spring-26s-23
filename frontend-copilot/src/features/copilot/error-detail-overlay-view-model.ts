import type {
  RuntimeModelRoute,
  RuntimeResolvedModelRoute,
} from './thread-run-contract'

export type CopilotErrorDetailSourceKind = 'preflight' | 'run-start' | 'streaming'

export interface CopilotErrorDetailMeta {
  stage?: string | null
  requestedMethod?: string | null
  status?: number | null
  rawMessage?: string | null
  summaryMessage?: string | null
  resolvedToolIds?: string[]
}

export interface CopilotErrorDetailSource {
  source: CopilotErrorDetailSourceKind
  title: string
  summaryMessage: string
  rawMessage: string | null
  code: string | null
  stage: string | null
  requestedMethod: string | null
  status: number | null
  details: Record<string, unknown>
  resolvedModelId: string | null
  resolvedModelRoute: RuntimeResolvedModelRoute | RuntimeModelRoute | null
  resolvedToolIds: string[]
  requestOptions: Record<string, unknown>
}

export type ErrorDetailOverlayGroupKey =
  | 'summary'
  | 'request-context'
  | 'tool-model-context'
  | 'raw-details'

export type ErrorDetailOverlayStructuredJsonValue = Record<string, unknown> | unknown[]

export type ErrorDetailOverlayContentItem =
  | {
      kind: 'key-value'
      label: string
      value: string
    }
  | {
      kind: 'list'
      label: string
      values: string[]
    }
  | {
      kind: 'text'
      label: string | null
      text: string
      presentation?: 'plain-text' | 'json'
      structuredValue?: ErrorDetailOverlayStructuredJsonValue
    }

export interface ErrorDetailOverlayGroup {
  key: ErrorDetailOverlayGroupKey
  title: string
  description: string
  items: ErrorDetailOverlayContentItem[]
}

export interface ErrorDetailOverlayViewModel {
  title: string
  summaryMessage: string
  source: CopilotErrorDetailSourceKind
  code: string | null
  stage: string | null
  groups: ErrorDetailOverlayGroup[]
  hasAdditionalDetails: boolean
  emptyStateMessage: string | null
}

const ERROR_DETAIL_META_KEYS = {
  stage: '__copilotMeta_stage',
  requestedMethod: '__copilotMeta_requestedMethod',
  status: '__copilotMeta_status',
  rawMessage: '__copilotMeta_rawMessage',
  summaryMessage: '__copilotMeta_summaryMessage',
  resolvedToolIds: '__copilotMeta_resolvedToolIds',
} as const

const groupOrder: Record<ErrorDetailOverlayGroupKey, number> = {
  summary: 0,
  'request-context': 1,
  'tool-model-context': 2,
  'raw-details': 3,
}

export function withCopilotErrorDetailMeta(
  details: Record<string, unknown> | null | undefined,
  meta: CopilotErrorDetailMeta,
): Record<string, unknown> {
  const nextDetails = cloneRecord(details)

  if (hasNonEmptyString(meta.stage)) {
    nextDetails[ERROR_DETAIL_META_KEYS.stage] = meta.stage.trim()
  }
  if (hasNonEmptyString(meta.requestedMethod)) {
    nextDetails[ERROR_DETAIL_META_KEYS.requestedMethod] = meta.requestedMethod.trim()
  }
  if (typeof meta.status === 'number' && Number.isFinite(meta.status)) {
    nextDetails[ERROR_DETAIL_META_KEYS.status] = meta.status
  }
  if (hasNonEmptyString(meta.rawMessage)) {
    nextDetails[ERROR_DETAIL_META_KEYS.rawMessage] = meta.rawMessage.trim()
  }
  if (hasNonEmptyString(meta.summaryMessage)) {
    nextDetails[ERROR_DETAIL_META_KEYS.summaryMessage] = meta.summaryMessage.trim()
  }

  const resolvedToolIds = dedupeStringArray(meta.resolvedToolIds ?? [])
  if (resolvedToolIds.length > 0) {
    nextDetails[ERROR_DETAIL_META_KEYS.resolvedToolIds] = resolvedToolIds
  }

  return nextDetails
}

export function readCopilotErrorDetailMeta(
  details: Record<string, unknown> | null | undefined,
): CopilotErrorDetailMeta {
  const sourceDetails = details ?? {}

  return {
    stage: readOptionalString(sourceDetails[ERROR_DETAIL_META_KEYS.stage]),
    requestedMethod: readOptionalString(sourceDetails[ERROR_DETAIL_META_KEYS.requestedMethod]),
    status: readOptionalNumber(sourceDetails[ERROR_DETAIL_META_KEYS.status]),
    rawMessage: readOptionalString(sourceDetails[ERROR_DETAIL_META_KEYS.rawMessage]),
    summaryMessage: readOptionalString(sourceDetails[ERROR_DETAIL_META_KEYS.summaryMessage]),
    resolvedToolIds: readOptionalStringArray(sourceDetails[ERROR_DETAIL_META_KEYS.resolvedToolIds]),
  }
}

export function stripCopilotErrorDetailMeta(
  details: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const nextDetails = cloneRecord(details)

  for (const key of Object.values(ERROR_DETAIL_META_KEYS)) {
    delete nextDetails[key]
  }

  return nextDetails
}

export function createCopilotErrorDetailSource(input: {
  source: CopilotErrorDetailSourceKind
  title?: string | null
  summaryMessage: string
  rawMessage?: string | null
  code?: string | null
  stage?: string | null
  requestedMethod?: string | null
  status?: number | null
  details?: Record<string, unknown> | null
  resolvedModelId?: string | null
  resolvedModelRoute?: RuntimeResolvedModelRoute | RuntimeModelRoute | null
  resolvedToolIds?: string[] | null
  requestOptions?: Record<string, unknown> | null
}): CopilotErrorDetailSource {
  return {
    source: input.source,
    title: readOptionalString(input.title) ?? '发送失败',
    summaryMessage: input.summaryMessage.trim() === '' ? '当前响应失败，请重试。' : input.summaryMessage.trim(),
    rawMessage: readOptionalString(input.rawMessage),
    code: readOptionalString(input.code),
    stage: readOptionalString(input.stage),
    requestedMethod: readOptionalString(input.requestedMethod),
    status: typeof input.status === 'number' && Number.isFinite(input.status)
      ? input.status
      : null,
    details: cloneRecord(input.details),
    resolvedModelId: readOptionalString(input.resolvedModelId),
    resolvedModelRoute: cloneRuntimeModelRoute(input.resolvedModelRoute ?? null),
    resolvedToolIds: dedupeStringArray(input.resolvedToolIds ?? []),
    requestOptions: cloneRecord(input.requestOptions),
  }
}

export function buildErrorDetailOverlayViewModel(
  source: CopilotErrorDetailSource,
): ErrorDetailOverlayViewModel {
  const summaryGroup = buildSummaryGroup(source)
  const requestContextGroup = buildRequestContextGroup(source)
  const toolModelContextGroup = buildToolModelContextGroup(source)
  const rawDetailsGroup = buildRawDetailsGroup(source)

  const groups = [
    summaryGroup,
    requestContextGroup,
    toolModelContextGroup,
    rawDetailsGroup,
  ]
    .filter((group): group is ErrorDetailOverlayGroup => group !== null)
    .sort((left, right) => groupOrder[left.key] - groupOrder[right.key])

  const hasAdditionalDetails = groups.some((group) => group.key !== 'summary')

  return {
    title: source.title,
    summaryMessage: source.summaryMessage,
    source: source.source,
    code: source.code,
    stage: source.stage,
    groups,
    hasAdditionalDetails,
    emptyStateMessage: hasAdditionalDetails ? null : '暂无更多详情',
  }
}

function buildSummaryGroup(source: CopilotErrorDetailSource): ErrorDetailOverlayGroup {
  const items: ErrorDetailOverlayContentItem[] = [
    {
      kind: 'key-value',
      label: '标题',
      value: source.title,
    },
    {
      kind: 'key-value',
      label: '说明',
      value: source.summaryMessage,
    },
  ]

  if (source.stage !== null) {
    items.push({
      kind: 'key-value',
      label: '失败阶段',
      value: source.stage,
    })
  }

  if (source.code !== null) {
    items.push({
      kind: 'key-value',
      label: '错误码',
      value: source.code,
    })
  }

  return {
    key: 'summary',
    title: '摘要',
    description: '概括这次失败发生了什么，便于先快速判断问题方向。',
    items,
  }
}

function buildRequestContextGroup(source: CopilotErrorDetailSource): ErrorDetailOverlayGroup | null {
  const items: ErrorDetailOverlayContentItem[] = []

  if (source.requestedMethod !== null) {
    items.push({
      kind: 'key-value',
      label: '请求动作',
      value: source.requestedMethod,
    })
  }

  if (source.stage !== null) {
    items.push({
      kind: 'key-value',
      label: '阶段',
      value: source.stage,
    })
  }

  if (source.status !== null) {
    items.push({
      kind: 'key-value',
      label: '状态码',
      value: String(source.status),
    })
  }

  const requestOptionsSummary = summarizeRecord(source.requestOptions)
  if (requestOptionsSummary !== null) {
    items.push({
      kind: 'key-value',
      label: '请求选项',
      value: requestOptionsSummary,
    })
  }

  return items.length === 0
    ? null
    : {
        key: 'request-context',
        title: '请求 / 运行上下文',
        description: '说明失败发生在哪个请求动作或运行阶段。',
        items,
      }
}

function buildToolModelContextGroup(source: CopilotErrorDetailSource): ErrorDetailOverlayGroup | null {
  const items: ErrorDetailOverlayContentItem[] = []
  const modelId = source.resolvedModelId ?? readModelIdFromRoute(source.resolvedModelRoute)
  const routeSummary = formatRouteSummary(source.resolvedModelRoute)

  if (modelId !== null) {
    items.push({
      kind: 'key-value',
      label: '模型',
      value: modelId,
    })
  }

  if (routeSummary !== null) {
    items.push({
      kind: 'key-value',
      label: '路由',
      value: routeSummary,
    })
  }

  if (source.resolvedToolIds.length > 0) {
    items.push({
      kind: 'list',
      label: '工具',
      values: source.resolvedToolIds,
    })
  }

  return items.length === 0
    ? null
    : {
        key: 'tool-model-context',
        title: '工具 / 模型上下文',
        description: '展示和本次失败相关的模型、路由与工具上下文。',
        items,
      }
}

function buildRawDetailsGroup(source: CopilotErrorDetailSource): ErrorDetailOverlayGroup | null {
  const items: ErrorDetailOverlayContentItem[] = []
  const rawMessage = source.rawMessage === null || source.rawMessage === source.summaryMessage
    ? null
    : source.rawMessage
  const rawDetails = stripCopilotErrorDetailMeta(source.details)

  if (rawMessage !== null) {
    items.push({
      kind: 'text',
      label: '原始消息',
      text: rawMessage,
    })
  }

  const rawDetailsText = stringifyRecord(rawDetails)
  if (rawDetailsText !== null) {
    const structuredValue = parseErrorDetailJsonTextForViewer(rawDetailsText)
    items.push({
      kind: 'text',
      label: '原始 details',
      text: rawDetailsText,
      presentation: structuredValue === null ? 'plain-text' : 'json',
      ...(structuredValue === null ? {} : { structuredValue }),
    })
  }

  return items.length === 0
    ? null
    : {
        key: 'raw-details',
        title: '原始详情',
        description: '保留未经产品化改写的底层错误信息，便于转交排查。',
        items,
      }
}

function summarizeRecord(record: Record<string, unknown>): string | null {
  if (Object.keys(record).length === 0) {
    return null
  }

  const serialized = JSON.stringify(record)
  if (serialized === undefined || serialized.trim() === '') {
    return null
  }

  return serialized.length > 160 ? `${serialized.slice(0, 157)}…` : serialized
}

function stringifyRecord(record: Record<string, unknown>): string | null {
  if (Object.keys(record).length === 0) {
    return null
  }

  const serialized = JSON.stringify(record, null, 2)
  return serialized === undefined || serialized.trim() === '' ? null : serialized
}

export function parseErrorDetailJsonTextForViewer(
  text: string,
): ErrorDetailOverlayStructuredJsonValue | null {
  const trimmedText = text.trim()
  if (trimmedText === '') {
    return null
  }

  try {
    const parsed = JSON.parse(trimmedText)
    return isErrorDetailStructuredJsonValue(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isErrorDetailStructuredJsonValue(
  value: unknown,
): value is ErrorDetailOverlayStructuredJsonValue {
  return Array.isArray(value) || (typeof value === 'object' && value !== null)
}

function formatRouteSummary(
  route: RuntimeResolvedModelRoute | RuntimeModelRoute | null,
): string | null {
  if (route === null) {
    return null
  }

  if ('providerId' in route) {
    const segments = [
      route.providerProfileId,
      route.provider || route.providerId,
      route.modelId,
      route.endpointType,
    ]

    return segments
      .map((segment) => segment?.trim() ?? '')
      .filter((segment) => segment !== '')
      .join(' / ')
      || null
  }

  const routeRef = route.routeRef
  if (routeRef === undefined || routeRef === null) {
    return null
  }

  return [routeRef.profileId, routeRef.modelId]
    .map((segment) => segment?.trim() ?? '')
    .filter((segment) => segment !== '')
    .join(' / ')
    || null
}

function readModelIdFromRoute(
  route: RuntimeResolvedModelRoute | RuntimeModelRoute | null,
): string | null {
  if (route === null) {
    return null
  }

  return 'providerId' in route ? route.modelId : route.routeRef?.modelId ?? null
}

function cloneRuntimeModelRoute(
  route: RuntimeResolvedModelRoute | RuntimeModelRoute | null,
): RuntimeResolvedModelRoute | RuntimeModelRoute | null {
  if (route === null) {
    return null
  }

  if ('providerId' in route) {
    return {
      routeRef: {
        routeKind: route.routeRef.routeKind,
        profileId: route.routeRef.profileId,
        modelId: route.routeRef.modelId,
      },
      providerProfileId: route.providerProfileId,
      provider: route.provider,
      providerId: route.providerId,
      adapterId: route.adapterId,
      runtimeStatus: route.runtimeStatus,
      catalogRevision: route.catalogRevision,
      endpointFamily: route.endpointFamily,
      endpointType: route.endpointType,
      baseUrl: route.baseUrl,
      modelId: route.modelId,
      authKind: route.authKind,
    }
  }

  return {
    ...(route.routeRef === undefined || route.routeRef === null
      ? {}
      : {
          routeRef: {
            routeKind: route.routeRef.routeKind,
            profileId: route.routeRef.profileId,
            modelId: route.routeRef.modelId,
          },
        }),
    ...(route.catalogRevision === undefined ? {} : { catalogRevision: route.catalogRevision }),
  }
}

function cloneRecord(
  record: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return record === null || record === undefined ? {} : { ...record }
}

function dedupeStringArray(values: string[]): string[] {
  const seen = new Set<string>()
  const nextValues: string[] = []

  for (const value of values) {
    const trimmedValue = value.trim()
    if (trimmedValue === '' || seen.has(trimmedValue)) {
      continue
    }

    seen.add(trimmedValue)
    nextValues.push(trimmedValue)
  }

  return nextValues
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

function readOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readOptionalStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? dedupeStringArray(value.filter((candidate): candidate is string => typeof candidate === 'string'))
    : []
}

function hasNonEmptyString(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim() !== ''
}
