import { useMemo, useState } from 'react'

import { CapabilitiesSecondaryNav } from './CapabilitiesSecondaryNav'
import {
  capabilitiesNavItems,
  initialToolPermissions,
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

export function CapabilitiesWorkspace() {
  const [activeSection, setActiveSection] = useState<CapabilitiesSection>('tool-permissions')
  const [toolPermissions, setToolPermissions] = useState<ToolPermissionRecord[]>(() => (
    initialToolPermissions.map((tool) => ({ ...tool }))
  ))
  const [mcpServers, setMcpServers] = useState<McpServerRecord[]>(() => (
    mockMcpServers.map((server) => ({ ...server }))
  ))
  const [editorState, setEditorState] = useState<McpServerEditorState | null>(null)

  const activeNavItem = useMemo(
    () => capabilitiesNavItems.find((item) => item.id === activeSection) ?? capabilitiesNavItems[0],
    [activeSection],
  )

  const handleModeChange = (toolId: string, mode: ToolPermissionMode) => {
    setToolPermissions((previous) => previous.map((tool) => (
      tool.id === toolId
        ? {
            ...tool,
            mode,
          }
        : tool
    )))
  }

  const handleDelayActionChange = (toolId: string, action: ToolPermissionDelayAction) => {
    setToolPermissions((previous) => previous.map((tool) => (
      tool.id === toolId
        ? {
            ...tool,
            delayAction: action,
          }
        : tool
    )))
  }

  const handleDelaySecondsChange = (toolId: string, seconds: number) => {
    setToolPermissions((previous) => previous.map((tool) => (
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
