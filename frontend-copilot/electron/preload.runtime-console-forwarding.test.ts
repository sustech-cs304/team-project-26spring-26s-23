import { describe, expect, it, vi } from 'vitest'

import { getRegisteredOnListener, loadPreloadModule } from './preload.test-support'
import { MAIN_PROCESS_RUNTIME_CONSOLE_CHANNEL, type RuntimeConsoleEntry } from './renderer-ipc-contract'

describe('preload runtime console forwarding bridge', () => {
  it('registers main-process runtime console forwarding and writes forwarded entries to the browser console', async () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    try {
      await loadPreloadModule()

      const runtimeConsoleListener = getRegisteredOnListener<
        (event: unknown, payload: RuntimeConsoleEntry) => void
      >(MAIN_PROCESS_RUNTIME_CONSOLE_CHANNEL)

      runtimeConsoleListener(undefined, {
        source: 'electron-main',
        level: 'debug',
        message: '[startup] app:ready',
        context: {
          sinceMainMs: 12,
        },
      })
      runtimeConsoleListener(undefined, {
        source: 'electron-main',
        level: 'warn',
        message: '[desktop-runtime] Ignoring invalid hosted runtime command-line arguments.',
      })

      expect(debugSpy).toHaveBeenCalledWith('[electron-main]', '[startup] app:ready', {
        sinceMainMs: 12,
      })
      expect(warnSpy).toHaveBeenCalledWith(
        '[electron-main]',
        '[desktop-runtime] Ignoring invalid hosted runtime command-line arguments.',
      )
    } finally {
      debugSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })
})
