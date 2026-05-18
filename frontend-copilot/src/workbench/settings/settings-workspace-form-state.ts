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
  proxyMode: string
  assistantNotificationsEnabled: boolean
  backupEnabled: boolean
  dataPath: string
  backupCycle: string
  launchSyncEnabled: boolean
  mcpAutoDiscoveryEnabled: boolean
  toolPermissionMode: string
  toolPermissionPolicy: SettingsWorkspaceToolPermissionPolicyState
  searchEngine: string
  searchResultCount: string
  compressionMode: string
  memoryStrategy: string
  memoryCleanupEnabled: boolean
  apiReconnectMode: string
  healthPollingEnabled: boolean
  apiBaseUrl: string
  docsFormat: string
  outputDirectory: string
  autoFileNameEnabled: boolean
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
  proxyMode: 'system',
  assistantNotificationsEnabled: false,
  backupEnabled: true,
  dataPath: 'D:/workspace/copilot-data',
  backupCycle: 'daily',
  launchSyncEnabled: true,
  mcpAutoDiscoveryEnabled: true,
  toolPermissionMode: 'manual',
  toolPermissionPolicy: {
    version: 1,
    defaultMode: 'ask',
    toolPermissions: {},
  },
  searchEngine: 'google',
  searchResultCount: '8',
  compressionMode: 'summary',
  memoryStrategy: 'session-longterm',
  memoryCleanupEnabled: true,
  apiReconnectMode: 'exponential',
  healthPollingEnabled: true,
  apiBaseUrl: 'http://127.0.0.1:8000',
  docsFormat: 'markdown',
  outputDirectory: 'D:/workspace/exports',
  autoFileNameEnabled: true,
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
    proxyMode: state.general.proxyMode,
    assistantNotificationsEnabled: state.general.assistantNotificationsEnabled,
    backupEnabled: state.general.backupEnabled,
    dataPath: state.data.dataPath,
    backupCycle: state.data.backupCycle,
    launchSyncEnabled: state.data.launchSyncEnabled,
    mcpAutoDiscoveryEnabled: state.mcp.mcpAutoDiscoveryEnabled,
    toolPermissionMode: state.mcp.toolPermissionMode,
    toolPermissionPolicy: state.mcp.toolPermissionPolicy,
    searchEngine: state.search.searchEngine,
    searchResultCount: state.search.searchResultCount,
    compressionMode: state.search.compressionMode,
    memoryStrategy: state.memory.memoryStrategy,
    memoryCleanupEnabled: state.memory.memoryCleanupEnabled,
    apiReconnectMode: state.api.apiReconnectMode,
    healthPollingEnabled: state.api.healthPollingEnabled,
    apiBaseUrl: state.api.apiBaseUrl,
    docsFormat: state.docs.docsFormat,
    outputDirectory: state.docs.outputDirectory,
    autoFileNameEnabled: state.docs.autoFileNameEnabled,
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
