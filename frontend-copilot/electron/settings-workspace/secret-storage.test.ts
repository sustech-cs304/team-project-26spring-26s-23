import { describe, expect, it, vi } from 'vitest'

import type { SettingsWorkspaceDocumentIO } from './settings-workspace-document-io'
import { createSettingsWorkspaceSecretStorage } from './settings-workspace-secret-storage'

function createMockDocumentIO(
  overrides: {
    stateDocument?: Record<string, unknown>
    secretsDocument?: Record<string, unknown>
  } = {},
): SettingsWorkspaceDocumentIO {
  const defaultState = {
    version: 3,
    kind: 'settings-workspace-state',
    values: {
      providerProfiles: [
        { profileId: 'profile-a', models: [{ modelId: 'model-1' }], compatibility: { status: 'active', reason: '' }, extensions: {} },
        { profileId: 'profile-b', models: [{ modelId: 'model-2' }], compatibility: { status: 'active', reason: '' }, extensions: {} },
      ],
      sustech: { studentId: '', email: '', blackboardCurrentTermOnly: false, blackboardParallelSyncWorkers: '1', blackboardSyncInterval: 'off' as const, blackboardLastAutoSyncAt: null, blackboardNextAutoSyncAt: null },
      defaultModelRouting: { primaryAssistantModel: null, fastAssistantModel: null },
      general: { language: 'zh-CN', assistantNotificationsEnabled: false },
      mcp: { mcpAutoDiscoveryEnabled: true, toolPermissionMode: 'manual' as const, toolPermissionPolicy: { version: 1, migrationSourceMode: 'manual' as const, defaultMode: 'ask' as const, toolPermissions: {} } },
      api: { apiReconnectMode: 'exponential', healthPollingEnabled: true, apiBaseUrl: 'http://127.0.0.1:8000' },
      docs: { docsFormat: 'markdown' },
      externalSource: { wakeupShareLink: '' },
    },
  }

  const defaultSecrets = {
    version: 2,
    kind: 'settings-workspace-secrets',
    values: {
      providerSecrets: {} as Record<string, unknown>,
      sustech: { casPassword: '' },
    },
  }

  const stateDoc = { ...defaultState, values: { ...defaultState.values, ...overrides.stateDocument } }
  const secretsDoc = { ...defaultSecrets, values: { ...defaultSecrets.values, ...overrides.secretsDocument } }

  return {
    readStateDocument: vi.fn().mockResolvedValue({ document: stateDoc, missing: false, dirty: false }),
    readSecretsDocument: vi.fn().mockResolvedValue({ document: secretsDoc, missing: false, dirty: false }),
    writeDocuments: vi.fn().mockResolvedValue(undefined),
  }
}

