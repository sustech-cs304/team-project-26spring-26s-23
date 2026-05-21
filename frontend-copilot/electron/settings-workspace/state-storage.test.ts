import { describe, expect, it, vi } from 'vitest'

import type { SettingsWorkspaceDocumentIO } from './settings-workspace-document-io'
import { createSettingsWorkspaceStateStorage } from './settings-workspace-state-storage'

const defaultStateValues = {
  sustech: {
    studentId: '', email: '', blackboardCurrentTermOnly: false,
    blackboardParallelSyncWorkers: '1', blackboardSyncInterval: 'off' as const,
    blackboardLastAutoSyncAt: null, blackboardNextAutoSyncAt: null,
  },
  providerProfiles: [
    {
      profileId: 'profile-a', providerId: 'openai', displayName: 'Profile A',
      baseUrl: 'https://api.openai.com/v1', models: [],
      compatibility: { status: 'active' as const, reason: '' }, extensions: {},
    },
  ],
  defaultModelRouting: { primaryAssistantModel: null, fastAssistantModel: null },
  general: { language: 'zh-CN', assistantNotificationsEnabled: false },
  mcp: {
    mcpAutoDiscoveryEnabled: true, toolPermissionMode: 'manual' as const,
    toolPermissionPolicy: {
      version: 1 as const, migrationSourceMode: 'manual' as const,
      defaultMode: 'ask' as const, toolPermissions: {},
    },
  },
  api: { apiReconnectMode: 'exponential', healthPollingEnabled: true, apiBaseUrl: 'http://127.0.0.1:8000' },
  docs: { docsFormat: 'markdown' },
  externalSource: { wakeupShareLink: '' },
}

function createMockDocumentIO(options: {
  stateMissing?: boolean
  secretsMissing?: boolean
  stateDirty?: boolean
  secretsDirty?: boolean
  stateValues?: Record<string, unknown>
  secretsValues?: Record<string, unknown>
} = {}): SettingsWorkspaceDocumentIO {
  const stateDoc = {
    version: 3,
    kind: 'settings-workspace-state',
    values: { ...defaultStateValues, ...options.stateValues },
  }

  const secretsDoc = {
    version: 2,
    kind: 'settings-workspace-secrets',
    values: {
      providerSecrets: {} as Record<string, unknown>,
      sustech: { casPassword: '' },
      ...options.secretsValues,
    },
  }

  return {
    readStateDocument: vi.fn().mockResolvedValue({
      document: stateDoc,
      missing: options.stateMissing ?? false,
      dirty: options.stateDirty ?? false,
    }),
    readSecretsDocument: vi.fn().mockResolvedValue({
      document: secretsDoc,
      missing: options.secretsMissing ?? false,
      dirty: options.secretsDirty ?? false,
    }),
    writeDocuments: vi.fn().mockResolvedValue(undefined),
  }
}

describe('createSettingsWorkspaceStateStorage', () => {
  describe('loadState', () => {
    it('returns source "stored" when state is not missing', async () => {
      const docIO = createMockDocumentIO({ stateMissing: false })

      const storage = createSettingsWorkspaceStateStorage(docIO)
      const result = await storage.loadState()

      expect(result.source).toBe('stored')
    })

    it('returns source "initialized-defaults" when state is missing', async () => {
      const docIO = createMockDocumentIO({ stateMissing: true })

      const storage = createSettingsWorkspaceStateStorage(docIO)
      const result = await storage.loadState()

      expect(result.source).toBe('initialized-defaults')
    })

    it('writes documents when state is dirty', async () => {
      const docIO = createMockDocumentIO({ stateDirty: true })

      const storage = createSettingsWorkspaceStateStorage(docIO)
      await storage.loadState()

      expect(docIO.writeDocuments).toHaveBeenCalledTimes(1)
    })

    it('writes documents when secrets are dirty', async () => {
      const docIO = createMockDocumentIO({ secretsDirty: true })

      const storage = createSettingsWorkspaceStateStorage(docIO)
      await storage.loadState()

      expect(docIO.writeDocuments).toHaveBeenCalledTimes(1)
    })

    it('does not write when neither state nor secrets are dirty', async () => {
      const docIO = createMockDocumentIO({ stateDirty: false, secretsDirty: false })

      const storage = createSettingsWorkspaceStateStorage(docIO)
      await storage.loadState()

      expect(docIO.writeDocuments).not.toHaveBeenCalled()
    })

    it('returns editable state with provider profiles', async () => {
      const docIO = createMockDocumentIO()

      const storage = createSettingsWorkspaceStateStorage(docIO)
      const result = await storage.loadState()

      expect(result.state.providerProfiles).toBeDefined()
      expect(result.state.providerProfiles.length).toBeGreaterThanOrEqual(1)
    })

    it('returns sustech settings in editable state', async () => {
      const docIO = createMockDocumentIO()

      const storage = createSettingsWorkspaceStateStorage(docIO)
      const result = await storage.loadState()

      expect(result.state.sustech).toBeDefined()
      expect(typeof result.state.sustech.blackboardCurrentTermOnly).toBe('boolean')
    })

    it('returns general settings in editable state', async () => {
      const docIO = createMockDocumentIO()

      const storage = createSettingsWorkspaceStateStorage(docIO)
      const result = await storage.loadState()

      expect(result.state.general.language).toBeDefined()
    })

    it('returns MCP settings in editable state', async () => {
      const docIO = createMockDocumentIO()

      const storage = createSettingsWorkspaceStateStorage(docIO)
      const result = await storage.loadState()

      expect(result.state.mcp).toBeDefined()
      expect(result.state.mcp.toolPermissionPolicy).toBeDefined()
    })
  })

  describe('saveState', () => {
    it('saves state and returns updated editable state', async () => {
      const docIO = createMockDocumentIO()

      const storage = createSettingsWorkspaceStateStorage(docIO)

      const input = { ...defaultStateValues }
      const result = await storage.saveState(input)

      expect(result.state).toBeDefined()
      expect(result.state.providerProfiles).toBeDefined()
      expect(docIO.writeDocuments).toHaveBeenCalledTimes(1)
    })

    it('writes updated state document on save', async () => {
      const docIO = createMockDocumentIO()

      const storage = createSettingsWorkspaceStateStorage(docIO)
      await storage.saveState({ ...defaultStateValues })

      expect(docIO.writeDocuments).toHaveBeenCalledTimes(1)
    })

    it('prunes stale secrets during save', async () => {
      const docIO = createMockDocumentIO({
        secretsValues: {
          providerSecrets: {
            'profile-a': { profileId: 'profile-a', authKind: 'api-key', secretValues: { apiKey: 'key-a' } },
            'profile-b': { profileId: 'profile-b', authKind: 'api-key', secretValues: { apiKey: 'key-b' } },
          },
          sustech: { casPassword: '' },
        },
      })

      const storage = createSettingsWorkspaceStateStorage(docIO)

      // Save with only profile-a in profiles; profile-b should be pruned
      await storage.saveState({ ...defaultStateValues, providerProfiles: [defaultStateValues.providerProfiles[0]!] })

      expect(docIO.writeDocuments).toHaveBeenCalledTimes(1)
    })
  })

  describe('loadState with missing data', () => {
    it('handles missing secrets gracefully', async () => {
      const docIO = createMockDocumentIO({ secretsMissing: true })

      const storage = createSettingsWorkspaceStateStorage(docIO)
      const result = await storage.loadState()

      expect(result.source).toBeDefined()
      expect(result.state).toBeDefined()
    })
  })
})
