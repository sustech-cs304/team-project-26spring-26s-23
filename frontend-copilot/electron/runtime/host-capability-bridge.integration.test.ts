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

const CAP_SECRET = 'secret' as const
const OP_GET_SECRET = 'get_secret' as const
const TOOL_BB = 'blackboard.snapshot.sync' as const
const TOOL_TIS = 'tis.credit_gpa.fetch' as const
const BB_CALL = 'blackboard.snapshot.sync:call-1' as const
const TIS_CALL = 'tis.credit_gpa.fetch:call-1' as const

const activeStops: Array<() => Promise<void>> = []
const activeTempRoots: string[] = []

afterEach(async () => {
  while (activeStops.length > 0) {
    const stop = activeStops.pop()
    if (stop === undefined) continue
    await stop()
  }

  while (activeTempRoots.length > 0) {
    const tempRoot = activeTempRoots.pop()
    if (tempRoot === undefined) continue
    await destroyWorkspaceTempRoot(tempRoot)
  }
})

function createSettingsWorkspaceServiceStub(): ElectronSettingsWorkspaceService {
  return {
    loadState: vi.fn(async () => ({ ok: true, source: 'stored' as const, state: { sustech: { studentId: '20251234', email: 'student@example.com' } } } as never)),
    loadSecretStates: vi.fn(async () => ({ ok: true, states: { openrouter: { hasApiKey: true, apiKey: 'openrouter-secret' } } } as never)),
    loadSustechCasSecret: vi.fn(async () => ({ ok: true, state: { hasPassword: true, password: 'cas-secret' } } as never)),
  } as unknown as ElectronSettingsWorkspaceService
}

async function postBridgeRequest(
  bridge: HostCapabilityBridge,
  body: Record<string, unknown>,
): Promise<{ response: Response; payload: Record<string, unknown> }> {
  const response = await fetch(bridge.bootstrap.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [HOST_CAPABILITY_BRIDGE_TOKEN_HEADER]: bridge.bootstrap.token },
    body: JSON.stringify(body),
  })
  return { response, payload: await response.json() as Record<string, unknown> }
}

interface BridgeTestContext {
  bridge: HostCapabilityBridge
  bridgePaths: ReturnType<typeof createDesktopCapabilityBridgePaths>
  appendLog: ReturnType<typeof vi.fn>
  settingsWorkspaceService: ReturnType<typeof createSettingsWorkspaceServiceStub>
  fixture: Awaited<ReturnType<typeof createPreparedPaths>>
}

async function setupBridgeTest(label: string): Promise<BridgeTestContext> {
  const fixture = await createPreparedPaths(`host-capability-bridge-${label}`)
  activeTempRoots.push(fixture.tempRoot)

  const appendLog = vi.fn()
  const settingsWorkspaceService = createSettingsWorkspaceServiceStub()
  const service = createElectronDesktopCapabilityBridgeService({
    prepareRuntimePaths: async () => fixture.hostedPaths,
    appendLog,
    getSettingsWorkspaceService: () => settingsWorkspaceService,
  })
  const bridgePaths = createDesktopCapabilityBridgePaths(fixture.hostedPaths)
  const bridge = await createHostCapabilityBridge({ handleRequest: (request) => service.handleRequest(request) })
  activeStops.push(bridge.stop)

  return { bridge, bridgePaths, appendLog, settingsWorkspaceService, fixture }
}

function makeSecretRequest(requestId: string, toolId: string, toolCallId: string, secretName: string) {
  return { requestId, capability: CAP_SECRET, operation: OP_GET_SECRET, toolId, runId: 'run-1', toolCallId, payload: { secretName } }
}

