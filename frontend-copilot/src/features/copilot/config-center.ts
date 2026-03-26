import type {
  ConfigCenterPublicPatch,
  ConfigCenterPublicPatchResult,
} from '../../../electron/config-center/public-patch'
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

function getConfigCenterPublicPatchApi() {
  if (typeof window === 'undefined') {
    return undefined
  }

  return window.configCenterPublicPatch
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

export async function applyConfigCenterPublicPatch(
  patch: ConfigCenterPublicPatch,
): Promise<ConfigCenterPublicPatchResult> {
  const api = getConfigCenterPublicPatchApi()

  if (!api) {
    return {
      ok: false,
      error: 'window.configCenterPublicPatch is unavailable in the renderer process.',
    }
  }

  return api.apply(patch)
}

export function projectCopilotSettingsFromConfigCenterPublicSnapshot(
  snapshot: ConfigCenterPublicSnapshot,
): CopilotRendererSettings {
  return {
    runtimeUrl: snapshot.domains.hostConfig.runtimeUrl,
    agentName: snapshot.domains.assistantBehavior.agentName,
  }
}
