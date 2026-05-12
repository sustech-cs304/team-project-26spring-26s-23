/* eslint-disable sonarjs/no-duplicate-string -- test fixture data inherently contains repeated string literals */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createProviderProfile } from '../../src/workbench/settings/settings-workspace-test-fixtures'
import {
  SETTINGS_WORKSPACE_STATE_DOCUMENT_VERSION,
  normalizeSettingsWorkspaceStateValues,
} from './state-schema'
import { createElectronUnifiedConfigService } from '../config-center/main-process'
import { createHostedRuntimePaths, ensureHostedRuntimeDirectories } from '../runtime/runtime-paths'
import { createSettingsWorkspacePaths } from './paths'
import { createSettingsWorkspaceStorage } from './service'

const ROUTE_KIND = 'provider-model' as const
const PERSISTED_PROVIDER = 'persisted-provider'
const RESOLVED_PROVIDER = 'resolved-provider'
const LEGACY_PROVIDER = 'legacy-provider'
const OLLAMA_LOCAL = 'ollama-local'
const CATALOG_REVISION = '2026-04-06-provider-catalog-v1'
const CAPABILITY_HINTS = { streaming: true, tools: true, vision: true, reasoning: true, search: false }
const GPT_4_1 = 'gpt-4.1'

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
  return { tempRoot, hostedPaths, paths, storage: createSettingsWorkspaceStorage({ paths }) }
}

async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8')) as unknown
}

