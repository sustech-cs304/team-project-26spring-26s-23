import { describe, expect, it, vi } from 'vitest'

import { shouldWriteRuntimeConsoleEntryToTerminal, writeRuntimeConsoleEntryToTerminal } from './runtime-console-terminal'
import type { RuntimeConsoleEntry } from './renderer-ipc-contract'

describe('runtime console terminal output', () => {
  it('keeps only warning and error runtime console entries on the terminal path', () => {
    const targetConsole = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    const infoEntry: RuntimeConsoleEntry = {
      source: 'electron-main',
      level: 'info',
      message: '[desktop-runtime] Hosted backend is ready.',
    }
    const debugEntry: RuntimeConsoleEntry = {
      source: 'electron-main',
      level: 'debug',
      message: '[startup] app:ready',
      context: {
        sinceMainMs: 9,
      },
    }
    const warnEntry: RuntimeConsoleEntry = {
      source: 'electron-main',
      level: 'warn',
      message: '[desktop-runtime] Ignoring invalid hosted runtime command-line arguments.',
      timestamp: '2026-03-28T09:40:52.123Z',
    }
    const errorEntry: RuntimeConsoleEntry = {
      source: 'electron-main',
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
    expect(targetConsole.warn).toHaveBeenCalledWith(expect.stringMatching(/\u001B\[90m\d{2}:40:52\.123\u001B\[0m .*\u001B\[36m\[desktop-runtime\]\u001B\[0m \[desktop-runtime\] Ignoring invalid hosted runtime command-line arguments\.$/))
    expect(targetConsole.error).toHaveBeenCalledWith(expect.stringMatching(/\u001B\[90m\d{2}:40:53\.456\u001B\[0m .*\u001B\[36m\[desktop-runtime\]\u001B\[0m \[desktop-runtime\] Hosted backend startup failed\. code=startup_timeout$/))
  })

  it('formats renderer warning entries into compact terminal output', () => {
    const targetConsole = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    expect(writeRuntimeConsoleEntryToTerminal({
      source: 'electron-main',
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

    expect(targetConsole.warn).toHaveBeenCalledWith(expect.stringMatching(/\u001B\[90m\d{2}:40:54\.789\u001B\[0m .*\u001B\[36m\[renderer-console\]\u001B\[0m \u001B\[33mWARNING\u001B\[0m Electron Security Warning \(Insecure Content-Security-Policy\).*\u001B\[90m\(node:electron\/js2c\/sandbox_bundle:2\)\u001B\[0m$/))
  })
})
