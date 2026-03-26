import type {
  ConfigCenterPublicSnapshot,
  ConfigCenterPublicSnapshotLoadResult,
} from '../../../electron/config-center/public-snapshot'
import type { CopilotRendererSettings } from './types'

function getConfigCenterPublicSnapshotApi() {
  if (typeof window === 'undefined') {
    return undefined
  }

  return window.configCenterPublicSnapshot
}

export async function loadConfigCenterPublicSnapshot(): Promise<ConfigCenterPublicSnapshotLoadResult> {
  const api = getConfigCenterPublicSnapshotApi()

  if (!api) {
    return {
      ok: false,
      error: 'window.configCenterPublicSnapshot is unavailable in the renderer process.',
    }
  }

  return api.load()
}

export function projectCopilotSettingsFromConfigCenterPublicSnapshot(
  snapshot: ConfigCenterPublicSnapshot,
): CopilotRendererSettings {
  return {
    runtimeUrl: snapshot.domains.hostConfig.runtimeUrl,
    agentName: snapshot.domains.assistantBehavior.agentName,
  }
}
