import type {
  CopilotRendererSettingsLoadResult,
  CopilotRendererSettingsPatch,
  CopilotRendererSettingsSaveResult,
} from './types'

function getCopilotSettingsApi() {
  return window.copilotSettings
}

export async function loadCopilotSettings(): Promise<CopilotRendererSettingsLoadResult> {
  const api = getCopilotSettingsApi()

  if (!api) {
    return {
      ok: false,
      error: 'window.copilotSettings is unavailable in the renderer process.',
    }
  }

  return api.load()
}

export async function saveCopilotSettings(
  patch: CopilotRendererSettingsPatch,
): Promise<CopilotRendererSettingsSaveResult> {
  const api = getCopilotSettingsApi()

  if (!api) {
    return {
      ok: false,
      error: 'window.copilotSettings is unavailable in the renderer process.',
    }
  }

  return api.save(patch)
}
