import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DesktopCapabilityBridgeRequest } from '../protocol'
import { createDesktopCapabilityDispatcher } from '../services/DesktopCapabilityDispatcher'
import type { CreateDesktopCapabilityDispatcherOptions } from '../services/DesktopCapabilityDispatcher'

const mockSecretHandle = vi.fn(async () => ({ value: 'mock-secret' }))
const mockWorkspaceHandle = vi.fn(async () => ({ path: '/mock/workspace' }))
const mockDatabaseHandle = vi.fn(async () => ({ path: '/mock/database' }))
const mockArtifactHandle = vi.fn(async () => ({ artifactId: 'mock-artifact' }))
const mockStateHandle = vi.fn(async () => ({ found: true, value: { key: 'val' } }))
const mockEventHandle = vi.fn(async () => ({}))
const mockMcpHandle = vi.fn(async () => ({ ok: true }))
const mockBrowserHandle = vi.fn(async () => ({ tabId: 'mock-tab' }))

vi.mock('./DesktopCapabilitySecretService', () => ({
  createDesktopCapabilitySecretService: vi.fn(() => ({ handle: mockSecretHandle })),
}))

vi.mock('./DesktopCapabilityWorkspaceService', () => ({
  createDesktopCapabilityWorkspaceService: vi.fn(() => ({ handle: mockWorkspaceHandle })),
}))

vi.mock('./DesktopCapabilityDatabaseService', () => ({
  createDesktopCapabilityDatabaseService: vi.fn(() => ({ handle: mockDatabaseHandle })),
}))

vi.mock('./DesktopCapabilityArtifactService', () => ({
  createDesktopCapabilityArtifactService: vi.fn(() => ({ handle: mockArtifactHandle })),
}))

vi.mock('./DesktopCapabilityStateService', () => ({
  createDesktopCapabilityStateService: vi.fn(() => ({ handle: mockStateHandle })),
}))

vi.mock('./DesktopCapabilityEventService', () => ({
  createDesktopCapabilityEventService: vi.fn(() => ({ handle: mockEventHandle })),
}))

vi.mock('./DesktopCapabilityMcpService', () => ({
  createDesktopCapabilityMcpService: vi.fn(() => ({ handle: mockMcpHandle })),
}))

vi.mock('./DesktopCapabilityBrowserService', () => ({
  createDesktopCapabilityBrowserService: vi.fn(() => ({ handle: mockBrowserHandle })),
}))

function createStubOptions(): CreateDesktopCapabilityDispatcherOptions {
  return {
    prepareRuntimePaths: vi.fn(async () => ({
      userDataDir: '/tmp/candue-test',
      runtimeRootDir: '/tmp/candue-test',
      configDir: '/tmp/candue-test/config',
      logsDir: '/tmp/candue-test/logs',
      databaseDir: '/tmp/candue-test/database',
      stateDir: '/tmp/candue-test/state',
      copilotSettingsFile: '/tmp/candue-test/config/settings.json',
      legacyCopilotSettingsFile: '/tmp/candue-test/config/legacy.json',
      hostLogFile: '/tmp/candue-test/logs/host.log',
      backendStdoutLogFile: '/tmp/candue-test/logs/backend-stdout.log',
      backendStderrLogFile: '/tmp/candue-test/logs/backend-stderr.log',
      runtimeSnapshotFile: '/tmp/candue-test/state/runtime-snapshot.json',
      lastFailureFile: '/tmp/candue-test/state/last-failure.json',
    })),
    appendLog: vi.fn(),
  }
}

function createRequest(
  capability: string,
  operation: string,
  payload: Record<string, unknown> = {},
): DesktopCapabilityBridgeRequest {
  return {
    requestId: 'req-1',
    capability: capability as DesktopCapabilityBridgeRequest['capability'],
    operation: operation as DesktopCapabilityBridgeRequest['operation'],
    toolId: 'test.tool',
    runId: 'run-1',
    toolCallId: 'call-1',
    payload,
  }
}

describe('DesktopCapabilityDispatcher', () => {
  let dispatcher: ReturnType<typeof createDesktopCapabilityDispatcher>

  beforeEach(() => {
    vi.clearAllMocks()
    dispatcher = createDesktopCapabilityDispatcher(createStubOptions())
  })

  it('dispatches to secret service', async () => {
    const result = await dispatcher.handle(createRequest('secret', 'get_secret', { secretName: 'test' }))

    expect(mockSecretHandle).toHaveBeenCalledOnce()
    expect(result).toEqual({ value: 'mock-secret' })
  })

  it('dispatches to workspace service', async () => {
    const result = await dispatcher.handle(createRequest('workspace', 'resolve_path', { relativePath: 'data' }))

    expect(mockWorkspaceHandle).toHaveBeenCalledOnce()
    expect(result).toEqual({ path: '/mock/workspace' })
  })

  it('dispatches to database service', async () => {
    const result = await dispatcher.handle(createRequest('database', 'resolve_path'))

    expect(mockDatabaseHandle).toHaveBeenCalledOnce()
    expect(result).toEqual({ path: '/mock/database' })
  })

  it('dispatches to artifact service', async () => {
    const result = await dispatcher.handle(createRequest('artifact', 'save_text', { name: 'f', text: 't' }))

    expect(mockArtifactHandle).toHaveBeenCalledOnce()
    expect(result).toEqual({ artifactId: 'mock-artifact' })
  })

  it('dispatches to state service', async () => {
    const result = await dispatcher.handle(createRequest('state', 'get_value', { scope: 'tool', key: 'k' }))

    expect(mockStateHandle).toHaveBeenCalledOnce()
    expect(result).toEqual({ found: true, value: { key: 'val' } })
  })

  it('dispatches to event service', async () => {
    const result = await dispatcher.handle(createRequest('event', 'emit_event', { eventType: 'test' }))

    expect(mockEventHandle).toHaveBeenCalledOnce()
    expect(result).toEqual({})
  })

  it('dispatches to mcp service', async () => {
    const result = await dispatcher.handle(createRequest('mcp', 'call_tool', { serverId: 's', remoteToolName: 't', arguments: {} }))

    expect(mockMcpHandle).toHaveBeenCalledOnce()
    expect(result).toEqual({ ok: true })
  })

  it('dispatches to browser service', async () => {
    const result = await dispatcher.handle(createRequest('browser', 'reset'))

    expect(mockBrowserHandle).toHaveBeenCalledOnce()
    expect(result).toEqual({ tabId: 'mock-tab' })
  })

  it('throws for unsupported capability', async () => {
    await expect(
      dispatcher.handle({
        requestId: 'req-1',
        capability: 'unknown' as DesktopCapabilityBridgeRequest['capability'],
        operation: 'open' as DesktopCapabilityBridgeRequest['operation'],
        toolId: 'test',
        runId: 'r1',
        toolCallId: 'c1',
        payload: {},
      })
    ).rejects.toThrow(/not supported/)
  })
})
