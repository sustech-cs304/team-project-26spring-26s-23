import type {
  SettingsWorkspaceEditableState,
  SettingsWorkspaceToolPermissionPolicyState,
} from '../../../electron/settings-workspace/schema'
import type { ModelRouteRef, ProviderProfile } from '../types'

import { initialProviderProfiles } from './config'
import {
  cloneProviderProfiles,
  cloneSettingsWorkspaceFormState,
} from './settings-workspace-controller-helpers'

export interface SettingsWorkspaceFormState {
  studentId: string
  sustechEmail: string
  blackboardAutoDownloadEnabled: boolean
  blackboardDownloadLimitMb: string
  providerProfiles: ProviderProfile[]
  primaryAssistantModel: string
  fastAssistantModel: string
  primaryAssistantModelRoute: ModelRouteRef | null
  fastAssistantModelRoute: ModelRouteRef | null
  language: string
  assistantNotificationsEnabled: boolean
  toolPermissionPolicy: SettingsWorkspaceToolPermissionPolicyState
  apiReconnectMode: string
  healthPollingEnabled: boolean
  apiBaseUrl: string
  docsFormat: string
  wakeupShareLink: string
}

export const initialSettingsWorkspaceActiveProviderId = initialProviderProfiles[0]?.id ?? ''

const INITIAL_SETTINGS_WORKSPACE_FORM_STATE: SettingsWorkspaceFormState = {
  studentId: '',
  sustechEmail: '',
  blackboardAutoDownloadEnabled: false,
  blackboardDownloadLimitMb: '0',
  providerProfiles: cloneProviderProfiles(initialProviderProfiles),
  primaryAssistantModel: '',
  fastAssistantModel: initialProviderProfiles[0]?.fastModel ?? '',
  primaryAssistantModelRoute: null,
  fastAssistantModelRoute: null,
  language: 'zh-CN',
  assistantNotificationsEnabled: false,
  toolPermissionPolicy: {
    version: 1,
    defaultMode: 'ask',
    toolPermissions: {},
  },
  apiReconnectMode: 'exponential',
  healthPollingEnabled: true,
  apiBaseUrl: 'http://127.0.0.1:8000',
  docsFormat: 'markdown',
  wakeupShareLink: '',
}

export function createInitialSettingsWorkspaceFormState(): SettingsWorkspaceFormState {
  return cloneSettingsWorkspaceFormState(INITIAL_SETTINGS_WORKSPACE_FORM_STATE)
}

export function createSettingsWorkspaceFormStateFromEditableState(
  state: SettingsWorkspaceEditableState,
): SettingsWorkspaceFormState {
  return {
    studentId: state.sustech.studentId,
    sustechEmail: state.sustech.email,
    blackboardAutoDownloadEnabled: state.sustech.blackboardAutoDownloadEnabled,
    blackboardDownloadLimitMb: state.sustech.blackboardDownloadLimitMb,
    providerProfiles: cloneProviderProfiles(state.providerProfiles),
    primaryAssistantModel: state.defaultModelRouting.primaryAssistantModel,
    fastAssistantModel: state.defaultModelRouting.fastAssistantModel,
    primaryAssistantModelRoute: cloneModelRouteRef(state.defaultModelRouting.primaryAssistantModelRoute ?? null),
    fastAssistantModelRoute: cloneModelRouteRef(state.defaultModelRouting.fastAssistantModelRoute ?? null),
    language: state.general.language,
    assistantNotificationsEnabled: state.general.assistantNotificationsEnabled,
    toolPermissionPolicy: state.mcp.toolPermissionPolicy,
    apiReconnectMode: state.api.apiReconnectMode,
    healthPollingEnabled: state.api.healthPollingEnabled,
    apiBaseUrl: state.api.apiBaseUrl,
    docsFormat: state.docs.docsFormat,
    wakeupShareLink: state.externalSource.wakeupShareLink,
  }
}

function cloneModelRouteRef(routeRef: ModelRouteRef | null): ModelRouteRef | null {
  return routeRef === null
    ? null
    : {
      routeKind: routeRef.routeKind,
      profileId: routeRef.profileId,
      modelId: routeRef.modelId,
    }
}
