import {
  UNIFIED_CONFIG_DOCUMENT_VERSION,
  UNIFIED_CONFIG_DOMAIN_KEYS,
  type UnifiedConfigSnapshot,
} from './schema'

export const CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL = 'config-center:load-public-snapshot'
export const CONFIG_CENTER_PUBLIC_SNAPSHOT_UPDATED_CHANNEL = 'config-center:public-snapshot-updated'

export interface ConfigCenterPublicSnapshot {
  version: typeof UNIFIED_CONFIG_DOCUMENT_VERSION
  domains: {
    frontendPreferences: {
      theme: 'light' | 'dark'
    }
    assistantBehavior: {
      agentName: string | null
    }
    hostConfig: {
      runtimeUrl: string | null
    }
  }
}

export interface ConfigCenterPublicSnapshotLoadSuccess {
  ok: true
  snapshot: ConfigCenterPublicSnapshot
}

export interface ConfigCenterPublicSnapshotLoadFailure {
  ok: false
  error: string
}

export type ConfigCenterPublicSnapshotLoadResult =
  | ConfigCenterPublicSnapshotLoadSuccess
  | ConfigCenterPublicSnapshotLoadFailure

export type ConfigCenterPublicSnapshotListener = (snapshot: ConfigCenterPublicSnapshot) => void
export type ConfigCenterPublicSnapshotUnsubscribe = () => void

export interface ConfigCenterPublicSnapshotApi {
  load: () => Promise<ConfigCenterPublicSnapshotLoadResult>
}

export interface ConfigCenterPublicSnapshotSubscriptionApi {
  subscribe: (listener: ConfigCenterPublicSnapshotListener) => ConfigCenterPublicSnapshotUnsubscribe
}

export function projectConfigCenterPublicSnapshot(
  snapshot: UnifiedConfigSnapshot,
): ConfigCenterPublicSnapshot {
  return {
    version: UNIFIED_CONFIG_DOCUMENT_VERSION,
    domains: {
      frontendPreferences: {
        theme: snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES].values.theme,
      },
      assistantBehavior: {
        agentName: snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR].values.agentName,
      },
      hostConfig: {
        runtimeUrl: snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG].values.runtimeUrl,
      },
    },
  }
}
