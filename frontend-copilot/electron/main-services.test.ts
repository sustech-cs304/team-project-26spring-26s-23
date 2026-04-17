import { beforeEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => {
  const createElectronUnifiedConfigService = vi.fn()
  const createElectronSettingsWorkspaceService = vi.fn()
  const createElectronDesktopCapabilityBridgeService = vi.fn()
  const createElectronToolCatalogService = vi.fn()
  const unifiedConfigService = {
    loadPublicSnapshot: vi.fn(),
    applyPublicPatch: vi.fn(),
    getHostedBackendService: vi.fn(),
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
  const capabilityBridgeService = {
    handleRequest: vi.fn(),
  }
  const toolCatalogService = {
    load: vi.fn(),
  }
  const copilotHistoryService = {
    listThreads: vi.fn(),
    getThreadDetail: vi.fn(),
    getRunReplay: vi.fn(),
    renameThread: vi.fn(),
    duplicateThread: vi.fn(),
    deleteThread: vi.fn(),
    backupDatabase: vi.fn(),
    restoreDatabase: vi.fn(),
  }

  return {
    createElectronUnifiedConfigService,
    createElectronSettingsWorkspaceService,
    createElectronDesktopCapabilityBridgeService,
    createElectronToolCatalogService,
    unifiedConfigService,
    settingsWorkspaceService,
    capabilityBridgeService,
    toolCatalogService,
    copilotHistoryService,
  }
})

vi.mock('./config-center/main-process', () => ({
  createElectronUnifiedConfigService: hoisted.createElectronUnifiedConfigService,
}))

vi.mock('./settings-workspace/main-process', () => ({
  createElectronSettingsWorkspaceService: hoisted.createElectronSettingsWorkspaceService,
}))

vi.mock('./capability-bridge/main-process', () => ({
  createElectronDesktopCapabilityBridgeService: hoisted.createElectronDesktopCapabilityBridgeService,
}))

vi.mock('./tool-catalog/service', () => ({
  createElectronToolCatalogService: hoisted.createElectronToolCatalogService,
}))

import {
  createConfigCenterPublicSnapshotFixture,
  createSettingsWorkspaceStateFixture,
} from './renderer-ipc.test-support'
import { createMainProcessServices } from './main-services'
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
    const loadToolCatalogResult = {
      ok: true,
      tools: [
        {
          toolId: 'functions.read_file',
          kind: 'builtin',
          availability: 'available',
          displayName: '读取文件',
          description: '读取项目内文件内容。',
        },
      ],
    } as const
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
    const capabilityRequest = {
      requestId: 'request-1',
      capability: 'secret' as const,
      operation: 'get_secret' as const,
      toolId: 'blackboard.snapshot.sync',
      runId: 'run-1',
      toolCallId: 'call-1',
      payload: {
        secretName: 'bb.password',
      },
    }
    const capabilityResponse = {
      requestId: 'request-1',
      ok: true as const,
      result: {
        value: 'resolved-secret',
      },
    }

    const listHistoryThreadsResult = {
      ok: true,
      threads: [],
    } as const
    const getHistoryThreadDetailResult = {
      ok: true,
      thread: null,
      runSummaries: [],
      timelineItems: [],
    } as const
    const getHistoryRunReplayResult = {
      ok: true,
      run: null,
      orderedEvents: [],
      toolCallBlocks: [],
      diagnosticBlocks: [],
    } as const
    const renameHistoryThreadResult = {
      ok: true,
      thread: {
        threadId: 'thread-1',
        title: '已重命名线程',
      },
    } as const
    const duplicateHistoryThreadResult = {
      ok: true,
      thread: {
        threadId: 'thread-copy',
        title: '历史线程（副本）',
      },
    } as const
    const deleteHistoryThreadResult = {
      ok: true,
    } as const
    const backupHistoryDatabaseResult = {
      ok: true,
      backupPath: 'backups/history.db',
    } as const
    const restoreHistoryDatabaseResult = {
      ok: true,
      restoredThreadCount: 3,
    } as const

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
    hoisted.capabilityBridgeService.handleRequest.mockResolvedValue(capabilityResponse)
    hoisted.toolCatalogService.load.mockResolvedValue(loadToolCatalogResult)
    hoisted.copilotHistoryService.listThreads.mockResolvedValue(listHistoryThreadsResult)
    hoisted.copilotHistoryService.getThreadDetail.mockResolvedValue(getHistoryThreadDetailResult)
    hoisted.copilotHistoryService.getRunReplay.mockResolvedValue(getHistoryRunReplayResult)
    hoisted.copilotHistoryService.renameThread.mockResolvedValue(renameHistoryThreadResult)
    hoisted.copilotHistoryService.duplicateThread.mockResolvedValue(duplicateHistoryThreadResult)
    hoisted.copilotHistoryService.deleteThread.mockResolvedValue(deleteHistoryThreadResult)
    hoisted.copilotHistoryService.backupDatabase.mockResolvedValue(backupHistoryDatabaseResult)
    hoisted.copilotHistoryService.restoreDatabase.mockResolvedValue(restoreHistoryDatabaseResult)

    hoisted.createElectronUnifiedConfigService.mockReturnValue(hoisted.unifiedConfigService)
    hoisted.createElectronSettingsWorkspaceService.mockReturnValue(hoisted.settingsWorkspaceService)
    hoisted.createElectronDesktopCapabilityBridgeService.mockReturnValue(hoisted.capabilityBridgeService)
    hoisted.createElectronToolCatalogService.mockReturnValue(hoisted.toolCatalogService)

    const hostedBackendService = { getLocalToken: vi.fn(() => 'runtime-token') }
    hoisted.unifiedConfigService.getHostedBackendService.mockResolvedValue(hostedBackendService)

    const prepareRuntimePaths = vi.fn(async () => ({ runtimeRootDir: 'runtime-root' } as never))
    const ensureHostedBackendService = vi.fn(async () => hostedBackendService as never)
    const appendMainRuntimeLog = vi.fn()
    const publishConfigCenterPublicSnapshotUpdate = vi.fn()
    const createCopilotHistoryService = vi.fn(() => hoisted.copilotHistoryService)
    const services = createMainProcessServices({
      prepareRuntimePaths,
      ensureHostedBackendService,
      appendMainRuntimeLog,
      publishConfigCenterPublicSnapshotUpdate,
      createCopilotHistoryService,
    })

    expect(hoisted.createElectronUnifiedConfigService).not.toHaveBeenCalled()
    expect(hoisted.createElectronSettingsWorkspaceService).not.toHaveBeenCalled()
    expect(hoisted.createElectronDesktopCapabilityBridgeService).not.toHaveBeenCalled()
    expect(hoisted.createElectronToolCatalogService).not.toHaveBeenCalled()

    const patch = {
      domains: {
        frontendPreferences: {
          theme: 'dark' as const,
        },
      },
    }

    await expect(services.loadConfigCenterPublicSnapshot()).resolves.toEqual(loadPublicSnapshotResult)
    await expect(services.applyConfigCenterPublicPatch(patch)).resolves.toEqual(applyPublicPatchResult)
    await expect(services.loadToolCatalog()).resolves.toEqual(loadToolCatalogResult)
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
    await expect(services.listCopilotHistoryThreads()).resolves.toEqual(listHistoryThreadsResult)
    await expect(services.getCopilotHistoryThreadDetail('thread-1')).resolves.toEqual(getHistoryThreadDetailResult)
    await expect(services.getCopilotHistoryRunReplay('run-1')).resolves.toEqual(getHistoryRunReplayResult)
    await expect(services.renameCopilotHistoryThread('thread-1', { title: '已重命名线程' })).resolves.toEqual(renameHistoryThreadResult)
    await expect(services.duplicateCopilotHistoryThread('thread-1', { title: '历史线程（副本）' })).resolves.toEqual(duplicateHistoryThreadResult)
    await expect(services.deleteCopilotHistoryThread('thread-1')).resolves.toEqual(deleteHistoryThreadResult)
    await expect(services.backupCopilotHistoryDatabase({ targetPath: 'backups/history.db' })).resolves.toEqual(backupHistoryDatabaseResult)
    await expect(services.restoreCopilotHistoryDatabase({ sourcePath: 'backups/history.db' })).resolves.toEqual(restoreHistoryDatabaseResult)
    await expect(services.resolveSettingsWorkspaceProviderRoute(resolveProviderRouteRequest)).resolves.toEqual(
      resolveProviderRouteResult,
    )
    await expect(services.handleDesktopCapabilityBridgeRequest(capabilityRequest)).resolves.toEqual(
      capabilityResponse,
    )

    expect(hoisted.createElectronUnifiedConfigService).toHaveBeenCalledTimes(1)
    expect(hoisted.createElectronSettingsWorkspaceService).toHaveBeenCalledTimes(1)
    expect(hoisted.createElectronDesktopCapabilityBridgeService).toHaveBeenCalledTimes(1)
    expect(hoisted.createElectronToolCatalogService).toHaveBeenCalledTimes(1)
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
    expect(hoisted.capabilityBridgeService.handleRequest).toHaveBeenCalledWith(capabilityRequest)
    expect(hoisted.toolCatalogService.load).toHaveBeenCalledOnce()
    expect(hoisted.copilotHistoryService.listThreads).toHaveBeenCalledOnce()
    expect(hoisted.copilotHistoryService.getThreadDetail).toHaveBeenCalledWith('thread-1')
    expect(hoisted.copilotHistoryService.getRunReplay).toHaveBeenCalledWith('run-1')
    expect(hoisted.copilotHistoryService.renameThread).toHaveBeenCalledWith('thread-1', { title: '已重命名线程' })
    expect(hoisted.copilotHistoryService.duplicateThread).toHaveBeenCalledWith('thread-1', { title: '历史线程（副本）' })
    expect(hoisted.copilotHistoryService.deleteThread).toHaveBeenCalledWith('thread-1')
    expect(hoisted.copilotHistoryService.backupDatabase).toHaveBeenCalledWith({ targetPath: 'backups/history.db' })
    expect(hoisted.copilotHistoryService.restoreDatabase).toHaveBeenCalledWith({ sourcePath: 'backups/history.db' })

    const unifiedConfigOptions = hoisted.createElectronUnifiedConfigService.mock.calls[0]?.[0]
    const settingsWorkspaceOptions = hoisted.createElectronSettingsWorkspaceService.mock.calls[0]?.[0]
    const capabilityBridgeOptions = hoisted.createElectronDesktopCapabilityBridgeService.mock.calls[0]?.[0]

    expect(unifiedConfigOptions?.prepareRuntimePaths).toBe(prepareRuntimePaths)
    expect(unifiedConfigOptions?.ensureHostedBackendService).toBe(ensureHostedBackendService)
    expect(settingsWorkspaceOptions?.prepareRuntimePaths).toBe(prepareRuntimePaths)
    expect(capabilityBridgeOptions?.prepareRuntimePaths).toBe(prepareRuntimePaths)

    await unifiedConfigOptions?.appendLog?.('warn', 'config-log', {
      scope: 'config',
    })
    await unifiedConfigOptions?.publishPublicSnapshotUpdate?.(loadPublicSnapshotResult.snapshot)
    await settingsWorkspaceOptions?.appendLog?.('error', 'settings-log', {
      scope: 'settings',
    })
    await capabilityBridgeOptions?.appendLog?.('info', 'capability-log', {
      scope: 'capability',
    })

    expect(appendMainRuntimeLog).toHaveBeenNthCalledWith(1, 'warn', 'config-log', {
      scope: 'config',
    })
    expect(appendMainRuntimeLog).toHaveBeenNthCalledWith(2, 'error', 'settings-log', {
      scope: 'settings',
    })
    expect(appendMainRuntimeLog).toHaveBeenNthCalledWith(3, 'info', 'capability-log', {
      scope: 'capability',
    })
    expect(publishConfigCenterPublicSnapshotUpdate).toHaveBeenCalledOnce()
    expect(publishConfigCenterPublicSnapshotUpdate).toHaveBeenCalledWith(loadPublicSnapshotResult.snapshot)
  })
})
