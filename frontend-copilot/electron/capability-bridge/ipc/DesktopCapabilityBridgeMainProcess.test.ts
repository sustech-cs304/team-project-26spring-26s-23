import { access } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopCapabilityBridgeRequest } from '../protocol'
import type { ElectronSettingsWorkspaceService } from '../../settings-workspace/main-process'
import {
  createPreparedPaths,
  destroyWorkspaceTempRoot,
} from '../../settings-workspace/test-support/settings-workspace-test-fixtures'
import { createElectronDesktopCapabilityBridgeService } from './DesktopCapabilityBridgeMainProcess'

const activeTempRoots: string[] = []

afterEach(async () => {
  while (activeTempRoots.length > 0) {
    const tempRoot = activeTempRoots.pop()
    if (tempRoot === undefined) {
      continue
    }
    await destroyWorkspaceTempRoot(tempRoot)
  }
})

function buildRequest(
  input: Pick<DesktopCapabilityBridgeRequest, 'requestId' | 'capability' | 'operation' | 'payload'>
    & Partial<Pick<DesktopCapabilityBridgeRequest, 'toolId' | 'runId' | 'toolCallId'>>,
): DesktopCapabilityBridgeRequest {
  return {
    requestId: input.requestId,
    capability: input.capability,
    operation: input.operation,
    toolId: input.toolId ?? 'blackboard.snapshot.sync',
    runId: input.runId ?? 'run-1',
    toolCallId: input.toolCallId ?? 'call-1',
    payload: input.payload,
  }
}

function createSettingsWorkspaceServiceStub(): ElectronSettingsWorkspaceService {
  return {
    loadState: vi.fn(async () => ({
      ok: true,
      source: 'stored',
      state: {
        sustech: {
          studentId: '12345678',
          email: 'student@example.com',
        },
      },
    } as never)),
    loadSecretStates: vi.fn(async () => ({
      ok: true,
      states: {
        openrouter: {
          hasApiKey: true,
          apiKey: 'openrouter-secret',
        },
      },
    } as never)),
    loadSustechCasSecret: vi.fn(async () => ({
      ok: true,
      state: {
        hasPassword: true,
        password: 'cas-secret',
      },
    } as never)),
  } as unknown as ElectronSettingsWorkspaceService
}

