import { useEffect, useRef } from 'react'
import type { SettingsWorkspaceStateSaveInput } from '../../../electron/settings-workspace/schema'
import { loadSettingsWorkspaceState } from '../settings/workspace-state'
import { appendCopilotDebugLog } from '../../features/copilot/debug-mode-log'
import { loadConfigCenterPublicSnapshot } from '../../features/copilot/config-center'
import { loadToolCatalog } from './tool-catalog'
import type { ToolCatalogLoadResult } from '../../../electron/tool-catalog/ipc'
import { projectDebugModeEnabledFromConfigCenterPublicSnapshot } from '../../features/copilot/config-center'
import type { ToolPermissionRecord } from './capabilities-demo'
import { resolveRenderableToolCatalog } from './shared-status'
import type { ToolCatalogLoadState } from './shared-status'
import { buildToolPermissionRecords } from './tool-permissions-section'

interface UseToolPermissionsSyncInput {
  mcpSnapshotRevision: number
  settingsState: SettingsWorkspaceStateSaveInput | null
}

interface UseToolPermissionsSyncOutput {
  setToolPermissions: React.Dispatch<React.SetStateAction<ToolPermissionRecord[]>>
  setToolCatalogLoadState: React.Dispatch<React.SetStateAction<ToolCatalogLoadState>>
  setSettingsState: React.Dispatch<React.SetStateAction<SettingsWorkspaceStateSaveInput | null>>
}

export function useToolPermissionsSync(
  input: UseToolPermissionsSyncInput,
  output: UseToolPermissionsSyncOutput,
): void {
  const { mcpSnapshotRevision, settingsState } = input
  const { setToolPermissions, setToolCatalogLoadState, setSettingsState } = output
  const appliedSnapshotRevisionRef = useRef<number | null>(null)
  const appliedDirectoryVersionRef = useRef<string | null>(null)

  const applyToolCatalogResult = (
    toolCatalogResult: ToolCatalogLoadResult,
    debugModeEnabled: boolean,
  ): ReturnType<typeof resolveRenderableToolCatalog>['tools'] => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (mcpSnapshotRevision <= 0 || settingsState === null) {
      return
    }

    if (appliedSnapshotRevisionRef.current === null) {
      appliedSnapshotRevisionRef.current = mcpSnapshotRevision
      return
    }

    const shouldReloadForSnapshot = appliedSnapshotRevisionRef.current !== mcpSnapshotRevision

    if (!shouldReloadForSnapshot) {
      return
    }

    appliedSnapshotRevisionRef.current = mcpSnapshotRevision

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mcpSnapshotRevision, settingsState])
}
