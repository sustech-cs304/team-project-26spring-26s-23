import { beforeEach, describe, expect, it, vi } from 'vitest'

const REMOTE_RUNTIME_URL = 'http://127.0.0.1:8765'
const LOCAL_TOKEN = 'calendar-token'

const hoisted = vi.hoisted(() => ({
  getCalendarEvents: vi.fn(),
  addCalendarEvent: vi.fn(),
  updateCalendarEvent: vi.fn(),
  deleteCalendarEvent: vi.fn(),
  createElectronAttachmentService: vi.fn(() => ({
    readClipboardData: vi.fn(),
    writeTempFile: vi.fn(),
    readPreview: vi.fn(),
    cleanupTempFiles: vi.fn(),
  })),
  createElectronFileManagerService: vi.fn(() => ({
    selectRootDirectory: vi.fn(),
    listDirectory: vi.fn(),
    probeDirectory: vi.fn(),
    createDirectory: vi.fn(),
    copyEntries: vi.fn(),
    moveEntries: vi.fn(),
    renameEntry: vi.fn(),
    trashEntries: vi.fn(),
    deleteEntriesPermanently: vi.fn(),
    watchDirectories: vi.fn(),
    unwatchDirectories: vi.fn(),
    loadLastRootDirectory: vi.fn(),
    saveLastRootDirectory: vi.fn(),
    clearLastRootDirectory: vi.fn(),
    openEntryWithSystem: vi.fn(),
    revealEntryInFolder: vi.fn(),
    copyTextToClipboard: vi.fn(),
  })),
}))

vi.mock('./timeline-database/service', () => ({
  getCalendarEvents: hoisted.getCalendarEvents,
  addCalendarEvent: hoisted.addCalendarEvent,
  updateCalendarEvent: hoisted.updateCalendarEvent,
  deleteCalendarEvent: hoisted.deleteCalendarEvent,
}))

vi.mock('./attachment-service/service', () => ({
  createElectronAttachmentService: hoisted.createElectronAttachmentService,
}))

vi.mock('./file-manager/service', () => ({
  createElectronFileManagerService: hoisted.createElectronFileManagerService,
}))

import { createMainProcessServices } from './main-services'
import type { HostedBackendService } from './runtime/hosted-backend-service'
import type { UnifiedCalendarEvent } from './timeline-database/ipc'

