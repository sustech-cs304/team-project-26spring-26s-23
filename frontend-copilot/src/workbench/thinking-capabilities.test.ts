import { describe, expect, it } from 'vitest'

import type { ProviderProfile } from './types'
import { resolveThinkingCapability } from './thinking-capabilities'

describe('thinking capabilities', () => {
  it('treats routes without explicit declarations as unsupported instead of applying built-in inference', () => {
    const resolved = resolveThinkingCapability({
      providerProfile: createProviderProfile({
        protocol: 'openai',
        endpoint: 'https://api.z.ai/api/paas/v4',
      }),
      modelProfile: {
        modelId: 'glm-5-turbo',
        thinkingCapability: undefined,
      },
    })

    expect(resolved).toEqual({
      supported: false,
      levels: [],
      defaultLevel: null,
    })
  })

  it('resolves explicit supported declarations without consulting built-in rules', () => {
    const resolved = resolveThinkingCapability({
      providerProfile: createProviderProfile({
        protocol: 'openai',
        endpoint: 'https://api.z.ai/api/paas/v4',
      }),
      modelProfile: {
        modelId: 'glm-5-turbo',
        thinkingCapability: {
          supported: true,
          levels: ['low', 'medium', 'high'],
          defaultLevel: 'high',
        },
      },
    })

    expect(resolved).toEqual({
      supported: true,
      levels: ['off', 'low', 'medium', 'high'],
      defaultLevel: 'high',
    })
  })

  it('resolves explicit unsupported declarations without consulting built-in rules', () => {
    const resolved = resolveThinkingCapability({
      providerProfile: createProviderProfile({
        protocol: 'openai',
        endpoint: 'https://api.z.ai/api/paas/v4',
      }),
      modelProfile: {
        modelId: 'glm-5-turbo',
        thinkingCapability: {
          supported: false,
        },
      },
    })

    expect(resolved).toEqual({
      supported: false,
      levels: [],
      defaultLevel: null,
    })
  })

  it('treats unknown routes without explicit declarations as unsupported', () => {
    const resolved = resolveThinkingCapability({
      providerProfile: createProviderProfile({
        protocol: 'openai',
        endpoint: 'https://api.example.com/v1',
      }),
      modelProfile: {
        modelId: 'openai/gpt-4.1',
        thinkingCapability: undefined,
      },
    })

    expect(resolved).toEqual({
      supported: false,
      levels: [],
      defaultLevel: null,
    })
  })
})

function createProviderProfile(overrides: Partial<ProviderProfile>): ProviderProfile {
  return {
    id: overrides.id ?? 'provider-1',
    name: overrides.name ?? 'Provider 1',
    protocol: overrides.protocol ?? 'openai',
    endpoint: overrides.endpoint ?? 'https://api.example.com/v1',
    hasApiKey: overrides.hasApiKey ?? true,
    defaultModel: overrides.defaultModel ?? '',
    fastModel: overrides.fastModel ?? '',
    fallbackModel: overrides.fallbackModel ?? '',
    organization: overrides.organization ?? '',
    region: overrides.region ?? 'Global',
    notes: overrides.notes ?? '',
    availableModels: overrides.availableModels ?? [],
  }
}
