import type {
  CopilotToolPlatformGroup,
  CopilotToolPresentation,
  CopilotToolPresentationSource,
} from './_presentation/types'
import {
  FALLBACK_GROUP_ORDER,
  MCP_GROUP_ORDER,
  STATIC_TOOL_PLATFORM_GROUPS,
  TOOL_NAMESPACE_DESCRIPTIONS,
  TOOL_PRESENTATION_OVERRIDES,
} from './_presentation/constants'
import {
  buildIdBasedToolName,
  containsCjk,
  extractToolNamespace,
  firstNonEmptyString,
  formatExplicitPlatformTitle,
  formatMcpRemoteToolLabel,
  formatPlatformLabel,
  isBuiltinToolKind,
  normalizeGroupKey,
  normalizeText,
  readNestedIdentity,
  readRecord,
  readStringRecordField,
  stripOpaqueMcpSuffix,
  truncateText,
} from './_presentation/helpers'

// Re-export types for backward compatibility
export type {
  CopilotToolPlatformGroup,
  CopilotToolPresentation,
  CopilotToolPresentationSource,
}

export function resolveCopilotToolPresentation(tool: CopilotToolPresentationSource): CopilotToolPresentation {
  const override = TOOL_PRESENTATION_OVERRIDES[tool.toolId]
  const platformGroup = resolveCopilotToolPlatformGroup(tool)
  const name = override?.name ?? resolveCanonicalName(tool) ?? buildFallbackToolName(tool)
  const description = override?.description ?? resolveCanonicalDescription(tool) ?? buildFallbackToolDescription(tool)

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

export function resolveCopilotToolDisplayNameFromToolId(toolId: string): string | null {
  return buildReadableMcpToolNameFromToolId(toolId) ?? buildIdBasedToolName(toolId)
}

export function resolveCopilotToolPlatformGroup(tool: CopilotToolPresentationSource): CopilotToolPlatformGroup {
  const explicitGroup = tool.group
  if (explicitGroup !== undefined && explicitGroup !== null) {
    return attachPlatformSearchKeywords({
      key: explicitGroup.id,
      title: explicitGroup.label,
      order: explicitGroup.order,
      sourceKind: mapSourceKind(explicitGroup.sourceKind),
    }, [explicitGroup.labelZh, explicitGroup.labelEn, explicitGroup.sourceKind])
  }

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

// ---- Private orchestration helpers ----

function resolveCanonicalName(tool: CopilotToolPresentationSource): string | null {
  return normalizeText(tool.displayNameZh)
    ?? normalizeText(tool.displayName)
    ?? normalizeText(tool.displayNameEn)
}

function resolveCanonicalDescription(tool: CopilotToolPresentationSource): string | null {
  return normalizeText(tool.descriptionZh)
    ?? normalizeText(tool.description)
    ?? normalizeText(tool.descriptionEn)
}

function mapSourceKind(sourceKind: string): CopilotToolPlatformGroup['sourceKind'] {
  switch (sourceKind) {
    case 'workspace':
    case 'builtin':
      return 'builtin'
    case 'remote':
    case 'mcp-server':
      return 'mcp-server'
    case 'sustech-blackboard':
    case 'sustech-tis':
    case 'fallback':
      return sourceKind
    default:
      return 'fallback'
  }
}

function buildFallbackToolName(tool: CopilotToolPresentationSource): string {
  const readableMcpName = buildReadableMcpToolName(tool)
  if (readableMcpName !== null) {
    return readableMcpName
  }

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

function buildReadableMcpToolName(tool: CopilotToolPresentationSource): string | null {
  const serverIdentity = resolveExplicitServerIdentity(tool) ?? resolveMcpServerIdentityFromToolId(tool.toolId)
  const remoteToolLabel = resolveMcpRemoteToolLabel(tool)
  if (serverIdentity === null || remoteToolLabel === null) {
    return null
  }

  return `${serverIdentity.title} / ${remoteToolLabel}`
}

function buildReadableMcpToolNameFromToolId(toolId: string): string | null {
  const serverIdentity = resolveMcpServerIdentityFromToolId(toolId)
  const remoteToolLabel = resolveMcpRemoteToolLabelFromToolId(toolId)
  if (serverIdentity === null || remoteToolLabel === null) {
    return null
  }

  return `${serverIdentity.title} / ${remoteToolLabel}`
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

function resolveMcpRemoteToolLabel(tool: CopilotToolPresentationSource): string | null {
  const toolRecord = readRecord(tool)
  const explicitRemoteToolName = firstNonEmptyString([
    readStringRecordField(toolRecord, 'remoteToolName'),
    readStringRecordField(toolRecord, 'toolName'),
    readStringRecordField(toolRecord, 'name'),
  ])

  return formatMcpRemoteToolLabel(explicitRemoteToolName)
    ?? resolveMcpRemoteToolLabelFromToolId(tool.toolId)
}

function resolveMcpRemoteToolLabelFromToolId(toolId: string): string | null {
  const normalizedToolId = normalizeText(toolId)
  if (normalizedToolId === null) {
    return null
  }

  const segments = normalizedToolId.split(/[.:/]+/).filter((segment) => segment.trim() !== '')
  if (segments.length < 3 || segments[0]?.toLowerCase() !== 'mcp') {
    return null
  }

  const remoteSegments = stripOpaqueMcpSuffix(segments.slice(2))
  if (remoteSegments.length === 0) {
    return null
  }

  return formatMcpRemoteToolLabel(remoteSegments.join(' '))
}
