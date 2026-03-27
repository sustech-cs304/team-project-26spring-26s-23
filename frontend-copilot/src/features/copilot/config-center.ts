import type {
  ConfigCenterPublicPatch,
  ConfigCenterPublicPatchResult,
} from '../../../electron/config-center/public-patch'
import type {
  ConfigCenterPublicSnapshot,
  ConfigCenterPublicSnapshotListener,
  ConfigCenterPublicSnapshotLoadResult,
  ConfigCenterPublicSnapshotSubscriptionApi,
  ConfigCenterPublicSnapshotUnsubscribe,
} from '../../../electron/config-center/public-snapshot'
import type { ThemeMode } from '../../workbench/types'

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

function getConfigCenterPublicSnapshotSubscriptionApi(): ConfigCenterPublicSnapshotSubscriptionApi | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  return window.configCenterPublicSnapshotSubscription
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

export function subscribeToConfigCenterPublicSnapshotUpdates(
  listener: ConfigCenterPublicSnapshotListener,
): ConfigCenterPublicSnapshotUnsubscribe {
  const api = getConfigCenterPublicSnapshotSubscriptionApi()

  if (!api) {
    return () => {}
  }

  return api.subscribe(listener)
}

export function projectThemeModeFromConfigCenterPublicSnapshot(
  snapshot: ConfigCenterPublicSnapshot,
): ThemeMode {
  return snapshot.domains.frontendPreferences.theme
}

export function projectAnimationsEnabledFromConfigCenterPublicSnapshot(
  snapshot: ConfigCenterPublicSnapshot,
): boolean {
  return snapshot.domains.frontendPreferences.animationsEnabled
}

