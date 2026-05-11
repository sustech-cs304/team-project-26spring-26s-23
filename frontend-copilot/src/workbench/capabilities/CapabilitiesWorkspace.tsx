import { FolderPlus, LoaderCircle, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import type {
  SettingsWorkspaceStateSaveInput,
} from '../../../electron/settings-workspace/schema'
import {
  saveSettingsWorkspaceState,
} from '../settings/workspace-state'
import { CapabilitiesSecondaryNav } from './CapabilitiesSecondaryNav'
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
import { useToolPermissionsSync } from './use-tool-permissions-sync'

import type { McpServerEditorState } from './mcp-section'
import type { ToolCatalogLoadState } from './shared-status'
import { resolveToolPermissionStatusMessage } from './shared-status'
import {
  buildPolicyStateFromTools,
  mapDefaultModeToLegacyMode,
} from './tool-permissions-section'


const CAPABILITIES_SECTION_TRANSITION_MS = 180

// eslint-disable-next-line max-lines-per-function
export function CapabilitiesWorkspace() {
  const [activeSection, setActiveSection] = useState<CapabilitiesSection>('tool-permissions')
  const [visitedSections, setVisitedSections] = useState<Set<CapabilitiesSection>>(
    () => new Set<CapabilitiesSection>(['tool-permissions']),
  )
  const [exitingSection, setExitingSection] = useState<CapabilitiesSection | null>(null)
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
  const sectionTransitionTimerRef = useRef<number | null>(null)
  const [managedRuntimePanelOpen, setManagedRuntimePanelOpen] = useState(false)

  useToolPermissionsSync(
    { mcpSnapshotRevision: mcpRegistry.snapshotRevision, settingsState },
    { setToolPermissions, setToolCatalogLoadState, setSettingsState },
  )
 
  useEffect(() => {
    return () => {
      if (sectionTransitionTimerRef.current !== null) {
        window.clearTimeout(sectionTransitionTimerRef.current)
      }
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

  const handleSelectSection = useCallback((section: CapabilitiesSection) => {
    if (section === activeSection) {
      return
    }

    setVisitedSections((prev) => {
      if (prev.has(section)) {
        return prev
      }
      const next = new Set(prev)
      next.add(section)
      return next
    })

    if (sectionTransitionTimerRef.current !== null) {
      window.clearTimeout(sectionTransitionTimerRef.current)
    }

    const previousSection = activeSection
    setExitingSection(previousSection)
    setActiveSection(section)
    sectionTransitionTimerRef.current = window.setTimeout(() => {
      setExitingSection((current) => (current === previousSection ? null : current))
      sectionTransitionTimerRef.current = null
    }, CAPABILITIES_SECTION_TRANSITION_MS)
  }, [activeSection])

  const renderSectionPanel = useCallback((section: CapabilitiesSection, children: ReactNode) => {
    if (!visitedSections.has(section)) {
      return null
    }

    const isActive = section === activeSection
    const isExiting = section === exitingSection && !isActive
    const isVisible = isActive || isExiting

    return (
      <div
        key={section}
        className={[
          'capabilities-section-view',
          isActive ? 'capabilities-section-view--active' : null,
          isExiting ? 'capabilities-section-view--exiting' : null,
        ].filter(Boolean).join(' ')}
        data-capabilities-section={section}
        hidden={!isVisible}
        aria-hidden={!isActive}
      >
        {children}
      </div>
    )
  }, [activeSection, exitingSection, visitedSections])

  return (
    <>
      <section className="workspace-stage capabilities-workspace" aria-label="能力中心工作区">
        <CapabilitiesSecondaryNav
          items={capabilitiesNavItems}
          activeSection={activeSection}
          onSelect={handleSelectSection}
        />

        <main className="workspace-main capabilities-main" aria-label="能力中心主内容区">
          <header className="workspace-main__header capabilities-main__header">
            <div>
              <p className="workspace-main__eyebrow">能力中心</p>
              <h2 className="workspace-main__title">{activeNavItem.label}</h2>
            </div>
            {renderCapabilitiesToolbar({
              activeSection,
              managedRuntime,
              managedRuntimePanelOpen,
              setManagedRuntimePanelOpen,
              openMcpEditor,
              skillRegistry,
            })}
          </header>

          <section
            className="workspace-main__content capabilities-main__content"
            aria-label={`${activeNavItem.label}内容区`}
          >
            {renderSectionPanel('tool-permissions', (
              <ToolPermissionsPanel
                tools={toolPermissions}
                statusMessage={resolveToolPermissionStatusMessage(toolCatalogLoadState)}
                onModeChange={handleModeChange}
                onDelayActionChange={handleDelayActionChange}
                onDelaySecondsChange={handleDelaySecondsChange}
              />
            ))}
            {renderSectionPanel('mcp-servers', (
              <McpServersPanel
                servers={mcpRegistry.servers}
                statusMessage={mcpRegistry.statusMessage}
                onToggleEnabled={mcpRegistry.toggleServerEnabled}
                onDelete={mcpRegistry.deleteServer}
                onTestConnection={mcpRegistry.testServerConnection}
              />
            ))}
            {renderSectionPanel('skills', (
              <SkillsPanel
                skills={skillRegistry.skills}
                importValidationErrors={skillRegistry.importValidationErrors}
                onToggleEnabled={skillRegistry.toggleSkillEnabled}
                onDelete={skillRegistry.deleteSkill}
                onRefresh={skillRegistry.refreshSkill}
              />
            ))}
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

function renderCapabilitiesToolbar(input: {
  activeSection: CapabilitiesSection
  managedRuntime: ReturnType<typeof useManagedRuntime>
  managedRuntimePanelOpen: boolean
  setManagedRuntimePanelOpen: (value: boolean) => void
  openMcpEditor: (mode: import('./mcp-registry-view-model').McpServerEditorMode) => void
  skillRegistry: ReturnType<typeof useSkillRegistry>
}) {
  const {
    activeSection,
    managedRuntime,
    managedRuntimePanelOpen,
    setManagedRuntimePanelOpen,
    openMcpEditor,
    skillRegistry,
  } = input

  if (activeSection === 'mcp-servers') {
    return (
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
    )
  }

  if (activeSection === 'skills') {
    return (
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
    )
  }

  return null
}
