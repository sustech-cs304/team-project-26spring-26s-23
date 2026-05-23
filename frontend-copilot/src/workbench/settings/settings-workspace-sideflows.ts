import { useEffect, useState } from 'react'

import { getExternalSourcesCopy } from '../locale'
import type { WakeupDialogState } from './ExternalSourcesSection'
import { normalizeWakeupIcsText } from './wakeup-ics-text'
import {
  clearSettingsWorkspaceSustechCasPassword,
  saveSettingsWorkspaceSustechCasPassword,
} from './workspace-state'

interface UseSettingsWorkspaceSideflowsArgs {
  hydratedCasPasswordValue: string
  language: string
  wakeupShareLink: string
}

interface UseSettingsWorkspaceSideflowsResult {
  casPasswordDraft: string
  casPasswordFeedback: string | null
  setCasPasswordDraft: (value: string) => void
  persistCasPasswordDraft: () => Promise<void>
  wakeupDialogState: WakeupDialogState
  handleWakeupLinkParse: (value?: string) => Promise<void>
  handleWakeupDialogClose: () => void
  handleWakeupConflictChoice: () => void
}

export function useSettingsWorkspaceSideflows({
  hydratedCasPasswordValue,
  language,
  wakeupShareLink,
}: UseSettingsWorkspaceSideflowsArgs): UseSettingsWorkspaceSideflowsResult {
  const [casPasswordDraft, setCasPasswordDraft] = useState('')
  const [casPasswordSavedValue, setCasPasswordSavedValue] = useState('')
  const [casPasswordFeedback, setCasPasswordFeedback] = useState<string | null>(null)
  const [wakeupDialogState, setWakeupDialogState] = useState<WakeupDialogState>(null)

  useEffect(() => {
    setCasPasswordDraft(hydratedCasPasswordValue)
    setCasPasswordSavedValue(hydratedCasPasswordValue)
  }, [hydratedCasPasswordValue])

  useEffect(() => {
    if (!casPasswordFeedback) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setCasPasswordFeedback(null)
    }, 2000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [casPasswordFeedback])

  return {
    casPasswordDraft,
    casPasswordFeedback,
    setCasPasswordDraft,
    persistCasPasswordDraft: async () => {
      const normalizedDraft = casPasswordDraft.trim()

      if (normalizedDraft === casPasswordSavedValue) {
        return
      }

      if (!normalizedDraft) {
        const result = await clearSettingsWorkspaceSustechCasPassword()

        if (!result.ok) {
          setCasPasswordFeedback('保存失败，请稍后重试')
          return
        }

        setCasPasswordDraft('')
        setCasPasswordSavedValue('')
        setCasPasswordFeedback('已清除 CAS 密码')
        return
      }

      const result = await saveSettingsWorkspaceSustechCasPassword({
        password: normalizedDraft,
      })

      if (!result.ok) {
        setCasPasswordFeedback('保存失败，请稍后重试')
        return
      }

      setCasPasswordDraft(result.state.password)
      setCasPasswordSavedValue(result.state.password)
      setCasPasswordFeedback('已自动保存 CAS 密码')
    },
    wakeupDialogState,
    handleWakeupLinkParse: async (value?: string) => {
      const result = await resolveWakeupIcsImportResult(value ?? wakeupShareLink, language)
      if (!result.ok) {
        setWakeupDialogState({ status: 'failure', error: result.error })
        return
      }
      setWakeupDialogState({ status: 'success', parsed: result.parsed })
      window.dispatchEvent(new Event('candue:calendar-refresh'))
    },
    handleWakeupDialogClose: () => {
      setWakeupDialogState(null)
    },
    handleWakeupConflictChoice: () => {
      setWakeupDialogState(null)
    },
  }
}

export async function resolveWakeupIcsImportResult(
  value: string,
  language = 'zh-CN',
): Promise<{ ok: true; parsed: number } | { ok: false; error: string }> {
  const copy = getExternalSourcesCopy(language)
  const normalizedValue = normalizeWakeupIcsText(value)

  if (!normalizedValue) {
    return { ok: false, error: copy.missingIcsError }
  }

  if (!normalizedValue.startsWith('BEGIN:VCALENDAR')) {
    return { ok: false, error: copy.invalidIcsError }
  }

  try {
    const desktopRuntime = window.desktopRuntime
    if (!desktopRuntime || typeof desktopRuntime.importWakeupIcs !== 'function') {
      return { ok: false, error: copy.desktopRuntimeUnavailableError }
    }

    const data = await desktopRuntime.importWakeupIcs({ icsText: normalizedValue })
    if (data.ok !== true) {
      return { ok: false, error: (typeof data.error === 'string' ? data.error : copy.importFailedFallbackError) }
    }
    const parsed = typeof data.parsed === 'number' ? data.parsed : 0
    if (parsed <= 0) {
      return { ok: false, error: copy.emptyParsedEventsError }
    }
    return { ok: true, parsed }
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
