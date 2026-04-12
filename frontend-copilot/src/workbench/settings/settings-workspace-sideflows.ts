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
  handleWakeupLinkParse: () => Promise<void>
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
    handleWakeupLinkParse: async () => {
      const parseStatus = await resolveWakeupShareLinkParseStatus(wakeupShareLink)
      setWakeupDialogState(parseStatus === 'success' ? { status: 'success' } : { status: 'failure' })
    },
    handleWakeupDialogClose: () => {
      setWakeupDialogState(null)
    },
    handleWakeupConflictChoice: () => {
      setWakeupDialogState(null)
    },
  }
}

export async function resolveWakeupShareLinkParseStatus(value: string): Promise<'success' | 'failure'> {
  const normalizedValue = value.trim()

  if (!normalizedValue) {
    return 'failure'
  }

  return normalizedValue.includes('success') || normalizedValue.includes('wakeup') ? 'success' : 'failure'
}
