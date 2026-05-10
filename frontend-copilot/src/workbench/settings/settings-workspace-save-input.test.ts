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

const SHARED_MODEL_ID = 'shared-model'
const ALPHA_PROFILE_ID = 'alpha-profile'
const BETA_PROFILE_ID = 'beta-profile'
const OPENAI = 'openai'
const GEMINI = 'gemini'

const defaultModelRoutingTemplate = {
  primaryAssistantModel: SHARED_MODEL_ID,
  fastAssistantModel: SHARED_MODEL_ID,
  primaryAssistantModelRoute: null as null,
  fastAssistantModelRoute: null as null,
}

function createAlphaProfile(overrides?: { availableModels?: Array<{ id: string; modelId: string; displayName: string }> }) {
  return createProviderProfile({
    id: ALPHA_PROFILE_ID,
    profileId: ALPHA_PROFILE_ID,
    providerId: OPENAI,
    protocol: OPENAI,
    primaryModelId: SHARED_MODEL_ID,
    fastModel: 'alpha-fast',
    fallbackModel: 'alpha-fast',
    availableModels: overrides?.availableModels ?? [
      {
        ...createProviderProfile({ id: ALPHA_PROFILE_ID }).availableModels[0]!,
        id: 'alpha-model-1',
        modelId: SHARED_MODEL_ID,
        displayName: 'Shared Model A',
      },
    ],
  })
}

function createBetaProfile() {
  return createProviderProfile({
    id: BETA_PROFILE_ID,
    profileId: BETA_PROFILE_ID,
    providerId: GEMINI,
    protocol: GEMINI,
    primaryModelId: SHARED_MODEL_ID,
    fastModel: 'shared-model',
    fallbackModel: 'shared-model',
    availableModels: [
      {
        ...createProviderProfile({ id: BETA_PROFILE_ID }).availableModels[0]!,
        id: 'beta-model-1',
        modelId: SHARED_MODEL_ID,
        displayName: 'Shared Model B',
      },
    ],
  })
}

function createFormStateWithProfiles(profiles: ReturnType<typeof createProviderProfile>[], overrides?: {
  primaryAssistantModel?: string
  fastAssistantModel?: string
}) {
  return createSettingsWorkspaceFormStateFromEditableState(createPersistedWorkspaceState({
    providerProfiles: profiles,
    defaultModelRouting: {
      ...defaultModelRoutingTemplate,
      ...overrides,
    },
  }))
}

describe('settings workspace save input', () => {
  describe('legacy model strings', () => {
    it('keeps reading legacy model strings for display state but stops writing them back as new saved routes', () => {
      const alphaProvider = createProviderProfile({
        id: ALPHA_PROFILE_ID,
        primaryModelId: 'alpha-model',
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
  })

  describe('route-ref selection values', () => {
    it('prefers explicit route-ref selection values when the UI already serializes profile + model choices', () => {
      const alphaProvider = createAlphaProfile()
      const betaProvider = createBetaProfile()
      const formState = createFormStateWithProfiles([alphaProvider, betaProvider])

      formState.primaryAssistantModel = serializeModelRouteRef({
        routeKind: 'provider-model',
        profileId: ALPHA_PROFILE_ID,
        modelId: SHARED_MODEL_ID,
      })
      formState.fastAssistantModel = serializeModelRouteRef({
        routeKind: 'provider-model',
        profileId: BETA_PROFILE_ID,
        modelId: SHARED_MODEL_ID,
      })

      const saveInput = createSettingsWorkspaceStateSaveInput(formState)

      expect(saveInput.defaultModelRouting).toEqual({
        primaryAssistantModel: {
          routeKind: 'provider-model',
          profileId: ALPHA_PROFILE_ID,
          modelId: SHARED_MODEL_ID,
        },
        fastAssistantModel: {
          routeKind: 'provider-model',
          profileId: BETA_PROFILE_ID,
          modelId: SHARED_MODEL_ID,
        },
      })
    })
  })

  describe('ambiguous routes', () => {
    it('clears ambiguous default routes instead of guessing when multiple profiles share a model id', () => {
      const alphaProvider = createAlphaProfile()
      const betaProvider = createBetaProfile()
      const formState = createFormStateWithProfiles([alphaProvider, betaProvider])

      const saveInput = createSettingsWorkspaceStateSaveInput(formState)

      expect(saveInput.defaultModelRouting).toEqual({
        primaryAssistantModel: null,
        fastAssistantModel: null,
      })
    })
  })

  describe('persisted route display', () => {
    it('builds route-ref selection values from persisted routes and keeps legacy strings only for invalid-display fallback', () => {
      const alphaProvider = createAlphaProfile()
      const betaProvider = createBetaProfile()

      expect(buildDefaultModelRouteSelectionValue({
        selectedModelId: SHARED_MODEL_ID,
        persistedRoute: {
          routeKind: 'provider-model',
          profileId: BETA_PROFILE_ID,
          modelId: SHARED_MODEL_ID,
        },
        providerProfiles: [alphaProvider, betaProvider],
      })).toBe(serializeModelRouteRef({
        routeKind: 'provider-model',
        profileId: BETA_PROFILE_ID,
        modelId: SHARED_MODEL_ID,
      }))

      expect(buildDefaultModelRouteSelectionValue({
        selectedModelId: SHARED_MODEL_ID,
        persistedRoute: null,
        providerProfiles: [alphaProvider, betaProvider],
      })).toBe(SHARED_MODEL_ID)

      const formState = createFormStateWithProfiles([alphaProvider, betaProvider])

      expect(createSettingsWorkspaceStateSaveInput(formState).defaultModelRouting).toEqual({
        primaryAssistantModel: null,
        fastAssistantModel: null,
      })
    })
  })
})
