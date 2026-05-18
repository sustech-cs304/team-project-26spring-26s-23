import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
}))

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: electronMocks.showOpenDialog,
  },
}))

const hoisted = vi.hoisted(() => {
  const createElectronUnifiedConfigService = vi.fn()
  const createElectronSettingsWorkspaceService = vi.fn()
  const createElectronDesktopCapabilityBridgeService = vi.fn()
  const createElectronToolCatalogService = vi.fn()
  const createElectronMcpRegistryService = vi.fn()
  const createElectronSkillRegistryService = vi.fn()
  const createElectronManagedRuntimeService = vi.fn()
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
  const mcpRegistryService = {
    loadRegistry: vi.fn(),
    saveServer: vi.fn(),
    deleteServer: vi.fn(),
    setServerEnabled: vi.fn(),
    testConnection: vi.fn(),
    refreshCatalog: vi.fn(),
  }
  const skillRegistryService = {
    loadRegistry: vi.fn(),
    importSkill: vi.fn(),
    selectAndImportSkill: vi.fn(),
    deleteSkill: vi.fn(),
    setSkillEnabled: vi.fn(),
    refreshSkills: vi.fn(),
  }
  const managedRuntimeService = {
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
    createElectronMcpRegistryService,
    createElectronSkillRegistryService,
    createElectronManagedRuntimeService,
    unifiedConfigService,
    settingsWorkspaceService,
    capabilityBridgeService,
    toolCatalogService,
    mcpRegistryService,
    skillRegistryService,
    managedRuntimeService,
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

vi.mock('./mcp-registry/main-process', () => ({
  createElectronMcpRegistryService: hoisted.createElectronMcpRegistryService,
}))

vi.mock('./skill-registry/main-process', () => ({
  createElectronSkillRegistryService: hoisted.createElectronSkillRegistryService,
}))

vi.mock('./managed-runtime/main-process', () => ({
  createElectronManagedRuntimeService: hoisted.createElectronManagedRuntimeService,
}))

import {
  createConfigCenterPublicSnapshotFixture,
  createManagedRuntimeLoadResultFixture,
  createMcpDeleteServerSuccessFixture,
  createMcpRefreshCatalogSuccessFixture,
  createMcpRegistryLoadResultFixture,
  createMcpSaveServerSuccessFixture,
  createMcpSetServerEnabledSuccessFixture,
  createMcpStdioStubServerFixture,
  createMcpTestConnectionSuccessFixture,
  createSettingsWorkspaceStateFixture,
  createSkillRecordFixture,
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
    const mcpServerDraft = createMcpStdioStubServerFixture()
    const loadManagedRuntimeResult = createManagedRuntimeLoadResultFixture()
    const loadMcpRegistryResult = createMcpRegistryLoadResultFixture()
    const saveMcpServerResult = createMcpSaveServerSuccessFixture()
    const deleteMcpServerResult = createMcpDeleteServerSuccessFixture(mcpServerDraft.serverId)
    const setMcpServerEnabledResult = createMcpSetServerEnabledSuccessFixture(false)
    const testMcpConnectionResult = createMcpTestConnectionSuccessFixture('stdio')
    const refreshMcpCatalogResult = createMcpRefreshCatalogSuccessFixture()
    const skillRecord = createSkillRecordFixture()
    const loadSkillRegistryResult = {
      ok: true,
      registryRevision: 3,
      snapshotRevision: 5,
      skills: [skillRecord],
    } as const
    const importSkillResult = {
      ok: true,
      registryRevision: 4,
      snapshotRevision: 6,
      skill: skillRecord,
      validationErrors: [],
    } as const
    const selectAndImportSkillResult = {
      ok: true,
      registryRevision: 8,
      snapshotRevision: 10,
      skill: skillRecord,
      validationErrors: [],
    } as const
    const deleteSkillResult = {
      ok: true,
      registryRevision: 5,
      snapshotRevision: 7,
      skillId: skillRecord.skillId,
      deleted: true,
    } as const
    const setSkillEnabledResult = {
      ok: true,
      registryRevision: 6,
      snapshotRevision: 8,
      skill: { ...skillRecord, enabled: false },
    } as const
    const refreshSkillsResult = {
      ok: true,
      registryRevision: 7,
      snapshotRevision: 9,
      refreshedSkillIds: [skillRecord.skillId],
      results: [{
        skillId: skillRecord.skillId,
        status: 'valid' as const,
        errors: [],
        warnings: [],
      }],
    } as const
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
    hoisted.managedRuntimeService.load.mockResolvedValue(loadManagedRuntimeResult)
    hoisted.mcpRegistryService.loadRegistry.mockResolvedValue(loadMcpRegistryResult)
    hoisted.mcpRegistryService.saveServer.mockResolvedValue(saveMcpServerResult)
    hoisted.mcpRegistryService.deleteServer.mockResolvedValue(deleteMcpServerResult)
    hoisted.mcpRegistryService.setServerEnabled.mockResolvedValue(setMcpServerEnabledResult)
    hoisted.mcpRegistryService.testConnection.mockResolvedValue(testMcpConnectionResult)
    hoisted.mcpRegistryService.refreshCatalog.mockResolvedValue(refreshMcpCatalogResult)
    hoisted.skillRegistryService.loadRegistry.mockResolvedValue(loadSkillRegistryResult)
    hoisted.skillRegistryService.importSkill.mockResolvedValue(importSkillResult)
    hoisted.skillRegistryService.selectAndImportSkill.mockResolvedValue(selectAndImportSkillResult)
    hoisted.skillRegistryService.deleteSkill.mockResolvedValue(deleteSkillResult)
    hoisted.skillRegistryService.setSkillEnabled.mockResolvedValue(setSkillEnabledResult)
    hoisted.skillRegistryService.refreshSkills.mockResolvedValue(refreshSkillsResult)
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
    hoisted.createElectronMcpRegistryService.mockReturnValue(hoisted.mcpRegistryService)
    hoisted.createElectronSkillRegistryService.mockReturnValue(hoisted.skillRegistryService)
    hoisted.createElectronManagedRuntimeService.mockReturnValue(hoisted.managedRuntimeService)

    const hostedBackendService = { getLocalToken: vi.fn(() => 'runtime-token') }
    hoisted.unifiedConfigService.getHostedBackendService.mockResolvedValue(hostedBackendService)

    const prepareRuntimePaths = vi.fn(async () => ({ runtimeRootDir: 'runtime-root' } as never))
    const ensureHostedBackendService = vi.fn(async () => hostedBackendService as never)
    const appendMainRuntimeLog = vi.fn()
    const publishConfigCenterPublicSnapshotUpdate = vi.fn()
    const publishMcpRegistryEvent = vi.fn()
    const publishSkillRegistryEvent = vi.fn()
    const createCopilotHistoryService = vi.fn(() => hoisted.copilotHistoryService)
    const services = createMainProcessServices({
      prepareRuntimePaths,
      userDataPath: 'D:/workspace/candue-user-data',
      ensureHostedBackendService,
      appendMainRuntimeLog,
      publishConfigCenterPublicSnapshotUpdate,
      publishMcpRegistryEvent,
      publishSkillRegistryEvent,
      createCopilotHistoryService,
    })

    expect(hoisted.createElectronUnifiedConfigService).not.toHaveBeenCalled()
    expect(hoisted.createElectronSettingsWorkspaceService).not.toHaveBeenCalled()
    expect(hoisted.createElectronDesktopCapabilityBridgeService).not.toHaveBeenCalled()
    expect(hoisted.createElectronMcpRegistryService).not.toHaveBeenCalled()
    expect(hoisted.createElectronSkillRegistryService).not.toHaveBeenCalled()
    expect(hoisted.createElectronManagedRuntimeService).not.toHaveBeenCalled()
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
    await expect(services.loadManagedRuntime()).resolves.toEqual(loadManagedRuntimeResult)
    await expect(services.loadMcpRegistry()).resolves.toEqual(loadMcpRegistryResult)
    await expect(services.saveMcpServer(mcpServerDraft)).resolves.toEqual(saveMcpServerResult)
    await expect(services.deleteMcpServer(mcpServerDraft.serverId)).resolves.toEqual(deleteMcpServerResult)
    await expect(services.setMcpServerEnabled({ serverId: mcpServerDraft.serverId, enabled: false })).resolves.toEqual(
      setMcpServerEnabledResult,
    )
    await expect(services.testMcpConnection({ draft: mcpServerDraft })).resolves.toEqual(testMcpConnectionResult)
    await expect(services.refreshMcpCatalog({ serverId: mcpServerDraft.serverId })).resolves.toEqual(refreshMcpCatalogResult)
    await expect(services.loadSkillRegistry()).resolves.toEqual(loadSkillRegistryResult)
    await expect(services.importSkill({ sourceDirectory: 'D:/skills/writing-clear-docs' })).resolves.toEqual(importSkillResult)
    await expect(services.selectAndImportSkill()).resolves.toEqual(selectAndImportSkillResult)
    await expect(services.deleteSkill(skillRecord.skillId)).resolves.toEqual(deleteSkillResult)
    await expect(services.setSkillEnabled({ skillId: skillRecord.skillId, enabled: false })).resolves.toEqual(setSkillEnabledResult)
    await expect(services.refreshSkills({ skillId: skillRecord.skillId })).resolves.toEqual(refreshSkillsResult)
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
    expect(hoisted.createElectronMcpRegistryService).toHaveBeenCalledTimes(1)
    expect(hoisted.createElectronSkillRegistryService).toHaveBeenCalledTimes(1)
    expect(hoisted.createElectronManagedRuntimeService).toHaveBeenCalledTimes(1)
    expect(hoisted.createElectronToolCatalogService).toHaveBeenCalledTimes(1)
    expect(createCopilotHistoryService).toHaveBeenCalledTimes(1)
    expect(hoisted.unifiedConfigService.loadPublicSnapshot).toHaveBeenCalledOnce()
    expect(hoisted.unifiedConfigService.applyPublicPatch).toHaveBeenCalledWith(patch)
    expect(hoisted.settingsWorkspaceService.loadState).toHaveBeenCalledOnce()
    expect(hoisted.settingsWorkspaceService.saveState).toHaveBeenCalledWith(saveInput)
    expect(hoisted.settingsWorkspaceService.loadSecretStates).toHaveBeenCalledWith({ profileIds: ['openrouter'] })
    expect(hoisted.settingsWorkspaceService.loadSustechCasSecret).toHaveBeenCalledOnce()
    expect(hoisted.managedRuntimeService.load).toHaveBeenCalledOnce()
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
    expect(hoisted.mcpRegistryService.loadRegistry).toHaveBeenCalledOnce()
    expect(hoisted.mcpRegistryService.saveServer).toHaveBeenCalledWith(mcpServerDraft)
    expect(hoisted.mcpRegistryService.deleteServer).toHaveBeenCalledWith(mcpServerDraft.serverId)
    expect(hoisted.mcpRegistryService.setServerEnabled).toHaveBeenCalledWith({
      serverId: mcpServerDraft.serverId,
      enabled: false,
    })
    expect(hoisted.mcpRegistryService.testConnection).toHaveBeenCalledWith({ draft: mcpServerDraft })
    expect(hoisted.mcpRegistryService.refreshCatalog).toHaveBeenCalledWith({ serverId: mcpServerDraft.serverId })
    expect(hoisted.skillRegistryService.loadRegistry).toHaveBeenCalledOnce()
    expect(hoisted.skillRegistryService.importSkill).toHaveBeenCalledWith({ sourceDirectory: 'D:/skills/writing-clear-docs' })
    expect(hoisted.skillRegistryService.selectAndImportSkill).toHaveBeenCalledOnce()
    expect(hoisted.skillRegistryService.deleteSkill).toHaveBeenCalledWith(skillRecord.skillId)
    expect(hoisted.skillRegistryService.setSkillEnabled).toHaveBeenCalledWith({
      skillId: skillRecord.skillId,
      enabled: false,
    })
    expect(hoisted.skillRegistryService.refreshSkills).toHaveBeenCalledWith({ skillId: skillRecord.skillId })
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
    const skillRegistryOptions = hoisted.createElectronSkillRegistryService.mock.calls[0]?.[0]
    const managedRuntimeOptions = hoisted.createElectronManagedRuntimeService.mock.calls[0]?.[0]

    expect(unifiedConfigOptions?.prepareRuntimePaths).toBe(prepareRuntimePaths)
    expect(unifiedConfigOptions?.ensureHostedBackendService).toBe(ensureHostedBackendService)
    expect(settingsWorkspaceOptions?.prepareRuntimePaths).toBe(prepareRuntimePaths)
    expect(capabilityBridgeOptions?.prepareRuntimePaths).toBe(prepareRuntimePaths)
    expect(skillRegistryOptions?.prepareRuntimePaths).toBe(prepareRuntimePaths)
    expect(managedRuntimeOptions?.prepareRuntimePaths).toBe(prepareRuntimePaths)
    expect(managedRuntimeOptions?.userDataPath).toBe('D:/workspace/candue-user-data')

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
    await skillRegistryOptions?.appendLog?.('warn', 'skill-log', {
      scope: 'skill',
    })
    await skillRegistryOptions?.publishRegistryEvent?.({
      kind: 'snapshot',
      registryRevision: 8,
      snapshotRevision: 10,
      skills: [skillRecord],
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
    expect(appendMainRuntimeLog).toHaveBeenNthCalledWith(4, 'warn', 'skill-log', {
      scope: 'skill',
    })
    expect(publishConfigCenterPublicSnapshotUpdate).toHaveBeenCalledOnce()
    expect(publishConfigCenterPublicSnapshotUpdate).toHaveBeenCalledWith(loadPublicSnapshotResult.snapshot)
    expect(publishSkillRegistryEvent).toHaveBeenCalledOnce()
  })
})
