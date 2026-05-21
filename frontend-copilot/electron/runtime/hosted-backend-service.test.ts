import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { HostedBackendState } from './runtime-state'
import type { HostedBackendFailure } from './runtime-diagnostics'

vi.mock('./python-runtime-manager', () => {
  const mockManager = {
    start: vi.fn(),
    stop: vi.fn(),
    getState: vi.fn(),
    getLastFailure: vi.fn(),
    getRuntimeBaseUrl: vi.fn(),
    getLocalToken: vi.fn(),
  }

  return {
    createPythonRuntimeManager: vi.fn(() => mockManager),
    PythonRuntimeManager: vi.fn(),
  }
})

import { createHostedBackendService } from './hosted-backend-service'
import { createPythonRuntimeManager } from './python-runtime-manager'

describe('createHostedBackendService', () => {
  const mockManager = {
    start: vi.fn(),
    stop: vi.fn(),
    getState: vi.fn(),
    getLastFailure: vi.fn(),
    getRuntimeBaseUrl: vi.fn(),
    getLocalToken: vi.fn(),
  }

  beforeEach(() => {
    vi.mocked(createPythonRuntimeManager).mockReturnValue(mockManager as any)
    vi.clearAllMocks()
  })

  const baseOptions = {
    userDataPath: '/tmp/test',
    appRoot: '/tmp/app',
    resourcesPath: '/tmp/resources',
    isPackaged: false,
  }

  const readyState: HostedBackendState = {
    status: 'ready',
    mode: 'bundled',
    baseUrl: 'http://127.0.0.1:4000',
    pid: 1234,
    startedAt: '2026-01-01T00:00:00.000Z',
    readyAt: '2026-01-01T00:00:02.000Z',
    stoppedAt: null,
    exitCode: null,
    signal: null,
    lastFailure: null,
  }

  it('creates a manager with the provided options on construction', () => {
    createHostedBackendService(baseOptions)

    expect(createPythonRuntimeManager).toHaveBeenCalledWith(baseOptions)
  })

  it('start() delegates to the manager and returns its result', async () => {
    mockManager.start.mockResolvedValue(readyState)
    const service = createHostedBackendService(baseOptions)

    const result = await service.start()

    expect(mockManager.start).toHaveBeenCalledOnce()
    expect(result).toEqual(readyState)
  })

  it('stop() delegates to the manager', async () => {
    mockManager.stop.mockResolvedValue(undefined)
    const service = createHostedBackendService(baseOptions)

    await service.stop()

    expect(mockManager.stop).toHaveBeenCalledOnce()
  })

  it('getState() delegates to the manager', () => {
    mockManager.getState.mockReturnValue(readyState)
    const service = createHostedBackendService(baseOptions)

    const state = service.getState()

    expect(mockManager.getState).toHaveBeenCalledOnce()
    expect(state).toEqual(readyState)
  })

  it('getLastFailure() delegates to the manager', () => {
    const failure: HostedBackendFailure = {
      code: 'unexpected_exit',
      phase: 'runtime',
      message: 'Exit.',
      retryable: true,
      detail: null,
      exitCode: 1,
      signal: null,
      timestamp: '2026-01-01T00:00:00.000Z',
    }
    mockManager.getLastFailure.mockReturnValue(failure)
    const service = createHostedBackendService(baseOptions)

    const result = service.getLastFailure()

    expect(mockManager.getLastFailure).toHaveBeenCalledOnce()
    expect(result).toEqual(failure)
  })

  it('getLastFailure() returns null when the manager has no failure', () => {
    mockManager.getLastFailure.mockReturnValue(null)
    const service = createHostedBackendService(baseOptions)

    expect(service.getLastFailure()).toBeNull()
  })

  it('getRuntimeBaseUrl() delegates to the manager', () => {
    mockManager.getRuntimeBaseUrl.mockReturnValue('http://127.0.0.1:4000')
    const service = createHostedBackendService(baseOptions)

    const url = service.getRuntimeBaseUrl()

    expect(mockManager.getRuntimeBaseUrl).toHaveBeenCalledOnce()
    expect(url).toBe('http://127.0.0.1:4000')
  })

  it('getRuntimeBaseUrl() returns null when the manager returns null', () => {
    mockManager.getRuntimeBaseUrl.mockReturnValue(null)
    const service = createHostedBackendService(baseOptions)

    expect(service.getRuntimeBaseUrl()).toBeNull()
  })

  it('getLocalToken() delegates to the manager', () => {
    mockManager.getLocalToken.mockReturnValue('token-abc')
    const service = createHostedBackendService(baseOptions)

    const token = service.getLocalToken()

    expect(mockManager.getLocalToken).toHaveBeenCalledOnce()
    expect(token).toBe('token-abc')
  })

  it('getLocalToken() returns null when the manager returns null', () => {
    mockManager.getLocalToken.mockReturnValue(null)
    const service = createHostedBackendService(baseOptions)

    expect(service.getLocalToken()).toBeNull()
  })
})

describe('HostedBackendService interface', () => {
  it('exposes all required methods on the returned service object', () => {
    const service = createHostedBackendService({
      userDataPath: '/tmp/test',
      appRoot: '/tmp/app',
      resourcesPath: '/tmp/resources',
      isPackaged: false,
    })

    expect(typeof service.start).toBe('function')
    expect(typeof service.stop).toBe('function')
    expect(typeof service.getState).toBe('function')
    expect(typeof service.getLastFailure).toBe('function')
    expect(typeof service.getRuntimeBaseUrl).toBe('function')
    expect(typeof service.getLocalToken).toBe('function')
  })
})
