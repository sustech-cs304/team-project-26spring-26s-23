import { describe, expect, it } from 'vitest'

import { createProviderProfile } from '../../workbench/settings/settings-workspace-test-fixtures'
import {
  createCopilotModelCatalog,
  getRuntimeModelRouteStreamingSupportReason,
  isRuntimeModelRouteSupportedForStreamingChat,
  resolveCopilotPreferredModelId,
} from './model-picker'

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
    expect(catalog.models[0]?.icon.label).toBe('G')
    expect(catalog.models[0]?.icon.label).not.toBe('A')
    expect(catalog.models[1]?.icon.label).toBe('G')
    expect(resolveCopilotPreferredModelId({
      preferredModelId: 'openai/gpt-4.1',
      models: catalog.models,
    })).toBe('provider-alpha:openai/gpt-4.1')
    expect(isRuntimeModelRouteSupportedForStreamingChat(catalog.models[0]?.route ?? null)).toBe(true)
    expect(getRuntimeModelRouteStreamingSupportReason(catalog.models[0]?.route ?? null)).toBeNull()
  })

  it('marks openai-response routes as unsupported for current streaming chat', () => {
    const catalog = createCopilotModelCatalog([
      createProviderProfile({
        id: 'provider-response',
        name: 'Response Provider',
        protocol: 'openai-response',
        endpoint: 'https://response.example.com/v1/',
        availableModels: [
          {
            id: 'provider-response:gpt-5.4',
            modelId: 'gpt-5.4',
            displayName: 'GPT 5.4',
            groupName: 'Response',
            capabilities: ['reasoning', 'tools'],
            supportsStreaming: true,
            currency: 'usd',
            inputPrice: '1',
            outputPrice: '2',
          },
        ],
      }),
    ])

    expect(isRuntimeModelRouteSupportedForStreamingChat(catalog.models[0]?.route ?? null)).toBe(false)
    expect(getRuntimeModelRouteStreamingSupportReason(catalog.models[0]?.route ?? null)).toBe(
      '当前流式聊天暂不支持“openai-response”端点类型，请切换到 openai-compatible 模型路由。',
    )
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
