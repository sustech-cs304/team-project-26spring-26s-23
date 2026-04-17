import { useEffect, useMemo, useState } from 'react'

import type {
  SettingsWorkspaceStateSaveInput,
  SettingsWorkspaceToolPermissionPolicyState,
  ToolPermissionPolicyMode,
  ToolPermissionPolicySource,
} from '../../../electron/settings-workspace/schema'
import type { RuntimeToolDirectoryEntry, RuntimeToolPresentationGroup } from '../../features/copilot/chat-contract'
import {
  loadSettingsWorkspaceState,
  saveSettingsWorkspaceState,
} from '../settings/workspace-state'
import { appendCopilotDebugLog } from '../../features/copilot/debug-mode-log'
import { loadConfigCenterPublicSnapshot } from '../../features/copilot/config-center'
import { loadToolCatalog } from './tool-catalog'
import { CapabilitiesSecondaryNav } from './CapabilitiesSecondaryNav'
import { projectDebugModeEnabledFromConfigCenterPublicSnapshot } from '../../features/copilot/config-center'
import {
  capabilitiesNavItems,
  mockMcpServers,
  resolveMcpEditorSeed,
  type CapabilitiesSection,
  type McpServerEditorMode,
  type McpServerRecord,
  type ToolPermissionDelayAction,
  type ToolPermissionMode,
  type ToolPermissionRecord,
} from './capabilities-demo'
import { McpServerEditorDialog } from './McpServerEditorDialog'
import { McpServersPanel } from './McpServersPanel'
import { ToolPermissionsPanel } from './ToolPermissionsPanel'

interface McpServerEditorState {
  mode: McpServerEditorMode
  value: string
}

interface ToolCatalogLoadState {
  status: 'idle' | 'ready' | 'fallback' | 'error'
  error: string | null
  source: 'runtime' | 'fallback' | null
}

const FALLBACK_DELAY_ACTION: ToolPermissionDelayAction = 'approve'
const FALLBACK_DELAY_SECONDS = 15
const TOOL_PERMISSION_UPDATED_AT = '2026-04-17T00:00:00.000Z'
const FALLBACK_TOOL_CATALOG_ERROR = 'Hosted backend runtime tool catalog is temporarily unavailable. Using built-in fallback catalog.'
const EMPTY_TOOL_CATALOG_ERROR = 'Hosted backend returned an empty tool catalog. Using built-in fallback catalog.'
const INCOMPLETE_TOOL_CATALOG_ERROR = 'Hosted backend returned an incomplete tool catalog. Using built-in fallback catalog.'


