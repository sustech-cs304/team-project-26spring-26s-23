import { describe, expect, it, vi } from 'vitest'

import { BOOTSTRAP_WINDOW_READY_CHANNEL } from './bootstrap-window'
import { CONFIG_CENTER_PUBLIC_PATCH_CHANNEL } from './config-center/public-patch'
import { CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL } from './config-center/public-snapshot'
import { COPILOT_RUNTIME_LOAD_CHANNEL, COPILOT_RUNTIME_RETRY_CHANNEL } from './copilot-runtime'
import {
  MAIN_PROCESS_RUNTIME_CONSOLE_CHANNEL,
  registerRendererIpcHandlers,
  registerRuntimeConsoleForwarding,
  shouldWriteRuntimeConsoleEntryToTerminal,
  writeRuntimeConsoleEntryToTerminal,
  type RendererIpcHandlers,
  type RuntimeConsoleEntry,
} from './renderer-ipc'

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

function createFakeIpcRenderer() {
  const registeredListeners = new Map<string, (...args: unknown[]) => void>()

  return {
    registeredListeners,
    ipcRenderer: {
      on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        registeredListeners.set(channel, listener)
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
      loadSettingsWorkspaceState: vi.fn().mockResolvedValue({
        ok: true,
        source: 'stored',
        state: {
          providerProfiles: [],
          defaultModelRouting: {
            primaryAssistantModel: '',
            fastAssistantModel: '',
          },
          general: {
            language: 'zh-CN',
            proxyMode: 'system',
            assistantNotificationsEnabled: false,
            backupEnabled: true,
          },
          data: {
            dataPath: 'D:/workspace/copilot-data',
            backupCycle: 'daily',
            launchSyncEnabled: true,
          },
          mcp: {
            mcpAutoDiscoveryEnabled: true,
            toolPermissionMode: 'manual',
          },
          search: {
            searchEngine: 'google',
            searchResultCount: '8',
            compressionMode: 'summary',
          },
          memory: {
            memoryStrategy: 'session-longterm',
            memoryCleanupEnabled: true,
          },
          api: {
            apiReconnectMode: 'exponential',
            healthPollingEnabled: true,
            apiBaseUrl: 'http://127.0.0.1:8000',
          },
          docs: {
            docsFormat: 'markdown',
            outputDirectory: 'D:/workspace/exports',
            autoFileNameEnabled: true,
          },
        },
      }),
      saveSettingsWorkspaceState: vi.fn().mockResolvedValue({
        ok: true,
        state: {
          providerProfiles: [],
          defaultModelRouting: {
            primaryAssistantModel: '',
            fastAssistantModel: '',
          },
          general: {
            language: 'zh-CN',
            proxyMode: 'system',
            assistantNotificationsEnabled: false,
            backupEnabled: true,
          },
          data: {
            dataPath: 'D:/workspace/copilot-data',
            backupCycle: 'daily',
            launchSyncEnabled: true,
          },
          mcp: {
            mcpAutoDiscoveryEnabled: true,
            toolPermissionMode: 'manual',
          },
          search: {
            searchEngine: 'google',
            searchResultCount: '8',
            compressionMode: 'summary',
          },
          memory: {
            memoryStrategy: 'session-longterm',
            memoryCleanupEnabled: true,
          },
          api: {
            apiReconnectMode: 'exponential',
            healthPollingEnabled: true,
            apiBaseUrl: 'http://127.0.0.1:8000',
          },
          docs: {
            docsFormat: 'markdown',
            outputDirectory: 'D:/workspace/exports',
            autoFileNameEnabled: true,
          },
        },
      }),
      loadSettingsWorkspaceSecretStates: vi.fn().mockResolvedValue({
        ok: true,
        states: {},
      }),
      saveSettingsWorkspaceProviderSecret: vi.fn().mockResolvedValue({
        ok: true,
        providerId: 'openrouter',
        state: {
          hasApiKey: true,
        },
      }),
      clearSettingsWorkspaceProviderSecret: vi.fn().mockResolvedValue({
        ok: true,
        providerId: 'openrouter',
        state: {
          hasApiKey: false,
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
      'settings-workspace-state:load',
      'settings-workspace-state:save',
      'settings-workspace-secrets:load-statuses',
      'settings-workspace-secrets:save-provider-api-key',
      'settings-workspace-secrets:clear-provider-api-key',
      COPILOT_RUNTIME_LOAD_CHANNEL,
      COPILOT_RUNTIME_RETRY_CHANNEL,
      BOOTSTRAP_WINDOW_READY_CHANNEL,
    ])
    expect([...registeredHandlers.keys()]).toEqual([
      CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL,
      CONFIG_CENTER_PUBLIC_PATCH_CHANNEL,
      'settings-workspace-state:load',
      'settings-workspace-state:save',
      'settings-workspace-secrets:load-statuses',
      'settings-workspace-secrets:save-provider-api-key',
      'settings-workspace-secrets:clear-provider-api-key',
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
