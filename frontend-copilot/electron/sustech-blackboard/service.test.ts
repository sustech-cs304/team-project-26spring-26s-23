import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SettingsWorkspaceStateSaveInput } from '../settings-workspace/state-schema'
import {
  SUSTECH_BLACKBOARD_GET_STATUS_CHANNEL,
  SUSTECH_BLACKBOARD_TRIGGER_SYNC_CHANNEL,
  SUSTECH_BLACKBOARD_UPDATE_SETTINGS_CHANNEL,
} from './ipc'
import { createElectronSustechBlackboardService } from './service'

function createSettingsState(
  overrides: Partial<SettingsWorkspaceStateSaveInput['sustech']> = {},
): SettingsWorkspaceStateSaveInput {
  return {
    sustech: {
      studentId: '',
      email: '',
      blackboardCurrentTermOnly: false,
      blackboardParallelSyncWorkers: '1',
      blackboardSyncInterval: 'off',
      blackboardLastAutoSyncAt: null,
      blackboardNextAutoSyncAt: null,
      ...overrides,
    },
    providerProfiles: [],
    defaultModelRouting: {
      primaryAssistantModel: null,
      fastAssistantModel: null,
    },
    general: {
      language: 'zh-CN',
      assistantNotificationsEnabled: false,
    },
    mcp: {
      mcpAutoDiscoveryEnabled: true,
      toolPermissionMode: 'manual',
      toolPermissionPolicy: {
        version: 1,
        defaultMode: 'ask',
        toolPermissions: {},
      },
    },
    api: {
      apiReconnectMode: 'exponential',
      healthPollingEnabled: true,
      apiBaseUrl: 'http://127.0.0.1:8000',
    },
    docs: {
      docsFormat: 'markdown',
    },
    externalSource: {
      wakeupShareLink: '',
    },
  }
}

function createIpcMainStub() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handle(channel: string, listener: (...args: unknown[]) => unknown) {
      handlers.set(channel, listener)
    },
    removeHandler(channel: string) {
      handlers.delete(channel)
    },
    invoke(channel: string, ...args: unknown[]) {
      const handler = handlers.get(channel)
      if (handler === undefined) {
        throw new Error(`No handler registered for ${channel}`)
      }
      return handler(...args)
    },
  }
}

async function waitForCondition(check: () => boolean, attempts = 20) {
  for (let index = 0; index < attempts; index += 1) {
    if (check()) {
      return
    }
    await Promise.resolve()
  }
  throw new Error('Condition was not met within the allotted attempts.')
}

