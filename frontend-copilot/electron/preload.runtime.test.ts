import { describe, expect, it } from 'vitest'

import { COPILOT_RUNTIME_LOAD_CHANNEL, COPILOT_RUNTIME_RETRY_CHANNEL, type CopilotRuntimeApi } from './copilot-runtime'
import {
  DESKTOP_RUNTIME_CALENDAR_EVENTS_LOAD_CHANNEL,
  DESKTOP_RUNTIME_WAKEUP_ICS_IMPORT_CHANNEL,
  type DesktopRuntimeApi,
} from './desktop-runtime'
import { getExposedApi, getInvokeMock, loadPreloadModule } from './preload.test-support'

describe('preload runtime bridge', () => {
  it('routes runtime bridge APIs through the expected IPC channels', async () => {
    const invokeMock = getInvokeMock()
    invokeMock.mockResolvedValue(undefined)

    await loadPreloadModule()

    const runtimeApi = getExposedApi<CopilotRuntimeApi>('copilotRuntime')
    const desktopRuntimeApi = getExposedApi<DesktopRuntimeApi>('desktopRuntime')

    await runtimeApi.load()
    await runtimeApi.retry()
    await desktopRuntimeApi.loadCalendarEvents()
    await desktopRuntimeApi.importWakeupIcs({ icsText: 'BEGIN:VCALENDAR' })

    expect(invokeMock.mock.calls).toEqual([
      [COPILOT_RUNTIME_LOAD_CHANNEL],
      [COPILOT_RUNTIME_RETRY_CHANNEL],
      [DESKTOP_RUNTIME_CALENDAR_EVENTS_LOAD_CHANNEL],
      [DESKTOP_RUNTIME_WAKEUP_ICS_IMPORT_CHANNEL, { icsText: 'BEGIN:VCALENDAR' }],
    ])
  })
})
