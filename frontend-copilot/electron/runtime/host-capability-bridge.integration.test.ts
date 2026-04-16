import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ElectronSettingsWorkspaceService } from '../settings-workspace/main-process'
import { createDesktopCapabilityBridgePaths } from '../capability-bridge/paths'
import { createElectronDesktopCapabilityBridgeService } from '../capability-bridge/ipc/DesktopCapabilityBridgeMainProcess'
import {
  createPreparedPaths,
  destroyWorkspaceTempRoot,
  readJsonFile,
} from '../settings-workspace/test-support/settings-workspace-test-fixtures'
import {
  createHostCapabilityBridge,
  HOST_CAPABILITY_BRIDGE_TOKEN_HEADER,
  type HostCapabilityBridge,
} from './host-capability-bridge'

const activeStops: Array<() => Promise<void>> = []
const activeTempRoots: string[] = []

afterEach(async () => {
  while (activeStops.length > 0) {
    const stop = activeStops.pop()
    if (stop === undefined) {
      continue
    }
    await stop()
  }

  while (activeTempRoots.length > 0) {
    const tempRoot = activeTempRoots.pop()
    if (tempRoot === undefined) {
      continue
    }
    await destroyWorkspaceTempRoot(tempRoot)
  }
})

function createSettingsWorkspaceServiceStub(): ElectronSettingsWorkspaceService {
  return {
    loadState: vi.fn(async () => ({
      ok: true,
      source: 'stored',
      state: {
        sustech: {
          studentId: '20251234',
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

async function postBridgeRequest(
  bridge: HostCapabilityBridge,
  body: Record<string, unknown>,
): Promise<{
  response: Response
  payload: Record<string, any>
}> {
  const response = await fetch(bridge.bootstrap.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [HOST_CAPABILITY_BRIDGE_TOKEN_HEADER]: bridge.bootstrap.token,
    },
    body: JSON.stringify(body),
  })

  return {
    response,
    payload: await response.json() as Record<string, any>,
  }
}

describe('createHostCapabilityBridge integrated runtime regression', () => {
  it('routes blackboard and tis host capability traffic through the runtime HTTP bridge into the electron capability service', async () => {
    const fixture = await createPreparedPaths('host-capability-bridge-runtime-regression')
    activeTempRoots.push(fixture.tempRoot)

    const appendLog = vi.fn()
    const settingsWorkspaceService = createSettingsWorkspaceServiceStub()
    const service = createElectronDesktopCapabilityBridgeService({
      prepareRuntimePaths: async () => fixture.hostedPaths,
      appendLog,
      getSettingsWorkspaceService: () => settingsWorkspaceService,
    })
    const bridgePaths = createDesktopCapabilityBridgePaths(fixture.hostedPaths)
    const bridge = await createHostCapabilityBridge({
      handleRequest: (request) => service.handleRequest(request),
    })
    activeStops.push(bridge.stop)

    const blackboardUsernameSecret = await postBridgeRequest(bridge, {
      requestId: 'bb-username-secret-1',
      capability: 'secret',
      operation: 'get_secret',
      toolId: 'blackboard.snapshot.sync',
      runId: 'run-blackboard-1',
      toolCallId: 'blackboard.snapshot.sync:call-1',
      payload: {
        secretName: 'bb.username',
      },
    })
    expect(blackboardUsernameSecret.response.status).toBe(200)
    expect(blackboardUsernameSecret.payload).toEqual({
      requestId: 'bb-username-secret-1',
      ok: true,
      result: {
        value: 'student@example.com',
      },
    })

    const blackboardFallbackUsernameSecret = await postBridgeRequest(bridge, {
      requestId: 'bb-username-secret-2',
      capability: 'secret',
      operation: 'get_secret',
      toolId: 'blackboard.snapshot.sync',
      runId: 'run-blackboard-1',
      toolCallId: 'blackboard.snapshot.sync:call-1',
      payload: {
        secretName: 'sustech.username',
      },
    })
    expect(blackboardFallbackUsernameSecret.response.status).toBe(200)
    expect(blackboardFallbackUsernameSecret.payload).toEqual({
      requestId: 'bb-username-secret-2',
      ok: true,
      result: {
        value: 'student@example.com',
      },
    })

    const blackboardSecret = await postBridgeRequest(bridge, {
      requestId: 'bb-secret-1',
      capability: 'secret',
      operation: 'get_secret',
      toolId: 'blackboard.snapshot.sync',
      runId: 'run-blackboard-1',
      toolCallId: 'blackboard.snapshot.sync:call-1',
      payload: {
        secretName: 'bb.password',
      },
    })
    expect(blackboardSecret.response.status).toBe(200)
    expect(blackboardSecret.payload).toEqual({
      requestId: 'bb-secret-1',
      ok: true,
      result: {
        value: 'cas-secret',
      },
    })

    const blackboardFallbackPasswordSecret = await postBridgeRequest(bridge, {
      requestId: 'bb-secret-2',
      capability: 'secret',
      operation: 'get_secret',
      toolId: 'blackboard.snapshot.sync',
      runId: 'run-blackboard-1',
      toolCallId: 'blackboard.snapshot.sync:call-1',
      payload: {
        secretName: 'sustech.casPassword',
      },
    })
    expect(blackboardFallbackPasswordSecret.response.status).toBe(200)
    expect(blackboardFallbackPasswordSecret.payload).toEqual({
      requestId: 'bb-secret-2',
      ok: true,
      result: {
        value: 'cas-secret',
      },
    })

    const blackboardDatabasePath = await postBridgeRequest(bridge, {
      requestId: 'bb-database-1',
      capability: 'database',
      operation: 'resolve_path',
      toolId: 'blackboard.snapshot.sync',
      runId: 'run-blackboard-1',
      toolCallId: 'blackboard.snapshot.sync:call-1',
      payload: {
        relativePath: 'blackboard/sustech.db',
      },
    })
    expect(blackboardDatabasePath.response.status).toBe(200)
    expect(blackboardDatabasePath.payload).toEqual({
      requestId: 'bb-database-1',
      ok: true,
      result: {
        path: path.resolve(fixture.hostedPaths.databaseDir, 'blackboard', 'sustech.db'),
      },
    })

    const tisDatabasePath = await postBridgeRequest(bridge, {
      requestId: 'tis-database-1',
      capability: 'database',
      operation: 'resolve_path',
      toolId: 'tis.credit_gpa.fetch',
      runId: 'run-tis-1',
      toolCallId: 'tis.credit_gpa.fetch:call-1',
      payload: {
        relativePath: 'teaching_information_system/sustech_tis.db',
      },
    })
    expect(tisDatabasePath.response.status).toBe(200)
    expect(tisDatabasePath.payload).toEqual({
      requestId: 'tis-database-1',
      ok: true,
      result: {
        path: path.resolve(
          fixture.hostedPaths.databaseDir,
          'teaching_information_system',
          'sustech_tis.db',
        ),
      },
    })

    const blackboardArtifactText = '{"dbPath":"database-root/blackboard/sustech.db","integrityOk":true}'
    const blackboardArtifact = await postBridgeRequest(bridge, {
      requestId: 'bb-artifact-1',
      capability: 'artifact',
      operation: 'save_text',
      toolId: 'blackboard.snapshot.sync',
      runId: 'run-blackboard-1',
      toolCallId: 'blackboard.snapshot.sync:call-1',
      payload: {
        name: 'snapshot.json',
        text: blackboardArtifactText,
        contentType: 'application/json',
        metadata: {
          toolId: 'blackboard.snapshot.sync',
          invocationId: 'blackboard.snapshot.sync:call-1',
        },
      },
    })
    expect(blackboardArtifact.response.status).toBe(200)
    expect(blackboardArtifact.payload).toMatchObject({
      requestId: 'bb-artifact-1',
      ok: true,
      result: {
        artifactId: expect.stringMatching(/^artifact-/),
        uri: expect.stringMatching(/^artifact:\/\/desktop\/artifact-/),
        name: 'snapshot.json',
        contentType: 'application/json',
        metadata: {
          toolId: 'blackboard.snapshot.sync',
          invocationId: 'blackboard.snapshot.sync:call-1',
        },
      },
    })

    const artifactId = String(blackboardArtifact.payload.result.artifactId)
    const artifactIndex = await readJsonFile(bridgePaths.artifactIndexFile) as {
      artifacts?: Record<string, { fileName?: string }>
    }
    const artifactFileName = artifactIndex.artifacts?.[artifactId]?.fileName
    if (artifactFileName === undefined) {
      throw new Error(`Expected artifact '${artifactId}' to be persisted by the bridge.`)
    }
    const artifactFilePath = path.join(bridgePaths.artifactsDir, artifactFileName)
    await access(artifactFilePath)
    await expect(readFile(artifactFilePath, 'utf8')).resolves.toBe(blackboardArtifactText)

    const tisStateKey = 'tis.credit_gpa.fetch:tis.credit_gpa.fetch:credit-gpa-latest'
    const tisStatePut = await postBridgeRequest(bridge, {
      requestId: 'tis-state-put-1',
      capability: 'state',
      operation: 'put_value',
      toolId: 'tis.credit_gpa.fetch',
      runId: 'run-tis-1',
      toolCallId: 'tis.credit_gpa.fetch:call-1',
      payload: {
        scope: 'tool',
        key: tisStateKey,
        value: {
          summary: {
            average_credit_gpa: 3.82,
          },
        },
      },
    })
    expect(tisStatePut.response.status).toBe(200)
    expect(tisStatePut.payload).toEqual({
      requestId: 'tis-state-put-1',
      ok: true,
      result: {},
    })

    const tisStateGet = await postBridgeRequest(bridge, {
      requestId: 'tis-state-get-1',
      capability: 'state',
      operation: 'get_value',
      toolId: 'tis.credit_gpa.fetch',
      runId: 'run-tis-1',
      toolCallId: 'tis.credit_gpa.fetch:call-1',
      payload: {
        scope: 'tool',
        key: tisStateKey,
      },
    })
    expect(tisStateGet.response.status).toBe(200)
    expect(tisStateGet.payload).toEqual({
      requestId: 'tis-state-get-1',
      ok: true,
      result: {
        found: true,
        value: {
          summary: {
            average_credit_gpa: 3.82,
          },
        },
      },
    })
    await expect(readJsonFile(bridgePaths.stateFile)).resolves.toMatchObject({
      version: 1,
      values: {
        tool: {
          'tis.credit_gpa.fetch': {
            [tisStateKey]: {
              summary: {
                average_credit_gpa: 3.82,
              },
            },
          },
        },
      },
    })

    const tisEvent = await postBridgeRequest(bridge, {
      requestId: 'tis-event-1',
      capability: 'event',
      operation: 'emit_event',
      toolId: 'tis.credit_gpa.fetch',
      runId: 'run-tis-1',
      toolCallId: 'tis.credit_gpa.fetch:call-1',
      payload: {
        eventType: 'tis.credit_gpa.fetch.completed',
        message: 'completed',
        data: {
          severity: 'info',
          artifactCount: 1,
        },
      },
    })
    expect(tisEvent.response.status).toBe(200)
    expect(tisEvent.payload).toEqual({
      requestId: 'tis-event-1',
      ok: true,
      result: {},
    })
    expect(appendLog).toHaveBeenCalledWith(
      'info',
      '[capability-bridge] Event emitted.',
      expect.objectContaining({
        toolId: 'tis.credit_gpa.fetch',
        runId: 'run-tis-1',
        toolCallId: 'tis.credit_gpa.fetch:call-1',
        eventType: 'tis.credit_gpa.fetch.completed',
        message: 'completed',
        data: {
          severity: 'info',
          artifactCount: 1,
        },
      }),
      {
        relayToRenderer: false,
      },
    )
    expect(settingsWorkspaceService.loadState).toHaveBeenCalledTimes(2)
    expect(settingsWorkspaceService.loadSustechCasSecret).toHaveBeenCalledTimes(2)
  })
})
