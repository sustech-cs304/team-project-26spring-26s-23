import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createProviderProfile } from '../../src/workbench/settings/settings-workspace-test-fixtures'
import { createElectronUnifiedConfigService } from '../config-center/main-process'
import { createHostedRuntimePaths, ensureHostedRuntimeDirectories } from '../runtime/runtime-paths'
import { createSettingsWorkspacePaths } from './paths'
import { createSettingsWorkspaceStorage } from './service'

interface SettingsWorkspaceFixture {
  tempRoot: string
  hostedPaths: ReturnType<typeof createHostedRuntimePaths>
  storage: ReturnType<typeof createSettingsWorkspaceStorage>
  paths: ReturnType<typeof createSettingsWorkspacePaths>
}

async function createSettingsWorkspaceFixture(): Promise<SettingsWorkspaceFixture> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-settings-workspace-'))
  const hostedPaths = createHostedRuntimePaths(tempRoot)
  await ensureHostedRuntimeDirectories(hostedPaths)
  const paths = createSettingsWorkspacePaths(hostedPaths)

  return {
    tempRoot,
    hostedPaths,
    paths,
    storage: createSettingsWorkspaceStorage({ paths }),
  }
}

async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8')) as unknown
}

describe('createSettingsWorkspaceStorage', () => {
  it('initializes state and secrets documents with defaults when storage is empty', async () => {
    const fixture = await createSettingsWorkspaceFixture()

    try {
      const result = await fixture.storage.loadState()

      expect(result.source).toBe('initialized-defaults')
      expect(result.state.providerProfiles).toEqual([])
      expect(result.state.defaultModelRouting).toEqual({
        primaryAssistantModel: '',
        fastAssistantModel: '',
      })
      expect(result.state.providerProfiles.flatMap((profile) => profile.availableModels)).toEqual([])
      expect(result.state.providerProfiles.every((profile) => profile.hasApiKey === false)).toBe(true)

      expect(await readJsonFile(fixture.paths.stateDocument)).toMatchObject({
        version: 1,
        kind: 'settings-workspace-state',
      })
      expect(await readJsonFile(fixture.paths.secretsDocument)).toEqual({
        version: 1,
        kind: 'settings-workspace-secrets',
        values: {
          providerSecrets: {},
          sustech: {
            casPassword: '',
          },
        },
      })
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })

  it('persists provider non-sensitive settings and restores them after reload', async () => {
    const fixture = await createSettingsWorkspaceFixture()

    try {
      const initial = await fixture.storage.loadState()
      const persistedProvider = createProviderProfile({
        id: 'persisted-provider',
        name: 'Persisted Router',
      })
      const stateToSave = {
        ...initial.state,
        providerProfiles: [
          {
            ...persistedProvider,
            notes: 'persisted-note',
          },
        ],
        defaultModelRouting: {
          primaryAssistantModel: 'persisted-primary',
          fastAssistantModel: 'persisted-fast',
        },
        general: {
          ...initial.state.general,
          language: 'en-US',
        },
      }

      await fixture.storage.saveState({
        ...stateToSave,
        providerProfiles: stateToSave.providerProfiles.map(({ hasApiKey: _hasApiKey, ...profile }) => profile),
      })

      const reloadedStorage = createSettingsWorkspaceStorage({ paths: fixture.paths })
      const reloaded = await reloadedStorage.loadState()

      expect(reloaded.source).toBe('stored')
      expect(reloaded.state.providerProfiles[0]).toMatchObject({
        name: 'Persisted Router',
        endpoint: 'https://persisted.example.com/v1',
        notes: 'persisted-note',
        hasApiKey: false,
      })
      expect(reloaded.state.defaultModelRouting).toEqual({
        primaryAssistantModel: 'persisted-primary',
        fastAssistantModel: 'persisted-fast',
      })
      expect(reloaded.state.general.language).toBe('en-US')
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })

  it('loads legacy flat thinking declarations and normalizes them into structured override inputs', async () => {
    const fixture = await createSettingsWorkspaceFixture()

    try {
      const initial = await fixture.storage.loadState()
      const legacyProvider = createProviderProfile({
        id: 'legacy-provider',
        name: 'Legacy Provider',
        defaultModel: 'legacy-model',
        fastModel: 'legacy-model',
        fallbackModel: 'legacy-model',
        availableModels: [
          {
            id: 'legacy-provider:model-1',
            modelId: 'legacy-model',
            displayName: 'Legacy Model',
            groupName: 'Legacy',
            capabilities: ['reasoning', 'tools'],
            thinkingCapability: {
              supported: true,
              levels: ['low', 'high'],
              defaultLevel: 'high',
            },
            supportsStreaming: true,
            currency: 'usd',
            inputPrice: '1',
            outputPrice: '2',
          },
        ],
      })

      await writeFile(fixture.paths.stateDocument, `${JSON.stringify({
        version: 1,
        kind: 'settings-workspace-state',
        values: {
          ...initial.state,
          providerProfiles: [legacyProvider].map(({ hasApiKey: _hasApiKey, ...profile }) => profile),
        },
      }, null, 2)}\n`)

      const loaded = await fixture.storage.loadState()

      expect(loaded.state.providerProfiles[0]?.availableModels[0]?.thinkingCapability).toEqual({
        supported: true,
        series: 'openai-6-level-superset-v1',
        template: {
          editorType: 'discrete',
          allowedValues: [
            { valueType: 'code', code: 'none', labelZh: '无' },
            { valueType: 'code', code: 'low', labelZh: '低' },
            { valueType: 'code', code: 'high', labelZh: '高' },
          ],
          defaultValue: { valueType: 'code', code: 'high', labelZh: '高' },
        },
      })
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })

  it('writes, replaces, clears, and reports provider secret status without exposing raw secret in public snapshot', async () => {
    const fixture = await createSettingsWorkspaceFixture()

    try {
      await fixture.storage.loadState()

      await fixture.storage.saveProviderSecret('persisted-provider', 'first-secret')
      expect(await readJsonFile(fixture.paths.secretsDocument)).toEqual({
        version: 1,
        kind: 'settings-workspace-secrets',
        values: {
          providerSecrets: {
            'persisted-provider': {
              apiKey: 'first-secret',
            },
          },
          sustech: {
            casPassword: '',
          },
        },
      })

      await fixture.storage.saveState({
        ...(await fixture.storage.loadState()).state,
        providerProfiles: [createProviderProfile({ id: 'persisted-provider', name: 'Persisted Router' })],
      })

      await fixture.storage.saveProviderSecret('persisted-provider', 'second-secret')
      expect(await readJsonFile(fixture.paths.secretsDocument)).toEqual({
        version: 1,
        kind: 'settings-workspace-secrets',
        values: {
          providerSecrets: {
            'persisted-provider': {
              apiKey: 'second-secret',
            },
          },
          sustech: {
            casPassword: '',
          },
        },
      })

      const loadedStateWithSecret = await fixture.storage.loadState()
      expect(loadedStateWithSecret.state.providerProfiles.find((profile) => profile.id === 'persisted-provider')?.hasApiKey).toBe(true)

      const secretStatuses = await fixture.storage.loadSecretStates(['persisted-provider', 'missing-provider'])
      expect(secretStatuses.states).toEqual({
        'persisted-provider': {
          hasApiKey: true,
          apiKey: 'second-secret',
        },
        'missing-provider': {
          hasApiKey: false,
          apiKey: '',
        },
      })

      const reloadedStorage = createSettingsWorkspaceStorage({ paths: fixture.paths })
      const reloadedSecretStatuses = await reloadedStorage.loadSecretStates(['persisted-provider'])
      expect(reloadedSecretStatuses.states).toEqual({
        'persisted-provider': {
          hasApiKey: true,
          apiKey: 'second-secret',
        },
      })

      const unifiedConfigService = createElectronUnifiedConfigService({
        prepareRuntimePaths: async () => fixture.hostedPaths,
      })
      const publicSnapshotResult = await unifiedConfigService.loadPublicSnapshot()
      expect(publicSnapshotResult.ok).toBe(true)
      if (!publicSnapshotResult.ok) {
        throw new Error('Expected config center public snapshot load to succeed.')
      }

      const publicSnapshotJson = JSON.stringify(publicSnapshotResult.snapshot)
      expect(publicSnapshotJson).not.toContain('second-secret')
      expect(publicSnapshotJson).not.toContain('providerSecrets')
      expect(publicSnapshotJson).not.toContain('apiKey')

      await fixture.storage.clearProviderSecret('persisted-provider')
      expect(await readJsonFile(fixture.paths.secretsDocument)).toEqual({
        version: 1,
        kind: 'settings-workspace-secrets',
        values: {
          providerSecrets: {},
          sustech: {
            casPassword: '',
          },
        },
      })

      const clearedStatuses = await fixture.storage.loadSecretStates(['persisted-provider'])
      expect(clearedStatuses.states).toEqual({
        'persisted-provider': {
          hasApiKey: false,
          apiKey: '',
        },
      })
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })

  it('resolves provider routes from stable ids plus route snapshots without leaking secrets into public snapshots', async () => {
    const fixture = await createSettingsWorkspaceFixture()

    try {
      await fixture.storage.loadState()
      const persistedProvider = createProviderProfile({
        id: 'resolved-provider',
        protocol: 'openai',
        endpoint: 'https://resolved.example.com/v1/',
        defaultModel: 'gpt-4.1',
        fastModel: 'gpt-4.1-mini',
        fallbackModel: 'gpt-4.1-mini',
      })
      await fixture.storage.saveState({
        ...(await fixture.storage.loadState()).state,
        providerProfiles: [persistedProvider],
      })
      await fixture.storage.saveProviderSecret('resolved-provider', 'resolved-secret')

      await expect(fixture.storage.resolveProviderRoute({
        providerProfileId: 'resolved-provider',
        snapshot: {
          provider: 'openai',
          endpointType: 'openai-compatible',
          baseUrl: 'https://resolved.example.com/v1',
          modelId: 'gpt-4.1',
        },
      })).resolves.toEqual({
        ok: true,
        route: {
          providerProfileId: 'resolved-provider',
          provider: 'openai',
          endpointType: 'openai-compatible',
          baseUrl: 'https://resolved.example.com/v1',
          modelId: 'gpt-4.1',
          auth: {
            apiKey: 'resolved-secret',
          },
        },
      })

      await expect(fixture.storage.resolveProviderRoute({
        providerProfileId: 'missing-provider',
        snapshot: {
          provider: 'openai',
          endpointType: 'openai-compatible',
          baseUrl: 'https://resolved.example.com/v1',
          modelId: 'gpt-4.1',
        },
      })).resolves.toEqual({
        ok: false,
        error: {
          code: 'provider_profile_not_found',
          message: "Provider profile 'missing-provider' does not exist.",
          details: {
            providerProfileId: 'missing-provider',
          },
        },
      })

      await expect(fixture.storage.resolveProviderRoute({
        providerProfileId: 'resolved-provider',
        snapshot: {
          provider: 'openai',
          endpointType: 'openai-compatible',
          baseUrl: 'https://drifted.example.com/v1',
          modelId: 'gpt-4.1',
        },
      })).resolves.toEqual({
        ok: false,
        error: {
          code: 'route_snapshot_mismatch',
          message: "Provider profile 'resolved-provider' no longer matches the requested route snapshot.",
          details: {
            providerProfileId: 'resolved-provider',
            mismatches: [
              {
                field: 'baseUrl',
                expected: 'https://resolved.example.com/v1',
                actual: 'https://drifted.example.com/v1',
              },
            ],
          },
        },
      })

      await fixture.storage.clearProviderSecret('resolved-provider')
      await expect(fixture.storage.resolveProviderRoute({
        providerProfileId: 'resolved-provider',
        snapshot: {
          provider: 'openai',
          endpointType: 'openai-compatible',
          baseUrl: 'https://resolved.example.com/v1',
          modelId: 'gpt-4.1',
        },
      })).resolves.toEqual({
        ok: false,
        error: {
          code: 'provider_secret_missing',
          message: "Provider profile 'resolved-provider' is missing an API key.",
          details: {
            providerProfileId: 'resolved-provider',
          },
        },
      })

      const unifiedConfigService = createElectronUnifiedConfigService({
        prepareRuntimePaths: async () => fixture.hostedPaths,
      })
      const publicSnapshotResult = await unifiedConfigService.loadPublicSnapshot()
      expect(publicSnapshotResult.ok).toBe(true)
      if (!publicSnapshotResult.ok) {
        throw new Error('Expected config center public snapshot load to succeed.')
      }

      const publicSnapshotJson = JSON.stringify(publicSnapshotResult.snapshot)
      expect(publicSnapshotJson).not.toContain('resolved-secret')
      expect(publicSnapshotJson).not.toContain('resolved-provider')
      expect(publicSnapshotJson).not.toContain('apiKey')
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })
})
