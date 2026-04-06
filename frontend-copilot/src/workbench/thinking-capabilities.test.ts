import { describe, expect, it } from 'vitest'

import type { ProviderProfile } from './types'
import {
  resolveThinkingCapability,
  serializeThinkingCapabilityOverrideInput,
} from './thinking-capabilities'

describe('thinking capabilities', () => {
  it.each([
    {
      endpoint: 'https://api.z.ai/api/paas/v4',
      modelId: 'glm-5-turbo',
    },
    {
      endpoint: 'https://open.bigmodel.cn/api/paas/v4',
      modelId: 'glm-5',
    },
    {
      endpoint: 'https://api.z.ai/api/paas/v4',
      modelId: 'zai/glm-5',
    },
  ])('falls back to built-in rules for supported glm variants on verified openai-compatible routes', ({ endpoint, modelId }) => {
    const resolved = resolveThinkingCapability({
      providerProfile: createProviderProfile({
        protocol: 'openai',
        endpoint,
      }),
      modelProfile: {
        modelId,
        thinkingCapability: undefined,
      },
    })

    expect(resolved).toEqual({
      supported: true,
      levels: ['off', 'auto'],
      defaultLevel: 'auto',
    })
  })

  it('lets explicit supported declarations override built-in inference', () => {
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

  it('lets explicit unsupported declarations override built-in inference', () => {
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

  it('serializes legacy declarations into the structured override input shape', () => {
    expect(serializeThinkingCapabilityOverrideInput({
      supported: true,
      levels: ['low', 'high'],
      defaultLevel: 'high',
    })).toEqual({
      supported: true,
      series: 'compat-discrete-levels-v1',
      input: {
        kind: 'discrete',
        levels: ['low', 'high'],
      },
      defaultSelection: {
        mode: 'preset',
        level: 'high',
      },
    })
  })

  it('preserves structured series-specific budget input during serialization', () => {
    expect(serializeThinkingCapabilityOverrideInput({
      supported: true,
      series: 'gemini-2.5-budget-v1',
      input: {
        kind: 'budget',
        minTokens: 0,
        maxTokens: 32768,
        stepTokens: 1024,
      },
      defaultSelection: {
        mode: 'budget',
        budgetTokens: 8192,
      },
      source: 'settings-page',
    })).toEqual({
      supported: true,
      series: 'gemini-2.5-budget-v1',
      input: {
        kind: 'budget',
        minTokens: 0,
        maxTokens: 32768,
        stepTokens: 1024,
      },
      defaultSelection: {
        mode: 'budget',
        budgetTokens: 8192,
      },
      source: 'settings-page',
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
