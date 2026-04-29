import { FolderPlus, LoaderCircle, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  SettingsWorkspaceStateSaveInput,
} from '../../../electron/settings-workspace/schema'
import {
  loadSettingsWorkspaceState,
  saveSettingsWorkspaceState,
} from '../settings/workspace-state'
import { appendCopilotDebugLog } from '../../features/copilot/debug-mode-log'
import { loadConfigCenterPublicSnapshot } from '../../features/copilot/config-center'
import { loadToolCatalog } from './tool-catalog'
import type { ToolCatalogLoadResult } from '../../../electron/tool-catalog/ipc'
import { CapabilitiesSecondaryNav } from './CapabilitiesSecondaryNav'
import { projectDebugModeEnabledFromConfigCenterPublicSnapshot } from '../../features/copilot/config-center'
import {
  capabilitiesNavItems,
  type CapabilitiesSection,
  type ToolPermissionRecord,
} from './capabilities-demo'
import { ManagedRuntimeStatusButton } from './ManagedRuntimeStatusButton'
import { McpServerEditorDialog } from './McpServerEditorDialog'
import { McpServersPanel } from './McpServersPanel'
import { SkillsPanel } from './SkillsPanel'
import { ToolPermissionsPanel } from './ToolPermissionsPanel'
import { useManagedRuntime } from './use-managed-runtime'
import { useMcpRegistry } from './use-mcp-registry'
import { useSkillRegistry } from './use-skill-registry'

import type { McpServerEditorState } from './mcp-section'
import type { ToolCatalogLoadState } from './shared-status'
import { resolveRenderableToolCatalog, resolveToolPermissionStatusMessage } from './shared-status'
import {
  buildPolicyStateFromTools,
  buildToolPermissionRecords,
  mapDefaultModeToLegacyMode,
} from './tool-permissions-section'


