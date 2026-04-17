import { useEffect, useMemo, useState } from 'react'

import type {
  SettingsWorkspaceStateSaveInput,
  SettingsWorkspaceToolPermissionPolicyState,
  ToolPermissionPolicyMode,
} from '../../../electron/settings-workspace/schema'
import type { RuntimeToolDirectoryEntry } from '../../features/copilot/chat-contract'
import {
  loadSettingsWorkspaceState,
  saveSettingsWorkspaceState,
} from '../settings/workspace-state'
import { CapabilitiesSecondaryNav } from './CapabilitiesSecondaryNav'
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

const FALLBACK_DELAY_ACTION: ToolPermissionDelayAction = 'approve'
const FALLBACK_DELAY_SECONDS = 15
const TOOL_PERMISSION_UPDATED_AT = '2026-04-17T00:00:00.000Z'

const DEFAULT_TOOL_CATALOG: RuntimeToolDirectoryEntry[] = [
  {
    toolId: 'functions.read_file',
    kind: 'builtin',
    availability: 'available',
    displayName: '读取文件',
    description: '读取项目内文件内容，用于理解上下文与定位实现细节。',
  },
  {
    toolId: 'functions.execute_command',
    kind: 'builtin',
    availability: 'available',
    displayName: '执行命令',
    description: '运行本地终端命令，适合构建、检查与资源处理。',
  },
  {
    toolId: 'functions.write_to_file',
    kind: 'builtin',
    availability: 'available',
    displayName: '写入文件',
    description: '创建或重写文件，适用于页面搭建、样式输出与配置修改。',
  },
  {
    toolId: 'mcp--fetch--fetch',
    kind: 'external',
    availability: 'available',
    displayName: '联网抓取',
    description: '抓取网页内容，用于补充外部说明与页面上下文。',
  },
  {
    toolId: 'mcp--puppeteer--puppeteer_navigate',
    kind: 'external',
    availability: 'available',
    displayName: '浏览器自动化',
    description: '驱动浏览器执行界面级操作，用于录制流程或验证可见交互。',
  },
]

export function CapabilitiesWorkspace() {
  const [activeSection, setActiveSection] = useState<CapabilitiesSection>('tool-permissions')
  const [toolPermissions, setToolPermissions] = useState<ToolPermissionRecord[]>([])
  const [mcpServers, setMcpServers] = useState<McpServerRecord[]>(() => (
    mockMcpServers.map((server) => ({ ...server }))
  ))
  const [editorState, setEditorState] = useState<McpServerEditorState | null>(null)
  const [settingsState, setSettingsState] = useState<SettingsWorkspaceStateSaveInput | null>(null)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const settingsResult = await loadSettingsWorkspaceState()

      if (cancelled) {
        return
      }

      if (!settingsResult.ok) {
        setSettingsState(null)
        setToolPermissions(buildToolPermissionRecords(DEFAULT_TOOL_CATALOG, createDefaultPolicyState()))
        return
      }

      const nextSettingsState = settingsResult.state
      const policy = nextSettingsState.mcp.toolPermissionPolicy

      setSettingsState(nextSettingsState)
      setToolPermissions(buildToolPermissionRecords(DEFAULT_TOOL_CATALOG, policy))
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

    setSettingsState((previous) => {
      if (previous === null) {
        return previous
      }

      const nextPolicy = buildPolicyStateFromTools(nextTools)
      const nextState: SettingsWorkspaceStateSaveInput = {
        ...previous,
        mcp: {
          ...previous.mcp,
          toolPermissionMode: mapDefaultModeToLegacyMode(nextPolicy.defaultMode),
          toolPermissionPolicy: nextPolicy,
        },
      }

      void saveSettingsWorkspaceState(nextState)
      return nextState
    })
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
      name: tool.displayName ?? tool.toolId,
      description: tool.description ?? '该工具尚未提供详细说明。',
      toolId: tool.toolId,
      mode: resolvedMode,
      delayAction: FALLBACK_DELAY_ACTION,
      delaySeconds: FALLBACK_DELAY_SECONDS + index,
    }
  })
}

function resolveToolGroupId(tool: RuntimeToolDirectoryEntry): ToolPermissionRecord['groupId'] {
  return tool.kind === 'external' || tool.toolId.startsWith('mcp--') ? 'remote' : 'workspace'
}

function buildPolicyStateFromTools(
  tools: ToolPermissionRecord[],
): SettingsWorkspaceToolPermissionPolicyState {
  const defaultMode = resolveDefaultMode(tools)
  const toolPermissions = Object.fromEntries(tools.flatMap((tool) => {
    const normalizedMode = tool.mode === 'delay' ? 'ask' : tool.mode

    if (normalizedMode === defaultMode) {
      return []
    }

    return [[tool.toolId, {
      mode: normalizedMode,
      source: 'user',
      updatedAt: TOOL_PERMISSION_UPDATED_AT,
    }]]
  }))

  return {
    version: 1,
    defaultMode,
    toolPermissions,
  }
}

function resolveDefaultMode(tools: ToolPermissionRecord[]): ToolPermissionPolicyMode {
  const counts = {
    allow: 0,
    ask: 0,
    deny: 0,
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

function createDefaultPolicyState(): SettingsWorkspaceToolPermissionPolicyState {
  return {
    version: 1,
    defaultMode: 'ask',
    toolPermissions: {},
  }
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
