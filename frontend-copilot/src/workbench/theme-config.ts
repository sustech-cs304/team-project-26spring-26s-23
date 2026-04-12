import {
  applyConfigCenterPublicPatch,
  loadConfigCenterPublicSnapshot,
  projectThemeModeFromConfigCenterPublicSnapshot,
  subscribeToConfigCenterPublicSnapshotUpdates,
} from '../features/copilot/config-center'
import type { ThemeMode } from './types'

export type ThemeModePreferenceLoadResult =
  | { ok: true; themeMode: ThemeMode }
  | { ok: false; error: string }

export type ThemeModePreferenceSaveResult =
  | { ok: true; themeMode: ThemeMode }
  | { ok: false; error: string; revertedThemeMode: ThemeMode }

export async function loadThemeModePreference(): Promise<ThemeModePreferenceLoadResult> {
  const result = await loadConfigCenterPublicSnapshot()

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
    }
  }

  return {
    ok: true,
    themeMode: projectThemeModeFromConfigCenterPublicSnapshot(result.snapshot),
  }
}

export async function persistThemeModePreference(input: {
  previousThemeMode: ThemeMode
  themeMode: ThemeMode
  applyThemeMode: (themeMode: ThemeMode) => void
}): Promise<ThemeModePreferenceSaveResult> {
  input.applyThemeMode(input.themeMode)

  const result = await applyConfigCenterPublicPatch({
    domains: {
      frontendPreferences: {
        theme: input.themeMode,
      },
    },
  })

  if (!result.ok) {
    input.applyThemeMode(input.previousThemeMode)
    return {
      ok: false,
      error: result.error,
      revertedThemeMode: input.previousThemeMode,
    }
  }

  const nextThemeMode = projectThemeModeFromConfigCenterPublicSnapshot(result.snapshot)
  input.applyThemeMode(nextThemeMode)

  return {
    ok: true,
    themeMode: nextThemeMode,
  }
}

export function subscribeToThemeModePreferenceUpdates(
  listener: (themeMode: ThemeMode) => void,
) {
  return subscribeToConfigCenterPublicSnapshotUpdates((snapshot) => {
    listener(projectThemeModeFromConfigCenterPublicSnapshot(snapshot))
  })
}
