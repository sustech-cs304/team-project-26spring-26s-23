import { useEffect, useState } from 'react'

import type { WakeupDialogState } from './ExternalSourcesSection'
import {
  clearSettingsWorkspaceSustechCasPassword,
  saveSettingsWorkspaceSustechCasPassword,
} from './workspace-state'

interface UseSettingsWorkspaceSideflowsArgs {
  hydratedCasPasswordValue: string
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
      const result = await resolveWakeupIcsImportResult(value ?? wakeupShareLink)
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
): Promise<{ ok: true; parsed: number } | { ok: false; error: string }> {
  const normalizedValue = value.trim()

  if (!normalizedValue) {
    return { ok: false, error: '未选择 .ics 文件' }
  }

  if (!normalizedValue.startsWith('BEGIN:VCALENDAR')) {
    return { ok: false, error: '不是有效的 .ics 内容' }
  }

  try {
    const desktopRuntime = window.desktopRuntime
    if (!desktopRuntime || typeof desktopRuntime.importWakeupIcs !== 'function') {
      return { ok: false, error: '桌面运行时 IPC 不可用' }
    }

    const data = await desktopRuntime.importWakeupIcs({ icsText: normalizedValue })
    if (data.ok !== true) {
      return { ok: false, error: (typeof data.error === 'string' ? data.error : '导入失败') }
    }
    const parsed = typeof data.parsed === 'number' ? data.parsed : 0
    if (parsed <= 0) {
      return { ok: false, error: '未解析到任何事件' }
    }
    return { ok: true, parsed }
  } catch (error: unknown) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
