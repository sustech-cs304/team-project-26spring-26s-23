import { vi } from 'vitest'

type IpcHandler = (...args: unknown[]) => Promise<unknown> | unknown
type IpcListener = (...args: unknown[]) => void

export function createFakeIpcMain() {
  const registeredHandlers = new Map<string, IpcHandler>()

  return {
    registeredHandlers,
    ipcMain: {
      removeHandler: vi.fn((channel: string) => {
        registeredHandlers.delete(channel)
      }),
      handle: vi.fn((channel: string, handler: IpcHandler) => {
        registeredHandlers.set(channel, handler)
      }),
    },
  }
}

export function createFakeIpcRenderer() {
  const registeredListeners = new Map<string, IpcListener>()

  return {
    registeredListeners,
    ipcRenderer: {
      on: vi.fn((channel: string, listener: IpcListener) => {
        registeredListeners.set(channel, listener)
      }),
      off: vi.fn((channel: string, listener: IpcListener) => {
        if (registeredListeners.get(channel) === listener) {
          registeredListeners.delete(channel)
        }
      }),
    },
  }
}
