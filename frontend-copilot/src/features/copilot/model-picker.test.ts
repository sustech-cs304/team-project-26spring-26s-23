import { describe, expect, it } from 'vitest'

import { createProviderProfile } from '../../workbench/settings/settings-workspace-test-fixtures'
import { createCopilotModelCatalog, resolveCopilotPreferredModelId } from './model-picker'

describe('copilot model picker bridge', () => {
  it('maps persisted provider profiles into provider-backed groups and model options', () => {
    const catalog = createCopilotModelCatalog([
      createProviderProfile({
        id: 'provider-alpha',
        name: 'Alpha Provider',
        protocol: 'openai',
        endpoint: 'https://alpha.example.com/v1/',
        availableModels: [
          {
            id: 'provider-alpha:openai/gpt-4.1',
            modelId: 'openai/gpt-4.1',
            displayName: 'GPT 4.1',
            groupName: 'OpenAI',
            capabilities: ['reasoning', 'tools'],
            supportsStreaming: true,
            currency: 'usd',
            inputPrice: '1',
            outputPrice: '2',
          },
          {
            id: 'provider-alpha:google/gemini-2.5-pro',
            modelId: 'google/gemini-2.5-pro',
            displayName: 'Gemini 2.5 Pro',
            groupName: 'Google',
            capabilities: ['vision', 'search', 'reasoning'],
            supportsStreaming: true,
            currency: 'usd',
            inputPrice: '1',
            outputPrice: '2',
          },
        ],
      }),
      createProviderProfile({
        id: 'provider-empty',
        name: 'Empty Provider',
        availableModels: [],
      }),
    ])

    expect(catalog.groups).toEqual([
      expect.objectContaining({
        key: 'provider-alpha',
        title: 'Alpha Provider',
        models: [
          expect.objectContaining({
            id: 'provider-alpha:openai/gpt-4.1',
            modelId: 'openai/gpt-4.1',
            name: 'GPT 4.1',
            provider: 'Alpha Provider',
            group: 'Alpha Provider',
            tags: ['推理', '工具'],
            route: {
              providerProfileId: 'provider-alpha',
              snapshot: {
                provider: 'openai',
                endpointType: 'openai-compatible',
                baseUrl: 'https://alpha.example.com/v1',
                modelId: 'openai/gpt-4.1',
              },
            },
          }),
          expect.objectContaining({
            id: 'provider-alpha:google/gemini-2.5-pro',
            modelId: 'google/gemini-2.5-pro',
            name: 'Gemini 2.5 Pro',
            provider: 'Alpha Provider',
            group: 'Alpha Provider',
            tags: ['视觉', '联网', '推理'],
          }),
        ],
      }),
      expect.objectContaining({
        key: 'provider-empty',
        title: 'Empty Provider',
        models: [],
      }),
    ])
    expect(resolveCopilotPreferredModelId({
      preferredModelId: 'openai/gpt-4.1',
      models: catalog.models,
    })).toBe('provider-alpha:openai/gpt-4.1')
  })

  it('returns an empty preferred model id when no configured models exist', () => {
    const catalog = createCopilotModelCatalog([])

    expect(catalog.groups).toEqual([])
    expect(catalog.models).toEqual([])
    expect(resolveCopilotPreferredModelId({
      preferredModelId: 'openai/gpt-4.1',
      models: catalog.models,
    })).toBe('')
  })
})
