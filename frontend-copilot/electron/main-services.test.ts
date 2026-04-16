import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => {
  const createElectronUnifiedConfigService = vi.fn()
  const createElectronSettingsWorkspaceService = vi.fn()
  const unifiedConfigService = {
    loadPublicSnapshot: vi.fn(),
    applyPublicPatch: vi.fn(),
  }
  const settingsWorkspaceService = {
    loadState: vi.fn(),
    saveState: vi.fn(),
    loadSecretStates: vi.fn(),
    loadSustechCasSecret: vi.fn(),
    saveProfileSecret: vi.fn(),
    clearProfileSecret: vi.fn(),
    saveSustechCasSecret: vi.fn(),
    clearSustechCasSecret: vi.fn(),
    resolveProviderRoute: vi.fn(),
  }

  return {
    createElectronUnifiedConfigService,
    createElectronSettingsWorkspaceService,
    unifiedConfigService,
    settingsWorkspaceService,
  }
})

vi.mock('./config-center/main-process', () => ({
  createElectronUnifiedConfigService: hoisted.createElectronUnifiedConfigService,
}))

vi.mock('./settings-workspace/main-process', () => ({
  createElectronSettingsWorkspaceService: hoisted.createElectronSettingsWorkspaceService,
}))

import {
  createConfigCenterPublicSnapshotFixture,
  createSettingsWorkspaceStateFixture,
} from './renderer-ipc.test-support'
import { createMainProcessServices } from './main-services'
import type { ElectronCopilotHistoryService } from './copilot-history-service'
import { normalizeSettingsWorkspaceStateValues } from './settings-workspace/state-schema'

