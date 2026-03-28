import { describe, expect, it, vi } from 'vitest'

import { BOOTSTRAP_WINDOW_READY_CHANNEL } from './bootstrap-window'
import { CONFIG_CENTER_PUBLIC_PATCH_CHANNEL } from './config-center/public-patch'
import { CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL } from './config-center/public-snapshot'
import { COPILOT_RUNTIME_LOAD_CHANNEL, COPILOT_RUNTIME_RETRY_CHANNEL } from './copilot-runtime'
import { registerRendererIpcHandlers, type RendererIpcHandlers } from './renderer-ipc'

function createFakeIpcMain() {
  const registeredHandlers = new Map<string, (...args: unknown[]) => Promise<unknown> | unknown>()

  return {
    registeredHandlers,
    ipcMain: {
      removeHandler: vi.fn((channel: string) => {
        registeredHandlers.delete(channel)
      }),
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown> | unknown) => {
        registeredHandlers.set(channel, handler)
      }),
    },
  }
}

describe('registerRendererIpcHandlers', () => {
  it('registers only the config center public and runtime channels needed by the renderer', async () => {
    const { registeredHandlers, ipcMain } = createFakeIpcMain()
    const handlers: RendererIpcHandlers = {
      loadConfigCenterPublicSnapshot: vi.fn().mockResolvedValue({
        ok: true,
        snapshot: {
          version: 1,
          domains: {
            frontendPreferences: {
              theme: 'light',
            },
            assistantBehavior: {
              agentName: 'planner',
            },
            hostConfig: {
              runtimeUrl: 'http://127.0.0.1:4400',
            },
            backendExposed: {
              model: null,
            },
          },
        },
      }),
      applyConfigCenterPublicPatch: vi.fn().mockResolvedValue({
        ok: true,
        snapshot: {
          version: 1,
          domains: {
            frontendPreferences: {
              theme: 'dark',
            },
            assistantBehavior: {
              agentName: 'planner',
            },
            hostConfig: {
              runtimeUrl: 'http://127.0.0.1:4400',
            },
            backendExposed: {
              model: 'qwen-plus',
            },
          },
        },
      }),
      loadCopilotRuntime: vi.fn().mockResolvedValue({
        ok: true,
        snapshot: {
          hosted: {
            status: 'ready',
            expectedMode: 'development',
            resolvedMode: 'development',
            runtimeUrl: 'http://127.0.0.1:4400',
            isPackaged: false,
            failure: null,
          },
        },
      }),
      retryCopilotRuntime: vi.fn().mockResolvedValue({
        ok: true,
        snapshot: {
          hosted: {
            status: 'starting',
            expectedMode: 'development',
            resolvedMode: null,
            runtimeUrl: null,
            isPackaged: false,
            failure: null,
          },
        },
      }),
      notifyBootstrapWindowReady: vi.fn().mockResolvedValue(undefined),
    }

    registerRendererIpcHandlers(ipcMain as never, handlers)

    expect(ipcMain.removeHandler.mock.calls.map(([channel]) => channel)).toEqual([
      CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL,
      CONFIG_CENTER_PUBLIC_PATCH_CHANNEL,
      COPILOT_RUNTIME_LOAD_CHANNEL,
      COPILOT_RUNTIME_RETRY_CHANNEL,
      BOOTSTRAP_WINDOW_READY_CHANNEL,
    ])
    expect([...registeredHandlers.keys()]).toEqual([
      CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL,
      CONFIG_CENTER_PUBLIC_PATCH_CHANNEL,
      COPILOT_RUNTIME_LOAD_CHANNEL,
      COPILOT_RUNTIME_RETRY_CHANNEL,
      BOOTSTRAP_WINDOW_READY_CHANNEL,
    ])
    expect(registeredHandlers.has('copilot-settings:load')).toBe(false)
    expect(registeredHandlers.has('copilot-settings:save')).toBe(false)

    const loadSnapshotHandler = getRegisteredHandler(registeredHandlers, CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL)
    const applyPatchHandler = getRegisteredHandler(registeredHandlers, CONFIG_CENTER_PUBLIC_PATCH_CHANNEL)
    const loadRuntimeHandler = getRegisteredHandler(registeredHandlers, COPILOT_RUNTIME_LOAD_CHANNEL)
    const retryRuntimeHandler = getRegisteredHandler(registeredHandlers, COPILOT_RUNTIME_RETRY_CHANNEL)
    const notifyBootstrapWindowReadyHandler = getRegisteredHandler(registeredHandlers, BOOTSTRAP_WINDOW_READY_CHANNEL)

    await expect(loadSnapshotHandler()).resolves.toEqual(await handlers.loadConfigCenterPublicSnapshot())
    await expect(applyPatchHandler(undefined, {
      domains: {
        frontendPreferences: {
          theme: 'dark',
        },
      },
    })).resolves.toEqual(await handlers.applyConfigCenterPublicPatch({
      domains: {
        frontendPreferences: {
          theme: 'dark',
        },
      },
    }))
    await expect(loadRuntimeHandler()).resolves.toEqual(await handlers.loadCopilotRuntime())
    await expect(retryRuntimeHandler()).resolves.toEqual(await handlers.retryCopilotRuntime())
    await expect(notifyBootstrapWindowReadyHandler()).resolves.toBeUndefined()
    expect(handlers.notifyBootstrapWindowReady).toHaveBeenCalledOnce()
  })
})

function getRegisteredHandler(
  registeredHandlers: Map<string, (...args: unknown[]) => Promise<unknown> | unknown>,
  channel: string,
): (...args: unknown[]) => Promise<unknown> {
  const handler = registeredHandlers.get(channel)

  if (handler === undefined) {
    throw new Error(`Expected IPC handler for channel "${channel}".`)
  }

  return handler as (...args: unknown[]) => Promise<unknown>
}
