import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'

import type { ProviderProfile } from '../../types'
import { createInitialSettingsWorkspaceFormState, type SettingsWorkspaceFormState } from '../settings-workspace-form-state'
import { resolveProviderBaseUrlValidationMessage } from '../settings-workspace-provider-helpers'
import { loadSettingsWorkspaceHydration } from '../settings-workspace-hydration'
import {
  parseSerializedModelRouteRef,
  serializeModelRouteRef,
} from '../settings-workspace-model-options'
import { createSettingsWorkspaceStateSaveInput } from '../settings-workspace-save-input'
import { saveSettingsWorkspaceState } from '../workspace-state'

interface UseSettingsWorkspaceStateResult {
  formState: SettingsWorkspaceFormState
  workspaceHydrated: boolean
  activeProviderId: string
  setActiveProviderId: (value: string) => void
  providerSecretValues: Record<string, string>
  casPasswordValue: string
  setStudentId: (value: string) => void
  setSustechEmail: (value: string) => void
  setBlackboardAutoDownloadEnabled: (value: boolean) => void
  setBlackboardDownloadLimitMb: (value: string) => void
  setProviderProfiles: (value: ProviderProfile[] | ((previous: ProviderProfile[]) => ProviderProfile[])) => void
  setPrimaryAssistantModel: (value: string | ((previous: string) => string)) => void
  setFastAssistantModel: (value: string | ((previous: string) => string)) => void
  setLanguage: (value: string) => void
  setAssistantNotificationsEnabled: (value: boolean) => void
  setApiReconnectMode: (value: string) => void
  setHealthPollingEnabled: (value: boolean) => void
  setApiBaseUrl: (value: string) => void
  setDocsFormat: (value: string) => void
  setWakeupShareLink: (value: string) => void
}

export function useSettingsWorkspaceState(initialActiveProviderId: string): UseSettingsWorkspaceStateResult {
  const [formState, setFormState] = useState<SettingsWorkspaceFormState>(() => createInitialSettingsWorkspaceFormState())
  const [activeProviderId, setActiveProviderId] = useState(initialActiveProviderId)
  const [workspaceHydrated, setWorkspaceHydrated] = useState(false)
  const [providerSecretValues, setProviderSecretValues] = useState<Record<string, string>>({})
  const [casPasswordValue, setCasPasswordValue] = useState('')
  const skipNextWorkspaceSaveRef = useRef(true)
  const [initialHydrationActiveProviderId] = useState(() => initialActiveProviderId)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      const hydration = await loadSettingsWorkspaceHydration(initialHydrationActiveProviderId)

      if (!cancelled && hydration) {
        setFormState(hydration.state)
        setActiveProviderId(hydration.activeProviderId)
        setProviderSecretValues(hydration.providerSecretValues)
        setCasPasswordValue(hydration.casPasswordValue)
      }

      if (!cancelled) {
        setWorkspaceHydrated(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [initialHydrationActiveProviderId])

  const workspaceStateInput = useMemo(() => createSettingsWorkspaceStateSaveInput(formState), [formState])
  const hasInvalidProviderProfiles = useMemo(() => {
    return formState.providerProfiles.some((profile) => resolveProviderBaseUrlValidationMessage(profile) !== null)
  }, [formState.providerProfiles])

  useEffect(() => {
    if (!workspaceHydrated) {
      return
    }

    if (skipNextWorkspaceSaveRef.current) {
      skipNextWorkspaceSaveRef.current = false
      return
    }

    if (hasInvalidProviderProfiles) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      void saveSettingsWorkspaceState(workspaceStateInput)
    }, 200)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [hasInvalidProviderProfiles, workspaceHydrated, workspaceStateInput])

  return {
    formState,
    workspaceHydrated,
    activeProviderId,
    setActiveProviderId,
    providerSecretValues,
    casPasswordValue,
    setStudentId: (value) => updateField(setFormState, 'studentId', value),
    setSustechEmail: (value) => updateField(setFormState, 'sustechEmail', value),
    setBlackboardAutoDownloadEnabled: (value) => updateField(setFormState, 'blackboardAutoDownloadEnabled', value),
    setBlackboardDownloadLimitMb: (value) => updateField(setFormState, 'blackboardDownloadLimitMb', value),
    setProviderProfiles: (value) => {
      setFormState((previous) => ({
        ...previous,
        providerProfiles: typeof value === 'function' ? value(previous.providerProfiles) : value,
      }))
    },
    setPrimaryAssistantModel: (value) => {
      setFormState((previous) => updateDefaultModelSelectionField(
        previous,
        'primaryAssistantModel',
        'primaryAssistantModelRoute',
        value,
      ))
    },
    setFastAssistantModel: (value) => {
      setFormState((previous) => updateDefaultModelSelectionField(
        previous,
        'fastAssistantModel',
        'fastAssistantModelRoute',
        value,
      ))
    },
    setLanguage: (value) => updateField(setFormState, 'language', value),
    setAssistantNotificationsEnabled: (value) => updateField(setFormState, 'assistantNotificationsEnabled', value),
    setApiReconnectMode: (value) => {
      setFormState((previous) => ({
        ...previous,
        apiReconnectMode: value,
      }))
    },
    setHealthPollingEnabled: (value) => updateField(setFormState, 'healthPollingEnabled', value),
    setApiBaseUrl: (value) => {
      setFormState((previous) => ({
        ...previous,
        apiBaseUrl: value,
      }))
    },
    setDocsFormat: (value) => updateField(setFormState, 'docsFormat', value),
    setWakeupShareLink: (value) => updateField(setFormState, 'wakeupShareLink', value),
  }
}