export function CapabilitiesWorkspace() {
  const [activeSection, setActiveSection] = useState<CapabilitiesSection>('tool-permissions')
  const [toolPermissions, setToolPermissions] = useState<ToolPermissionRecord[]>([])
  const [mcpServers, setMcpServers] = useState<McpServerRecord[]>(() => (
    mockMcpServers.map((server) => ({ ...server }))
  ))
  const [editorState, setEditorState] = useState<McpServerEditorState | null>(null)
  const [settingsState, setSettingsState] = useState<SettingsWorkspaceStateSaveInput | null>(null)
  const [toolCatalogLoadState, setToolCatalogLoadState] = useState<ToolCatalogLoadState>({
    status: 'idle',
    error: null,
    source: null,
  })

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const snapshotResult = await loadConfigCenterPublicSnapshot()
      const debugModeEnabled = snapshotResult.ok
        && projectDebugModeEnabledFromConfigCenterPublicSnapshot(snapshotResult.snapshot)
      const preferredLanguage = snapshotResult.ok ? snapshotResult.snapshot.domains.general.language : null
      const [settingsResult, toolCatalogResult] = await Promise.all([
        loadSettingsWorkspaceState(),
        loadToolCatalog(preferredLanguage),
      ])

      if (cancelled) {
        return
      }

      appendCopilotDebugLog(debugModeEnabled, 'capabilities-workspace', 'tool-catalog-load-result', toolCatalogResult.ok
        ? {
            ok: true,
            toolCount: toolCatalogResult.tools.length,
            toolIds: toolCatalogResult.tools.map((tool) => tool.toolId),
          }
        : {
            ok: false,
            error: toolCatalogResult.error,
          })

      const resolvedCatalog = resolveRenderableToolCatalog(toolCatalogResult)
      setToolCatalogLoadState({
        status: resolvedCatalog.status,
        error: resolvedCatalog.error,
        source: resolvedCatalog.source,
      })

      if (!settingsResult.ok) {
        setSettingsState(null)
        setToolPermissions([])
        return
      }

      const nextSettingsState = settingsResult.state as unknown as SettingsWorkspaceStateSaveInput
      const policy = nextSettingsState.mcp.toolPermissionPolicy

      setSettingsState(nextSettingsState)
      setToolPermissions(buildToolPermissionRecords(resolvedCatalog.tools, policy))
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const activeNavItem = useMemo(
    () => capabilitiesNavItems.find((item) => item.id === activeSection) ?? capabilitiesNavItems[0],
    [activeSection],
  )

  const persistToolPermissions = (nextTools: ToolPermissionRecord[]) => {
    setToolPermissions(nextTools)

    if (settingsState === null) {
      return
    }

    const nextPolicy = buildPolicyStateFromTools(nextTools, settingsState.mcp.toolPermissionPolicy)
    const nextState: SettingsWorkspaceStateSaveInput = {
      ...settingsState,
      mcp: {
        ...settingsState.mcp,
        toolPermissionMode: mapDefaultModeToLegacyMode(nextPolicy.defaultMode),
        toolPermissionPolicy: nextPolicy,
      },
    }

    void saveSettingsWorkspaceState(nextState)
    setSettingsState(nextState)
  }

  const handleModeChange = (toolId: string, mode: ToolPermissionMode) => {
    persistToolPermissions(toolPermissions.map((tool) => (
      tool.id === toolId
        ? {
            ...tool,
            mode,
          }
        : tool
    )))
  }

  const handleDelayActionChange = (toolId: string, action: ToolPermissionDelayAction) => {
    persistToolPermissions(toolPermissions.map((tool) => (
      tool.id === toolId
        ? {
            ...tool,
            delayAction: action,
          }
        : tool
    )))
  }

  const handleDelaySecondsChange = (toolId: string, seconds: number) => {
    persistToolPermissions(toolPermissions.map((tool) => (
      tool.id === toolId
        ? {
            ...tool,
            delaySeconds: Math.max(3, Math.min(300, seconds)),
          }
        : tool
    )))
  }

  const openMcpEditor = (mode: McpServerEditorMode) => {
    setEditorState({
      mode,
      value: resolveMcpEditorSeed(mode),
    })
  }

  const handleToggleMcpServer = (serverId: string) => {
    setMcpServers((previous) => previous.map((server) => (
      server.id === serverId
        ? {
            ...server,
            enabled: !server.enabled,
          }
        : server
    )))
  }

  const handleDeleteMcpServer = (serverId: string) => {
    setMcpServers((previous) => previous.filter((server) => server.id !== serverId))
  }

  return (
    <>
      <section className="workspace-stage capabilities-workspace" aria-label="能力中心工作区">
        <CapabilitiesSecondaryNav
          items={capabilitiesNavItems}
          activeSection={activeSection}
          onSelect={setActiveSection}
        />

        <main className="workspace-main capabilities-main" aria-label="能力中心主内容区">
          <header className="workspace-main__header capabilities-main__header">
            <div>
              <p className="workspace-main__eyebrow">能力中心</p>
              <h2 className="workspace-main__title">{activeNavItem.label}</h2>
            </div>

            {activeSection === 'mcp-servers' ? (
              <div className="toolbar-actions capabilities-main__actions">
                <button
                  type="button"
                  className="secondary-button secondary-button--subtle"
                  onClick={() => openMcpEditor('edit')}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => openMcpEditor('add')}
                >
                  添加
                </button>
              </div>
            ) : null}
          </header>

          <section
            className="workspace-main__content capabilities-main__content"
            id={`capabilities-panel-${activeSection}`}
            aria-label={`${activeNavItem.label}内容区`}
          >
            {activeSection === 'tool-permissions' ? (
              <ToolPermissionsPanel
                tools={toolPermissions}
                statusMessage={resolveToolPermissionStatusMessage(toolCatalogLoadState)}
                onModeChange={handleModeChange}
                onDelayActionChange={handleDelayActionChange}
                onDelaySecondsChange={handleDelaySecondsChange}
              />
            ) : (
              <McpServersPanel
                servers={mcpServers}
                onToggleEnabled={handleToggleMcpServer}
                onDelete={handleDeleteMcpServer}
              />
            )}
          </section>
        </main>
      </section>

      {editorState ? (
        <McpServerEditorDialog
          mode={editorState.mode}
          value={editorState.value}
          onValueChange={(value) => {
            setEditorState((previous) => (previous === null ? previous : {
              ...previous,
              value,
            }))
          }}
          onClose={() => setEditorState(null)}
          onConfirm={() => setEditorState(null)}
        />
      ) : null}
    </>
  )
}