describe('createSettingsWorkspaceSecretStorage', () => {
  describe('loadSecretStates', () => {
    it('loads secret states for provided profile IDs', async () => {
      const docIO = createMockDocumentIO({
        secretsDocument: {
          providerSecrets: {
            'profile-a': { profileId: 'profile-a', authKind: 'api-key', secretValues: { apiKey: 'secret-key-a' } },
          },
        },
      })

      const storage = createSettingsWorkspaceSecretStorage(docIO)
      const result = await storage.loadSecretStates(['profile-a', 'profile-b'])

      expect(result.states['profile-a']).toEqual({ hasApiKey: true, apiKey: 'secret-key-a' })
      expect(result.states['profile-b']).toEqual({ hasApiKey: false, apiKey: '' })
    })

    it('reads state document to resolve profile IDs when none provided', async () => {
      const docIO = createMockDocumentIO({
        secretsDocument: {
          providerSecrets: {
            'profile-a': { profileId: 'profile-a', authKind: 'api-key', secretValues: { apiKey: 'key-a' } },
          },
        },
      })

      const storage = createSettingsWorkspaceSecretStorage(docIO)
      const result = await storage.loadSecretStates()

      // Should use profile IDs from state document (profile-a, profile-b)
      expect(Object.keys(result.states)).toContain('profile-a')
      expect(Object.keys(result.states)).toContain('profile-b')
      expect(result.states['profile-a']).toEqual({ hasApiKey: true, apiKey: 'key-a' })
    })

    it('returns empty states for unknown profile IDs', async () => {
      const docIO = createMockDocumentIO()

      const storage = createSettingsWorkspaceSecretStorage(docIO)
      const result = await storage.loadSecretStates(['unknown-profile'])

      expect(result.states['unknown-profile']).toEqual({ hasApiKey: false, apiKey: '' })
    })

    it('handles empty profile IDs gracefully', async () => {
      const docIO = createMockDocumentIO()

      const storage = createSettingsWorkspaceSecretStorage(docIO)
      const result = await storage.loadSecretStates([''])

      expect(result.states['']).toEqual({ hasApiKey: false, apiKey: '' })
    })
  })

  describe('loadSustechCasSecret', () => {
    it('loads CAS password from secrets document', async () => {
      const docIO = createMockDocumentIO({
        secretsDocument: {
          sustech: { casPassword: 'saved-password' },
        },
      })

      const storage = createSettingsWorkspaceSecretStorage(docIO)
      const result = await storage.loadSustechCasSecret()

      expect(result.state).toEqual({ hasPassword: true, password: 'saved-password' })
    })

    it('returns empty password when none saved', async () => {
      const docIO = createMockDocumentIO()

      const storage = createSettingsWorkspaceSecretStorage(docIO)
      const result = await storage.loadSustechCasSecret()

      expect(result.state).toEqual({ hasPassword: false, password: '' })
    })
  })

  describe('saveProfileSecret', () => {
    it('saves API key for a provider profile', async () => {
      const docIO = createMockDocumentIO()

      const storage = createSettingsWorkspaceSecretStorage(docIO)
      const result = await storage.saveProfileSecret('profile-a', '  my-api-key  ')

      expect(result.state).toEqual({ hasApiKey: true, apiKey: 'my-api-key' })
      expect(docIO.writeDocuments).toHaveBeenCalledTimes(1)
      expect(docIO.readStateDocument).toHaveBeenCalled()
      expect(docIO.readSecretsDocument).toHaveBeenCalled()
    })

    it('normalizes profileId and apiKey', async () => {
      const docIO = createMockDocumentIO()

      const storage = createSettingsWorkspaceSecretStorage(docIO)
      const result = await storage.saveProfileSecret('  profile-a  ', '  trimmed-key  ')

      expect(result.state.apiKey).toBe('trimmed-key')
    })

    it('throws on empty profileId', async () => {
      const docIO = createMockDocumentIO()

      const storage = createSettingsWorkspaceSecretStorage(docIO)
      await expect(storage.saveProfileSecret('', 'key')).rejects.toThrow('Missing required profileId')
    })

    it('throws on empty apiKey', async () => {
      const docIO = createMockDocumentIO()

      const storage = createSettingsWorkspaceSecretStorage(docIO)
      await expect(storage.saveProfileSecret('profile-a', '   ')).rejects.toThrow('Missing required apiKey')
    })
  })

  describe('clearProfileSecret', () => {
    it('removes API key for a provider profile', async () => {
      const docIO = createMockDocumentIO({
        secretsDocument: {
          providerSecrets: {
            'profile-a': { profileId: 'profile-a', authKind: 'api-key', secretValues: { apiKey: 'old-key' } },
            'profile-b': { profileId: 'profile-b', authKind: 'api-key', secretValues: { apiKey: 'other-key' } },
          },
        },
      })

      const storage = createSettingsWorkspaceSecretStorage(docIO)
      const result = await storage.clearProfileSecret('profile-a')

      expect(result.state).toEqual({ hasApiKey: false, apiKey: '' })
      expect(docIO.writeDocuments).toHaveBeenCalledTimes(1)
    })

    it('handles clearing a profile that has no secret', async () => {
      const docIO = createMockDocumentIO()

      const storage = createSettingsWorkspaceSecretStorage(docIO)
      const result = await storage.clearProfileSecret('profile-a')

      expect(result.state).toEqual({ hasApiKey: false, apiKey: '' })
    })
  })

  describe('saveSustechCasSecret', () => {
    it('saves CAS password', async () => {
      const docIO = createMockDocumentIO()

      const storage = createSettingsWorkspaceSecretStorage(docIO)
      const result = await storage.saveSustechCasSecret('  cas-password  ')

      expect(result.state).toEqual({ hasPassword: true, password: 'cas-password' })
      expect(docIO.writeDocuments).toHaveBeenCalledTimes(1)
    })

    it('throws on empty password', async () => {
      const docIO = createMockDocumentIO()

      const storage = createSettingsWorkspaceSecretStorage(docIO)
      await expect(storage.saveSustechCasSecret('   ')).rejects.toThrow('Missing required password')
    })
  })

  describe('clearSustechCasSecret', () => {
    it('clears CAS password', async () => {
      const docIO = createMockDocumentIO({
        secretsDocument: {
          sustech: { casPassword: 'old-password' },
        },
      })

      const storage = createSettingsWorkspaceSecretStorage(docIO)
      const result = await storage.clearSustechCasSecret()

      expect(result.state).toEqual({ hasPassword: false, password: '' })
      expect(docIO.writeDocuments).toHaveBeenCalledTimes(1)
    })
  })
})