describe('createSettingsWorkspaceStorage', () => { // eslint-disable-line max-lines-per-function -- groups 4 sub-describes for init, persistence, secrets, routing
  describe('state initialization and persistence', () => {
    it('initializes state and secrets documents with defaults when storage is empty', async () => {
      const fixture = await createSettingsWorkspaceFixture()
      try {
        const result = await fixture.storage.loadState()
        expect(result.source).toBe('initialized-defaults')
        expect(result.state.providerProfiles).toEqual([])
        expect(result.state.defaultModelRouting).toMatchObject({
          primaryAssistantModel: '', fastAssistantModel: '',
          primaryAssistantModelRoute: null, fastAssistantModelRoute: null,
        })
        expect(result.state.providerProfiles.flatMap((profile) => profile.availableModels)).toEqual([])
        expect(result.state.providerProfiles.every((profile) => profile.hasApiKey === false)).toBe(true)

        expect(await readJsonFile(fixture.paths.stateDocument)).toMatchObject({
          version: SETTINGS_WORKSPACE_STATE_DOCUMENT_VERSION, kind: 'settings-workspace-state',
        })
        expect(await readJsonFile(fixture.paths.secretsDocument)).toEqual({
          version: 2, kind: 'settings-workspace-secrets',
          values: { providerSecrets: {}, sustech: { casPassword: '' } },
        })
      } finally {
        await rm(fixture.tempRoot, { recursive: true, force: true })
      }
    })

    it('persists provider non-sensitive settings and restores them after reload', async () => {
      const fixture = await createSettingsWorkspaceFixture()
      try {
        const initial = await fixture.storage.loadState()
        const persistedProvider = createProviderProfile({ id: PERSISTED_PROVIDER, name: 'Persisted Router' })
        const primaryModelId = persistedProvider.availableModels[0]!.modelId
        const stateToSave = {
          ...initial.state,
          providerProfiles: [{ ...persistedProvider, notes: 'persisted-note' }],
          defaultModelRouting: { primaryAssistantModel: primaryModelId, fastAssistantModel: persistedProvider.fastModel },
          general: { ...initial.state.general, language: 'en-US' },
        }

        await fixture.storage.saveState(normalizeSettingsWorkspaceStateValues(stateToSave))
        const reloadedStorage = createSettingsWorkspaceStorage({ paths: fixture.paths })
        const reloaded = await reloadedStorage.loadState()

        expect(reloaded.source).toBe('stored')
        expect(reloaded.state.providerProfiles[0]).toMatchObject({
          name: 'Persisted Router', endpoint: 'https://persisted.example.com/v1', notes: 'persisted-note', hasApiKey: false,
        })
        expect(reloaded.state.defaultModelRouting).toMatchObject({
          primaryAssistantModel: primaryModelId, fastAssistantModel: persistedProvider.fastModel,
          primaryAssistantModelRoute: { routeKind: ROUTE_KIND, profileId: PERSISTED_PROVIDER, modelId: primaryModelId },
          fastAssistantModelRoute: { routeKind: ROUTE_KIND, profileId: PERSISTED_PROVIDER, modelId: persistedProvider.fastModel },
        })
        expect(reloaded.state.general.language).toBe('en-US')
      } finally {
        await rm(fixture.tempRoot, { recursive: true, force: true })
      }
    })

  })

  describe('legacy migration', () => {
    it('loads legacy flat thinking declarations and normalizes them into structured override inputs', async () => {
      const fixture = await createSettingsWorkspaceFixture()
      try {
        const initial = await fixture.storage.loadState()
        const legacyProvider = createProviderProfile({
          id: LEGACY_PROVIDER, name: 'Legacy Provider', fastModel: 'legacy-model', fallbackModel: 'legacy-model',
          availableModels: [{
            id: 'legacy-provider:model-1', modelId: 'legacy-model', displayName: 'Legacy Model', groupName: 'Legacy',
            capabilities: ['reasoning', 'tools'], thinkingCapability: { supported: true, levels: ['low', 'high'], defaultLevel: 'high' },
            supportsStreaming: true, currency: 'usd', inputPrice: '1', outputPrice: '2',
          }],
        })

        await writeFile(fixture.paths.stateDocument, `${JSON.stringify({
          version: 1, kind: 'settings-workspace-state',
          values: { ...initial.state, providerProfiles: [legacyProvider].map((profile) => ({ ...profile, hasApiKey: undefined })) },
        }, null, 2)}\n`)

        const loaded = await fixture.storage.loadState()
        expect(loaded.state.providerProfiles[0]?.availableModels[0]?.thinkingCapability).toEqual({
          supported: true, series: 'openai-6-level-superset-v1',
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

    it('drops legacy provider defaultModel fields from editable state and clears them on save', async () => {
      const fixture = await createSettingsWorkspaceFixture()
      try {
        const initial = await fixture.storage.loadState()
        await fixture.storage.saveProfileSecret(LEGACY_PROVIDER, 'legacy-secret')

        await writeFile(fixture.paths.stateDocument, `${JSON.stringify({
          version: 1, kind: 'settings-workspace-state',
          values: {
            ...initial.state,
            providerProfiles: [{
              id: LEGACY_PROVIDER, name: 'Legacy Provider', protocol: 'openai',
              endpoint: 'https://legacy.example.com/v1', defaultModel: 'legacy-model',
              fastModel: '', fallbackModel: '', organization: '', region: 'Global', notes: 'legacy-default-model',
              availableModels: [{ id: 'legacy-provider:model-1', modelId: 'legacy-model', displayName: 'Legacy Model', groupName: 'Legacy', capabilities: ['reasoning', 'tools'], supportsStreaming: true, currency: 'usd', inputPrice: '1', outputPrice: '2' }],
            }],
          },
        }, null, 2)}\n`)

        const loaded = await fixture.storage.loadState()
        expect(loaded.state.providerProfiles[0]).toMatchObject({ id: LEGACY_PROVIDER, fastModel: '', fallbackModel: '', hasApiKey: true })
        expect(loaded.state.providerProfiles[0]).not.toHaveProperty('defaultModel')
        expect(loaded.state.providerProfiles[0]).not.toHaveProperty('defaultModelId')

        const saveResult = await fixture.storage.saveState(normalizeSettingsWorkspaceStateValues(loaded.state))
        expect(saveResult.state.providerProfiles[0]).not.toHaveProperty('defaultModel')
        expect(saveResult.state.providerProfiles[0]).not.toHaveProperty('defaultModelId')

        const persistedDocument = await readJsonFile(fixture.paths.stateDocument) as { values: { providerProfiles: Array<Record<string, unknown>> } }
        expect(persistedDocument.values.providerProfiles[0]).not.toHaveProperty('defaultModel')
        expect(await fixture.storage.loadSecretStates([LEGACY_PROVIDER])).toEqual({ states: { [LEGACY_PROVIDER]: { hasApiKey: true, apiKey: 'legacy-secret' } } })
      } finally {
        await rm(fixture.tempRoot, { recursive: true, force: true })
      }
    })
  })

  describe('provider secrets', () => {
    it('writes, replaces, clears, and reports provider secret status without exposing raw secret in public snapshot', async () => {
      const fixture = await createSettingsWorkspaceFixture()
      try {
        await fixture.storage.loadState()

        await fixture.storage.saveProfileSecret(PERSISTED_PROVIDER, 'first-secret')
        expect(await readJsonFile(fixture.paths.secretsDocument)).toEqual({
          version: 2, kind: 'settings-workspace-secrets',
          values: { providerSecrets: { [PERSISTED_PROVIDER]: { profileId: PERSISTED_PROVIDER, authKind: 'api-key', secretValues: { apiKey: 'first-secret' } } }, sustech: { casPassword: '' } },
        })

        await fixture.storage.saveState(normalizeSettingsWorkspaceStateValues({
          ...(await fixture.storage.loadState()).state,
          providerProfiles: [createProviderProfile({ id: PERSISTED_PROVIDER, name: 'Persisted Router' })],
        }))

        await fixture.storage.saveProfileSecret(PERSISTED_PROVIDER, 'second-secret')
        expect(await readJsonFile(fixture.paths.secretsDocument)).toEqual({
          version: 2, kind: 'settings-workspace-secrets',
          values: { providerSecrets: { [PERSISTED_PROVIDER]: { profileId: PERSISTED_PROVIDER, authKind: 'api-key', secretValues: { apiKey: 'second-secret' } } }, sustech: { casPassword: '' } },
        })

        const loadedStateWithSecret = await fixture.storage.loadState()
        expect(loadedStateWithSecret.state.providerProfiles.find((profile) => profile.id === PERSISTED_PROVIDER)?.hasApiKey).toBe(true)

        const secretStatuses = await fixture.storage.loadSecretStates([PERSISTED_PROVIDER, 'missing-provider'])
        expect(secretStatuses.states).toEqual({
          [PERSISTED_PROVIDER]: { hasApiKey: true, apiKey: 'second-secret' },
          'missing-provider': { hasApiKey: false, apiKey: '' },
        })

        const reloadedStorage = createSettingsWorkspaceStorage({ paths: fixture.paths })
        const reloadedSecretStatuses = await reloadedStorage.loadSecretStates([PERSISTED_PROVIDER])
        expect(reloadedSecretStatuses.states).toEqual({ [PERSISTED_PROVIDER]: { hasApiKey: true, apiKey: 'second-secret' } })

        const unifiedConfigService = createElectronUnifiedConfigService({ prepareRuntimePaths: async () => fixture.hostedPaths })
        const publicSnapshotResult = await unifiedConfigService.loadPublicSnapshot()
        expect(publicSnapshotResult.ok).toBe(true)
        if (!publicSnapshotResult.ok) throw new Error('Expected config center public snapshot load to succeed.')

        const publicSnapshotJson = JSON.stringify(publicSnapshotResult.snapshot)
        expect(publicSnapshotJson).not.toContain('second-secret')
        expect(publicSnapshotJson).not.toContain('providerSecrets')
        expect(publicSnapshotJson).not.toContain('apiKey')

        await fixture.storage.clearProfileSecret(PERSISTED_PROVIDER)
        expect(await readJsonFile(fixture.paths.secretsDocument)).toEqual({
          version: 2, kind: 'settings-workspace-secrets',
          values: { providerSecrets: {}, sustech: { casPassword: '' } },
        })

        const clearedStatuses = await fixture.storage.loadSecretStates([PERSISTED_PROVIDER])
        expect(clearedStatuses.states).toEqual({ [PERSISTED_PROVIDER]: { hasApiKey: false, apiKey: '' } })
      } finally {
        await rm(fixture.tempRoot, { recursive: true, force: true })
      }
    })
  })

  describe('provider route resolution', () => { // eslint-disable-line max-lines-per-function -- sub-describe covers 3 test cases, just over limit
    it('resolves provider routes from stable route refs with optional snapshot validation and private auth separation', async () => {
      const fixture = await createSettingsWorkspaceFixture()
      try {
        await fixture.storage.loadState()
        const persistedProvider = createProviderProfile({
          id: RESOLVED_PROVIDER, protocol: 'openai', endpoint: 'https://resolved.example.com/v1/',
          fastModel: 'gpt-4.1-mini', fallbackModel: 'gpt-4.1-mini',
          availableModels: [{ id: 'resolved-provider:model-1', modelId: GPT_4_1, displayName: 'GPT 4.1', groupName: 'Resolved', capabilities: ['reasoning', 'tools'], supportsStreaming: true, currency: 'usd', inputPrice: '1', outputPrice: '2' }],
        })
        await fixture.storage.saveState(normalizeSettingsWorkspaceStateValues({
          ...(await fixture.storage.loadState()).state,
          providerProfiles: [persistedProvider],
        }))
        await fixture.storage.saveProfileSecret(RESOLVED_PROVIDER, 'resolved-secret')

        const expectedResolvedRoute = {
          routeRef: { routeKind: ROUTE_KIND, profileId: RESOLVED_PROVIDER, modelId: GPT_4_1 },
          providerProfileId: RESOLVED_PROVIDER, provider: 'openai', providerId: 'openai', adapterId: 'openai',
          runtimeStatus: 'enabled', catalogRevision: CATALOG_REVISION,
          endpointFamily: 'openai', endpointType: 'openai-compatible',
          baseUrl: 'https://resolved.example.com/v1', modelId: GPT_4_1, authKind: 'api-key',
          capabilityHints: CAPABILITY_HINTS,
        }
        const expectedPrivateAuth = { authKind: 'api-key' as const, authPayload: { apiKey: 'resolved-secret' }, apiKey: 'resolved-secret' }

        await expect(fixture.storage.resolveProviderRoute({
          routeRef: { routeKind: ROUTE_KIND, profileId: RESOLVED_PROVIDER, modelId: GPT_4_1 },
          catalogRevision: CATALOG_REVISION,
        })).resolves.toEqual({ ok: true, resolvedRoute: expectedResolvedRoute, privateAuth: expectedPrivateAuth })

        await expect(fixture.storage.resolveProviderRoute({
          routeRef: { routeKind: ROUTE_KIND, profileId: RESOLVED_PROVIDER, modelId: GPT_4_1 },
        })).resolves.toEqual({ ok: true, resolvedRoute: expectedResolvedRoute, privateAuth: expectedPrivateAuth })

        await expect(fixture.storage.resolveProviderRoute({
          // @ts-expect-error legacy providerProfileId + snapshot requests are no longer accepted
          providerProfileId: RESOLVED_PROVIDER,
          snapshot: { provider: 'openai', endpointType: 'openai-compatible', baseUrl: 'https://resolved.example.com/v1', modelId: GPT_4_1 },
        })).resolves.toEqual({ ok: false, error: { code: 'invalid_provider_route_request', message: 'Provider route request must include a stable routeRef.', details: {} } })

        await expect(fixture.storage.resolveProviderRoute({
          routeRef: { routeKind: ROUTE_KIND, profileId: 'missing-provider', modelId: GPT_4_1 },
        })).resolves.toEqual({
          ok: false, error: {
            code: 'provider_profile_not_found',
            message: "Provider profile 'missing-provider' does not exist.",
            details: { providerProfileId: 'missing-provider', routeRef: { routeKind: ROUTE_KIND, profileId: 'missing-provider', modelId: GPT_4_1 } },
          },
        })

        await fixture.storage.clearProfileSecret(RESOLVED_PROVIDER)
        await expect(fixture.storage.resolveProviderRoute({
          routeRef: { routeKind: ROUTE_KIND, profileId: RESOLVED_PROVIDER, modelId: GPT_4_1 },
        })).resolves.toEqual({
          ok: false, error: {
            code: 'provider_secret_missing',
            message: `Provider profile '${RESOLVED_PROVIDER}' is missing an API key.`,
            details: { providerProfileId: RESOLVED_PROVIDER, providerId: 'openai', routeRef: { routeKind: ROUTE_KIND, profileId: RESOLVED_PROVIDER, modelId: GPT_4_1 }, authKind: 'api-key' },
          },
        })

        const unifiedConfigService = createElectronUnifiedConfigService({ prepareRuntimePaths: async () => fixture.hostedPaths })
        const publicSnapshotResult = await unifiedConfigService.loadPublicSnapshot()
        expect(publicSnapshotResult.ok).toBe(true)
        if (!publicSnapshotResult.ok) throw new Error('Expected config center public snapshot load to succeed.')

        const publicSnapshotJson = JSON.stringify(publicSnapshotResult.snapshot)
        expect(publicSnapshotJson).not.toContain('resolved-secret')
        expect(publicSnapshotJson).not.toContain(RESOLVED_PROVIDER)
        expect(publicSnapshotJson).not.toContain('apiKey')
      } finally {
        await rm(fixture.tempRoot, { recursive: true, force: true })
      }
    })

    it('returns stable resolver error codes for catalog-only, legacy, unsupported, model drift, catalog mismatch, and unknown catalog providers', async () => {
      const fixture = await createSettingsWorkspaceFixture()
      try {
        await fixture.storage.loadState()
        const activeProvider = createProviderProfile({ id: 'active-openai', protocol: 'openai', endpoint: 'https://active.example.com/v1/', primaryModelId: GPT_4_1, fastModel: 'gpt-4.1-mini', fallbackModel: 'gpt-4.1-mini' })
        const catalogOnlyProvider = createProviderProfile({ id: 'catalog-openrouter', protocol: 'openrouter', providerId: 'openrouter', endpoint: 'https://openrouter.ai/api/v1/', primaryModelId: 'openai/gpt-4.1', fastModel: 'openai/gpt-4.1-mini', fallbackModel: 'openai/gpt-4.1-mini' })
        const legacyCatalogProvider = createProviderProfile({ id: 'legacy-catalog-provider', protocol: 'openai-response', providerId: 'openai-response', endpoint: 'https://legacy.example.com/v1/', primaryModelId: GPT_4_1, fastModel: GPT_4_1, fallbackModel: GPT_4_1 })
        const legacyProfile = createProviderProfile({ id: 'legacy-profile', protocol: 'openai', endpoint: 'https://legacy-profile.example.com/v1/', primaryModelId: GPT_4_1, fastModel: 'gpt-4.1-mini', fallbackModel: 'gpt-4.1-mini', compatibility: { status: 'legacy', reason: 'legacy profile preserved for migration' } })
        const unsupportedProfile = createProviderProfile({ id: 'unsupported-profile', protocol: 'openai', endpoint: 'https://unsupported.example.com/v1/', primaryModelId: GPT_4_1, fastModel: 'gpt-4.1-mini', fallbackModel: 'gpt-4.1-mini', compatibility: { status: 'unsupported', reason: 'unsupported provider profile' } })
        const missingCatalogProvider = createProviderProfile({ id: 'missing-catalog-provider', protocol: 'custom-missing', providerId: 'custom-missing', endpoint: 'https://missing.example.com/v1/', primaryModelId: 'custom-model', fastModel: 'custom-model', fallbackModel: 'custom-model' })

        await fixture.storage.saveState(normalizeSettingsWorkspaceStateValues({
          ...(await fixture.storage.loadState()).state,
          providerProfiles: [activeProvider, catalogOnlyProvider, legacyCatalogProvider, legacyProfile, unsupportedProfile, missingCatalogProvider],
        }))

        await expect(fixture.storage.resolveProviderRoute({ routeRef: { routeKind: ROUTE_KIND, profileId: 'missing-catalog-provider', modelId: 'custom-model' } })).resolves.toMatchObject({ ok: false, error: { code: 'provider_catalog_entry_not_found' } })
        await expect(fixture.storage.resolveProviderRoute({ routeRef: { routeKind: ROUTE_KIND, profileId: 'catalog-openrouter', modelId: 'openai/gpt-4.1' } })).resolves.toMatchObject({ ok: false, error: { code: 'provider_runtime_catalog_only' } })
        await expect(fixture.storage.resolveProviderRoute({ routeRef: { routeKind: ROUTE_KIND, profileId: 'legacy-catalog-provider', modelId: GPT_4_1 } })).resolves.toMatchObject({ ok: false, error: { code: 'provider_runtime_legacy_unsupported' } })
        await expect(fixture.storage.resolveProviderRoute({ routeRef: { routeKind: ROUTE_KIND, profileId: 'legacy-profile', modelId: GPT_4_1 } })).resolves.toMatchObject({ ok: false, error: { code: 'provider_profile_legacy' } })
        await expect(fixture.storage.resolveProviderRoute({ routeRef: { routeKind: ROUTE_KIND, profileId: 'unsupported-profile', modelId: GPT_4_1 } })).resolves.toMatchObject({ ok: false, error: { code: 'provider_profile_unsupported' } })
        await expect(fixture.storage.resolveProviderRoute({ routeRef: { routeKind: ROUTE_KIND, profileId: 'active-openai', modelId: 'missing-model' } })).resolves.toMatchObject({ ok: false, error: { code: 'provider_model_not_found', details: { providerProfileId: 'active-openai', modelId: 'missing-model' } } })
        await expect(fixture.storage.resolveProviderRoute({ routeRef: { routeKind: ROUTE_KIND, profileId: 'active-openai', modelId: GPT_4_1 }, catalogRevision: 'stale-revision' })).resolves.toMatchObject({ ok: false, error: { code: 'provider_catalog_revision_mismatch', details: { providerProfileId: 'active-openai', expectedCatalogRevision: 'stale-revision', actualCatalogRevision: CATALOG_REVISION } } })
      } finally {
        await rm(fixture.tempRoot, { recursive: true, force: true })
      }
    })

    it('resolves ollama routes without requiring an API key when catalog auth kind is none', async () => {
      const fixture = await createSettingsWorkspaceFixture()
      try {
        await fixture.storage.loadState()
        const persistedProvider = createProviderProfile({
          id: OLLAMA_LOCAL, protocol: 'ollama', endpoint: 'http://127.0.0.1:11434/v1/',
          hasApiKey: false, primaryModelId: 'llama3.2', fastModel: 'llama3.2', fallbackModel: 'llama3.2',
        })
        await fixture.storage.saveState(normalizeSettingsWorkspaceStateValues({
          ...(await fixture.storage.loadState()).state,
          providerProfiles: [persistedProvider],
        }))

        await expect(fixture.storage.resolveProviderRoute({
          routeRef: { routeKind: ROUTE_KIND, profileId: OLLAMA_LOCAL, modelId: 'llama3.2' },
        })).resolves.toEqual({
          ok: true,
          resolvedRoute: {
            routeRef: { routeKind: ROUTE_KIND, profileId: OLLAMA_LOCAL, modelId: 'llama3.2' },
            providerProfileId: OLLAMA_LOCAL, provider: 'ollama', providerId: 'ollama', adapterId: 'ollama',
            runtimeStatus: 'enabled', catalogRevision: CATALOG_REVISION,
            endpointFamily: 'ollama', endpointType: 'ollama-native',
            baseUrl: 'http://127.0.0.1:11434/v1', modelId: 'llama3.2', authKind: 'none',
            capabilityHints: CAPABILITY_HINTS,
          },
          privateAuth: { authKind: 'none', authPayload: {}, apiKey: '' },
        })
      } finally {
        await rm(fixture.tempRoot, { recursive: true, force: true })
      }
    })
  })
})
