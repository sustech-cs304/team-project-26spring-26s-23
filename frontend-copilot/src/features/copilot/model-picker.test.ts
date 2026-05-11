import { describe, expect, it } from 'vitest'

import { createProviderProfile } from '../../workbench/settings/settings-workspace-test-fixtures'
import {
  createCopilotModelCatalog,
  getRuntimeModelRouteStreamingSupportReason,
  isRuntimeModelRouteSupportedForStreamingChat,
  resolveCopilotPreferredModelId,
} from './model-picker'

// Duplicate-string constants extracted for sonarjs/no-duplicate-string
const LABEL_ALPHA_PROVIDER = 'Alpha Provider'
const LABEL_OPENAI_GPT = 'openai/gpt-4.1'
const LABEL_PROVIDER_ALPHA = 'provider-alpha'
const LABEL_PROVIDER_MODEL = 'provider-model'
const LABEL_SHARED_MODEL = 'shared-model'


describe('copilot model picker bridge', () => {
  describe('model catalog construction', () => {
    it('maps persisted provider profiles into provider-backed groups and model options', () => {
    const catalog = createCopilotModelCatalog([
      createProviderProfile({
        id: LABEL_PROVIDER_ALPHA,
        name: LABEL_ALPHA_PROVIDER,
        protocol: 'openai',
        endpoint: 'https://alpha.example.com/v1/',
        availableModels: [
          {
            id: 'provider-alpha:openai/gpt-4.1',
            modelId: LABEL_OPENAI_GPT,
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

    expect(catalog.groups).toHaveLength(2)
    expect(catalog.groups[0]).toMatchObject({
      key: LABEL_PROVIDER_ALPHA,
      title: LABEL_ALPHA_PROVIDER,
    })
    expect(catalog.groups[1]).toMatchObject({
      key: 'provider-empty',
      title: 'Empty Provider',
      models: [],
    })
    expect(catalog.groups[0]?.models[0]).toMatchObject({
      id: 'provider-alpha:openai/gpt-4.1',
      selectionValue: 'provider-model|provider-alpha|openai%2Fgpt-4.1',
      routeRef: {
        routeKind: LABEL_PROVIDER_MODEL,
        profileId: LABEL_PROVIDER_ALPHA,
        modelId: LABEL_OPENAI_GPT,
      },
      modelId: LABEL_OPENAI_GPT,
      name: 'GPT 4.1',
      provider: LABEL_ALPHA_PROVIDER,
      group: LABEL_ALPHA_PROVIDER,
      tags: ['推理', '工具'],
      available: true,
      unavailableReason: null,
      route: {
        routeRef: {
          routeKind: LABEL_PROVIDER_MODEL,
          profileId: LABEL_PROVIDER_ALPHA,
          modelId: LABEL_OPENAI_GPT,
        },
        catalogRevision: '2026-04-06-provider-catalog-v1',
      },
    })
    expect(catalog.groups[0]?.models[1]).toMatchObject({
      id: 'provider-alpha:google/gemini-2.5-pro',
      modelId: 'google/gemini-2.5-pro',
      name: 'Gemini 2.5 Pro',
      provider: LABEL_ALPHA_PROVIDER,
      group: LABEL_ALPHA_PROVIDER,
      tags: ['视觉', '联网', '推理'],
    })
    expect(catalog.models[0]?.icon.label).toBe('G')
    expect(catalog.models[0]?.icon.label).not.toBe('A')
    expect(catalog.models[1]?.icon.label).toBe('G')
    expect(resolveCopilotPreferredModelId({
      preferredModelId: LABEL_OPENAI_GPT,
      models: catalog.models,
    })).toBe('')
    expect(resolveCopilotPreferredModelId({
      preferredModelId: LABEL_OPENAI_GPT,
      preferredModelRouteRef: {
        routeKind: LABEL_PROVIDER_MODEL,
        profileId: LABEL_PROVIDER_ALPHA,
        modelId: LABEL_OPENAI_GPT,
      },
      models: catalog.models,
    })).toBe('provider-model|provider-alpha|openai%2Fgpt-4.1')
    expect(isRuntimeModelRouteSupportedForStreamingChat(catalog.models[0]?.route ?? null)).toBe(true)
    expect(getRuntimeModelRouteStreamingSupportReason(catalog.models[0]?.route ?? null)).toBeNull()
  })

  it('marks legacy-unsupported providers as unavailable based on catalog runtime status', () => {
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

    expect(catalog.models[0]?.available).toBe(false)
    expect(catalog.models[0]?.unavailableReason).toBe('当前模型暂不可用于聊天。')
    expect(isRuntimeModelRouteSupportedForStreamingChat(catalog.models[0]?.route ?? null)).toBe(true)
    expect(getRuntimeModelRouteStreamingSupportReason(catalog.models[0]?.route ?? null)).toBeNull()
  })

  it('allows enabled non-openai providers to remain sendable without endpoint-type whitelists', () => {
    const catalog = createCopilotModelCatalog([
      createProviderProfile({
        id: 'provider-anthropic',
        name: 'Anthropic',
        providerId: 'anthropic',
        protocol: 'anthropic',
        endpoint: 'https://api.anthropic.com/',
        availableModels: [
          {
            id: 'provider-anthropic:claude-3.7-sonnet',
            modelId: 'claude-3.7-sonnet',
            displayName: 'Claude 3.7 Sonnet',
            groupName: 'Anthropic',
            capabilities: ['reasoning', 'tools'],
            supportsStreaming: true,
            currency: 'usd',
            inputPrice: '1',
            outputPrice: '2',
          },
        ],
      }),
    ])

    expect(catalog.models[0]?.available).toBe(true)
    expect(catalog.models[0]?.unavailableReason).toBeNull()
    expect(isRuntimeModelRouteSupportedForStreamingChat(catalog.models[0]?.route ?? null)).toBe(true)
    expect(getRuntimeModelRouteStreamingSupportReason(catalog.models[0]?.route ?? null)).toBeNull()
    })
  })

  describe('model resolution', () => {
    it('uses route refs to distinguish duplicate model ids across provider profiles and invalidates ambiguous legacy strings', () => {
    const catalog = createCopilotModelCatalog([
      createProviderProfile({
        id: LABEL_PROVIDER_ALPHA,
        name: LABEL_ALPHA_PROVIDER,
        protocol: 'openai',
        availableModels: [
          {
            id: 'provider-alpha:shared-model',
            modelId: LABEL_SHARED_MODEL,
            displayName: 'Shared Model Alpha',
            groupName: 'Alpha',
            capabilities: ['reasoning'],
            supportsStreaming: true,
            currency: 'usd',
            inputPrice: '1',
            outputPrice: '2',
          },
        ],
      }),
      createProviderProfile({
        id: 'provider-beta',
        name: 'Beta Provider',
        providerId: 'groq',
        protocol: 'openai',
        availableModels: [
          {
            id: 'provider-beta:shared-model',
            modelId: LABEL_SHARED_MODEL,
            displayName: 'Shared Model Beta',
            groupName: 'Beta',
            capabilities: ['reasoning', 'tools'],
            supportsStreaming: true,
            currency: 'usd',
            inputPrice: '1',
            outputPrice: '2',
          },
        ],
      }),
      createProviderProfile({
        id: 'provider-openrouter',
        name: 'Catalog Only Router',
        providerId: 'openrouter',
        protocol: 'openai',
        availableModels: [
          {
            id: 'provider-openrouter:router-model',
            modelId: 'router-model',
            displayName: 'Router Model',
            groupName: 'CatalogOnly',
            capabilities: ['tools'],
            supportsStreaming: true,
            currency: 'usd',
            inputPrice: '1',
            outputPrice: '2',
          },
        ],
      }),
    ])

    expect(resolveCopilotPreferredModelId({
      preferredModelId: LABEL_SHARED_MODEL,
      models: catalog.models,
    })).toBe('')
    expect(resolveCopilotPreferredModelId({
      preferredModelId: LABEL_SHARED_MODEL,
      preferredModelRouteRef: {
        routeKind: LABEL_PROVIDER_MODEL,
        profileId: 'provider-beta',
        modelId: LABEL_SHARED_MODEL,
      },
      models: catalog.models,
    })).toBe('provider-model|provider-beta|shared-model')

    const catalogOnlyModel = catalog.models.find((model) => model.id === 'provider-openrouter:router-model')
    expect(catalogOnlyModel?.available).toBe(false)
    expect(catalogOnlyModel?.unavailableReason).toBe('当前模型暂不可用于聊天。')
    })
    })

  it('returns an empty preferred model id when no configured models exist', () => {
    const catalog = createCopilotModelCatalog([])

    expect(catalog.groups).toEqual([])
    expect(catalog.models).toEqual([])
    expect(resolveCopilotPreferredModelId({
      preferredModelId: LABEL_OPENAI_GPT,
      models: catalog.models,
    })).toBe('')
  })
})