describe('createMainProcessServices timeline database bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.getCalendarEvents.mockReturnValue([])
    hoisted.updateCalendarEvent.mockReturnValue(createCalendarEvent({ id: 12, status: 'completed', progress: 100 }))
    hoisted.deleteCalendarEvent.mockReturnValue(true)
  })

  it('loads remote calendar events through the main process with the hosted local token header', async () => {
    const remoteEvent = createCalendarEvent({ id: 7, source_id: 'remote-1', title: 'Remote assignment' })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ items: [remoteEvent] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const hostedBackendService = {
      getLocalToken: vi.fn(() => LOCAL_TOKEN),
      getRuntimeBaseUrl: vi.fn(() => REMOTE_RUNTIME_URL),
      start: vi.fn(async () => undefined),
    } as unknown as HostedBackendService
    const services = createServices(hostedBackendService)

    await expect(services.loadTimelineEvents({ runtimeUrl: REMOTE_RUNTIME_URL })).resolves.toEqual({
      items: [remoteEvent],
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${REMOTE_RUNTIME_URL}/calendar/events`)
    expect((init.headers as Headers).get('X-Local-Token')).toBe(LOCAL_TOKEN)
  })

  it('uses remote calendar events to replace stale local events with the same composite key', async () => {
    const staleLocalEvent = createCalendarEvent({
      id: 1,
      source: 'bb',
      source_id: 'assignment-1',
      title: 'Old assignment title',
      start_time: '2026-05-01T00:00:00.000Z',
      status: 'not_started',
    })
    const localOnlyEvent = createCalendarEvent({
      id: 2,
      source: 'manual',
      source_id: 'manual-1',
      title: 'Local only event',
      start_time: '2026-05-01T12:00:00.000Z',
    })
    const remoteUpdatedEvent = createCalendarEvent({
      id: 7,
      source: 'bb',
      source_id: 'assignment-1',
      title: 'Updated assignment title',
      start_time: '2026-05-02T00:00:00.000Z',
      status: 'completed',
    })
    hoisted.getCalendarEvents.mockReturnValue([staleLocalEvent, localOnlyEvent])
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ items: [remoteUpdatedEvent] }), { status: 200 })))

    const hostedBackendService = {
      getLocalToken: vi.fn(() => LOCAL_TOKEN),
      getRuntimeBaseUrl: vi.fn(() => REMOTE_RUNTIME_URL),
      start: vi.fn(async () => undefined),
    } as unknown as HostedBackendService
    const services = createServices(hostedBackendService)

    await expect(services.loadTimelineEvents({ runtimeUrl: REMOTE_RUNTIME_URL })).resolves.toEqual({
      items: [localOnlyEvent, remoteUpdatedEvent],
    })
  })

  it('always fetches calendar events from the trusted hosted runtime URL', async () => {
    const remoteEvent = createCalendarEvent({ id: 9, source_id: 'trusted-remote-1', title: 'Trusted remote event' })
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ items: [remoteEvent] }), { status: 200 }))
    const appendMainRuntimeLog = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const hostedBackendService = {
      getLocalToken: vi.fn(() => LOCAL_TOKEN),
      getRuntimeBaseUrl: vi.fn(() => REMOTE_RUNTIME_URL),
      start: vi.fn(async () => undefined),
    } as unknown as HostedBackendService
    const services = createServices(hostedBackendService, appendMainRuntimeLog)

    await expect(services.loadTimelineEvents({ runtimeUrl: 'https://attacker.example/runtime' })).resolves.toEqual({
      items: [remoteEvent],
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${REMOTE_RUNTIME_URL}/calendar/events`)
    expect((init.headers as Headers).get('X-Local-Token')).toBe(LOCAL_TOKEN)
    expect(appendMainRuntimeLog).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('Renderer calendar runtime URL does not match trusted hosted runtime'),
      expect.objectContaining({
        runtimeUrl: 'https://attacker.example/runtime/',
        trustedRuntimeUrl: `${REMOTE_RUNTIME_URL}/`,
      }),
    )
  })

  it('treats malformed renderer runtime URLs as remote failures without throwing synchronously', async () => {
    const localEvent = createCalendarEvent({ id: 3, title: 'Cached fallback event' })
    const fetchMock = vi.fn()
    const appendMainRuntimeLog = vi.fn()
    hoisted.getCalendarEvents.mockReturnValue([localEvent])
    vi.stubGlobal('fetch', fetchMock)

    const hostedBackendService = {
      getLocalToken: vi.fn(() => LOCAL_TOKEN),
      getRuntimeBaseUrl: vi.fn(() => REMOTE_RUNTIME_URL),
      start: vi.fn(async () => undefined),
    } as unknown as HostedBackendService
    const services = createServices(hostedBackendService, appendMainRuntimeLog)

    await expect(services.loadTimelineEvents({ runtimeUrl: 'http://[invalid-runtime' })).resolves.toEqual({
      items: [localEvent],
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(appendMainRuntimeLog).toHaveBeenCalledWith(
      'warn',
      expect.stringContaining('Invalid renderer runtime URL'),
      expect.objectContaining({ runtimeUrl: 'http://[invalid-runtime' }),
    )
  })

  it('delegates local timeline event mutations to the database service', async () => {
    const updatedEvent = createCalendarEvent({ id: 12, title: 'Updated task', status: 'completed', progress: 100 })
    hoisted.updateCalendarEvent.mockReturnValue(updatedEvent)
    hoisted.deleteCalendarEvent.mockReturnValue(true)

    const hostedBackendService = {
      getLocalToken: vi.fn(() => LOCAL_TOKEN),
      getRuntimeBaseUrl: vi.fn(() => REMOTE_RUNTIME_URL),
      start: vi.fn(async () => undefined),
    } as unknown as HostedBackendService
    const services = createServices(hostedBackendService)

    await expect(services.updateTimelineEvent({ id: 12, patch: { status: 'completed', progress: 100 } })).resolves.toEqual({
      updated: true,
      item: updatedEvent,
    })
    await expect(services.deleteTimelineEvent({ id: 12 })).resolves.toEqual({ deleted: true })

    expect(hoisted.updateCalendarEvent).toHaveBeenCalledWith(12, { status: 'completed', progress: 100 })
    expect(hoisted.deleteCalendarEvent).toHaveBeenCalledWith(12)
  })

  it('throws the calendar load failure when both local cache and remote API are unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })))

    const hostedBackendService = {
      getLocalToken: vi.fn(() => LOCAL_TOKEN),
      getRuntimeBaseUrl: vi.fn(() => REMOTE_RUNTIME_URL),
      start: vi.fn(async () => undefined),
    } as unknown as HostedBackendService
    const services = createServices(hostedBackendService)

    await expect(services.loadTimelineEvents({ runtimeUrl: REMOTE_RUNTIME_URL })).rejects.toThrow(
      '无法加载日历事件：本地无缓存数据且远端 API 请求失败，请检查网络连接或后端服务状态。',
    )
  })
})

function createServices(hostedBackendService: HostedBackendService, appendMainRuntimeLog = vi.fn()) {
  return createMainProcessServices({
    prepareRuntimePaths: vi.fn(async () => ({ runtimeRootDir: 'runtime-root' }) as never),
    userDataPath: 'D:/workspace/candue-user-data',
    ensureHostedBackendService: vi.fn(async () => hostedBackendService),
    appendMainRuntimeLog,
    publishConfigCenterPublicSnapshotUpdate: vi.fn(),
    publishMcpRegistryEvent: vi.fn(),
    publishSkillRegistryEvent: vi.fn(),
    createCopilotHistoryService: vi.fn(() => ({
      listThreads: vi.fn(),
      getThreadDetail: vi.fn(),
      getRunReplay: vi.fn(),
      renameThread: vi.fn(),
      duplicateThread: vi.fn(),
      deleteThread: vi.fn(),
      backupDatabase: vi.fn(),
      restoreDatabase: vi.fn(),
    })),
  })
}

function createCalendarEvent(overrides: Partial<UnifiedCalendarEvent> = {}): UnifiedCalendarEvent {
  return {
    id: 1,
    source: 'bb',
    source_id: 'source-1',
    title: 'Task 1',
    description: 'Example event',
    start_time: '2026-05-01T00:00:00.000Z',
    end_time: '2026-05-03T00:00:00.000Z',
    is_all_day: false,
    location: null,
    status: 'not_started',
    metadata_payload: null,
    ...overrides,
  }
}
