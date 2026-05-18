import type { ModelRouteRef } from '../types'

import { parseSerializedModelRouteRef } from './settings-workspace-model-options'
import {
  projectStoredProviderProfile,
  type SettingsWorkspaceStateSaveInput,
  type SettingsWorkspaceStoredProviderProfile,
} from '../../../electron/settings-workspace/schema'
import type { SettingsWorkspaceFormState } from './settings-workspace-form-state'

export function createSettingsWorkspaceStateSaveInput(
  state: SettingsWorkspaceFormState,
): SettingsWorkspaceStateSaveInput {
  const providerProfiles = state.providerProfiles.map((profile) => projectStoredProviderProfile(profile))

  return {
    sustech: {
      studentId: state.studentId,
      email: state.sustechEmail,
      blackboardAutoDownloadEnabled: state.blackboardAutoDownloadEnabled,
      blackboardDownloadLimitMb: state.blackboardDownloadLimitMb,
    },
    providerProfiles,
    defaultModelRouting: {
      primaryAssistantModel: resolveStoredDefaultModelRoute({
        selectedModelId: state.primaryAssistantModel,
        persistedRoute: state.primaryAssistantModelRoute ?? null,
        providerProfiles,
      }),
      fastAssistantModel: resolveStoredDefaultModelRoute({
        selectedModelId: state.fastAssistantModel,
        persistedRoute: state.fastAssistantModelRoute ?? null,
        providerProfiles,
      }),
    },
    general: {
      language: state.language,
      proxyMode: state.proxyMode,
      assistantNotificationsEnabled: state.assistantNotificationsEnabled,
      backupEnabled: state.backupEnabled,
    },
    data: {
      dataPath: state.dataPath,
      backupCycle: state.backupCycle,
      launchSyncEnabled: state.launchSyncEnabled,
    },
    mcp: {
      mcpAutoDiscoveryEnabled: state.mcpAutoDiscoveryEnabled,
      toolPermissionMode: state.toolPermissionMode,
      toolPermissionPolicy: state.toolPermissionPolicy,
    },
    search: {
      searchEngine: state.searchEngine,
      searchResultCount: state.searchResultCount,
      compressionMode: state.compressionMode,
    },
    memory: {
      memoryStrategy: state.memoryStrategy,
      memoryCleanupEnabled: state.memoryCleanupEnabled,
    },
    api: {
      apiReconnectMode: state.apiReconnectMode,
      healthPollingEnabled: state.healthPollingEnabled,
      apiBaseUrl: state.apiBaseUrl,
    },
    docs: {
      docsFormat: state.docsFormat,
      outputDirectory: state.outputDirectory,
      autoFileNameEnabled: state.autoFileNameEnabled,
    },
    externalSource: {
      wakeupShareLink: state.wakeupShareLink,
    },
  }
}

function resolveStoredDefaultModelRoute(input: {
  selectedModelId: string
  persistedRoute: ModelRouteRef | null
  providerProfiles: SettingsWorkspaceStoredProviderProfile[]
}): ModelRouteRef | null {
  const normalizedSelectedModelId = input.selectedModelId.trim()

  if (normalizedSelectedModelId === '') {
    return null
  }

  const parsedRoute = parseSerializedModelRouteRef(normalizedSelectedModelId)
  if (parsedRoute !== null) {
    const normalizedParsedRoute: ModelRouteRef = {
      routeKind: parsedRoute.routeKind,
      profileId: parsedRoute.profileId,
      modelId: parsedRoute.modelId,
    }

    return providerProfilesSupportRoute(input.providerProfiles, normalizedParsedRoute)
      ? normalizedParsedRoute
      : null
  }

  if (
    input.persistedRoute !== null
    && input.persistedRoute.modelId === normalizedSelectedModelId
    && providerProfilesSupportRoute(input.providerProfiles, input.persistedRoute)
  ) {
    return cloneModelRouteRef(input.persistedRoute)
  }

  return null
}

function providerProfilesSupportRoute(
  providerProfiles: SettingsWorkspaceStoredProviderProfile[],
  route: ModelRouteRef,
): boolean {
  const profile = providerProfiles.find((candidate) => candidate.profileId === route.profileId)
  return profile !== undefined && profileSupportsModel(profile, route.modelId)
}

function profileSupportsModel(
  profile: SettingsWorkspaceStoredProviderProfile,
  modelId: string,
): boolean {
  return profile.models.some((model) => model.modelId === modelId)
}

function cloneModelRouteRef(route: ModelRouteRef): ModelRouteRef {
  return {
    routeKind: route.routeKind,
    profileId: route.profileId,
    modelId: route.modelId,
  }
}
