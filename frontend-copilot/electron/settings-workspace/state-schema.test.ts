import { describe, expect, it } from 'vitest'

import {
  normalizeSettingsWorkspaceStateValues,
  projectSettingsWorkspaceEditableState,
} from './state-schema'

describe('settings workspace state schema migration', () => {
  it('migrates legacy provider profiles and unique default model strings into stable route refs', () => {
    const values = normalizeSettingsWorkspaceStateValues({
      providerProfiles: [
        {
          id: 'google-main',
          name: 'Google Main',
          protocol: 'google',
          endpoint: 'https://generativelanguage.googleapis.com',
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

  it('keeps blank provider base urls blank during normalization and editable-state projection', () => {
    const values = normalizeSettingsWorkspaceStateValues({
      providerProfiles: [
        {
          id: 'blank-openai',
          name: 'Blank OpenAI',
          protocol: 'openai',
          endpoint: '',
          baseUrl: '',
          fastModel: '',
          fallbackModel: '',
          organization: '',
          region: 'Global',
          notes: '',
          availableModels: [
            { modelId: 'gpt-4.1' },
          ],
        },
      ],
    })

    expect(values.providerProfiles[0]).toMatchObject({
      profileId: 'blank-openai',
      providerId: 'openai',
      baseUrl: '',
    })

    const editableState = projectSettingsWorkspaceEditableState(values, {})
    expect(editableState.providerProfiles[0]).toMatchObject({
      id: 'blank-openai',
      profileId: 'blank-openai',
      providerId: 'openai',
      endpoint: '',
      baseUrl: '',
    })
  })
  it('creates default MCP tool permission policy state when no MCP settings are stored', () => {
    const values = normalizeSettingsWorkspaceStateValues({})

    expect(values.mcp).toEqual({
      mcpAutoDiscoveryEnabled: true,
      toolPermissionMode: 'manual',
      toolPermissionPolicy: {
        version: 1,
        migrationSourceMode: 'manual',
        defaultMode: 'ask',
        toolPermissions: {},
      },
    })
  })

  it('migrates legacy toolPermissionMode into the new MCP tool permission policy state', () => {
    const values = normalizeSettingsWorkspaceStateValues({
      mcp: {
        mcpAutoDiscoveryEnabled: false,
        toolPermissionMode: 'trusted',
      },
    })

    expect(values.mcp).toEqual({
      mcpAutoDiscoveryEnabled: false,
      toolPermissionMode: 'trusted',
      toolPermissionPolicy: {
        version: 1,
        migrationSourceMode: 'trusted',
        defaultMode: 'allow',
        toolPermissions: {},
      },
    })
  })

  it('keeps explicit MCP tool permission policy and mirrors its default mode back to toolPermissionMode', () => {
    const values = normalizeSettingsWorkspaceStateValues({
      mcp: {
        mcpAutoDiscoveryEnabled: true,
        toolPermissionMode: 'manual',
        toolPermissionPolicy: {
          version: 1,
          migrationSourceMode: 'manual',
          defaultMode: 'deny',
          toolPermissions: {
            'functions.read_file': {
              mode: 'allow',
              source: 'user',
              updatedAt: '2026-04-17T04:00:00.000Z',
            },
          },
        },
      },
    })

    expect(values.mcp.toolPermissionMode).toBe('strict')
    expect(values.mcp.toolPermissionPolicy).toEqual({
      version: 1,
      migrationSourceMode: 'manual',
      defaultMode: 'deny',
      toolPermissions: {
        'functions.read_file': {
          mode: 'allow',
          source: 'user',
          updatedAt: '2026-04-17T04:00:00.000Z',
        },
      },
    })
  })

  it('keeps delay tool permission entries including timeout settings', () => {
    const values = normalizeSettingsWorkspaceStateValues({
      mcp: {
        mcpAutoDiscoveryEnabled: true,
        toolPermissionMode: 'manual',
        toolPermissionPolicy: {
          version: 1,
          defaultMode: 'ask',
          toolPermissions: {
            'functions.read_file': {
              mode: 'delay',
              timeoutAction: 'deny',
              timeoutSeconds: 27,
              source: 'user',
            },
          },
        },
      },
    })

    expect(values.mcp.toolPermissionPolicy).toEqual({
      version: 1,
      migrationSourceMode: undefined,
      defaultMode: 'ask',
      toolPermissions: {
        'functions.read_file': {
          mode: 'delay',
          timeoutAction: 'deny',
          timeoutSeconds: 27,
          source: 'user',
        },
      },
    })
  })
})
