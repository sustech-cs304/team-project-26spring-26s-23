import { beforeEach, describe, expect, it, vi } from 'vitest'

const PROFILE_ID = 'openrouter'
const MODEL_ID = 'qwen-plus'
const THREAD_ID = 'thread-1'
const RUN_ID = 'run-1'
const TEST_ROOT = '/test/root'
const TEST_SUB = '/test/root/sub'
const TEST_DIR_PATH = '/test/dir'
const TEST_FILE = '/test/root/file1.txt'
const TEST_TARGET = '/test/root/target'
const TEST_SAVED_ROOT = '/test/saved-root'
const TEST_OPENED_FILE = '/test/opened-file.txt'
const TEST_REVEALED_ENTRY = '/test/revealed-entry'
const CAS_SECRET = 'cas-secret'
const DRAFT_SECRET = 'draft-secret'
const BACKUP_PATH = 'backups/history.db'
const PASTED_IMAGE = 'pasted-image.png'

const hoisted = vi.hoisted(() => {
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
  const capabilityBridgeService = { handleRequest: vi.fn() }
  const toolCatalogService = { load: vi.fn() }
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
  const managedRuntimeService = { load: vi.fn() }
  const attachmentService = {
    readClipboardData: vi.fn(),
    writeTempFile: vi.fn(),
    readPreview: vi.fn(),
    cleanupTempFiles: vi.fn(),
  }
  const fileManagerService = {
    selectRootDirectory: vi.fn(),
    listDirectory: vi.fn(),
    probeDirectory: vi.fn(),
    createDirectory: vi.fn(),
    copyEntries: vi.fn(),
    moveEntries: vi.fn(),
    renameEntry: vi.fn(),
    trashEntries: vi.fn(),
    deleteEntriesPermanently: vi.fn(),
    watchDirectories: vi.fn(),
    unwatchDirectories: vi.fn(),
    loadLastRootDirectory: vi.fn(),
    saveLastRootDirectory: vi.fn(),
    clearLastRootDirectory: vi.fn(),
    openEntryWithSystem: vi.fn(),
    revealEntryInFolder: vi.fn(),
    copyTextToClipboard: vi.fn(),
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
    createElectronAttachmentService: vi.fn(),
    createElectronUnifiedConfigService: vi.fn(),
    createElectronSettingsWorkspaceService: vi.fn(),
    createElectronDesktopCapabilityBridgeService: vi.fn(),
    createElectronToolCatalogService: vi.fn(),
    createElectronMcpRegistryService: vi.fn(),
    createElectronSkillRegistryService: vi.fn(),
    createElectronManagedRuntimeService: vi.fn(),
    createElectronFileManagerService: vi.fn(),
    attachmentService,
    unifiedConfigService,
    settingsWorkspaceService,
    capabilityBridgeService,
    toolCatalogService,
    mcpRegistryService,
    skillRegistryService,
    managedRuntimeService,
    fileManagerService,
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

vi.mock('./attachment-service/service', () => ({
  createElectronAttachmentService: hoisted.createElectronAttachmentService,
}))

vi.mock('./file-manager/service', () => ({
  createElectronFileManagerService: hoisted.createElectronFileManagerService,
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

/**
 * Builds all the test fixture result objects used by the main integration test.
 * Extracted to keep the main test body manageable. The function is intentionally
 * long because it constructs a complete fixture object with ~40 typed result stubs;
 * further splitting would scatter closely related fixture definitions.
 */
// eslint-disable-next-line max-lines-per-function
function createTestFixtures() {
  const skillRecord = createSkillRecordFixture()
  const mcpServerDraft = createMcpStdioStubServerFixture()
  const settingsState = createSettingsWorkspaceStateFixture()

  return {
    skillRecord,
    mcpServerDraft,
    settingsState,
    saveInput: normalizeSettingsWorkspaceStateValues(settingsState),

    loadPublicSnapshotResult: {
      ok: true,
      snapshot: createConfigCenterPublicSnapshotFixture({ theme: 'light', model: null }),
    } as const,

    applyPublicPatchResult: {
      ok: true,
      snapshot: createConfigCenterPublicSnapshotFixture({ theme: 'dark', model: MODEL_ID }),
    } as const,

    loadToolCatalogResult: {
      ok: true,
      tools: [{
        toolId: 'functions.read_file',
        kind: 'builtin' as const,
        availability: 'available' as const,
        displayName: '读取文件',
        description: '读取项目内文件内容。',
      }],
    } as const,

    loadStateResult: { ok: true, source: 'stored' as const, state: settingsState } as const,
    saveStateResult: { ok: true, state: settingsState } as const,

    loadSecretStatesResult: {
      ok: true,
      states: { openrouter: { hasApiKey: true, apiKey: 'persisted-secret' } },
    } as const,

    loadSustechCasSecretResult: {
      ok: true,
      state: { hasPassword: true, password: CAS_SECRET },
    } as const,

    saveProfileSecretResult: {
      ok: true,
      profileId: PROFILE_ID,
      state: { hasApiKey: true, apiKey: DRAFT_SECRET },
    } as const,

    clearProfileSecretResult: {
      ok: true,
      profileId: PROFILE_ID,
      state: { hasApiKey: false, apiKey: '' },
    } as const,

    saveSustechCasSecretResult: {
      ok: true,
      state: { hasPassword: true, password: CAS_SECRET },
    } as const,

    clearSustechCasSecretResult: {
      ok: true,
      state: { hasPassword: false, password: '' },
    } as const,

    resolveProviderRouteRequest: {
      routeRef: {
        routeKind: 'provider-model' as const,
        profileId: PROFILE_ID,
        modelId: MODEL_ID,
      },
      catalogRevision: 'catalog-v1',
    },

    resolveProviderRouteResult: {
      ok: true,
      resolvedRoute: {
        routeRef: {
          routeKind: 'provider-model' as const,
          profileId: PROFILE_ID,
          modelId: MODEL_ID,
        },
        providerProfileId: PROFILE_ID,
        provider: 'OpenRouter',
        providerId: PROFILE_ID,
        adapterId: 'openrouter-chat-completions',
        runtimeStatus: 'active' as const,
        catalogRevision: 'catalog-v1',
        endpointFamily: 'openai-compatible' as const,
        endpointType: 'chat-completions' as const,
        baseUrl: 'https://openrouter.ai/api/v1',
        modelId: MODEL_ID,
        authKind: 'api-key' as const,
      },
      privateAuth: {
        authKind: 'api-key' as const,
        authPayload: { apiKey: DRAFT_SECRET },
        apiKey: DRAFT_SECRET,
      },
    } as const,

    capabilityRequest: {
      requestId: 'request-1',
      capability: 'secret' as const,
      operation: 'get_secret' as const,
      toolId: 'blackboard.snapshot.sync',
      runId: RUN_ID,
      toolCallId: 'call-1',
      payload: { secretName: 'bb.password' },
    },

    capabilityResponse: {
      requestId: 'request-1',
      ok: true as const,
      result: { value: 'resolved-secret' },
    },

    listHistoryThreadsResult: { ok: true, threads: [] } as const,
    getHistoryThreadDetailResult: { ok: true, thread: null, runSummaries: [], timelineItems: [] } as const,
    getHistoryRunReplayResult: { ok: true, run: null, orderedEvents: [], toolCallBlocks: [], diagnosticBlocks: [] } as const,
    renameHistoryThreadResult: { ok: true, thread: { threadId: THREAD_ID, title: '已重命名线程' } } as const,
    duplicateHistoryThreadResult: { ok: true, thread: { threadId: 'thread-copy', title: '历史线程（副本）' } } as const,
    deleteHistoryThreadResult: { ok: true } as const,
    backupHistoryDatabaseResult: { ok: true, backupPath: BACKUP_PATH } as const,
    restoreHistoryDatabaseResult: { ok: true, restoredThreadCount: 3 } as const,

    readClipboardAttachmentDataResult: {
      ok: true as const,
      status: 'image' as const,
      availableFormats: ['image/png'],
      data: {
        mimeType: 'image/png' as const,
        base64Data: 'cG5nLWRhdGE=',
        byteLength: 8,
        width: 320,
        height: 180,
        suggestedName: PASTED_IMAGE,
      },
    },

    writeAttachmentTempFileResult: {
      ok: true as const,
      file: {
        path: `/tmp/candue-attachments/${PASTED_IMAGE}`,
        name: PASTED_IMAGE,
        mimeType: 'image/png' as const,
        size: 8,
        createdAt: '2026-05-09T06:00:00.000Z',
        isTemporary: true as const,
      },
    },

    readAttachmentPreviewResult: {
      ok: true as const,
      kind: 'text' as const,
      path: '/tmp/readme.txt',
      name: 'readme.txt',
      size: 16,
      mimeType: 'text/plain' as const,
      text: 'hello attachment',
      truncated: false,
      maxBytes: 1024,
      encoding: 'utf-8' as const,
    },

    cleanupAttachmentTempFilesResult: {
      ok: true as const,
      deletedPaths: ['/tmp/candue-attachments/pasted-image.png'],
      missingPaths: [],
      skippedPaths: [],
    },

    selectRootDirectoryResult: { ok: true as const, rootPath: TEST_ROOT, entries: [] },
    listDirectoryResult: { ok: true as const, entries: [] },
    probeDirectoryResult: { ok: true as const, totalItems: 0, isLarge: false, maxDepth: 0 },
    fileOperationResult: { ok: true as const, affectedPaths: [] },
    loadLastRootDirectoryResult: { ok: true as const, rootPath: '/test/last-root' },
    openEntryWithSystemResult: { ok: true as const, affectedPaths: [TEST_OPENED_FILE] },
    revealEntryInFolderResult: { ok: true as const, affectedPaths: [TEST_REVEALED_ENTRY] },
    copyTextToClipboardResult: { ok: true as const, affectedPaths: [] },

    loadManagedRuntimeResult: createManagedRuntimeLoadResultFixture(),
    loadMcpRegistryResult: createMcpRegistryLoadResultFixture(),
    saveMcpServerResult: createMcpSaveServerSuccessFixture(),
    deleteMcpServerResult: createMcpDeleteServerSuccessFixture(mcpServerDraft.serverId),
    setMcpServerEnabledResult: createMcpSetServerEnabledSuccessFixture(false),
    testMcpConnectionResult: createMcpTestConnectionSuccessFixture('stdio'),
    refreshMcpCatalogResult: createMcpRefreshCatalogSuccessFixture(),

    loadSkillRegistryResult: {
      ok: true, registryRevision: 3, snapshotRevision: 5, skills: [skillRecord],
    } as const,
    importSkillResult: {
      ok: true, registryRevision: 4, snapshotRevision: 6, skill: skillRecord, validationErrors: [],
    } as const,
    selectAndImportSkillResult: {
      ok: true, registryRevision: 8, snapshotRevision: 10, skill: skillRecord, validationErrors: [],
    } as const,
    deleteSkillResult: {
      ok: true, registryRevision: 5, snapshotRevision: 7, skillId: skillRecord.skillId, deleted: true,
    } as const,
    setSkillEnabledResult: {
      ok: true, registryRevision: 6, snapshotRevision: 8, skill: { ...skillRecord, enabled: false },
    } as const,
    refreshSkillsResult: {
      ok: true, registryRevision: 7, snapshotRevision: 9,
      refreshedSkillIds: [skillRecord.skillId],
      results: [{ skillId: skillRecord.skillId, status: 'valid' as const, errors: [], warnings: [] }],
    } as const,
  }
}

/**
 * Sets up all domain service mock resolved values from the test fixtures.
 * Extracted to keep the main test body manageable.
 */
function setupDomainServiceMocks(f: ReturnType<typeof createTestFixtures>) {
  hoisted.unifiedConfigService.loadPublicSnapshot.mockResolvedValue(f.loadPublicSnapshotResult)
  hoisted.unifiedConfigService.applyPublicPatch.mockResolvedValue(f.applyPublicPatchResult)
  hoisted.settingsWorkspaceService.loadState.mockResolvedValue(f.loadStateResult)
  hoisted.settingsWorkspaceService.saveState.mockResolvedValue(f.saveStateResult)
  hoisted.settingsWorkspaceService.loadSecretStates.mockResolvedValue(f.loadSecretStatesResult)
  hoisted.settingsWorkspaceService.loadSustechCasSecret.mockResolvedValue(f.loadSustechCasSecretResult)
  hoisted.settingsWorkspaceService.saveProfileSecret.mockResolvedValue(f.saveProfileSecretResult)
  hoisted.settingsWorkspaceService.clearProfileSecret.mockResolvedValue(f.clearProfileSecretResult)
  hoisted.settingsWorkspaceService.saveSustechCasSecret.mockResolvedValue(f.saveSustechCasSecretResult)
  hoisted.settingsWorkspaceService.clearSustechCasSecret.mockResolvedValue(f.clearSustechCasSecretResult)
  hoisted.settingsWorkspaceService.resolveProviderRoute.mockResolvedValue(f.resolveProviderRouteResult)
  hoisted.capabilityBridgeService.handleRequest.mockResolvedValue(f.capabilityResponse)
  hoisted.toolCatalogService.load.mockResolvedValue(f.loadToolCatalogResult)
  hoisted.managedRuntimeService.load.mockResolvedValue(f.loadManagedRuntimeResult)
  hoisted.mcpRegistryService.loadRegistry.mockResolvedValue(f.loadMcpRegistryResult)
  hoisted.mcpRegistryService.saveServer.mockResolvedValue(f.saveMcpServerResult)
  hoisted.mcpRegistryService.deleteServer.mockResolvedValue(f.deleteMcpServerResult)
  hoisted.mcpRegistryService.setServerEnabled.mockResolvedValue(f.setMcpServerEnabledResult)
  hoisted.mcpRegistryService.testConnection.mockResolvedValue(f.testMcpConnectionResult)
  hoisted.mcpRegistryService.refreshCatalog.mockResolvedValue(f.refreshMcpCatalogResult)
  hoisted.skillRegistryService.loadRegistry.mockResolvedValue(f.loadSkillRegistryResult)
  hoisted.skillRegistryService.importSkill.mockResolvedValue(f.importSkillResult)
  hoisted.skillRegistryService.selectAndImportSkill.mockResolvedValue(f.selectAndImportSkillResult)
  hoisted.skillRegistryService.deleteSkill.mockResolvedValue(f.deleteSkillResult)
  hoisted.skillRegistryService.setSkillEnabled.mockResolvedValue(f.setSkillEnabledResult)
  hoisted.skillRegistryService.refreshSkills.mockResolvedValue(f.refreshSkillsResult)
  hoisted.copilotHistoryService.listThreads.mockResolvedValue(f.listHistoryThreadsResult)
  hoisted.copilotHistoryService.getThreadDetail.mockResolvedValue(f.getHistoryThreadDetailResult)
  hoisted.copilotHistoryService.getRunReplay.mockResolvedValue(f.getHistoryRunReplayResult)
  hoisted.copilotHistoryService.renameThread.mockResolvedValue(f.renameHistoryThreadResult)
  hoisted.copilotHistoryService.duplicateThread.mockResolvedValue(f.duplicateHistoryThreadResult)
  hoisted.copilotHistoryService.deleteThread.mockResolvedValue(f.deleteHistoryThreadResult)
  hoisted.copilotHistoryService.backupDatabase.mockResolvedValue(f.backupHistoryDatabaseResult)
  hoisted.copilotHistoryService.restoreDatabase.mockResolvedValue(f.restoreHistoryDatabaseResult)
  hoisted.attachmentService.readClipboardData.mockResolvedValue(f.readClipboardAttachmentDataResult)
  hoisted.attachmentService.writeTempFile.mockResolvedValue(f.writeAttachmentTempFileResult)
  hoisted.attachmentService.readPreview.mockResolvedValue(f.readAttachmentPreviewResult)
  hoisted.attachmentService.cleanupTempFiles.mockResolvedValue(f.cleanupAttachmentTempFilesResult)

  hoisted.fileManagerService.selectRootDirectory.mockResolvedValue(f.selectRootDirectoryResult)
  hoisted.fileManagerService.listDirectory.mockResolvedValue(f.listDirectoryResult)
  hoisted.fileManagerService.probeDirectory.mockResolvedValue(f.probeDirectoryResult)
  hoisted.fileManagerService.createDirectory.mockResolvedValue(f.fileOperationResult)
  hoisted.fileManagerService.copyEntries.mockResolvedValue(f.fileOperationResult)
  hoisted.fileManagerService.moveEntries.mockResolvedValue(f.fileOperationResult)
  hoisted.fileManagerService.renameEntry.mockResolvedValue(f.fileOperationResult)
  hoisted.fileManagerService.trashEntries.mockResolvedValue(f.fileOperationResult)
  hoisted.fileManagerService.deleteEntriesPermanently.mockResolvedValue(f.fileOperationResult)
  hoisted.fileManagerService.watchDirectories.mockResolvedValue(f.fileOperationResult)
  hoisted.fileManagerService.unwatchDirectories.mockResolvedValue(f.fileOperationResult)
  hoisted.fileManagerService.loadLastRootDirectory.mockResolvedValue(f.loadLastRootDirectoryResult)
  hoisted.fileManagerService.saveLastRootDirectory.mockResolvedValue({
    ok: true as const, affectedPaths: [TEST_SAVED_ROOT],
  })
  hoisted.fileManagerService.clearLastRootDirectory.mockResolvedValue(f.fileOperationResult)
  hoisted.fileManagerService.openEntryWithSystem.mockResolvedValue(f.openEntryWithSystemResult)
  hoisted.fileManagerService.revealEntryInFolder.mockResolvedValue(f.revealEntryInFolderResult)
  hoisted.fileManagerService.copyTextToClipboard.mockResolvedValue(f.copyTextToClipboardResult)
}

// eslint-disable-next-line max-lines-per-function -- single integration test, fragile to split
describe('createMainProcessServices', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // eslint-disable-next-line max-lines-per-function -- See describe-level comment above.
  it('lazily creates domain services once and delegates the electron-facing operations', async () => {
    const f = createTestFixtures()
    setupDomainServiceMocks(f)

    hoisted.createElectronUnifiedConfigService.mockReturnValue(hoisted.unifiedConfigService)
    hoisted.createElectronSettingsWorkspaceService.mockReturnValue(hoisted.settingsWorkspaceService)
    hoisted.createElectronDesktopCapabilityBridgeService.mockReturnValue(hoisted.capabilityBridgeService)
    hoisted.createElectronToolCatalogService.mockReturnValue(hoisted.toolCatalogService)
    hoisted.createElectronMcpRegistryService.mockReturnValue(hoisted.mcpRegistryService)
    hoisted.createElectronSkillRegistryService.mockReturnValue(hoisted.skillRegistryService)
    hoisted.createElectronManagedRuntimeService.mockReturnValue(hoisted.managedRuntimeService)
    hoisted.createElectronAttachmentService.mockReturnValue(hoisted.attachmentService)
    hoisted.createElectronFileManagerService.mockReturnValue(hoisted.fileManagerService)

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

    // Verify lazy creation
    expect(hoisted.createElectronUnifiedConfigService).not.toHaveBeenCalled()
    expect(hoisted.createElectronSettingsWorkspaceService).not.toHaveBeenCalled()
    expect(hoisted.createElectronDesktopCapabilityBridgeService).not.toHaveBeenCalled()
    expect(hoisted.createElectronMcpRegistryService).not.toHaveBeenCalled()
    expect(hoisted.createElectronSkillRegistryService).not.toHaveBeenCalled()
    expect(hoisted.createElectronManagedRuntimeService).not.toHaveBeenCalled()
    expect(hoisted.createElectronToolCatalogService).not.toHaveBeenCalled()

    const patch = { domains: { frontendPreferences: { theme: 'dark' as const } } }

    await expect(services.loadConfigCenterPublicSnapshot()).resolves.toEqual(f.loadPublicSnapshotResult)
    await expect(services.applyConfigCenterPublicPatch(patch)).resolves.toEqual(f.applyPublicPatchResult)
    await expect(services.loadToolCatalog()).resolves.toEqual(f.loadToolCatalogResult)
    await expect(services.loadSettingsWorkspaceState()).resolves.toEqual(f.loadStateResult)
    await expect(services.saveSettingsWorkspaceState(f.saveInput)).resolves.toEqual(f.saveStateResult)
    await expect(services.loadSettingsWorkspaceSecretStates({ profileIds: [PROFILE_ID] })).resolves.toEqual(f.loadSecretStatesResult)
    await expect(services.loadSettingsWorkspaceSustechCasSecret()).resolves.toEqual(f.loadSustechCasSecretResult)
    await expect(services.loadManagedRuntime()).resolves.toEqual(f.loadManagedRuntimeResult)
    await expect(services.loadMcpRegistry()).resolves.toEqual(f.loadMcpRegistryResult)
    await expect(services.saveMcpServer(f.mcpServerDraft)).resolves.toEqual(f.saveMcpServerResult)
    await expect(services.deleteMcpServer(f.mcpServerDraft.serverId)).resolves.toEqual(f.deleteMcpServerResult)
    await expect(services.setMcpServerEnabled({ serverId: f.mcpServerDraft.serverId, enabled: false })).resolves.toEqual(
      f.setMcpServerEnabledResult,
    )
    await expect(services.testMcpConnection({ draft: f.mcpServerDraft })).resolves.toEqual(f.testMcpConnectionResult)
    await expect(services.refreshMcpCatalog({ serverId: f.mcpServerDraft.serverId })).resolves.toEqual(f.refreshMcpCatalogResult)
    await expect(services.loadSkillRegistry()).resolves.toEqual(f.loadSkillRegistryResult)
    await expect(services.importSkill({ sourceDirectory: 'D:/skills/writing-clear-docs' })).resolves.toEqual(f.importSkillResult)
    await expect(services.selectAndImportSkill()).resolves.toEqual(f.selectAndImportSkillResult)
    await expect(services.deleteSkill(f.skillRecord.skillId)).resolves.toEqual(f.deleteSkillResult)
    await expect(services.setSkillEnabled({ skillId: f.skillRecord.skillId, enabled: false })).resolves.toEqual(f.setSkillEnabledResult)
    await expect(services.refreshSkills({ skillId: f.skillRecord.skillId })).resolves.toEqual(f.refreshSkillsResult)
    await expect(services.saveSettingsWorkspaceProfileSecret({
      profileId: PROFILE_ID, apiKey: DRAFT_SECRET,
    })).resolves.toEqual(f.saveProfileSecretResult)
    await expect(services.clearSettingsWorkspaceProfileSecret({
      profileId: PROFILE_ID,
    })).resolves.toEqual(f.clearProfileSecretResult)
    await expect(services.saveSettingsWorkspaceSustechCasSecret({
      password: CAS_SECRET,
    })).resolves.toEqual(f.saveSustechCasSecretResult)
    await expect(services.clearSettingsWorkspaceSustechCasSecret()).resolves.toEqual(f.clearSustechCasSecretResult)
    await expect(services.listCopilotHistoryThreads()).resolves.toEqual(f.listHistoryThreadsResult)
    await expect(services.getCopilotHistoryThreadDetail(THREAD_ID)).resolves.toEqual(f.getHistoryThreadDetailResult)
    await expect(services.getCopilotHistoryRunReplay(RUN_ID)).resolves.toEqual(f.getHistoryRunReplayResult)
    await expect(services.renameCopilotHistoryThread(THREAD_ID, { title: '已重命名线程' })).resolves.toEqual(f.renameHistoryThreadResult)
    await expect(services.duplicateCopilotHistoryThread(THREAD_ID, { title: '历史线程（副本）' })).resolves.toEqual(f.duplicateHistoryThreadResult)
    await expect(services.deleteCopilotHistoryThread(THREAD_ID)).resolves.toEqual(f.deleteHistoryThreadResult)
    await expect(services.backupCopilotHistoryDatabase({ targetPath: BACKUP_PATH })).resolves.toEqual(f.backupHistoryDatabaseResult)
    await expect(services.restoreCopilotHistoryDatabase({ sourcePath: BACKUP_PATH })).resolves.toEqual(f.restoreHistoryDatabaseResult)
    await expect(services.resolveSettingsWorkspaceProviderRoute(f.resolveProviderRouteRequest)).resolves.toEqual(
      f.resolveProviderRouteResult,
    )
    await expect(services.handleDesktopCapabilityBridgeRequest(f.capabilityRequest)).resolves.toEqual(
      f.capabilityResponse,
    )
    await expect(services.readClipboardAttachmentData()).resolves.toEqual(f.readClipboardAttachmentDataResult)
    await expect(services.writeAttachmentTempFile({ data: f.readClipboardAttachmentDataResult.data })).resolves.toEqual(
      f.writeAttachmentTempFileResult,
    )
    await expect(
      services.readAttachmentPreview({ path: '/tmp/readme.txt', maxTextBytes: 1024 }),
    ).resolves.toEqual(f.readAttachmentPreviewResult)
    await expect(
      services.cleanupAttachmentTempFiles({ paths: ['/tmp/candue-attachments/pasted-image.png'] }),
    ).resolves.toEqual(f.cleanupAttachmentTempFilesResult)

    await expect(services.selectRootDirectory()).resolves.toEqual(f.selectRootDirectoryResult)
    await expect(services.listDirectory({ rootPath: TEST_ROOT, directoryPath: TEST_SUB })).resolves.toEqual(
      f.listDirectoryResult,
    )
    await expect(services.probeDirectory({ rootPath: TEST_ROOT })).resolves.toEqual(f.probeDirectoryResult)
    await expect(
      services.createDirectory({ rootPath: TEST_ROOT, parentPath: TEST_SUB, name: 'new-folder' }),
    ).resolves.toEqual(f.fileOperationResult)
    await expect(
      services.copyEntries({
        rootPath: TEST_ROOT,
        sourcePaths: [TEST_FILE],
        destinationDirectory: TEST_TARGET,
        operationType: 'copy',
      }),
    ).resolves.toEqual(f.fileOperationResult)
    await expect(
      services.moveEntries({
        rootPath: TEST_ROOT,
        sourcePaths: [TEST_FILE],
        destinationDirectory: TEST_TARGET,
      }),
    ).resolves.toEqual(f.fileOperationResult)
    await expect(
      services.renameEntry({
        rootPath: TEST_ROOT,
        entryPath: '/test/root/old.txt',
        newName: 'new.txt',
      }),
    ).resolves.toEqual(f.fileOperationResult)
    await expect(
      services.trashEntries({ rootPath: TEST_ROOT, entryPaths: ['/test/root/delete-me.txt'] }),
    ).resolves.toEqual(f.fileOperationResult)
    await expect(
      services.deleteEntriesPermanently({ rootPath: TEST_ROOT, entryPaths: ['/test/root/permanent.txt'] }),
    ).resolves.toEqual(f.fileOperationResult)

    await expect(
      services.watchDirectories({ paths: [TEST_ROOT, TEST_SUB] }),
    ).resolves.toEqual(f.fileOperationResult)

    await expect(
      services.unwatchDirectories({ paths: [TEST_SUB] }),
    ).resolves.toEqual(f.fileOperationResult)

    await expect(services.loadLastRootDirectory()).resolves.toEqual(f.loadLastRootDirectoryResult)

    await expect(
      services.saveLastRootDirectory({ rootPath: TEST_SAVED_ROOT }),
    ).resolves.toEqual({ ok: true, affectedPaths: [TEST_SAVED_ROOT] })

    await expect(services.clearLastRootDirectory()).resolves.toEqual(f.fileOperationResult)
    await expect(services.openEntryWithSystem({ path: TEST_FILE })).resolves.toEqual(f.openEntryWithSystemResult)
    await expect(services.revealEntryInFolder({ path: TEST_DIR_PATH })).resolves.toEqual(f.revealEntryInFolderResult)
    await expect(services.copyTextToClipboard({ text: 'copied text' })).resolves.toEqual(f.copyTextToClipboardResult)

    // Verify factory functions called exactly once (lazy creation)
    expect(hoisted.createElectronUnifiedConfigService).toHaveBeenCalledTimes(1)
    expect(hoisted.createElectronSettingsWorkspaceService).toHaveBeenCalledTimes(1)
    expect(hoisted.createElectronDesktopCapabilityBridgeService).toHaveBeenCalledTimes(1)
    expect(hoisted.createElectronMcpRegistryService).toHaveBeenCalledTimes(1)
    expect(hoisted.createElectronSkillRegistryService).toHaveBeenCalledTimes(1)
    expect(hoisted.createElectronManagedRuntimeService).toHaveBeenCalledTimes(1)
    expect(hoisted.createElectronAttachmentService).toHaveBeenCalledTimes(1)
    expect(hoisted.createElectronToolCatalogService).toHaveBeenCalledTimes(1)
    expect(createCopilotHistoryService).toHaveBeenCalledTimes(1)

    // Verify service method delegations
    expect(hoisted.unifiedConfigService.loadPublicSnapshot).toHaveBeenCalledOnce()
    expect(hoisted.unifiedConfigService.applyPublicPatch).toHaveBeenCalledWith(patch)
    expect(hoisted.settingsWorkspaceService.loadState).toHaveBeenCalledOnce()
    expect(hoisted.settingsWorkspaceService.saveState).toHaveBeenCalledWith(f.saveInput)
    expect(hoisted.settingsWorkspaceService.loadSecretStates).toHaveBeenCalledWith({ profileIds: [PROFILE_ID] })
    expect(hoisted.settingsWorkspaceService.loadSustechCasSecret).toHaveBeenCalledOnce()
    expect(hoisted.managedRuntimeService.load).toHaveBeenCalledOnce()
    expect(hoisted.settingsWorkspaceService.saveProfileSecret).toHaveBeenCalledWith({
      profileId: PROFILE_ID, apiKey: DRAFT_SECRET,
    })
    expect(hoisted.settingsWorkspaceService.clearProfileSecret).toHaveBeenCalledWith({ profileId: PROFILE_ID })
    expect(hoisted.settingsWorkspaceService.saveSustechCasSecret).toHaveBeenCalledWith({ password: CAS_SECRET })
    expect(hoisted.settingsWorkspaceService.clearSustechCasSecret).toHaveBeenCalledOnce()
    expect(hoisted.settingsWorkspaceService.resolveProviderRoute).toHaveBeenCalledWith(f.resolveProviderRouteRequest)
    expect(hoisted.capabilityBridgeService.handleRequest).toHaveBeenCalledWith(f.capabilityRequest)
    expect(hoisted.attachmentService.readClipboardData).toHaveBeenCalledOnce()
    expect(hoisted.attachmentService.writeTempFile).toHaveBeenCalledWith({
      data: f.readClipboardAttachmentDataResult.data,
    })
    expect(hoisted.attachmentService.readPreview).toHaveBeenCalledWith({
      path: '/tmp/readme.txt', maxTextBytes: 1024,
    })
    expect(hoisted.attachmentService.cleanupTempFiles).toHaveBeenCalledWith({
      paths: ['/tmp/candue-attachments/pasted-image.png'],
    })
    expect(hoisted.mcpRegistryService.loadRegistry).toHaveBeenCalledOnce()
    expect(hoisted.mcpRegistryService.saveServer).toHaveBeenCalledWith(f.mcpServerDraft)
    expect(hoisted.mcpRegistryService.deleteServer).toHaveBeenCalledWith(f.mcpServerDraft.serverId)
    expect(hoisted.mcpRegistryService.setServerEnabled).toHaveBeenCalledWith({
      serverId: f.mcpServerDraft.serverId, enabled: false,
    })
    expect(hoisted.mcpRegistryService.testConnection).toHaveBeenCalledWith({ draft: f.mcpServerDraft })
    expect(hoisted.mcpRegistryService.refreshCatalog).toHaveBeenCalledWith({ serverId: f.mcpServerDraft.serverId })
    expect(hoisted.skillRegistryService.loadRegistry).toHaveBeenCalledOnce()
    expect(hoisted.skillRegistryService.importSkill).toHaveBeenCalledWith({ sourceDirectory: 'D:/skills/writing-clear-docs' })
    expect(hoisted.skillRegistryService.selectAndImportSkill).toHaveBeenCalledOnce()
    expect(hoisted.skillRegistryService.deleteSkill).toHaveBeenCalledWith(f.skillRecord.skillId)
    expect(hoisted.skillRegistryService.setSkillEnabled).toHaveBeenCalledWith({
      skillId: f.skillRecord.skillId, enabled: false,
    })
    expect(hoisted.skillRegistryService.refreshSkills).toHaveBeenCalledWith({ skillId: f.skillRecord.skillId })
    expect(hoisted.toolCatalogService.load).toHaveBeenCalledOnce()
    expect(hoisted.copilotHistoryService.listThreads).toHaveBeenCalledOnce()
    expect(hoisted.copilotHistoryService.getThreadDetail).toHaveBeenCalledWith(THREAD_ID)
    expect(hoisted.copilotHistoryService.getRunReplay).toHaveBeenCalledWith(RUN_ID)
    expect(hoisted.copilotHistoryService.renameThread).toHaveBeenCalledWith(THREAD_ID, { title: '已重命名线程' })
    expect(hoisted.copilotHistoryService.duplicateThread).toHaveBeenCalledWith(THREAD_ID, { title: '历史线程（副本）' })
    expect(hoisted.copilotHistoryService.deleteThread).toHaveBeenCalledWith(THREAD_ID)
    expect(hoisted.copilotHistoryService.backupDatabase).toHaveBeenCalledWith({ targetPath: BACKUP_PATH })
    expect(hoisted.copilotHistoryService.restoreDatabase).toHaveBeenCalledWith({ sourcePath: BACKUP_PATH })

    expect(hoisted.createElectronFileManagerService).toHaveBeenCalledTimes(1)
    expect(hoisted.fileManagerService.selectRootDirectory).toHaveBeenCalledOnce()
    expect(hoisted.fileManagerService.listDirectory).toHaveBeenCalledWith({
      rootPath: TEST_ROOT, directoryPath: TEST_SUB,
    })
    expect(hoisted.fileManagerService.probeDirectory).toHaveBeenCalledWith({ rootPath: TEST_ROOT })
    expect(hoisted.fileManagerService.createDirectory).toHaveBeenCalledWith({
      rootPath: TEST_ROOT, parentPath: TEST_SUB, name: 'new-folder',
    })
    expect(hoisted.fileManagerService.copyEntries).toHaveBeenCalledWith({
      rootPath: TEST_ROOT,
      sourcePaths: [TEST_FILE],
      destinationDirectory: TEST_TARGET,
      operationType: 'copy',
    })
    expect(hoisted.fileManagerService.moveEntries).toHaveBeenCalledWith({
      rootPath: TEST_ROOT,
      sourcePaths: [TEST_FILE],
      destinationDirectory: TEST_TARGET,
    })
    expect(hoisted.fileManagerService.renameEntry).toHaveBeenCalledWith({
      rootPath: TEST_ROOT, entryPath: '/test/root/old.txt', newName: 'new.txt',
    })
    expect(hoisted.fileManagerService.trashEntries).toHaveBeenCalledWith({
      rootPath: TEST_ROOT, entryPaths: ['/test/root/delete-me.txt'],
    })
    expect(hoisted.fileManagerService.deleteEntriesPermanently).toHaveBeenCalledWith({
      rootPath: TEST_ROOT, entryPaths: ['/test/root/permanent.txt'],
    })
    expect(hoisted.fileManagerService.watchDirectories).toHaveBeenCalledWith({ paths: [TEST_ROOT, TEST_SUB] })
    expect(hoisted.fileManagerService.unwatchDirectories).toHaveBeenCalledWith({ paths: [TEST_SUB] })
    expect(hoisted.fileManagerService.loadLastRootDirectory).toHaveBeenCalledOnce()
    expect(hoisted.fileManagerService.saveLastRootDirectory).toHaveBeenCalledWith({ rootPath: TEST_SAVED_ROOT })
    expect(hoisted.fileManagerService.clearLastRootDirectory).toHaveBeenCalledOnce()
    expect(hoisted.fileManagerService.openEntryWithSystem).toHaveBeenCalledWith({ path: TEST_FILE })
    expect(hoisted.fileManagerService.revealEntryInFolder).toHaveBeenCalledWith({ path: TEST_DIR_PATH })
    expect(hoisted.fileManagerService.copyTextToClipboard).toHaveBeenCalledWith({ text: 'copied text' })

    // Verify options propagation
    const fileManagerOptions = hoisted.createElectronFileManagerService.mock.calls[0]?.[0]
    expect(fileManagerOptions?.getMainWindow).toBeUndefined()

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

    await unifiedConfigOptions?.appendLog?.('warn', 'config-log', { scope: 'config' })
    await unifiedConfigOptions?.publishPublicSnapshotUpdate?.(f.loadPublicSnapshotResult.snapshot)
    await settingsWorkspaceOptions?.appendLog?.('error', 'settings-log', { scope: 'settings' })
    await capabilityBridgeOptions?.appendLog?.('info', 'capability-log', { scope: 'capability' })
    await skillRegistryOptions?.appendLog?.('warn', 'skill-log', { scope: 'skill' })
    await skillRegistryOptions?.publishRegistryEvent?.({
      kind: 'snapshot', registryRevision: 8, snapshotRevision: 10, skills: [f.skillRecord],
    })

    expect(appendMainRuntimeLog).toHaveBeenNthCalledWith(1, 'warn', 'config-log', { scope: 'config' })
    expect(appendMainRuntimeLog).toHaveBeenNthCalledWith(2, 'error', 'settings-log', { scope: 'settings' })
    expect(appendMainRuntimeLog).toHaveBeenNthCalledWith(3, 'info', 'capability-log', { scope: 'capability' })
    expect(appendMainRuntimeLog).toHaveBeenNthCalledWith(4, 'warn', 'skill-log', { scope: 'skill' })
    expect(publishConfigCenterPublicSnapshotUpdate).toHaveBeenCalledOnce()
    expect(publishConfigCenterPublicSnapshotUpdate).toHaveBeenCalledWith(f.loadPublicSnapshotResult.snapshot)
    expect(publishSkillRegistryEvent).toHaveBeenCalledOnce()
  })
})
