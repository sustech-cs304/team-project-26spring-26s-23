import type {
  LegacyToolPermissionMode,
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
  blackboardCurrentTermOnly: boolean
  blackboardParallelSyncWorkers: string
  blackboardSyncInterval: 'off' | 'two_hours' | 'daily'
  blackboardLastAutoSyncAt: string | null
  blackboardNextAutoSyncAt: string | null
  providerProfiles: ProviderProfile[]
  primaryAssistantModel: string
  fastAssistantModel: string
  primaryAssistantModelRoute: ModelRouteRef | null
  fastAssistantModelRoute: ModelRouteRef | null
  language: string
  assistantNotificationsEnabled: boolean
  toolPermissionMode: LegacyToolPermissionMode
  mcpAutoDiscoveryEnabled: boolean
  toolPermissionPolicy: SettingsWorkspaceToolPermissionPolicyState
  apiReconnectMode: string
  healthPollingEnabled: boolean
  apiBaseUrl: string
  searchEngine: string
  searchResultCount: string
  compressionMode: string
  docsFormat: string
  wakeupShareLink: string
}

export const initialSettingsWorkspaceActiveProviderId = initialProviderProfiles[0]?.id ?? ''

const INITIAL_SETTINGS_WORKSPACE_FORM_STATE: SettingsWorkspaceFormState = {
  studentId: '',
  sustechEmail: '',
  blackboardCurrentTermOnly: false,
  blackboardParallelSyncWorkers: '1',
  blackboardSyncInterval: 'off' as const,
  blackboardLastAutoSyncAt: null,
  blackboardNextAutoSyncAt: null,
  providerProfiles: cloneProviderProfiles(initialProviderProfiles),
  primaryAssistantModel: '',
  fastAssistantModel: initialProviderProfiles[0]?.fastModel ?? '',
  primaryAssistantModelRoute: null,
  fastAssistantModelRoute: null,
  language: 'zh-CN',
  assistantNotificationsEnabled: false,
  toolPermissionMode: 'manual',
  mcpAutoDiscoveryEnabled: true,
  toolPermissionPolicy: {
    version: 1,
    migrationSourceMode: 'manual',
    defaultMode: 'ask',
    toolPermissions: {},
  },
  apiReconnectMode: 'exponential',
  healthPollingEnabled: true,
  apiBaseUrl: 'http://127.0.0.1:8000',
  searchEngine: 'google',
  searchResultCount: '8',
  compressionMode: 'balanced',
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
    blackboardCurrentTermOnly: state.sustech.blackboardCurrentTermOnly,
    blackboardParallelSyncWorkers: state.sustech.blackboardParallelSyncWorkers,
    blackboardSyncInterval: state.sustech.blackboardSyncInterval,
    blackboardLastAutoSyncAt: state.sustech.blackboardLastAutoSyncAt ?? null,
    blackboardNextAutoSyncAt: state.sustech.blackboardNextAutoSyncAt ?? null,
    providerProfiles: cloneProviderProfiles(state.providerProfiles),
    primaryAssistantModel: state.defaultModelRouting.primaryAssistantModel,
    fastAssistantModel: state.defaultModelRouting.fastAssistantModel,
    primaryAssistantModelRoute: cloneModelRouteRef(state.defaultModelRouting.primaryAssistantModelRoute ?? null),
    fastAssistantModelRoute: cloneModelRouteRef(state.defaultModelRouting.fastAssistantModelRoute ?? null),
    language: state.general.language,
    assistantNotificationsEnabled: state.general.assistantNotificationsEnabled,
    toolPermissionMode: state.mcp.toolPermissionMode,
    mcpAutoDiscoveryEnabled: state.mcp.mcpAutoDiscoveryEnabled,
    toolPermissionPolicy: state.mcp.toolPermissionPolicy,
    apiReconnectMode: state.api.apiReconnectMode,
    healthPollingEnabled: state.api.healthPollingEnabled,
    apiBaseUrl: state.api.apiBaseUrl,
    searchEngine: 'google',
    searchResultCount: '8',
    compressionMode: 'balanced',
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
