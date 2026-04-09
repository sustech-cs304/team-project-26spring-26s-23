import { describe, expect, it } from 'vitest'

import type { ProviderProfile } from './types'
import {
  normalizeThinkingCapabilityDeclaration,
  resolveThinkingCapability,
  serializeThinkingCapabilityOverrideInput,
} from './thinking-capabilities'

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
          series: 'openai-4-level-none-v1',
          template: {
            editorType: 'discrete',
            allowedValues: [
              { valueType: 'code', code: 'none', labelZh: '无' },
              { valueType: 'code', code: 'low', labelZh: '低' },
              { valueType: 'code', code: 'high', labelZh: '高' },
            ],
            defaultValue: { valueType: 'code', code: 'high', labelZh: '高' },
          },
        },
      },
    })

    expect(resolved).toEqual({
      supported: true,
      levels: ['off', 'low', 'high'],
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

  it('serializes discrete series declarations into series template payloads with chinese labels and real codes', () => {
    expect(serializeThinkingCapabilityOverrideInput({
      supported: true,
      series: 'openai-4-level-minimal-v1',
      template: {
        editorType: 'discrete',
        allowedValues: [
          { valueType: 'code', code: 'minimal', labelZh: '极简' },
          { valueType: 'code', code: 'high', labelZh: '高' },
        ],
        defaultValue: { valueType: 'code', code: 'high', labelZh: '高' },
      },
      source: 'settings-page',
    })).toEqual({
      supported: true,
      series: 'openai-4-level-minimal-v1',
      template: {
        editorType: 'discrete',
        allowedValues: [
          { valueType: 'code', code: 'minimal', labelZh: '极简' },
          { valueType: 'code', code: 'high', labelZh: '高' },
        ],
        defaultValue: { valueType: 'code', code: 'high', labelZh: '高' },
      },
      source: 'settings-page',
    })
  })

  it('preserves budget series templates during serialization', () => {
    expect(serializeThinkingCapabilityOverrideInput({
      supported: true,
      series: 'gemini-2.5-budget-v1',
      template: {
        editorType: 'budget',
        allowedValues: [
          { valueType: 'budget', mode: 'off', budgetTokens: null, labelZh: '关闭' },
          { valueType: 'budget', mode: 'dynamic', budgetTokens: null, labelZh: '动态' },
        ],
        defaultValue: { valueType: 'budget', mode: 'budget', budgetTokens: 8192, labelZh: '8192 Tokens' },
        budget: {
          minTokens: 0,
          maxTokens: 32768,
          stepTokens: 1024,
          anchorTokens: [0, 4096, 32768, 131072, 1048576],
        },
      },
      source: 'settings-page',
    })).toEqual({
      supported: true,
      series: 'gemini-2.5-budget-v1',
      template: {
        editorType: 'budget',
        allowedValues: [
          { valueType: 'budget', mode: 'off', budgetTokens: null, labelZh: '关闭' },
          { valueType: 'budget', mode: 'dynamic', budgetTokens: null, labelZh: '动态' },
        ],
        defaultValue: { valueType: 'budget', mode: 'budget', budgetTokens: 8192, labelZh: '8192 Tokens' },
        budget: {
          minTokens: 0,
          maxTokens: 32768,
          stepTokens: 1024,
          anchorTokens: [0, 4096, 32768, 131072, 1048576],
        },
      },
      source: 'settings-page',
    })
  })

  it('keeps openai 6-level and 4-level declarations as distinct series', () => {
    const openAi6 = normalizeThinkingCapabilityDeclaration({
      supported: true,
      series: 'openai-6-level-superset-v1',
      template: {
        editorType: 'discrete',
        allowedValues: [
          { valueType: 'code', code: 'none', labelZh: '无' },
          { valueType: 'code', code: 'minimal', labelZh: '极简' },
          { valueType: 'code', code: 'high', labelZh: '高' },
        ],
        defaultValue: { valueType: 'code', code: 'high', labelZh: '高' },
      },
    })
    const openAi4 = normalizeThinkingCapabilityDeclaration({
      supported: true,
      series: 'openai-4-level-minimal-v1',
      template: {
        editorType: 'discrete',
        allowedValues: [
          { valueType: 'code', code: 'minimal', labelZh: '极简' },
          { valueType: 'code', code: 'high', labelZh: '高' },
        ],
        defaultValue: { valueType: 'code', code: 'high', labelZh: '高' },
      },
    })

    expect(openAi6).toMatchObject({
      supported: true,
      series: 'openai-6-level-superset-v1',
      template: {
        allowedValues: [
          { valueType: 'code', code: 'none', labelZh: '无' },
          { valueType: 'code', code: 'minimal', labelZh: '极简' },
          { valueType: 'code', code: 'high', labelZh: '高' },
        ],
      },
    })
    expect(openAi4).toMatchObject({
      supported: true,
      series: 'openai-4-level-minimal-v1',
      template: {
        allowedValues: [
          { valueType: 'code', code: 'minimal', labelZh: '极简' },
          { valueType: 'code', code: 'high', labelZh: '高' },
        ],
      },
    })
    expect(openAi6).not.toEqual(openAi4)
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
    defaultModelId: overrides.defaultModelId,
    fastModel: overrides.fastModel ?? '',
    fallbackModel: overrides.fallbackModel ?? '',
    organization: overrides.organization ?? '',
    region: overrides.region ?? 'Global',
    notes: overrides.notes ?? '',
    availableModels: overrides.availableModels ?? [],
  }
}