export function CapabilitiesWorkspace() {
  const [activeSection, setActiveSection] = useState<CapabilitiesSection>('tool-permissions')
  const [visitedSections, setVisitedSections] = useState<Set<CapabilitiesSection>>(
    () => new Set<CapabilitiesSection>(['tool-permissions']),
  )
  const [toolPermissions, setToolPermissions] = useState<ToolPermissionRecord[]>([])
  const [editorState, setEditorState] = useState<McpServerEditorState | null>(null)
  const [settingsState, setSettingsState] = useState<SettingsWorkspaceStateSaveInput | null>(null)
  const [toolCatalogLoadState, setToolCatalogLoadState] = useState<ToolCatalogLoadState>({
    status: 'idle',
    error: null,
    source: null,
    directoryVersion: null,
  })
  const mcpRegistry = useMcpRegistry()
  const managedRuntime = useManagedRuntime(activeSection === 'mcp-servers')
  const skillRegistry = useSkillRegistry()
  const appliedSnapshotRevisionRef = useRef<number | null>(null)
  const appliedDirectoryVersionRef = useRef<string | null>(null)
  const [managedRuntimePanelOpen, setManagedRuntimePanelOpen] = useState(false)

  const applyToolCatalogResult = (
    toolCatalogResult: ToolCatalogLoadResult,
    debugModeEnabled: boolean,
  ) => {
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
      directoryVersion: toolCatalogResult.ok ? toolCatalogResult.directoryVersion : null,
    })

    appliedDirectoryVersionRef.current = toolCatalogResult.ok ? toolCatalogResult.directoryVersion : null

    return resolvedCatalog.tools
  }
 
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

      const tools = applyToolCatalogResult(toolCatalogResult, debugModeEnabled)
 
      if (!settingsResult.ok) {
        setSettingsState(null)
        setToolPermissions([])
        return
      }
 
      const nextSettingsState = settingsResult.state as unknown as SettingsWorkspaceStateSaveInput
      const policy = nextSettingsState.mcp.toolPermissionPolicy
 
      setSettingsState(nextSettingsState)
      setToolPermissions(buildToolPermissionRecords(tools, policy))
    })()
 
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (mcpRegistry.snapshotRevision <= 0 || settingsState === null) {
      return
    }

    if (appliedSnapshotRevisionRef.current === null) {
      appliedSnapshotRevisionRef.current = mcpRegistry.snapshotRevision
      return
    }

    const shouldReloadForSnapshot = appliedSnapshotRevisionRef.current !== mcpRegistry.snapshotRevision

    if (!shouldReloadForSnapshot) {
      return
    }

    appliedSnapshotRevisionRef.current = mcpRegistry.snapshotRevision

    let cancelled = false
    void (async () => {
      const snapshotResult = await loadConfigCenterPublicSnapshot()
      const debugModeEnabled = snapshotResult.ok
        && projectDebugModeEnabledFromConfigCenterPublicSnapshot(snapshotResult.snapshot)
      const preferredLanguage = snapshotResult.ok ? snapshotResult.snapshot.domains.general.language : null
      const toolCatalogResult = await loadToolCatalog(preferredLanguage)

      if (cancelled) {
        return
      }

      const tools = applyToolCatalogResult(toolCatalogResult, debugModeEnabled)
      setToolPermissions(buildToolPermissionRecords(tools, settingsState.mcp.toolPermissionPolicy))
    })()

    return () => {
      cancelled = true
    }
  }, [mcpRegistry.snapshotRevision, settingsState])

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

  const handleModeChange = (toolId: string, mode: import('./capabilities-demo').ToolPermissionMode) => {
    persistToolPermissions(toolPermissions.map((tool) => (
      tool.id === toolId
        ? {
            ...tool,
            mode,
          }
        : tool
    )))
  }

  const handleDelayActionChange = (toolId: string, action: import('./capabilities-demo').ToolPermissionDelayAction) => {
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

  const openMcpEditor = (mode: import('./mcp-registry-view-model').McpServerEditorMode) => {
    setEditorState({
      mode,
      value: mcpRegistry.getEditorSeed(mode),
      validationErrors: [],
      errorMessage: null,
      submitting: false,
    })
  }

  const handleConfirmMcpEditor = () => {
    if (editorState === null) {
      return
    }

    const activeEditorState = editorState
    setEditorState((previous) => previous === null ? previous : {
      ...previous,
      submitting: true,
      errorMessage: null,
      validationErrors: [],
    })

    void (async () => {
      const result = await mcpRegistry.saveEditorDraft(activeEditorState.mode, activeEditorState.value)

      if (result.ok) {
        setEditorState(null)
        return
      }

      setEditorState((previous) => previous === null ? previous : {
        ...previous,
        submitting: false,
        errorMessage: result.errorMessage,
        validationErrors: result.validationErrors,
      })
    })()
  }

  return (
    <>
      <section className="workspace-stage capabilities-workspace" aria-label="能力中心工作区">
        <CapabilitiesSecondaryNav
          items={capabilitiesNavItems}
          activeSection={activeSection}
          onSelect={useCallback((section: CapabilitiesSection) => {
            setVisitedSections((prev) => {
              if (prev.has(section)) {
                return prev
              }
              const next = new Set(prev)
              next.add(section)
              return next
            })
            setActiveSection(section)
          }, [])}
        />

        <main className="workspace-main capabilities-main" aria-label="能力中心主内容区">
          <header className="workspace-main__header capabilities-main__header">
            <div>
              <p className="workspace-main__eyebrow">能力中心</p>
              <h2 className="workspace-main__title">{activeNavItem.label}</h2>
            </div>

            {activeSection === 'mcp-servers' ? (
              <div className="toolbar-actions capabilities-main__actions">
                <ManagedRuntimeStatusButton
                  viewModel={managedRuntime.viewModel}
                  loading={managedRuntime.loading}
                  busy={managedRuntime.busy}
                  open={managedRuntimePanelOpen}
                  error={managedRuntime.error}
                  onToggle={() => setManagedRuntimePanelOpen((previous) => !previous)}
                  onInstallOrRepair={managedRuntime.installOrRepair}
                />
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => openMcpEditor('add')}
                >
                  新增 MCP 服务器
                </button>
              </div>
            ) : activeSection === 'skills' ? (
              <div className="toolbar-actions capabilities-main__actions">
                <button
                  type="button"
                  className="secondary-button secondary-button--subtle skills-header__button"
                  disabled={skillRegistry.globalBusyOperation !== null}
                  onClick={() => void skillRegistry.refreshSkills()}
                >
                  {skillRegistry.globalBusyOperation === 'refreshing'
                    ? <LoaderCircle size={15} className="skill-activity__icon" aria-hidden="true" />
                    : <RefreshCw size={15} aria-hidden="true" />}
                  {skillRegistry.globalBusyOperation === 'refreshing' ? '刷新中…' : '刷新'}
                </button>
                <button
                  type="button"
                  className="primary-button skills-header__button"
                  disabled={skillRegistry.globalBusyOperation !== null}
                  onClick={() => void skillRegistry.selectAndImportSkill()}
                >
                  {skillRegistry.globalBusyOperation === 'importing'
                    ? <LoaderCircle size={15} className="skill-activity__icon" aria-hidden="true" />
                    : <FolderPlus size={15} aria-hidden="true" />}
                  {skillRegistry.globalBusyOperation === 'importing' ? '导入中…' : '导入 Skill'}
                </button>
              </div>
            ) : null}
          </header>

          <section
            className="workspace-main__content capabilities-main__content"
            aria-label={`${activeNavItem.label}内容区`}
          >
            {visitedSections.has('tool-permissions') && (
              <div hidden={activeSection !== 'tool-permissions'} aria-hidden={activeSection !== 'tool-permissions'}>
                <ToolPermissionsPanel
                  tools={toolPermissions}
                  statusMessage={resolveToolPermissionStatusMessage(toolCatalogLoadState)}
                  onModeChange={handleModeChange}
                  onDelayActionChange={handleDelayActionChange}
                  onDelaySecondsChange={handleDelaySecondsChange}
                />
              </div>
            )}
            {visitedSections.has('mcp-servers') && (
              <div hidden={activeSection !== 'mcp-servers'} aria-hidden={activeSection !== 'mcp-servers'}>
                <McpServersPanel
                  servers={mcpRegistry.servers}
                  statusMessage={mcpRegistry.statusMessage}
                  onToggleEnabled={mcpRegistry.toggleServerEnabled}
                  onDelete={mcpRegistry.deleteServer}
                  onTestConnection={mcpRegistry.testServerConnection}
                />
              </div>
            )}
            {visitedSections.has('skills') && (
              <div hidden={activeSection !== 'skills'} aria-hidden={activeSection !== 'skills'}>
                <SkillsPanel
                  skills={skillRegistry.skills}
                  importValidationErrors={skillRegistry.importValidationErrors}
                  onToggleEnabled={skillRegistry.toggleSkillEnabled}
                  onDelete={skillRegistry.deleteSkill}
                  onRefresh={skillRegistry.refreshSkill}
                />
              </div>
            )}
          </section>
        </main>
      </section>

      {editorState ? (
        <McpServerEditorDialog
          mode={editorState.mode}
          value={editorState.value}
          validationErrors={editorState.validationErrors}
          errorMessage={editorState.errorMessage}
          submitting={editorState.submitting}
          onValueChange={(value) => {
            setEditorState((previous) => (previous === null ? previous : {
              ...previous,
              value,
              errorMessage: null,
              validationErrors: [],
            }))
          }}
          onClose={() => setEditorState(null)}
          onConfirm={handleConfirmMcpEditor}
        />
      ) : null}
    </>
  )
}
