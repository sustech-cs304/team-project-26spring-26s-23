import { describe, expect, it } from 'vitest'

import { createSettingsWorkspaceFormStateFromEditableState } from './settings-workspace-form-state'
import {
  createSettingsWorkspaceStateSaveInput,
} from './settings-workspace-save-input'
import {
  buildDefaultModelRouteSelectionValue,
  serializeModelRouteRef,
} from './settings-workspace-model-options'
import { createPersistedWorkspaceState, createProviderProfile } from './settings-workspace-test-fixtures'

describe('settings workspace save input', () => {
  it('keeps reading legacy model strings for display state but stops writing them back as new saved routes', () => {
    const alphaProvider = createProviderProfile({
      id: 'alpha-profile',
      defaultModel: 'alpha-model',
      fastModel: 'alpha-fast',
      fallbackModel: 'alpha-fast',
    })
    const formState = createSettingsWorkspaceFormStateFromEditableState(createPersistedWorkspaceState({
      providerProfiles: [alphaProvider],
      defaultModelRouting: {
        primaryAssistantModel: 'alpha-model',
        fastAssistantModel: 'alpha-fast',
        primaryAssistantModelRoute: null,
        fastAssistantModelRoute: null,
      },
    }))

    expect(buildDefaultModelRouteSelectionValue({
      selectedModelId: formState.primaryAssistantModel,
      persistedRoute: formState.primaryAssistantModelRoute,
      providerProfiles: [alphaProvider],
    })).toBe('alpha-model')

    const saveInput = createSettingsWorkspaceStateSaveInput(formState)

    expect(saveInput.defaultModelRouting).toEqual({
      primaryAssistantModel: null,
      fastAssistantModel: null,
    })
  })

  it('prefers explicit route-ref selection values when the UI already serializes profile + model choices', () => {
    const alphaProvider = createProviderProfile({
      id: 'alpha-profile',
      profileId: 'alpha-profile',
      providerId: 'openai',
      protocol: 'openai',
      defaultModel: 'shared-model',
      defaultModelId: 'shared-model',
      fastModel: 'shared-model',
      fallbackModel: 'shared-model',
      availableModels: [
        {
          ...createProviderProfile({ id: 'alpha-profile' }).availableModels[0]!,
          id: 'alpha-model-1',
          modelId: 'shared-model',
          displayName: 'Shared Model A',
        },
      ],
    })
    const betaProvider = createProviderProfile({
      id: 'beta-profile',
      profileId: 'beta-profile',
      providerId: 'gemini',
      protocol: 'gemini',
      defaultModel: 'shared-model',
      defaultModelId: 'shared-model',
      fastModel: 'shared-model',
      fallbackModel: 'shared-model',
      availableModels: [
        {
          ...createProviderProfile({ id: 'beta-profile' }).availableModels[0]!,
          id: 'beta-model-1',
          modelId: 'shared-model',
          displayName: 'Shared Model B',
        },
      ],
    })
    const formState = createSettingsWorkspaceFormStateFromEditableState(createPersistedWorkspaceState({
      providerProfiles: [alphaProvider, betaProvider],
      defaultModelRouting: {
        primaryAssistantModel: 'shared-model',
        fastAssistantModel: 'shared-model',
        primaryAssistantModelRoute: null,
        fastAssistantModelRoute: null,
      },
    }))

    formState.primaryAssistantModel = serializeModelRouteRef({
      routeKind: 'provider-model',
      profileId: 'alpha-profile',
      modelId: 'shared-model',
    })
    formState.fastAssistantModel = serializeModelRouteRef({
      routeKind: 'provider-model',
      profileId: 'beta-profile',
      modelId: 'shared-model',
    })

    const saveInput = createSettingsWorkspaceStateSaveInput(formState)

    expect(saveInput.defaultModelRouting).toEqual({
      primaryAssistantModel: {
        routeKind: 'provider-model',
        profileId: 'alpha-profile',
        modelId: 'shared-model',
      },
      fastAssistantModel: {
        routeKind: 'provider-model',
        profileId: 'beta-profile',
        modelId: 'shared-model',
      },
    })
  })

  it('clears ambiguous default routes instead of guessing when multiple profiles share a model id', () => {
    const alphaProvider = createProviderProfile({
      id: 'alpha-profile',
      defaultModel: 'shared-model',
      fastModel: 'alpha-fast',
      fallbackModel: 'alpha-fast',
      availableModels: [
        {
          ...createProviderProfile({ id: 'alpha-profile' }).availableModels[0]!,
          id: 'alpha-model-1',
          modelId: 'shared-model',
          displayName: 'Shared Model A',
        },
      ],
    })
    const betaProvider = createProviderProfile({
      id: 'beta-profile',
      providerId: 'openai',
      protocol: 'openai',
      defaultModel: 'shared-model',
      fastModel: 'beta-fast',
      fallbackModel: 'beta-fast',
      availableModels: [
        {
          ...createProviderProfile({ id: 'beta-profile' }).availableModels[0]!,
          id: 'beta-model-1',
          modelId: 'shared-model',
          displayName: 'Shared Model B',
        },
      ],
    })
    const formState = createSettingsWorkspaceFormStateFromEditableState(createPersistedWorkspaceState({
      providerProfiles: [alphaProvider, betaProvider],
      defaultModelRouting: {
        primaryAssistantModel: 'shared-model',
        fastAssistantModel: 'shared-model',
        primaryAssistantModelRoute: null,
        fastAssistantModelRoute: null,
      },
    }))

    const saveInput = createSettingsWorkspaceStateSaveInput(formState)

    expect(saveInput.defaultModelRouting).toEqual({
      primaryAssistantModel: null,
      fastAssistantModel: null,
    })
  })

  it('builds route-ref selection values from persisted routes and keeps legacy strings only for invalid-display fallback', () => {
    const alphaProvider = createProviderProfile({
      id: 'alpha-profile',
      profileId: 'alpha-profile',
      providerId: 'openai',
      protocol: 'openai',
      defaultModel: 'shared-model',
      defaultModelId: 'shared-model',
      availableModels: [
        {
          ...createProviderProfile({ id: 'alpha-profile' }).availableModels[0]!,
          id: 'alpha-model-1',
          modelId: 'shared-model',
          displayName: 'Shared Model A',
        },
      ],
    })
    const betaProvider = createProviderProfile({
      id: 'beta-profile',
      profileId: 'beta-profile',
      providerId: 'gemini',
      protocol: 'gemini',
      defaultModel: 'shared-model',
      defaultModelId: 'shared-model',
      availableModels: [
        {
          ...createProviderProfile({ id: 'beta-profile' }).availableModels[0]!,
          id: 'beta-model-1',
          modelId: 'shared-model',
          displayName: 'Shared Model B',
        },
      ],
    })

    expect(buildDefaultModelRouteSelectionValue({
      selectedModelId: 'shared-model',
      persistedRoute: {
        routeKind: 'provider-model',
        profileId: 'beta-profile',
        modelId: 'shared-model',
      },
      providerProfiles: [alphaProvider, betaProvider],
    })).toBe(serializeModelRouteRef({
      routeKind: 'provider-model',
      profileId: 'beta-profile',
      modelId: 'shared-model',
    }))

    expect(buildDefaultModelRouteSelectionValue({
      selectedModelId: 'shared-model',
      persistedRoute: null,
      providerProfiles: [alphaProvider, betaProvider],
    })).toBe('shared-model')

    const formState = createSettingsWorkspaceFormStateFromEditableState(createPersistedWorkspaceState({
      providerProfiles: [alphaProvider, betaProvider],
      defaultModelRouting: {
        primaryAssistantModel: 'shared-model',
        fastAssistantModel: 'shared-model',
        primaryAssistantModelRoute: null,
        fastAssistantModelRoute: null,
      },
    }))

    expect(createSettingsWorkspaceStateSaveInput(formState).defaultModelRouting).toEqual({
      primaryAssistantModel: null,
      fastAssistantModel: null,
    })
  })
})
