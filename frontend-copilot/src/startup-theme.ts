import {
  loadConfigCenterPublicSnapshot,
  projectThemeModeFromConfigCenterPublicSnapshot,
} from './features/copilot/config-center'
import type { ThemeMode } from './workbench/types'

export function applyStartupThemeMode(themeMode: ThemeMode) {
  if (typeof document === 'undefined') {
    return
  }

  document.documentElement.dataset.theme = themeMode
}

export function resolveSystemThemeMode(): ThemeMode {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return 'light'
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export async function primeStartupTheme(
  loadSnapshot: typeof loadConfigCenterPublicSnapshot = loadConfigCenterPublicSnapshot,
): Promise<ThemeMode> {
  const fallbackThemeMode = resolveSystemThemeMode()
  applyStartupThemeMode(fallbackThemeMode)

  try {
    const result = await loadSnapshot()
    if (!result.ok) {
      return fallbackThemeMode
    }

    const nextThemeMode = projectThemeModeFromConfigCenterPublicSnapshot(result.snapshot)
    applyStartupThemeMode(nextThemeMode)
    return nextThemeMode
  } catch {
    return fallbackThemeMode
  }
}
