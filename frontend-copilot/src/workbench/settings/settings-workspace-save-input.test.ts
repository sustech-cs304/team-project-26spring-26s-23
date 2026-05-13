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
import { createProviderModelProfile } from './domains/provider-profiles/provider-profiles'

const SHARED_MODEL_ID = 'shared-model'
const ALPHA_FAST_MODEL = 'alpha-fast'

function mkRoute(profileId: string, modelId: string) {
  return { routeKind: 'provider-model' as const, profileId, modelId }
}
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

function createAlphaProfile(overrides?: { availableModels?: import('../types').ProviderModelProfile[] }) {
  return createProviderProfile({
    id: ALPHA_PROFILE_ID,
    profileId: ALPHA_PROFILE_ID,
    providerId: OPENAI,
    protocol: OPENAI,
    primaryModelId: SHARED_MODEL_ID,
    fastModel: ALPHA_FAST_MODEL,
    fallbackModel: ALPHA_FAST_MODEL,
    availableModels: overrides?.availableModels ?? [
      {
        ...createProviderModelProfile(OPENAI, SHARED_MODEL_ID, 'Alpha Provider'),
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
    fastModel: SHARED_MODEL_ID,
    fallbackModel: SHARED_MODEL_ID,
    availableModels: [
      {
        ...createProviderModelProfile(GEMINI, SHARED_MODEL_ID, 'Beta Provider'),
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
        fastModel: ALPHA_FAST_MODEL,
        fallbackModel: ALPHA_FAST_MODEL,
      })
      const formState = createSettingsWorkspaceFormStateFromEditableState(createPersistedWorkspaceState({
        providerProfiles: [alphaProvider],
        defaultModelRouting: {
          primaryAssistantModel: 'alpha-model',
          fastAssistantModel: ALPHA_FAST_MODEL,
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

      const routeAlpha = mkRoute(ALPHA_PROFILE_ID, SHARED_MODEL_ID)
      const routeBeta = mkRoute(BETA_PROFILE_ID, SHARED_MODEL_ID)
      formState.primaryAssistantModel = serializeModelRouteRef(routeAlpha)
      formState.fastAssistantModel = serializeModelRouteRef(routeBeta)

      const saveInput = createSettingsWorkspaceStateSaveInput(formState)

      expect(saveInput.defaultModelRouting).toEqual({
        primaryAssistantModel: routeAlpha,
        fastAssistantModel: routeBeta,
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
        persistedRoute: mkRoute(BETA_PROFILE_ID, SHARED_MODEL_ID),
        providerProfiles: [alphaProvider, betaProvider],
      })).toBe(serializeModelRouteRef(mkRoute(BETA_PROFILE_ID, SHARED_MODEL_ID)))

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
