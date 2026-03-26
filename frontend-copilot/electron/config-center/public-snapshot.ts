import {
  UNIFIED_CONFIG_DOCUMENT_VERSION,
  UNIFIED_CONFIG_DOMAIN_KEYS,
  type UnifiedConfigSnapshot,
} from './schema'

export const CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL = 'config-center:load-public-snapshot'

export interface ConfigCenterPublicSnapshot {
  version: typeof UNIFIED_CONFIG_DOCUMENT_VERSION
  domains: {
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

export interface ConfigCenterPublicSnapshotApi {
  load: () => Promise<ConfigCenterPublicSnapshotLoadResult>
}

export function projectConfigCenterPublicSnapshot(
  snapshot: UnifiedConfigSnapshot,
): ConfigCenterPublicSnapshot {
  return {
    version: UNIFIED_CONFIG_DOCUMENT_VERSION,
    domains: {
      assistantBehavior: {
        agentName: snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR].values.agentName,
      },
      hostConfig: {
        runtimeUrl: snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG].values.runtimeUrl,
      },
    },
  }
}
