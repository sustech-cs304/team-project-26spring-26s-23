import { describe, expect, it } from 'vitest'

import { normalizeSettingsWorkspaceStateValues, projectSettingsWorkspaceEditableState } from './state-schema'

describe('settings workspace state schema migration', () => {
  it('migrates legacy provider profiles and unique default model strings into stable route refs', () => {
    const values = normalizeSettingsWorkspaceStateValues({
      providerProfiles: [
        {
          id: 'google-main',
          name: 'Google Main',
          protocol: 'google',
          endpoint: 'https://generativelanguage.googleapis.com',
          defaultModel: 'gemini-2.5-pro',
          fastModel: 'gemini-2.5-flash',
          fallbackModel: 'gemini-2.0-flash',
          organization: 'org-a',
          region: 'Global',
          notes: 'legacy google profile',
          availableModels: [
            {
              modelId: 'gemini-2.5-pro',
            },
            {
              modelId: 'gemini-2.5-flash',
            },
          ],
        },
      ],
      defaultModelRouting: {
        primaryAssistantModel: 'gemini-2.5-pro',
        fastAssistantModel: 'gemini-2.5-flash',
      },
    })

    expect(values.providerProfiles).toHaveLength(1)
    expect(values.providerProfiles[0]).toMatchObject({
      profileId: 'google-main',
      providerId: 'gemini',
      displayName: 'Google Main',
      baseUrl: 'https://generativelanguage.googleapis.com',
      defaultModelId: 'gemini-2.5-pro',
      compatibility: {
        status: 'active',
        reason: '',
      },
      extensions: {
        fastModel: 'gemini-2.5-flash',
        fallbackModel: 'gemini-2.0-flash',
        organization: 'org-a',
        region: 'Global',
        notes: 'legacy google profile',
        legacyProtocol: 'google',
      },
    })
    expect(values.defaultModelRouting).toEqual({
      primaryAssistantModel: {
        routeKind: 'provider-model',
        profileId: 'google-main',
        modelId: 'gemini-2.5-pro',
      },
      fastAssistantModel: {
        routeKind: 'provider-model',
        profileId: 'google-main',
        modelId: 'gemini-2.5-flash',
      },
    })

    const editableState = projectSettingsWorkspaceEditableState(values, {})
    expect(editableState.providerProfiles[0]).toMatchObject({
      id: 'google-main',
      profileId: 'google-main',
      providerId: 'gemini',
      name: 'Google Main',
      displayName: 'Google Main',
      protocol: 'google',
      endpoint: 'https://generativelanguage.googleapis.com',
      baseUrl: 'https://generativelanguage.googleapis.com',
      defaultModel: 'gemini-2.5-pro',
      defaultModelId: 'gemini-2.5-pro',
      fastModel: 'gemini-2.5-flash',
      fallbackModel: 'gemini-2.0-flash',
      organization: 'org-a',
      notes: 'legacy google profile',
      hasApiKey: false,
    })
    expect(editableState.defaultModelRouting).toEqual({
      primaryAssistantModel: 'gemini-2.5-pro',
      fastAssistantModel: 'gemini-2.5-flash',
      primaryAssistantModelRoute: {
        routeKind: 'provider-model',
        profileId: 'google-main',
        modelId: 'gemini-2.5-pro',
      },
      fastAssistantModelRoute: {
        routeKind: 'provider-model',
        profileId: 'google-main',
        modelId: 'gemini-2.5-flash',
      },
    })
  })

  it('clears ambiguous legacy default model strings instead of guessing a provider profile', () => {
    const values = normalizeSettingsWorkspaceStateValues({
      providerProfiles: [
        {
          id: 'openai-main',
          name: 'OpenAI Main',
          protocol: 'openai',
          endpoint: 'https://api.openai.com/v1',
          defaultModel: 'gpt-4.1',
          fastModel: 'gpt-4.1-mini',
          fallbackModel: 'gpt-4.1-mini',
          organization: '',
          region: 'Global',
          notes: '',
          availableModels: [
            { modelId: 'gpt-4.1' },
          ],
        },
        {
          id: 'openrouter-main',
          name: 'OpenRouter Main',
          protocol: 'openrouter',
          endpoint: 'https://openrouter.ai/api/v1',
          defaultModel: 'gpt-4.1',
          fastModel: 'gpt-4.1-mini',
          fallbackModel: 'gpt-4.1-mini',
          organization: '',
          region: 'Global',
          notes: '',
          availableModels: [
            { modelId: 'gpt-4.1' },
          ],
        },
      ],
      defaultModelRouting: {
        primaryAssistantModel: 'gpt-4.1',
        fastAssistantModel: 'gpt-4.1',
      },
    })

    expect(values.defaultModelRouting).toEqual({
      primaryAssistantModel: null,
      fastAssistantModel: null,
    })
  })

  it('preserves legacy unsupported provider data with legacy compatibility markers', () => {
    const values = normalizeSettingsWorkspaceStateValues({
      providerProfiles: [
        {
          id: 'legacy-response',
          name: 'Legacy Response',
          protocol: 'openai-response',
          endpoint: 'https://response.example.com/v1',
          defaultModel: 'gpt-4.1',
          fastModel: 'gpt-4.1-mini',
          fallbackModel: 'gpt-4.1-mini',
          organization: '',
          region: 'Global',
          notes: 'keep me',
          availableModels: [
            { modelId: 'gpt-4.1' },
          ],
        },
      ],
    })

    expect(values.providerProfiles[0]).toMatchObject({
      profileId: 'legacy-response',
      providerId: 'openai-response',
      compatibility: {
        status: 'legacy',
      },
      extensions: {
        notes: 'keep me',
      },
    })
    expect(values.providerProfiles[0]?.compatibility.reason).toContain('legacy / unsupported')
  })
})