function buildToolPermissionRecords(
  toolCatalog: RuntimeToolDirectoryEntry[],
  policy: SettingsWorkspaceToolPermissionPolicyState,
): ToolPermissionRecord[] {
  return toolCatalog.map((tool, index) => {
    const persisted = policy.toolPermissions[tool.toolId]
    const resolvedMode = persisted?.mode ?? policy.defaultMode

    return {
      id: tool.toolId,
      groupId: resolveToolGroupId(tool),
      name: tool.displayNameZh ?? tool.displayName ?? tool.displayNameEn ?? tool.toolId,
      description: tool.descriptionZh ?? tool.description ?? tool.descriptionEn ?? '该工具尚未提供详细说明。',
      toolId: tool.toolId,
      mode: resolvedMode,
      delayAction: FALLBACK_DELAY_ACTION,
      delaySeconds: FALLBACK_DELAY_SECONDS + index,
    }
  })
}

function resolveToolGroupId(tool: RuntimeToolDirectoryEntry): ToolPermissionRecord['groupId'] {
  const group = tool.group
  if (group !== undefined && group !== null && group.id.trim() !== '') {
    return group.id
  }

  return resolveFallbackToolGroup(tool)
}

function resolveFallbackToolGroup(tool: RuntimeToolDirectoryEntry): ToolPermissionRecord['groupId'] {
  if (tool.kind === 'builtin') {
    return 'builtin-core'
  }

  const namespace = tool.toolId.split(/[.-]/, 1)[0]?.toLowerCase()
  if (namespace === 'blackboard') {
    return 'blackboard'
  }
  if (namespace === 'tis') {
    return 'tis'
  }
  return 'mcp'
}

function buildPolicyStateFromTools(
  tools: ToolPermissionRecord[],
  previousPolicy: SettingsWorkspaceToolPermissionPolicyState,
): SettingsWorkspaceToolPermissionPolicyState {
  const defaultMode = resolveDefaultMode(tools, previousPolicy.defaultMode)
  const toolPermissions = {
    ...collectPersistedOrphanPolicies(previousPolicy, tools),
    ...Object.fromEntries(tools.flatMap((tool) => {
      const normalizedMode = tool.mode === 'delay' ? 'ask' : tool.mode

      if (normalizedMode === defaultMode) {
        return []
      }

      const nextEntry = {
        mode: normalizedMode,
        source: 'user' as ToolPermissionPolicySource,
        updatedAt: TOOL_PERMISSION_UPDATED_AT,
      }

      return [[tool.toolId, nextEntry]]
    })),
  }

  return {
    version: 1,
    defaultMode,
    toolPermissions,
  }
}

function resolveDefaultMode(
  tools: ToolPermissionRecord[],
  fallbackMode: ToolPermissionPolicyMode,
): ToolPermissionPolicyMode {
  const counts = {
    allow: 0,
    ask: 0,
    deny: 0,
  }

  if (tools.length === 0) {
    return fallbackMode
  }

  for (const tool of tools) {
    const normalizedMode = tool.mode === 'delay' ? 'ask' : tool.mode
    counts[normalizedMode] += 1
  }

  if (counts.allow >= counts.ask && counts.allow >= counts.deny) {
    return 'allow'
  }
  if (counts.deny >= counts.ask) {
    return 'deny'
  }
  return 'ask'
}

function collectPersistedOrphanPolicies(
  previousPolicy: SettingsWorkspaceToolPermissionPolicyState,
  tools: ToolPermissionRecord[],
): Record<string, SettingsWorkspaceToolPermissionPolicyState['toolPermissions'][string]> {
  const knownToolIds = new Set(tools.map((tool) => tool.toolId))

  return Object.fromEntries(Object.entries(previousPolicy.toolPermissions).flatMap(([toolId, policyEntry]) => {
    return knownToolIds.has(toolId) ? [] : [[toolId, policyEntry]]
  }))
}

