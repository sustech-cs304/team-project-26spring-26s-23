/* eslint-disable sonarjs/no-duplicate-string -- test fixture data inherently contains repeated string literals */
import { describe, expect, it } from 'vitest'

import { createPersistedWorkspaceState, createProviderProfile } from '../../src/workbench/settings/settings-workspace-test-fixtures'
import { resolveSettingsWorkspaceProviderRoute } from './provider-route-resolver'

const ROUTE_KIND = 'provider-model' as const
const PROVIDER_OPENAI = 'openai'
const CATALOG_REVISION = '2026-04-06-provider-catalog-v1'
const CAPABILITY_HINTS = { streaming: true, tools: true, vision: true, reasoning: true, search: false }
const SHARED_MODEL = 'shared-model'
const GPT_4_1 = 'gpt-4.1'

describe('resolveSettingsWorkspaceProviderRoute', () => {
  describe('successful resolution', () => {
    it('includes provider catalog capability hints in resolved routes', () => {
      const result = resolveSettingsWorkspaceProviderRoute({
        state: createPersistedWorkspaceState(),
        secretStates: { openrouter: { hasApiKey: true, apiKey: 'persisted-secret' } },
        request: { routeRef: { routeKind: ROUTE_KIND, profileId: 'openrouter', modelId: 'openai/gpt-4.1' } },
      })

      expect(result).toEqual({
        ok: true,
        resolvedRoute: {
          routeRef: { routeKind: ROUTE_KIND, profileId: 'openrouter', modelId: 'openai/gpt-4.1' },
          providerProfileId: 'openrouter',
          provider: PROVIDER_OPENAI,
          providerId: PROVIDER_OPENAI,
          adapterId: PROVIDER_OPENAI,
          runtimeStatus: 'enabled',
          catalogRevision: CATALOG_REVISION,
          endpointFamily: PROVIDER_OPENAI,
          endpointType: 'openai-compatible',
          baseUrl: 'https://persisted.example.com/v1',
          modelId: 'openai/gpt-4.1',
          authKind: 'api-key',
          capabilityHints: CAPABILITY_HINTS,
        },
        privateAuth: { authKind: 'api-key', authPayload: { apiKey: 'persisted-secret' }, apiKey: 'persisted-secret' },
      })
    })

    it('resolves stable route refs against the requested provider profile even when model ids overlap', () => {
      const alphaProfile = createProviderProfile({
        id: 'alpha-profile', profileId: 'alpha-profile', providerId: PROVIDER_OPENAI,
        protocol: PROVIDER_OPENAI, endpoint: 'https://alpha.example.com/v1/', baseUrl: 'https://alpha.example.com/v1/',
        fastModel: SHARED_MODEL, fallbackModel: SHARED_MODEL,
        availableModels: [{ ...createProviderProfile({ id: 'alpha-seed' }).availableModels[0]!, id: 'alpha-model-1', modelId: SHARED_MODEL, displayName: 'Shared Alpha', groupName: 'Alpha' }],
      })
      const betaProfile = createProviderProfile({
        id: 'beta-profile', profileId: 'beta-profile', providerId: PROVIDER_OPENAI,
        protocol: PROVIDER_OPENAI, endpoint: 'https://beta.example.com/v1/', baseUrl: 'https://beta.example.com/v1/',
        fastModel: SHARED_MODEL, fallbackModel: SHARED_MODEL,
        availableModels: [{ ...createProviderProfile({ id: 'beta-seed' }).availableModels[0]!, id: 'beta-model-1', modelId: SHARED_MODEL, displayName: 'Shared Beta', groupName: 'Beta' }],
      })

      const result = resolveSettingsWorkspaceProviderRoute({
        state: createPersistedWorkspaceState({ providerProfiles: [alphaProfile, betaProfile] }),
        secretStates: {
          'alpha-profile': { hasApiKey: true, apiKey: 'alpha-secret' },
          'beta-profile': { hasApiKey: true, apiKey: 'beta-secret' },
        },
        request: { routeRef: { routeKind: ROUTE_KIND, profileId: 'beta-profile', modelId: SHARED_MODEL } },
      })

      expect(result).toEqual({
        ok: true,
        resolvedRoute: {
          routeRef: { routeKind: ROUTE_KIND, profileId: 'beta-profile', modelId: SHARED_MODEL },
          providerProfileId: 'beta-profile',
          provider: PROVIDER_OPENAI, providerId: PROVIDER_OPENAI, adapterId: PROVIDER_OPENAI,
          runtimeStatus: 'enabled',
          catalogRevision: CATALOG_REVISION,
          endpointFamily: PROVIDER_OPENAI, endpointType: 'openai-compatible',
          baseUrl: 'https://beta.example.com/v1',
          modelId: SHARED_MODEL,
          authKind: 'api-key',
          capabilityHints: CAPABILITY_HINTS,
        },
        privateAuth: { authKind: 'api-key', authPayload: { apiKey: 'beta-secret' }, apiKey: 'beta-secret' },
      })
    })
  })

  describe('error cases', () => {
    it('rejects route refs whose model is not present in the provider model list', () => {
      const providerWithoutMatchingModel = createProviderProfile({
        id: 'legacy-route-provider', profileId: 'legacy-route-provider', providerId: PROVIDER_OPENAI,
        protocol: PROVIDER_OPENAI, endpoint: 'https://legacy-route.example.com/v1/', baseUrl: 'https://legacy-route.example.com/v1/',
        fastModel: '', fallbackModel: '', availableModels: [],
      })

      const result = resolveSettingsWorkspaceProviderRoute({
        state: createPersistedWorkspaceState({ providerProfiles: [providerWithoutMatchingModel] }),
        secretStates: { 'legacy-route-provider': { hasApiKey: true, apiKey: 'legacy-secret' } },
        request: { routeRef: { routeKind: ROUTE_KIND, profileId: 'legacy-route-provider', modelId: 'legacy-only-model' } },
      })

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'provider_model_not_found',
          message: "Provider profile 'legacy-route-provider' does not define model 'legacy-only-model'.",
          details: {
            providerProfileId: 'legacy-route-provider', providerId: PROVIDER_OPENAI,
            routeRef: { routeKind: ROUTE_KIND, profileId: 'legacy-route-provider', modelId: 'legacy-only-model' },
            modelId: 'legacy-only-model', supportedModelIds: [],
          },
        },
      })
    })

    it('rejects provider routes when the base url is blank instead of falling back to catalog defaults', () => {
      const providerWithoutBaseUrl = createProviderProfile({
        id: 'blank-base-url-provider', profileId: 'blank-base-url-provider', providerId: PROVIDER_OPENAI,
        protocol: PROVIDER_OPENAI, endpoint: '', baseUrl: '',
        fastModel: GPT_4_1, fallbackModel: GPT_4_1,
        availableModels: [{ ...createProviderProfile({ id: 'blank-base-url-seed' }).availableModels[0]!, id: 'blank-base-url-model-1', modelId: GPT_4_1, displayName: 'GPT 4.1', groupName: 'OpenAI' }],
      })

      const result = resolveSettingsWorkspaceProviderRoute({
        state: createPersistedWorkspaceState({ providerProfiles: [providerWithoutBaseUrl] }),
        secretStates: { 'blank-base-url-provider': { hasApiKey: true, apiKey: 'blank-base-url-secret' } },
        request: { routeRef: { routeKind: ROUTE_KIND, profileId: 'blank-base-url-provider', modelId: GPT_4_1 } },
      })

      expect(result).toEqual({
        ok: false,
        error: {
          code: 'provider_base_url_missing',
          message: "Provider profile 'blank-base-url-provider' is missing a base URL.",
          details: {
            providerProfileId: 'blank-base-url-provider', providerId: PROVIDER_OPENAI,
            routeRef: { routeKind: ROUTE_KIND, profileId: 'blank-base-url-provider', modelId: GPT_4_1 },
          },
        },
      })
    })
  })
})
