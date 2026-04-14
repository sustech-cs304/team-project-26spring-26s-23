import { describe, expect, it } from 'vitest'

import { createPersistedWorkspaceState, createProviderProfile } from '../../src/workbench/settings/settings-workspace-test-fixtures'
import { resolveSettingsWorkspaceProviderRoute } from './provider-route-resolver'

describe('resolveSettingsWorkspaceProviderRoute', () => {
  it('resolves stable route refs against the requested provider profile even when model ids overlap', () => {
    const alphaProfile = createProviderProfile({
      id: 'alpha-profile',
      profileId: 'alpha-profile',
      providerId: 'openai',
      protocol: 'openai',
      endpoint: 'https://alpha.example.com/v1/',
      baseUrl: 'https://alpha.example.com/v1/',
      fastModel: 'shared-model',
      fallbackModel: 'shared-model',
      availableModels: [
        {
          ...createProviderProfile({ id: 'alpha-seed' }).availableModels[0]!,
          id: 'alpha-model-1',
          modelId: 'shared-model',
          displayName: 'Shared Alpha',
          groupName: 'Alpha',
        },
      ],
    })
    const betaProfile = createProviderProfile({
      id: 'beta-profile',
      profileId: 'beta-profile',
      providerId: 'openai',
      protocol: 'openai',
      endpoint: 'https://beta.example.com/v1/',
      baseUrl: 'https://beta.example.com/v1/',
      fastModel: 'shared-model',
      fallbackModel: 'shared-model',
      availableModels: [
        {
          ...createProviderProfile({ id: 'beta-seed' }).availableModels[0]!,
          id: 'beta-model-1',
          modelId: 'shared-model',
          displayName: 'Shared Beta',
          groupName: 'Beta',
        },
      ],
    })

    const result = resolveSettingsWorkspaceProviderRoute({
      state: createPersistedWorkspaceState({
        providerProfiles: [alphaProfile, betaProfile],
      }),
      secretStates: {
        'alpha-profile': {
          hasApiKey: true,
          apiKey: 'alpha-secret',
        },
        'beta-profile': {
          hasApiKey: true,
          apiKey: 'beta-secret',
        },
      },
      request: {
        routeRef: {
          routeKind: 'provider-model',
          profileId: 'beta-profile',
          modelId: 'shared-model',
        },
      },
    })

    expect(result).toEqual({
      ok: true,
      resolvedRoute: {
        routeRef: {
          routeKind: 'provider-model',
          profileId: 'beta-profile',
          modelId: 'shared-model',
        },
        providerProfileId: 'beta-profile',
        provider: 'openai',
        providerId: 'openai',
        adapterId: 'openai',
        runtimeStatus: 'enabled',
        catalogRevision: '2026-04-06-provider-catalog-v1',
        endpointFamily: 'openai',
        endpointType: 'openai-compatible',
        baseUrl: 'https://beta.example.com/v1',
        modelId: 'shared-model',
        authKind: 'api-key',
      },
      privateAuth: {
        authKind: 'api-key',
        authPayload: {
          apiKey: 'beta-secret',
        },
        apiKey: 'beta-secret',
      },
    })
  })

  it('rejects route refs whose model is not present in the provider model list', () => {
    const providerWithoutMatchingModel = createProviderProfile({
      id: 'legacy-route-provider',
      profileId: 'legacy-route-provider',
      providerId: 'openai',
      protocol: 'openai',
      endpoint: 'https://legacy-route.example.com/v1/',
      baseUrl: 'https://legacy-route.example.com/v1/',
      fastModel: '',
      fallbackModel: '',
      availableModels: [],
    })

    const result = resolveSettingsWorkspaceProviderRoute({
      state: createPersistedWorkspaceState({
        providerProfiles: [providerWithoutMatchingModel],
      }),
      secretStates: {
        'legacy-route-provider': {
          hasApiKey: true,
          apiKey: 'legacy-secret',
        },
      },
      request: {
        routeRef: {
          routeKind: 'provider-model',
          profileId: 'legacy-route-provider',
          modelId: 'legacy-only-model',
        },
      },
    })

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'provider_model_not_found',
        message: "Provider profile 'legacy-route-provider' does not define model 'legacy-only-model'.",
        details: {
          providerProfileId: 'legacy-route-provider',
          providerId: 'openai',
          routeRef: {
            routeKind: 'provider-model',
            profileId: 'legacy-route-provider',
            modelId: 'legacy-only-model',
          },
          modelId: 'legacy-only-model',
          supportedModelIds: [],
        },
      },
    })
  })

  it('rejects provider routes when the base url is blank instead of falling back to catalog defaults', () => {
    const providerWithoutBaseUrl = createProviderProfile({
      id: 'blank-base-url-provider',
      profileId: 'blank-base-url-provider',
      providerId: 'openai',
      protocol: 'openai',
      endpoint: '',
      baseUrl: '',
      fastModel: 'gpt-4.1',
      fallbackModel: 'gpt-4.1',
      availableModels: [
        {
          ...createProviderProfile({ id: 'blank-base-url-seed' }).availableModels[0]!,
          id: 'blank-base-url-model-1',
          modelId: 'gpt-4.1',
          displayName: 'GPT 4.1',
          groupName: 'OpenAI',
        },
      ],
    })

    const result = resolveSettingsWorkspaceProviderRoute({
      state: createPersistedWorkspaceState({
        providerProfiles: [providerWithoutBaseUrl],
      }),
      secretStates: {
        'blank-base-url-provider': {
          hasApiKey: true,
          apiKey: 'blank-base-url-secret',
        },
      },
      request: {
        routeRef: {
          routeKind: 'provider-model',
          profileId: 'blank-base-url-provider',
          modelId: 'gpt-4.1',
        },
      },
    })

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'provider_base_url_missing',
        message: "Provider profile 'blank-base-url-provider' is missing a base URL.",
        details: {
          providerProfileId: 'blank-base-url-provider',
          providerId: 'openai',
          routeRef: {
            routeKind: 'provider-model',
            profileId: 'blank-base-url-provider',
            modelId: 'gpt-4.1',
          },
        },
      },
    })
  })
})