function updateField<TKey extends keyof SettingsWorkspaceFormState>(
  setFormState: Dispatch<SetStateAction<SettingsWorkspaceFormState>>,
  key: TKey,
  value: SettingsWorkspaceFormState[TKey] | ((previous: SettingsWorkspaceFormState[TKey]) => SettingsWorkspaceFormState[TKey]),
) {
  setFormState((previous) => ({
    ...previous,
    [key]: typeof value === 'function'
      ? (value as (previous: SettingsWorkspaceFormState[TKey]) => SettingsWorkspaceFormState[TKey])(previous[key])
      : value,
  }))
}

function updateDefaultModelSelectionField(
  previous: SettingsWorkspaceFormState,
  field: 'primaryAssistantModel' | 'fastAssistantModel',
  routeField: 'primaryAssistantModelRoute' | 'fastAssistantModelRoute',
  value: string | ((previous: string) => string),
): SettingsWorkspaceFormState {
  const currentSelectionValue = previous[routeField] !== null
    ? serializeModelRouteRef(previous[routeField])
    : previous[field]
  const nextRawValue = typeof value === 'function' ? value(currentSelectionValue) : value
  const normalizedValue = nextRawValue.trim()
  const parsedRoute = parseSerializedModelRouteRef(normalizedValue)

  if (parsedRoute !== null) {
    return {
      ...previous,
      [field]: parsedRoute.modelId,
      [routeField]: cloneModelRouteRef(parsedRoute),
    }
  }

  const previousRoute = previous[routeField]
  const previousModelId = previous[field].trim()
  const nextRoute = previousRoute !== null && previousRoute.modelId === previousModelId
    ? (normalizedValue === ''
        ? null
        : {
            routeKind: previousRoute.routeKind,
            profileId: previousRoute.profileId,
            modelId: normalizedValue,
          })
    : null

  return {
    ...previous,
    [field]: normalizedValue,
    [routeField]: nextRoute,
  }
}

function cloneModelRouteRef(route: SettingsWorkspaceFormState['primaryAssistantModelRoute']) {
  return route === null
    ? null
    : {
        routeKind: route.routeKind,
        profileId: route.profileId,
        modelId: route.modelId,
      }
}
