import { describe, expect, it } from 'vitest'

import { createProviderProfile, createPersistedWorkspaceState } from '../../src/workbench/settings/settings-workspace-test-fixtures'
import type { ProviderProfile } from '../../src/workbench/types'
import { resolveSettingsWorkspaceProviderRoute } from './provider-route-resolver'

describe('resolveSettingsWorkspaceProviderRoute', () => {
  it('accepts models from availableModels plus fast/fallback tracked fields', () => {
    const providerProfile = createProviderProfile({
      id: 'route-provider',
      endpoint: 'https://route.example.com/v1/',
      fastModel: 'fast-only-model',
      fallbackModel: 'fallback-only-model',
      availableModels: [
        {
          id: 'route-provider:model-1',
          modelId: 'available-model',
          displayName: 'Available Model',
          groupName: 'Route',
          capabilities: ['reasoning', 'tools'],
          supportsStreaming: true,
          currency: 'usd',
          inputPrice: '1',
          outputPrice: '2',
        },
      ],
    })

    const baseInput = {
      state: createPersistedWorkspaceState({
        providerProfiles: [providerProfile],
      }),
      secretStates: {
        'route-provider': {
          hasApiKey: true,
          apiKey: 'route-secret',
        },
      },
      request: {
        providerProfileId: 'route-provider',
        snapshot: {
          provider: 'openai',
          endpointType: 'openai-compatible',
          baseUrl: 'https://route.example.com/v1',
          modelId: 'available-model',
        },
      },
    } as const

    expect(resolveSettingsWorkspaceProviderRoute(baseInput)).toEqual({
      ok: true,
      route: {
        providerProfileId: 'route-provider',
        provider: 'openai',
        endpointType: 'openai-compatible',
        baseUrl: 'https://route.example.com/v1',
        modelId: 'available-model',
        auth: {
          apiKey: 'route-secret',
        },
      },
    })

    expect(resolveSettingsWorkspaceProviderRoute({
      ...baseInput,
      request: {
        ...baseInput.request,
        snapshot: {
          ...baseInput.request.snapshot,
          modelId: 'fast-only-model',
        },
      },
    })).toMatchObject({
      ok: true,
      route: {
        modelId: 'fast-only-model',
      },
    })

    expect(resolveSettingsWorkspaceProviderRoute({
      ...baseInput,
      request: {
        ...baseInput.request,
        snapshot: {
          ...baseInput.request.snapshot,
          modelId: 'fallback-only-model',
        },
      },
    })).toMatchObject({
      ok: true,
      route: {
        modelId: 'fallback-only-model',
      },
    })
  })

  it('ignores stray legacy defaultModel runtime properties when checking supported models', () => {
    const providerWithLegacyDefaultModel = {
      ...createProviderProfile({
        id: 'legacy-route-provider',
        endpoint: 'https://legacy-route.example.com/v1/',
        fastModel: '',
        fallbackModel: '',
        availableModels: [],
      }),
      defaultModel: 'legacy-only-model',
    } as ProviderProfile & { defaultModel: string }

    const result = resolveSettingsWorkspaceProviderRoute({
      state: createPersistedWorkspaceState({
        providerProfiles: [providerWithLegacyDefaultModel as unknown as ProviderProfile],
      }),
      secretStates: {
        'legacy-route-provider': {
          hasApiKey: true,
          apiKey: 'legacy-secret',
        },
      },
      request: {
        providerProfileId: 'legacy-route-provider',
        snapshot: {
          provider: 'openai',
          endpointType: 'openai-compatible',
          baseUrl: 'https://legacy-route.example.com/v1',
          modelId: 'legacy-only-model',
        },
      },
    })

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'route_snapshot_mismatch',
        message: "Provider profile 'legacy-route-provider' no longer matches the requested route snapshot.",
        details: {
          providerProfileId: 'legacy-route-provider',
          mismatches: [
            {
              field: 'modelId',
              expected: '',
              actual: 'legacy-only-model',
            },
          ],
        },
      },
    })
  })
})
