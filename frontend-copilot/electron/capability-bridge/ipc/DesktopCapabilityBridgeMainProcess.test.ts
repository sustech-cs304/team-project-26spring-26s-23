import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopCapabilityBridgeRequest } from '../protocol'
import { createDesktopCapabilityBridgePaths } from '../paths'
import type { ElectronSettingsWorkspaceService } from '../../settings-workspace/main-process'
import {
  createPreparedPaths,
  destroyWorkspaceTempRoot,
  readJsonFile,
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
  it('routes requests across all six capability families and persists artifact/state data under host-controlled storage', async () => {
    const fixture = await createPreparedPaths('desktop-capability-bridge-routing')
    activeTempRoots.push(fixture.tempRoot)

    const appendLog = vi.fn()
    const settingsWorkspaceService = createSettingsWorkspaceServiceStub()
    const service = createElectronDesktopCapabilityBridgeService({
      prepareRuntimePaths: async () => fixture.hostedPaths,
      appendLog,
      getSettingsWorkspaceService: () => settingsWorkspaceService,
    })
    const bridgePaths = createDesktopCapabilityBridgePaths(fixture.hostedPaths)

    await expect(service.handleRequest(buildRequest({
      requestId: 'secret-username-1',
      capability: 'secret',
      operation: 'get_secret',
      payload: {
        secretName: 'bb.username',
      },
    }))).resolves.toEqual({
      requestId: 'secret-username-1',
      ok: true,
      result: {
        value: 'student@example.com',
      },
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

    const expectedDatabasePath = path.resolve(fixture.hostedPaths.databaseDir, 'blackboard', 'snapshot.db')
    await expect(service.handleRequest(buildRequest({
      requestId: 'database-1',
      capability: 'database',
      operation: 'resolve_path',
      payload: {
        relativePath: 'blackboard/snapshot.db',
      },
    }))).resolves.toEqual({
      requestId: 'database-1',
      ok: true,
      result: {
        path: expectedDatabasePath,
      },
    })

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

    const artifactResult = artifactResponse.result
    const artifactId = String(artifactResult.artifactId)
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
          __desktopCapabilityArtifact: {
            storageKind: 'electron-desktop-capability-bridge',
            byteLength: 11,
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
            storedAt: expect.any(String),
          },
        },
      },
    })
    await expect(service.handleRequest(buildRequest({
      requestId: 'artifact-2',
      capability: 'artifact',
      operation: 'describe_artifact',
      payload: {
        artifactId,
      },
    }))).resolves.toEqual({
      requestId: 'artifact-2',
      ok: true,
      result: artifactResult,
    })

    const artifactIndex = await readJsonFile(bridgePaths.artifactIndexFile) as {
      artifacts?: Record<string, {
        fileName?: string
        metadata?: Record<string, unknown>
      }>
    }
    const artifactRecord = artifactIndex.artifacts?.[artifactId]
    if (artifactRecord === undefined) {
      throw new Error(`Expected artifact record '${artifactId}' to be persisted.`)
    }
    const artifactFilePath = path.join(bridgePaths.artifactsDir, String(artifactRecord.fileName ?? ''))
    await access(artifactFilePath)
    await expect(readFile(artifactFilePath, 'utf8')).resolves.toBe('hello world')
    expect(artifactRecord.metadata).toMatchObject({
      source: 'test',
      __desktopCapabilityArtifact: {
        storageKind: 'electron-desktop-capability-bridge',
        byteLength: 11,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        storedAt: expect.any(String),
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
    await expect(readJsonFile(bridgePaths.stateFile)).resolves.toMatchObject({
      version: 1,
      values: {
        tool: {
          'blackboard.snapshot.sync': {
            session: {
              count: 1,
            },
          },
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
      data: {
        severity: 'info',
      },
    }), {
      relayToRenderer: false,
    })
    expect(settingsWorkspaceService.loadState).toHaveBeenCalledTimes(1)
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

  it('returns structured failures when database paths escape the approved root', async () => {
    const fixture = await createPreparedPaths('desktop-capability-bridge-database-denied')
    activeTempRoots.push(fixture.tempRoot)

    const service = createElectronDesktopCapabilityBridgeService({
      prepareRuntimePaths: async () => fixture.hostedPaths,
      getSettingsWorkspaceService: () => createSettingsWorkspaceServiceStub(),
    })

    const resolvedPath = path.resolve(fixture.hostedPaths.databaseDir, '../outside')
    await expect(service.handleRequest(buildRequest({
      requestId: 'database-denied-1',
      capability: 'database',
      operation: 'resolve_path',
      payload: {
        relativePath: '../outside',
      },
    }))).resolves.toEqual({
      requestId: 'database-denied-1',
      ok: false,
      errorCode: 'permission_denied',
      errorMessage: 'Database path must resolve inside the desktop capability database root.',
      errorRetryable: false,
      details: {
        databaseRootDir: path.resolve(fixture.hostedPaths.databaseDir),
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

  it('returns a structured artifact failure for invalid base64 payloads', async () => {
    const fixture = await createPreparedPaths('desktop-capability-bridge-artifact-invalid-base64')
    activeTempRoots.push(fixture.tempRoot)

    const service = createElectronDesktopCapabilityBridgeService({
      prepareRuntimePaths: async () => fixture.hostedPaths,
      getSettingsWorkspaceService: () => createSettingsWorkspaceServiceStub(),
    })

    await expect(service.handleRequest(buildRequest({
      requestId: 'artifact-invalid-1',
      capability: 'artifact',
      operation: 'save_bytes',
      payload: {
        name: 'broken.bin',
        contentBase64: 'not-base64$',
      },
    }))).resolves.toEqual({
      requestId: 'artifact-invalid-1',
      ok: false,
      errorCode: 'invalid_request',
      errorMessage: 'contentBase64 must be valid base64.',
      errorRetryable: false,
      details: {},
    })
  })

  it('returns a structured state failure for invalid state values', async () => {
    const fixture = await createPreparedPaths('desktop-capability-bridge-state-invalid-value')
    activeTempRoots.push(fixture.tempRoot)

    const service = createElectronDesktopCapabilityBridgeService({
      prepareRuntimePaths: async () => fixture.hostedPaths,
      getSettingsWorkspaceService: () => createSettingsWorkspaceServiceStub(),
    })

    await expect(service.handleRequest(buildRequest({
      requestId: 'state-invalid-1',
      capability: 'state',
      operation: 'put_value',
      payload: {
        scope: 'tool',
        key: 'session',
        value: ['unexpected-array'],
      },
    }))).resolves.toEqual({
      requestId: 'state-invalid-1',
      ok: false,
      errorCode: 'invalid_request',
      errorMessage: 'State value must be an object.',
      errorRetryable: false,
      details: {},
    })
  })

  it('returns a structured event failure for invalid event payloads', async () => {
    const fixture = await createPreparedPaths('desktop-capability-bridge-event-invalid-payload')
    activeTempRoots.push(fixture.tempRoot)

    const appendLog = vi.fn()
    const service = createElectronDesktopCapabilityBridgeService({
      prepareRuntimePaths: async () => fixture.hostedPaths,
      appendLog,
      getSettingsWorkspaceService: () => createSettingsWorkspaceServiceStub(),
    })

    await expect(service.handleRequest(buildRequest({
      requestId: 'event-invalid-1',
      capability: 'event',
      operation: 'emit_event',
      payload: {
        eventType: '   ',
      },
    }))).resolves.toEqual({
      requestId: 'event-invalid-1',
      ok: false,
      errorCode: 'invalid_request',
      errorMessage: 'eventType must be a non-empty string.',
      errorRetryable: false,
      details: {},
    })
    expect(appendLog).not.toHaveBeenCalled()
  })
})
