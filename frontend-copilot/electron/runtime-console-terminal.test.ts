import { describe, expect, it, vi } from 'vitest'

import { shouldWriteRuntimeConsoleEntryToTerminal, writeRuntimeConsoleEntryToTerminal } from './runtime-console-terminal'
import type { RuntimeConsoleEntry } from './renderer-ipc-contract'

const SOURCE_ELECTRON = 'electron-main'

describe('runtime console terminal output', () => {
  it('keeps only warning and error runtime console entries on the terminal path', () => {
    const targetConsole = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    const infoEntry: RuntimeConsoleEntry = {
      source: SOURCE_ELECTRON,
      level: 'info',
      message: '[desktop-runtime] Hosted backend is ready.',
    }
    const debugEntry: RuntimeConsoleEntry = {
      source: SOURCE_ELECTRON,
      level: 'debug',
      message: '[startup] app:ready',
      context: {
        sinceMainMs: 9,
      },
    }
    const warnEntry: RuntimeConsoleEntry = {
      source: SOURCE_ELECTRON,
      level: 'warn',
      message: '[desktop-runtime] Ignoring invalid hosted runtime command-line arguments.',
      timestamp: '2026-03-28T09:40:52.123Z',
    }
    const errorEntry: RuntimeConsoleEntry = {
      source: SOURCE_ELECTRON,
      level: 'error',
      message: '[desktop-runtime] Hosted backend startup failed.',
      context: {
        code: 'startup_timeout',
      },
      timestamp: '2026-03-28T09:40:53.456Z',
    }

    expect(shouldWriteRuntimeConsoleEntryToTerminal(infoEntry)).toBe(false)
    expect(shouldWriteRuntimeConsoleEntryToTerminal(debugEntry)).toBe(false)
    expect(writeRuntimeConsoleEntryToTerminal(infoEntry, targetConsole)).toBe(false)
    expect(writeRuntimeConsoleEntryToTerminal(debugEntry, targetConsole)).toBe(false)
    expect(targetConsole.info).not.toHaveBeenCalled()
    expect(targetConsole.debug).not.toHaveBeenCalled()

    expect(shouldWriteRuntimeConsoleEntryToTerminal(warnEntry)).toBe(true)
    expect(shouldWriteRuntimeConsoleEntryToTerminal(errorEntry)).toBe(true)
    expect(writeRuntimeConsoleEntryToTerminal(warnEntry, targetConsole)).toBe(true)
    expect(writeRuntimeConsoleEntryToTerminal(errorEntry, targetConsole)).toBe(true)

    const warnOutput = targetConsole.warn.mock.calls[0]?.[0]
    const errorOutput = targetConsole.error.mock.calls[0]?.[0]

    expect(typeof warnOutput).toBe('string')
    expect(typeof errorOutput).toBe('string')
    expect(warnOutput).toContain('[desktop-runtime] Ignoring invalid hosted runtime command-line arguments.')
    expect(errorOutput).toContain('[desktop-runtime] Hosted backend startup failed. code=startup_timeout')
    expect(warnOutput).toContain('[desktop-runtime]')
    expect(errorOutput).toContain('[desktop-runtime]')
    expect(warnOutput).toContain('40:52.123')
    expect(errorOutput).toContain('40:53.456')
  })

  it('formats renderer warning entries into compact terminal output', () => {
    const targetConsole = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    expect(writeRuntimeConsoleEntryToTerminal({
      source: SOURCE_ELECTRON,
      level: 'warn',
      message: 'renderer-console',
      timestamp: '2026-03-28T09:40:54.789Z',
      context: {
        level: 'warning',
        line: 2,
        sourceId: 'node:electron/js2c/sandbox_bundle',
        message: '%cElectron Security Warning (Insecure Content-Security-Policy) font-weight: bold; This renderer process has either no Content Security\n  Policy set or a policy with "unsafe-eval" enabled.',
      },
    }, targetConsole)).toBe(true)

    const rendererWarnOutput = targetConsole.warn.mock.calls[0]?.[0]
    expect(typeof rendererWarnOutput).toBe('string')
    expect(rendererWarnOutput).toContain('40:54.789')
    expect(rendererWarnOutput).toContain('[renderer-console]')
    expect(rendererWarnOutput).toContain('WARNING')
    expect(rendererWarnOutput).toContain('Electron Security Warning (Insecure Content-Security-Policy)')
    expect(rendererWarnOutput).toContain('(node:electron/js2c/sandbox_bundle:2)')
  })
})