describe('createElectronSustechBlackboardService', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns trigger IPC result immediately while background polling continues', async () => {
    vi.useFakeTimers()

    const settings = createSettingsState()
    const loadSettings = vi.fn(async () => settings)
    const saveSettings = vi.fn(async () => {})
    const ipcMain = createIpcMainStub()

    const fetchMock = vi.fn<typeof fetch>()
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, status: 'running' }),
      } as Response)
      .mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/api/blackboard/sync/status')) {
          return {
            ok: true,
            json: async () => ({ status: 'running', progressStage: 'fetching_courses', progressMessage: '同步中' }),
          } as Response
        }
        throw new Error(`unexpected fetch ${url}`)
      })
    vi.stubGlobal('fetch', fetchMock)

    const service = createElectronSustechBlackboardService({
      getRuntimeBaseUrl: () => 'http://127.0.0.1:8000',
      getLiveWindows: () => [],
      loadSettings,
      saveSettings,
    })
    service.registerIpcHandlers(ipcMain)

    const resultPromise = ipcMain.invoke(SUSTECH_BLACKBOARD_TRIGGER_SYNC_CHANNEL)
    await vi.runAllTicks()
    const result = await resultPromise

    expect(result.ok).toBe(true)
    expect(result.state.status).toBe('running')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    service.dispose()
  })

  it('clears stale lastSyncError when a new sync starts running', async () => {
    vi.useFakeTimers()

    const settings = createSettingsState()
    const ipcMain = createIpcMainStub()
    const fetchMock = vi.fn<typeof fetch>()
    fetchMock
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'boom' }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true, status: 'running' }) } as Response)
      .mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('/api/blackboard/sync/status')) {
          return {
            ok: true,
            json: async () => ({ status: 'running' }),
          } as Response
        }
        throw new Error(`unexpected fetch ${url}`)
      })
    vi.stubGlobal('fetch', fetchMock)

    const service = createElectronSustechBlackboardService({
      getRuntimeBaseUrl: () => 'http://127.0.0.1:8000',
      getLiveWindows: () => [],
      loadSettings: async () => settings,
      saveSettings: async () => {},
    })
    service.registerIpcHandlers(ipcMain)

    await ipcMain.invoke(SUSTECH_BLACKBOARD_TRIGGER_SYNC_CHANNEL)
    await waitForCondition(() => service.getSyncState().lastSyncError === 'boom')
    expect(service.getSyncState().lastSyncError).toBe('boom')

    await ipcMain.invoke(SUSTECH_BLACKBOARD_TRIGGER_SYNC_CHANNEL)
    expect(service.getSyncState().status).toBe('running')
    expect(service.getSyncState().lastSyncError).toBeNull()

    service.dispose()
  })

  it('persists last and next auto sync timestamps after a successful sync completion', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-04T10:00:00.000Z'))

    let settings = createSettingsState({
      blackboardSyncInterval: 'two_hours',
    })
    const loadSettings = vi.fn(async () => settings)
    const saveSettings = vi.fn(async (input: SettingsWorkspaceStateSaveInput) => {
      settings = input
    })

    const fetchMock = vi.fn<typeof fetch>()
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true, status: 'running' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'completed',
          lastSyncAt: '2026-05-04T10:05:00.000Z',
        }),
      } as Response)
    vi.stubGlobal('fetch', fetchMock)

    const service = createElectronSustechBlackboardService({
      getRuntimeBaseUrl: () => 'http://127.0.0.1:8000',
      getLiveWindows: () => [],
      loadSettings,
      saveSettings,
    })

    const ipcMain = createIpcMainStub()
    service.registerIpcHandlers(ipcMain)
    await ipcMain.invoke(SUSTECH_BLACKBOARD_TRIGGER_SYNC_CHANNEL)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.runAllTicks()

    expect(saveSettings).toHaveBeenCalled()
    expect(settings.sustech.blackboardLastAutoSyncAt).toBe('2026-05-04T10:05:00.000Z')
    expect(settings.sustech.blackboardNextAutoSyncAt).toBe('2026-05-04T12:05:00.000Z')

    service.dispose()
  })

  it('persists next auto sync timestamp when interval setting changes', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-04T10:00:00.000Z'))

    let settings = createSettingsState()
    const loadSettings = vi.fn(async () => settings)
    const saveSettings = vi.fn(async (input: SettingsWorkspaceStateSaveInput) => {
      settings = input
    })

    const ipcMain = createIpcMainStub()
    const service = createElectronSustechBlackboardService({
      getRuntimeBaseUrl: () => 'http://127.0.0.1:8000',
      getLiveWindows: () => [],
      loadSettings,
      saveSettings,
    })
    service.registerIpcHandlers(ipcMain)

    const result = await ipcMain.invoke(SUSTECH_BLACKBOARD_UPDATE_SETTINGS_CHANNEL, undefined, 'daily')
    await vi.runAllTicks()

    expect(result.ok).toBe(true)
    expect(saveSettings).toHaveBeenCalled()
    expect(settings.sustech.blackboardNextAutoSyncAt).toBe('2026-05-05T10:00:00.000Z')

    service.dispose()
  })

  it('loads persisted sync timestamps into current state', async () => {
    const settings = createSettingsState({
      blackboardLastAutoSyncAt: '2026-05-04T08:00:00.000Z',
      blackboardNextAutoSyncAt: '2026-05-04T10:00:00.000Z',
    })

    const service = createElectronSustechBlackboardService({
      getRuntimeBaseUrl: () => 'http://127.0.0.1:8000',
      getLiveWindows: () => [],
      loadSettings: async () => settings,
      saveSettings: async () => {},
    })

    await Promise.resolve()

    expect(service.getSyncState().lastSyncAt).toBe('2026-05-04T08:00:00.000Z')
    expect(service.getSyncState().nextSyncAt).toBe('2026-05-04T10:00:00.000Z')

    service.dispose()
  })

  it('keeps nextSyncAt null when sync interval is off', async () => {
    vi.useFakeTimers()
    const ipcMain = createIpcMainStub()
    let settings = createSettingsState({
      blackboardSyncInterval: 'daily',
      blackboardLastAutoSyncAt: '2026-05-04T08:00:00.000Z',
    })
    const loadSettings = vi.fn(async () => settings)
    const saveSettings = vi.fn(async (input: SettingsWorkspaceStateSaveInput) => {
      settings = input
    })
    const service = createElectronSustechBlackboardService({
      getRuntimeBaseUrl: () => 'http://127.0.0.1:8000',
      getLiveWindows: () => [],
      loadSettings,
      saveSettings,
    })
    service.registerIpcHandlers(ipcMain)

    await ipcMain.invoke(SUSTECH_BLACKBOARD_UPDATE_SETTINGS_CHANNEL, undefined, 'off')
    await vi.runAllTicks()

    expect(service.getSyncState().nextSyncAt).toBeNull()
    expect(settings.sustech.blackboardNextAutoSyncAt).toBeNull()

    service.dispose()
  })

  it('exposes get status IPC handler', async () => {
    const ipcMain = createIpcMainStub()
    const service = createElectronSustechBlackboardService({
      getRuntimeBaseUrl: () => 'http://127.0.0.1:8000',
      getLiveWindows: () => [],
      loadSettings: async () => createSettingsState(),
      saveSettings: async () => {},
    })
    service.registerIpcHandlers(ipcMain)

    const result = await ipcMain.invoke(SUSTECH_BLACKBOARD_GET_STATUS_CHANNEL)
    expect(result.ok).toBe(true)
    expect(result.state.status).toBeDefined()

    service.dispose()
  })
})
