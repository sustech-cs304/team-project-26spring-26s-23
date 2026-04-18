import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  isCopilotStartupTraceEnabled,
  logCopilotRootStartupTrace,
} from './startup-tracing'

describe('startup-tracing', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('disables startup tracing outside development by default', () => {
    expect(isCopilotStartupTraceEnabled({
      isDevelopment: false,
      localStorage: null,
    })).toBe(false)
  })

  it('allows explicit opt-in outside development', () => {
    expect(isCopilotStartupTraceEnabled({
      isDevelopment: false,
      localStorage: {
        getItem: (key) => key === 'candue:debug:startup-trace' ? '1' : null,
      },
    })).toBe(true)
  })

  it('skips logging when startup tracing is disabled', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    logCopilotRootStartupTrace(
      'visible-stage',
      {
        runtimeUrl: 'http://secret.example',
        agentName: 'planner',
      },
      {
        isDevelopment: false,
        localStorage: null,
      },
    )

    expect(infoSpy).not.toHaveBeenCalled()
  })

  it('logs when startup tracing is explicitly enabled', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    logCopilotRootStartupTrace(
      'visible-stage',
      {
        runtimeUrl: 'http://visible.example',
        agentName: 'planner',
      },
      {
        isDevelopment: false,
        localStorage: {
          getItem: () => '1',
        },
      },
    )

    expect(infoSpy).toHaveBeenCalledTimes(1)
    expect(infoSpy.mock.calls[0]?.[0]).toBe('[startup]')
    expect(infoSpy.mock.calls[0]?.[1]).toContain('"stage":"visible-stage"')
    expect(infoSpy.mock.calls[0]?.[1]).toContain('"runtimeUrl":"http://visible.example"')
    expect(infoSpy.mock.calls[0]?.[1]).toContain('"agentName":"planner"')
  })
})