function resolveRenderableToolCatalog(
  result: { ok: true, tools: RuntimeToolDirectoryEntry[] } | { ok: false, error: string },
): {
  status: ToolCatalogLoadState['status']
  error: string | null
  source: ToolCatalogLoadState['source']
  tools: RuntimeToolDirectoryEntry[]
} {
  if (!result.ok) {
    return {
      status: 'fallback',
      error: FALLBACK_TOOL_CATALOG_ERROR,
      source: 'fallback',
      tools: createStaticFallbackToolCatalog(),
    }
  }

  const completeTools = result.tools.filter(isRenderableToolCatalogEntry)
  if (completeTools.length === 0) {
    return {
      status: 'fallback',
      error: EMPTY_TOOL_CATALOG_ERROR,
      source: 'fallback',
      tools: createStaticFallbackToolCatalog(),
    }
  }

  if (completeTools.length !== result.tools.length) {
    return {
      status: 'fallback',
      error: INCOMPLETE_TOOL_CATALOG_ERROR,
      source: 'fallback',
      tools: createStaticFallbackToolCatalog(),
    }
  }

  return {
    status: 'ready',
    error: null,
    source: 'runtime',
    tools: completeTools,
  }
}

function isRenderableToolCatalogEntry(tool: RuntimeToolDirectoryEntry): boolean {
  return typeof tool.toolId === 'string'
    && tool.toolId.trim() !== ''
    && typeof resolveToolLabel(tool) === 'string'
    && resolveToolLabel(tool).trim() !== ''
}

function resolveToolLabel(tool: RuntimeToolDirectoryEntry): string {
  return tool.displayNameZh ?? tool.displayName ?? tool.displayNameEn ?? tool.toolId
}

// Keep fallback catalog grouping aligned with the runtime tool catalog contract.
const FALLBACK_TOOL_GROUPS: Record<string, RuntimeToolPresentationGroup> = {
  'builtin-core': {
    id: 'builtin-core',
    label: '内置基础工具',
    labelZh: '内置基础工具',
    labelEn: 'Built-in Core Tools',
    order: 0,
    sourceKind: 'builtin',
  },
  blackboard: {
    id: 'blackboard',
    label: 'Blackboard 工具',
    labelZh: 'Blackboard 工具',
    labelEn: 'Blackboard Tools',
    order: 10,
    sourceKind: 'sustech-blackboard',
  },
  tis: {
    id: 'tis',
    label: 'TIS 工具',
    labelZh: 'TIS 工具',
    labelEn: 'TIS Tools',
    order: 20,
    sourceKind: 'sustech-tis',
  },
  mcp: {
    id: 'mcp',
    label: 'MCP 工具',
    labelZh: 'MCP 工具',
    labelEn: 'MCP Tools',
    order: 100,
    sourceKind: 'mcp-server',
  },
}

function createStaticFallbackToolCatalog(): RuntimeToolDirectoryEntry[] {
  return [
    {
      toolId: 'functions.read_file',
      kind: 'builtin',
      availability: 'available',
      displayName: '读取文件',
      description: '读取项目内文件内容，用于理解上下文与定位实现细节。',
      group: FALLBACK_TOOL_GROUPS['builtin-core'],
    },
    {
      toolId: 'functions.execute_command',
      kind: 'builtin',
      availability: 'available',
      displayName: '执行命令',
      description: '运行本地终端命令，适合构建、检查与资源处理。',
      group: FALLBACK_TOOL_GROUPS['builtin-core'],
    },
    {
      toolId: 'functions.write_to_file',
      kind: 'builtin',
      availability: 'available',
      displayName: '写入文件',
      description: '创建或重写文件，适用于页面搭建、样式输出与配置修改。',
      group: FALLBACK_TOOL_GROUPS['builtin-core'],
    },
    {
      toolId: 'mcp--fetch--fetch',
      kind: 'external',
      availability: 'available',
      displayName: '联网抓取',
      description: '抓取网页内容，用于补充外部说明与页面上下文。',
      group: FALLBACK_TOOL_GROUPS.mcp,
    },
    {
      toolId: 'mcp--puppeteer--puppeteer_navigate',
      kind: 'external',
      availability: 'available',
      displayName: '浏览器自动化',
      description: '驱动浏览器执行界面级操作，用于录制流程或验证可见交互。',
      group: FALLBACK_TOOL_GROUPS.mcp,
    },
  ]
}

function resolveToolPermissionStatusMessage(state: ToolCatalogLoadState): string | null {
  if (state.status === 'fallback' || state.status === 'error') {
    return state.error ?? '工具目录暂时不可用，当前显示内建降级目录。'
  }

  return null
}

function mapDefaultModeToLegacyMode(mode: ToolPermissionPolicyMode): string {
  switch (mode) {
    case 'allow':
      return 'trusted'
    case 'deny':
      return 'strict'
    case 'ask':
    default:
      return 'manual'
  }
}