describe('createHostCapabilityBridge integrated runtime regression', () => {
  it('resolves blackboard secrets through the bridge', async () => {
    const ctx = await setupBridgeTest('bb-secrets')

    const r1 = await postBridgeRequest(ctx.bridge, makeSecretRequest('bb-1', TOOL_BB, BB_CALL, 'bb.username'))
    expect(r1.response.status).toBe(200)
    expect(r1.payload).toEqual({ requestId: 'bb-1', ok: true, result: { value: 'student@example.com' } })

    const r2 = await postBridgeRequest(ctx.bridge, makeSecretRequest('bb-2', TOOL_BB, BB_CALL, 'sustech.username'))
    expect(r2.response.status).toBe(200)
    expect(r2.payload).toEqual({ requestId: 'bb-2', ok: true, result: { value: 'student@example.com' } })

    const r3 = await postBridgeRequest(ctx.bridge, makeSecretRequest('bb-3', TOOL_BB, BB_CALL, 'bb.password'))
    expect(r3.response.status).toBe(200)
    expect(r3.payload).toEqual({ requestId: 'bb-3', ok: true, result: { value: 'cas-secret' } })

    const r4 = await postBridgeRequest(ctx.bridge, makeSecretRequest('bb-4', TOOL_BB, BB_CALL, 'sustech.casPassword'))
    expect(r4.response.status).toBe(200)
    expect(r4.payload).toEqual({ requestId: 'bb-4', ok: true, result: { value: 'cas-secret' } })

    expect(ctx.settingsWorkspaceService.loadState).toHaveBeenCalledTimes(2)
    expect(ctx.settingsWorkspaceService.loadSustechCasSecret).toHaveBeenCalledTimes(2)
  })

  it('resolves database paths through the bridge', async () => {
    const ctx = await setupBridgeTest('db-paths')

    const r1 = await postBridgeRequest(ctx.bridge, {
      requestId: 'bb-db-1', capability: 'database', operation: 'resolve_path',
      toolId: TOOL_BB, runId: 'run-1', toolCallId: BB_CALL,
      payload: { relativePath: 'blackboard/sustech.db' },
    })
    expect(r1.response.status).toBe(200)
    expect(r1.payload).toEqual({
      requestId: 'bb-db-1', ok: true,
      result: { path: path.resolve(ctx.fixture.hostedPaths.databaseDir, 'blackboard', 'sustech.db') },
    })

    const r2 = await postBridgeRequest(ctx.bridge, {
      requestId: 'tis-db-1', capability: 'database', operation: 'resolve_path',
      toolId: TOOL_TIS, runId: 'run-1', toolCallId: TIS_CALL,
      payload: { relativePath: 'teaching_information_system/sustech_tis.db' },
    })
    expect(r2.response.status).toBe(200)
    expect(r2.payload).toEqual({
      requestId: 'tis-db-1', ok: true,
      result: { path: path.resolve(ctx.fixture.hostedPaths.databaseDir, 'teaching_information_system', 'sustech_tis.db') },
    })
  })

  it('handles artifact save and readback through the bridge', async () => {
    const ctx = await setupBridgeTest('artifact')

    const artifactText = '{"dbPath":"database-root/blackboard/sustech.db","integrityOk":true}'
    const r1 = await postBridgeRequest(ctx.bridge, {
      requestId: 'bb-artifact-1', capability: 'artifact', operation: 'save_text',
      toolId: TOOL_BB, runId: 'run-1', toolCallId: BB_CALL,
      payload: { name: 'snapshot.json', text: artifactText, contentType: 'application/json', metadata: { toolId: TOOL_BB, invocationId: BB_CALL } },
    })
    expect(r1.response.status).toBe(200)
    expect(r1.payload).toMatchObject({
      requestId: 'bb-artifact-1', ok: true,
      result: { artifactId: expect.stringMatching(/^artifact-/), uri: expect.stringMatching(/^artifact:\/\/desktop\/artifact-/), name: 'snapshot.json', contentType: 'application/json', metadata: { toolId: TOOL_BB, invocationId: BB_CALL } },
    })

    const artifactId = String(r1.payload.result.artifactId)
    const artifactIndex = await readJsonFile(ctx.bridgePaths.artifactIndexFile) as { artifacts?: Record<string, { fileName?: string }> }
    const artifactFileName = artifactIndex.artifacts?.[artifactId]?.fileName
    if (artifactFileName === undefined) throw new Error(`Expected artifact '${artifactId}' to be persisted.`)
    const artifactFilePath = path.join(ctx.bridgePaths.artifactsDir, artifactFileName)
    await access(artifactFilePath)
    await expect(readFile(artifactFilePath, 'utf8')).resolves.toBe(artifactText)
  })

  it('handles TIS tool state persistence through the bridge', async () => {
    const ctx = await setupBridgeTest('tis-state')

    const stateKey = 'tis.credit_gpa.fetch:tis.credit_gpa.fetch:credit-gpa-latest'
    const putResult = await postBridgeRequest(ctx.bridge, {
      requestId: 'tis-state-put-1', capability: 'state', operation: 'put_value',
      toolId: TOOL_TIS, runId: 'run-1', toolCallId: TIS_CALL,
      payload: { scope: 'tool', key: stateKey, value: { summary: { average_credit_gpa: 3.82 } } },
    })
    expect(putResult.response.status).toBe(200)
    expect(putResult.payload).toEqual({ requestId: 'tis-state-put-1', ok: true, result: {} })

    const getResult = await postBridgeRequest(ctx.bridge, {
      requestId: 'tis-state-get-1', capability: 'state', operation: 'get_value',
      toolId: TOOL_TIS, runId: 'run-1', toolCallId: TIS_CALL,
      payload: { scope: 'tool', key: stateKey },
    })
    expect(getResult.response.status).toBe(200)
    expect(getResult.payload).toEqual({ requestId: 'tis-state-get-1', ok: true, result: { found: true, value: { summary: { average_credit_gpa: 3.82 } } } })

    await expect(readJsonFile(ctx.bridgePaths.stateFile)).resolves.toMatchObject({
      version: 1,
      values: { tool: { 'tis.credit_gpa.fetch': { [stateKey]: { summary: { average_credit_gpa: 3.82 } } } } },
    })
  })

  it('handles event emission through the bridge', async () => {
    const ctx = await setupBridgeTest('events')

    const result = await postBridgeRequest(ctx.bridge, {
      requestId: 'tis-event-1', capability: 'event', operation: 'emit_event',
      toolId: TOOL_TIS, runId: 'run-1', toolCallId: TIS_CALL,
      payload: { eventType: 'tis.credit_gpa.fetch.completed', message: 'completed', data: { severity: 'info', artifactCount: 1 } },
    })
    expect(result.response.status).toBe(200)
    expect(result.payload).toEqual({ requestId: 'tis-event-1', ok: true, result: {} })
    expect(ctx.appendLog).toHaveBeenCalledWith('info', '[capability-bridge] Event emitted.', expect.objectContaining({ toolId: TOOL_TIS, runId: 'run-1', toolCallId: TIS_CALL, eventType: 'tis.credit_gpa.fetch.completed', message: 'completed', data: { severity: 'info', artifactCount: 1 } }), { relayToRenderer: false })
  })
})
