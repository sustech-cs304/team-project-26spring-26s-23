import { describe, expect, it, vi } from 'vitest'

import { MAIN_PROCESS_RUNTIME_CONSOLE_CHANNEL, type RuntimeConsoleEntry } from './renderer-ipc-contract'
import { createFakeIpcRenderer } from './renderer-ipc-transport.test-support'
import { registerRuntimeConsoleForwarding } from './runtime-console-forwarding'

describe('registerRuntimeConsoleForwarding', () => {
  it('registers runtime console forwarding for browser-side debug output', () => {
    const { registeredListeners, ipcRenderer } = createFakeIpcRenderer()
    const targetConsole = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }

    registerRuntimeConsoleForwarding(ipcRenderer as never, targetConsole)

    expect(ipcRenderer.on).toHaveBeenCalledWith(MAIN_PROCESS_RUNTIME_CONSOLE_CHANNEL, expect.any(Function))

    const listener = registeredListeners.get(MAIN_PROCESS_RUNTIME_CONSOLE_CHANNEL)
    listener?.(undefined, {
      source: 'electron-main',
      level: 'debug',
      message: '[startup] webContents:dom-ready',
      context: {
        sinceWindowMs: 18,
      },
    } satisfies RuntimeConsoleEntry)

    expect(targetConsole.debug).toHaveBeenCalledWith('[electron-main]', '[startup] webContents:dom-ready', {
      sinceWindowMs: 18,
    })
  })
})