describe('createElectronDesktopCapabilityBridgeService', () => {
  it('routes requests across all five capability families', async () => {
    const fixture = await createPreparedPaths('desktop-capability-bridge-routing')
    activeTempRoots.push(fixture.tempRoot)

    const appendLog = vi.fn()
    const settingsWorkspaceService = createSettingsWorkspaceServiceStub()
    const service = createElectronDesktopCapabilityBridgeService({
      prepareRuntimePaths: async () => fixture.hostedPaths,
      appendLog,
      getSettingsWorkspaceService: () => settingsWorkspaceService,
    })

    await expect(service.handleRequest(buildRequest({
      requestId: 'secret-1',
      capability: 'secret',
      operation: 'get_secret',
      payload: {
        secretName: 'provider.openrouter.apiKey',
      },
    }))).resolves.toEqual({
      requestId: 'secret-1',
      ok: true,
      result: {
        value: 'openrouter-secret',
      },
    })
    await expect(service.handleRequest(buildRequest({
      requestId: 'secret-2',
      capability: 'secret',
      operation: 'has_secret',
      payload: {
        secretName: 'custom.secret',
      },
    }))).resolves.toEqual({
      requestId: 'secret-2',
      ok: true,
      result: {
        present: false,
      },
    })

    const expectedWorkspaceDir = path.resolve(fixture.hostedPaths.runtimeRootDir, 'workspace', 'cache')
    await expect(service.handleRequest(buildRequest({
      requestId: 'workspace-1',
      capability: 'workspace',
      operation: 'ensure_directory',
      payload: {
        relativePath: 'workspace/cache',
      },
    }))).resolves.toEqual({
      requestId: 'workspace-1',
      ok: true,
      result: {
        path: expectedWorkspaceDir,
      },
    })
    await access(expectedWorkspaceDir)

    const artifactResponse = await service.handleRequest(buildRequest({
      requestId: 'artifact-1',
      capability: 'artifact',
      operation: 'save_text',
      payload: {
        name: 'note.txt',
        text: 'hello world',
        metadata: {
          source: 'test',
        },
      },
    }))
    expect(artifactResponse.ok).toBe(true)
    if (!artifactResponse.ok) {
      throw new Error('Expected artifact save request to succeed.')
    }
    expect(artifactResponse).toMatchObject({
      requestId: 'artifact-1',
      ok: true,
      result: {
        artifactId: expect.stringMatching(/^artifact-/),
        uri: expect.stringMatching(/^artifact:\/\/desktop\/artifact-/),
        name: 'note.txt',
        contentType: 'text/plain',
        metadata: {
          source: 'test',
        },
      },
    })

    await expect(service.handleRequest(buildRequest({
      requestId: 'state-put-1',
      capability: 'state',
      operation: 'put_value',
      payload: {
        scope: 'tool',
        key: 'session',
        value: {
          count: 1,
        },
      },
    }))).resolves.toEqual({
      requestId: 'state-put-1',
      ok: true,
      result: {},
    })
    await expect(service.handleRequest(buildRequest({
      requestId: 'state-get-1',
      capability: 'state',
      operation: 'get_value',
      payload: {
        scope: 'tool',
        key: 'session',
      },
    }))).resolves.toEqual({
      requestId: 'state-get-1',
      ok: true,
      result: {
        found: true,
        value: {
          count: 1,
        },
      },
    })

    await expect(service.handleRequest(buildRequest({
      requestId: 'event-1',
      capability: 'event',
      operation: 'emit_event',
      payload: {
        eventType: 'log',
        message: 'bridge event',
        data: {
          severity: 'info',
        },
      },
    }))).resolves.toEqual({
      requestId: 'event-1',
      ok: true,
      result: {},
    })

    expect(appendLog).toHaveBeenCalledWith('info', '[capability-bridge] Event emitted.', expect.objectContaining({
      capability: 'event',
      operation: 'emit_event',
      eventType: 'log',
      message: 'bridge event',
    }))
    expect(settingsWorkspaceService.loadSecretStates).toHaveBeenCalledTimes(1)
    expect(settingsWorkspaceService.loadSecretStates).toHaveBeenCalledWith({
      profileIds: ['openrouter'],
    })
  })

  it('returns structured failures when workspace paths escape the approved root', async () => {
    const fixture = await createPreparedPaths('desktop-capability-bridge-workspace-denied')
    activeTempRoots.push(fixture.tempRoot)

    const service = createElectronDesktopCapabilityBridgeService({
      prepareRuntimePaths: async () => fixture.hostedPaths,
      getSettingsWorkspaceService: () => createSettingsWorkspaceServiceStub(),
    })

    const resolvedPath = path.resolve(fixture.hostedPaths.runtimeRootDir, '../outside')
    await expect(service.handleRequest(buildRequest({
      requestId: 'workspace-denied-1',
      capability: 'workspace',
      operation: 'resolve_path',
      payload: {
        relativePath: '../outside',
      },
    }))).resolves.toEqual({
      requestId: 'workspace-denied-1',
      ok: false,
      errorCode: 'permission_denied',
      errorMessage: 'Workspace path must resolve inside the desktop capability workspace root.',
      errorRetryable: false,
      details: {
        workspaceRootDir: path.resolve(fixture.hostedPaths.runtimeRootDir),
        resolvedPath,
        relativePath: '../outside',
      },
    })
  })

  it('returns structured failures for unsupported capability operations', async () => {
    const fixture = await createPreparedPaths('desktop-capability-bridge-unsupported-operation')
    activeTempRoots.push(fixture.tempRoot)

    const service = createElectronDesktopCapabilityBridgeService({
      prepareRuntimePaths: async () => fixture.hostedPaths,
      getSettingsWorkspaceService: () => createSettingsWorkspaceServiceStub(),
    })

    await expect(service.handleRequest(buildRequest({
      requestId: 'unsupported-1',
      capability: 'secret',
      operation: 'resolve_path',
      payload: {
        relativePath: 'unexpected',
      },
    }))).resolves.toEqual({
      requestId: 'unsupported-1',
      ok: false,
      errorCode: 'unsupported_operation',
      errorMessage: "Operation 'resolve_path' is not supported for capability 'secret'.",
      errorRetryable: false,
      details: {
        capability: 'secret',
        operation: 'resolve_path',
      },
    })
  })
})
