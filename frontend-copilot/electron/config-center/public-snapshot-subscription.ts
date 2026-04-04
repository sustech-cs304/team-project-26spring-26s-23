import { UNIFIED_CONFIG_DOCUMENT_VERSION } from './domain-schema'
import type {
  ConfigCenterPublicSnapshot,
  ConfigCenterPublicSnapshotSubscriptionApi,
} from './public-snapshot'
import { CONFIG_CENTER_PUBLIC_SNAPSHOT_UPDATED_CHANNEL } from './public-snapshot'

interface ConfigCenterPublicSnapshotSubscriptionEventSource {
  on: (channel: string, listener: (...args: unknown[]) => void) => void
  off: (channel: string, listener: (...args: unknown[]) => void) => void
}

export function createConfigCenterPublicSnapshotSubscriptionApi(
  eventSource: ConfigCenterPublicSnapshotSubscriptionEventSource,
): ConfigCenterPublicSnapshotSubscriptionApi {
  return {
    subscribe(listener) {
      const wrappedListener = (_event: unknown, snapshot: unknown) => {
        if (!isConfigCenterPublicSnapshot(snapshot)) {
          console.error(
            `[config-center] Ignored invalid public snapshot payload on "${CONFIG_CENTER_PUBLIC_SNAPSHOT_UPDATED_CHANNEL}".`,
            snapshot,
          )
          return
        }

        listener(snapshot)
      }

      eventSource.on(CONFIG_CENTER_PUBLIC_SNAPSHOT_UPDATED_CHANNEL, wrappedListener)

      return () => {
        eventSource.off(CONFIG_CENTER_PUBLIC_SNAPSHOT_UPDATED_CHANNEL, wrappedListener)
      }
    },
  }
}

function isConfigCenterPublicSnapshot(value: unknown): value is ConfigCenterPublicSnapshot {
  if (!isPlainRecord(value) || value.version !== UNIFIED_CONFIG_DOCUMENT_VERSION) {
    return false
  }

  const domains = value.domains
  if (!isPlainRecord(domains)) {
    return false
  }

  const frontendPreferences = domains.frontendPreferences
  const assistantBehavior = domains.assistantBehavior
  const hostConfig = domains.hostConfig
  const backendExposed = domains.backendExposed

  return isPlainRecord(frontendPreferences)
    && (frontendPreferences.theme === 'light' || frontendPreferences.theme === 'dark')
    && typeof frontendPreferences.animationsEnabled === 'boolean'
    && isPlainRecord(assistantBehavior)
    && isNullableString(assistantBehavior.agentName)
    && (assistantBehavior.debugModeEnabled === undefined || typeof assistantBehavior.debugModeEnabled === 'boolean')
    && isPlainRecord(hostConfig)
    && isNullableString(hostConfig.runtimeUrl)
    && isPlainRecord(backendExposed)
    && isNullableString(backendExposed.model)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}