describe('createMainProcessServices', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lazily creates domain services once and delegates the electron-facing operations', async () => {
    const loadPublicSnapshotResult = {
      ok: true,
      snapshot: createConfigCenterPublicSnapshotFixture({
        theme: 'light',
        model: null,
      }),
    } as const
    const applyPublicPatchResult = {
      ok: true,
      snapshot: createConfigCenterPublicSnapshotFixture({
        theme: 'dark',
        model: 'qwen-plus',
      }),
    } as const
    const settingsState = createSettingsWorkspaceStateFixture()
    const saveInput = normalizeSettingsWorkspaceStateValues(settingsState)
    const loadStateResult = {
      ok: true,
      source: 'stored',
      state: settingsState,
    } as const
    const saveStateResult = {
      ok: true,
      state: settingsState,
    } as const
    const loadSecretStatesResult = {
      ok: true,
      states: {
        openrouter: {
          hasApiKey: true,
          apiKey: 'persisted-secret',
        },
      },
    } as const
    const loadSustechCasSecretResult = {
      ok: true,
      state: {
        hasPassword: true,
        password: 'cas-secret',
      },
    } as const
    const saveProfileSecretResult = {
      ok: true,
      profileId: 'openrouter',
      state: {
        hasApiKey: true,
        apiKey: 'draft-secret',
      },
    } as const
    const clearProfileSecretResult = {
      ok: true,
      profileId: 'openrouter',
      state: {
        hasApiKey: false,
        apiKey: '',
      },
    } as const
    const saveSustechCasSecretResult = {
      ok: true,
      state: {
        hasPassword: true,
        password: 'cas-secret',
      },
    } as const
    const clearSustechCasSecretResult = {
      ok: true,
      state: {
        hasPassword: false,
        password: '',
      },
    } as const
    const listThreadsResult = {
      ok: true,
      version: 'chat-history-v1',
      threads: [
        {
          threadId: 'thread-1',
          boundAgentId: 'default',
          title: '历史线程',
          titleSource: 'deterministic',
          summary: '已持久化回复',
          summarySource: 'deterministic',
          createdAt: '2026-04-13T14:00:00Z',
          updatedAt: '2026-04-13T14:05:00Z',
          lastActivityAt: '2026-04-13T14:05:00Z',
          lastRunId: 'run-1',
          lastRunStatus: 'completed',
          lastUserMessagePreview: '你好',
          lastAssistantMessagePreview: '已持久化回复',
          driftSummary: { status: 'not_evaluated' },
        },
      ],
    } as const
    const threadDetailResult = {
      ok: true,
      version: 'chat-history-v1',
      thread: listThreadsResult.threads[0],
      timelineItems: [{ kind: 'assistant_message', text: '已持久化回复' }],
      runSummaries: [
        {
          runId: 'run-1',
          threadId: 'thread-1',
          status: 'completed',
          createdAt: '2026-04-13T14:00:00Z',
          updatedAt: '2026-04-13T14:05:00Z',
          startedAt: '2026-04-13T14:00:01Z',
          terminalAt: '2026-04-13T14:05:00Z',
          resolvedModelId: 'gpt-4.1',
          requestedMessageText: '你好',
          assistantText: '已持久化回复',
        },
      ],
      latestConfigurationSnapshot: {
        runId: 'run-1',
      },
      availabilityDrift: {
        status: 'not_evaluated',
      },
    } as const
    const runReplayResult = {
      ok: true,
      version: 'chat-history-v1',
      run: threadDetailResult.runSummaries[0],
      historicalSnapshot: {
        resolvedModelId: 'gpt-4.1',
      },
      orderedEvents: [],
      toolCallBlocks: [],
      diagnosticBlocks: [],
      terminalState: {
        status: 'completed',
      },
      availabilityInterpretation: {
        status: 'not_evaluated',
      },
    } as const
    const deleteThreadResult = {
      ok: true,
      version: 'chat-history-v1',
      threadId: 'thread-1',
      deletedAt: '2026-04-13T14:06:00Z',
    } as const
    const backupDatabaseResult = {
      ok: true,
      version: 'chat-history-v1',
      databasePath: 'D:/workspace/copilot-data/database/copilot-chat.db',
      backupPath: 'D:/workspace/copilot-data/backups/copilot-chat.backup.db',
      createdAt: '2026-04-13T14:08:00Z',
    } as const
    const restoreDatabaseResult = {
      ok: true,
      version: 'chat-history-v1',
      databasePath: 'D:/workspace/copilot-data/database/copilot-chat.db',
      sourcePath: 'D:/workspace/copilot-data/backups/copilot-chat.backup.db',
      restoredAt: '2026-04-13T14:09:00Z',
    } as const

    const resolveProviderRouteRequest = {
      routeRef: {
        routeKind: 'provider-model' as const,
        profileId: 'openrouter',
        modelId: 'qwen-plus',
      },
      catalogRevision: 'catalog-v1',
    }
    const resolveProviderRouteResult = {
      ok: true,
      resolvedRoute: {
        routeRef: resolveProviderRouteRequest.routeRef,
        providerProfileId: 'openrouter',
        provider: 'OpenRouter',
        providerId: 'openrouter',
        adapterId: 'openrouter-chat-completions',
        runtimeStatus: 'active',
        catalogRevision: 'catalog-v1',
        endpointFamily: 'openai-compatible',
        endpointType: 'chat-completions',
        baseUrl: 'https://openrouter.ai/api/v1',
        modelId: 'qwen-plus',
        authKind: 'api-key',
      },
      privateAuth: {
        authKind: 'api-key',
        authPayload: {
          apiKey: 'draft-secret',
        },
        apiKey: 'draft-secret',
      },
    } as const

    const renameThreadResult = {
      ok: true,
      version: 'chat-history-v1',
      thread: {
        ...listThreadsResult.threads[0],
        title: '已重命名线程',
        titleSource: 'manual',
        updatedAt: '2026-04-13T14:06:00Z',
      },
    } as const
    const duplicateThreadResult = {
      ok: true,
      version: 'chat-history-v1',
      thread: {
        ...listThreadsResult.threads[0],
        threadId: 'thread-copy-1',
        title: '历史线程（副本）',
        titleSource: 'manual',
        createdAt: '2026-04-13T14:06:30Z',
        updatedAt: '2026-04-13T14:06:30Z',
        lastActivityAt: '2026-04-13T14:06:30Z',
        lastRunId: 'run-copy-1',
      },
    } as const
    const copilotHistoryService = {
      listThreads: vi.fn(async () => listThreadsResult),
      getThreadDetail: vi.fn(async (_threadId: string) => threadDetailResult),
      getRunReplay: vi.fn(async (_runId: string) => runReplayResult),
      renameThread: vi.fn(async (_threadId: string, _request: { title: string }) => renameThreadResult),
      duplicateThread: vi.fn(async (_threadId: string, _request?: { title?: string | null }) => duplicateThreadResult),
      deleteThread: vi.fn(async (_threadId: string) => deleteThreadResult),
      backupDatabase: vi.fn(async (_request?: { targetPath?: string | null }) => backupDatabaseResult),
      restoreDatabase: vi.fn(async (_request: { sourcePath: string }) => restoreDatabaseResult),
    } as unknown as ElectronCopilotHistoryService

    hoisted.unifiedConfigService.loadPublicSnapshot.mockResolvedValue(loadPublicSnapshotResult)
    hoisted.unifiedConfigService.applyPublicPatch.mockResolvedValue(applyPublicPatchResult)
    hoisted.settingsWorkspaceService.loadState.mockResolvedValue(loadStateResult)
    hoisted.settingsWorkspaceService.saveState.mockResolvedValue(saveStateResult)
    hoisted.settingsWorkspaceService.loadSecretStates.mockResolvedValue(loadSecretStatesResult)
    hoisted.settingsWorkspaceService.loadSustechCasSecret.mockResolvedValue(loadSustechCasSecretResult)
    hoisted.settingsWorkspaceService.saveProfileSecret.mockResolvedValue(saveProfileSecretResult)
    hoisted.settingsWorkspaceService.clearProfileSecret.mockResolvedValue(clearProfileSecretResult)
    hoisted.settingsWorkspaceService.saveSustechCasSecret.mockResolvedValue(saveSustechCasSecretResult)
    hoisted.settingsWorkspaceService.clearSustechCasSecret.mockResolvedValue(clearSustechCasSecretResult)
    hoisted.settingsWorkspaceService.resolveProviderRoute.mockResolvedValue(resolveProviderRouteResult)

    hoisted.createElectronUnifiedConfigService.mockReturnValue(hoisted.unifiedConfigService)
    hoisted.createElectronSettingsWorkspaceService.mockReturnValue(hoisted.settingsWorkspaceService)

    const prepareRuntimePaths = vi.fn(async () => ({ runtimeRootDir: 'runtime-root' } as never))
    const appendMainRuntimeLog = vi.fn()
    const publishConfigCenterPublicSnapshotUpdate = vi.fn()
    const createCopilotHistoryService = vi.fn(() => copilotHistoryService)
    const services = createMainProcessServices({
      prepareRuntimePaths,
      appendMainRuntimeLog,
      publishConfigCenterPublicSnapshotUpdate,
      createCopilotHistoryService,
    })

    expect(hoisted.createElectronUnifiedConfigService).not.toHaveBeenCalled()
    expect(hoisted.createElectronSettingsWorkspaceService).not.toHaveBeenCalled()
    expect(createCopilotHistoryService).not.toHaveBeenCalled()

    const patch = {
      domains: {
        frontendPreferences: {
          theme: 'dark' as const,
        },
      },
    }

    await expect(services.loadConfigCenterPublicSnapshot()).resolves.toEqual(loadPublicSnapshotResult)
    await expect(services.applyConfigCenterPublicPatch(patch)).resolves.toEqual(applyPublicPatchResult)
    await expect(services.loadSettingsWorkspaceState()).resolves.toEqual(loadStateResult)
    await expect(services.saveSettingsWorkspaceState(saveInput)).resolves.toEqual(saveStateResult)
    await expect(services.loadSettingsWorkspaceSecretStates({ profileIds: ['openrouter'] })).resolves.toEqual(loadSecretStatesResult)
    await expect(services.loadSettingsWorkspaceSustechCasSecret()).resolves.toEqual(loadSustechCasSecretResult)
    await expect(services.saveSettingsWorkspaceProfileSecret({
      profileId: 'openrouter',
      apiKey: 'draft-secret',
    })).resolves.toEqual(saveProfileSecretResult)
    await expect(services.clearSettingsWorkspaceProfileSecret({
      profileId: 'openrouter',
    })).resolves.toEqual(clearProfileSecretResult)
    await expect(services.saveSettingsWorkspaceSustechCasSecret({
      password: 'cas-secret',
    })).resolves.toEqual(saveSustechCasSecretResult)
    await expect(services.clearSettingsWorkspaceSustechCasSecret()).resolves.toEqual(clearSustechCasSecretResult)
    await expect(services.resolveSettingsWorkspaceProviderRoute(resolveProviderRouteRequest)).resolves.toEqual(
      resolveProviderRouteResult,
    )
    await expect(services.listCopilotHistoryThreads()).resolves.toEqual(listThreadsResult)
    await expect(services.getCopilotHistoryThreadDetail('thread-1')).resolves.toEqual(threadDetailResult)
    await expect(services.getCopilotHistoryRunReplay('run-1')).resolves.toEqual(runReplayResult)
    await expect(services.renameCopilotHistoryThread('thread-1', { title: '已重命名线程' })).resolves.toEqual(renameThreadResult)
    await expect(services.duplicateCopilotHistoryThread('thread-1', { title: '历史线程（副本）' })).resolves.toEqual(duplicateThreadResult)
    await expect(services.deleteCopilotHistoryThread('thread-1')).resolves.toEqual(deleteThreadResult)
    await expect(services.backupCopilotHistoryDatabase({ targetPath: 'backups/history.db' })).resolves.toEqual(
      backupDatabaseResult,
    )
    await expect(services.restoreCopilotHistoryDatabase({ sourcePath: 'backups/history.db' })).resolves.toEqual(
      restoreDatabaseResult,
    )

    expect(hoisted.createElectronUnifiedConfigService).toHaveBeenCalledTimes(1)
    expect(hoisted.createElectronSettingsWorkspaceService).toHaveBeenCalledTimes(1)
    expect(createCopilotHistoryService).toHaveBeenCalledTimes(1)
    expect(hoisted.unifiedConfigService.loadPublicSnapshot).toHaveBeenCalledOnce()
    expect(hoisted.unifiedConfigService.applyPublicPatch).toHaveBeenCalledWith(patch)
    expect(hoisted.settingsWorkspaceService.loadState).toHaveBeenCalledOnce()
    expect(hoisted.settingsWorkspaceService.saveState).toHaveBeenCalledWith(saveInput)
    expect(hoisted.settingsWorkspaceService.loadSecretStates).toHaveBeenCalledWith({ profileIds: ['openrouter'] })
    expect(hoisted.settingsWorkspaceService.loadSustechCasSecret).toHaveBeenCalledOnce()
    expect(hoisted.settingsWorkspaceService.saveProfileSecret).toHaveBeenCalledWith({
      profileId: 'openrouter',
      apiKey: 'draft-secret',
    })
    expect(hoisted.settingsWorkspaceService.clearProfileSecret).toHaveBeenCalledWith({
      profileId: 'openrouter',
    })
    expect(hoisted.settingsWorkspaceService.saveSustechCasSecret).toHaveBeenCalledWith({
      password: 'cas-secret',
    })
    expect(hoisted.settingsWorkspaceService.clearSustechCasSecret).toHaveBeenCalledOnce()
    expect(hoisted.settingsWorkspaceService.resolveProviderRoute).toHaveBeenCalledWith(resolveProviderRouteRequest)
    expect(copilotHistoryService.listThreads).toHaveBeenCalledOnce()
    expect(copilotHistoryService.getThreadDetail).toHaveBeenCalledWith('thread-1')
    expect(copilotHistoryService.getRunReplay).toHaveBeenCalledWith('run-1')
    expect(copilotHistoryService.renameThread).toHaveBeenCalledWith('thread-1', { title: '已重命名线程' })
    expect(copilotHistoryService.duplicateThread).toHaveBeenCalledWith('thread-1', { title: '历史线程（副本）' })
    expect(copilotHistoryService.deleteThread).toHaveBeenCalledWith('thread-1')
    expect(copilotHistoryService.backupDatabase).toHaveBeenCalledWith({ targetPath: 'backups/history.db' })
    expect(copilotHistoryService.restoreDatabase).toHaveBeenCalledWith({ sourcePath: 'backups/history.db' })

    const unifiedConfigOptions = hoisted.createElectronUnifiedConfigService.mock.calls[0]?.[0]
    const settingsWorkspaceOptions = hoisted.createElectronSettingsWorkspaceService.mock.calls[0]?.[0]

    expect(unifiedConfigOptions?.prepareRuntimePaths).toBe(prepareRuntimePaths)
    expect(settingsWorkspaceOptions?.prepareRuntimePaths).toBe(prepareRuntimePaths)

    await unifiedConfigOptions?.appendLog?.('warn', 'config-log', {
      scope: 'config',
    })
    await unifiedConfigOptions?.publishPublicSnapshotUpdate?.(loadPublicSnapshotResult.snapshot)
    await settingsWorkspaceOptions?.appendLog?.('error', 'settings-log', {
      scope: 'settings',
    })

    expect(appendMainRuntimeLog).toHaveBeenNthCalledWith(1, 'warn', 'config-log', {
      scope: 'config',
    })
    expect(appendMainRuntimeLog).toHaveBeenNthCalledWith(2, 'error', 'settings-log', {
      scope: 'settings',
    })
    expect(publishConfigCenterPublicSnapshotUpdate).toHaveBeenCalledOnce()
    expect(publishConfigCenterPublicSnapshotUpdate).toHaveBeenCalledWith(loadPublicSnapshotResult.snapshot)
  })
})
