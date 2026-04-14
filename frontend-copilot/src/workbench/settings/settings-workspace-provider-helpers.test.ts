import { describe, expect, it } from 'vitest'

import { createProviderProfile } from './settings-workspace-test-fixtures'
import {
  buildProviderTypeSelectionPatch,
  resolveProviderBaseUrlPreviewText,
  resolveProviderBaseUrlValidationMessage,
} from './settings-workspace-provider-helpers'

describe('settings workspace provider base url helpers', () => {
  it('builds endpoint previews per endpointType without removing duplicated semantic segments', () => {
    const openRouterProfile = createProviderProfile({
      id: 'openrouter-preview',
      profileId: 'openrouter-preview',
      providerId: 'openrouter',
      protocol: 'openrouter',
      endpoint: 'https://openrouter.ai/api/v1/chat/completions',
      baseUrl: 'https://openrouter.ai/api/v1/chat/completions',
    })
    const anthropicProfile = createProviderProfile({
      id: 'anthropic-preview',
      profileId: 'anthropic-preview',
      providerId: 'anthropic',
      protocol: 'anthropic',
      endpoint: 'https://api.anthropic.com',
      baseUrl: 'https://api.anthropic.com',
    })
    const xaiProfile = createProviderProfile({
      id: 'xai-preview',
      profileId: 'xai-preview',
      providerId: 'xai',
      protocol: 'xai',
      endpoint: 'https://api.x.ai/v1/chat/completions',
      baseUrl: 'https://api.x.ai/v1/chat/completions',
    })

    expect(resolveProviderBaseUrlPreviewText(openRouterProfile)).toBe(
      'https://openrouter.ai/api/v1/chat/completions/chat/completions',
    )
    expect(resolveProviderBaseUrlPreviewText(anthropicProfile)).toBe(
      'https://api.anthropic.com/v1/messages',
    )
    expect(resolveProviderBaseUrlPreviewText(xaiProfile)).toBe(
      'https://api.x.ai/v1/chat/completions/v1/chat/completions',
    )
  })

  it('builds gemini-native previews from the selected model, then the first configured model, then an explicit placeholder', () => {
    const geminiProfile = createProviderProfile({
      id: 'gemini-preview',
      profileId: 'gemini-preview',
      providerId: 'gemini',
      protocol: 'gemini',
      endpoint: 'https://api.ikuncode.cc/v1beta',
      baseUrl: 'https://api.ikuncode.cc/v1beta',
      primaryModelId: 'gemini-3.1-pro-preview',
      fastModel: 'gemini-3.1-pro-preview',
      fallbackModel: 'gemini-3.1-pro-preview',
      availableModels: [
        {
          ...createProviderProfile({ id: 'gemini-seed' }).availableModels[0]!,
          id: 'gemini-preview-model-1',
          modelId: 'gemini-2.5-flash',
          displayName: 'Gemini 2.5 Flash',
          groupName: 'Gemini',
        },
      ],
    })
    const geminiWithoutModels = createProviderProfile({
      id: 'gemini-preview-empty',
      profileId: 'gemini-preview-empty',
      providerId: 'gemini',
      protocol: 'gemini',
      endpoint: 'https://api.ikuncode.cc/v1beta',
      baseUrl: 'https://api.ikuncode.cc/v1beta',
      fastModel: '',
      fallbackModel: '',
      availableModels: [],
    })

    expect(resolveProviderBaseUrlPreviewText(geminiProfile, 'gemini-3.1-pro-preview')).toBe(
      'https://api.ikuncode.cc/v1beta/models/gemini-3.1-pro-preview:generateContent',
    )
    expect(resolveProviderBaseUrlPreviewText(geminiProfile)).toBe(
      'https://api.ikuncode.cc/v1beta/models/gemini-2.5-flash:generateContent',
    )
    expect(resolveProviderBaseUrlPreviewText(geminiWithoutModels)).toBe(
      'https://api.ikuncode.cc/v1beta/models/<model-id>:generateContent',
    )
  })

  it('treats provider base urls as required and does not inject a catalog default while switching provider type', () => {
    const blankOpenAiProfile = createProviderProfile({
      id: 'blank-openai',
      profileId: 'blank-openai',
      providerId: 'openai',
      protocol: 'openai',
      endpoint: '',
      baseUrl: '',
      fastModel: '',
      fallbackModel: '',
      availableModels: [],
    })

    expect(resolveProviderBaseUrlValidationMessage(blankOpenAiProfile)).toBe('未填写服务地址')
    expect(buildProviderTypeSelectionPatch(blankOpenAiProfile, 'anthropic')).toMatchObject({
      providerId: 'anthropic',
      protocol: 'anthropic',
      baseUrl: '',
      endpoint: '',
    })
  })

  it('uses the project baseUrl convention for ollama-native previews', () => {
    const ollamaProfile = createProviderProfile({
      id: 'ollama-preview',
      profileId: 'ollama-preview',
      providerId: 'ollama',
      protocol: 'ollama',
      endpoint: 'http://127.0.0.1:11434/v1',
      baseUrl: 'http://127.0.0.1:11434/v1',
      hasApiKey: false,
      primaryModelId: 'llama3.2',
      fastModel: 'llama3.2',
      fallbackModel: 'llama3.2',
    })

    expect(resolveProviderBaseUrlPreviewText(ollamaProfile)).toBe(
      'http://127.0.0.1:11434/v1/chat/completions',
    )
  })
})
