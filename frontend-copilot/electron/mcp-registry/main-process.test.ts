import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { createHostedRuntimePaths } from '../runtime/runtime-paths'
import { createElectronMcpRegistryService } from './main-process'

const MCP_TOOL_ID_STUB = 'mcp.mcp-stdio-stub.search-campus.00004d8d'
const MCP_SERVER_ID_STUB = 'mcp-stdio-stub'
const MCP_REMOTE_TOOL_NAME = 'search-campus'
const MCP_RUN_ID = 'run-1'
const MCP_TOOL_CALL_ID = 'tool-call-1'
const MCP_FIXED_NOW = '2026-04-21T12:00:00.000Z'
const MCP_BOOTSTRAP_FAILED = 'runtime path bootstrap failed'

// eslint-disable-next-line max-lines-per-function -- This describe groups related main-process integration tests; splitting would scatter coordinated lifecycle logic.
describe('createElectronMcpRegistryService', () => {
  it('retries runtime path initialization after a failed first attempt and caches the recovered service', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-mcp-main-process-'))
    const appendLog = vi.fn()
    const hostedPaths = createHostedRuntimePaths(tempRoot)
    const prepareRuntimePaths = vi.fn(async () => hostedPaths)
    prepareRuntimePaths.mockRejectedValueOnce(new Error(MCP_BOOTSTRAP_FAILED))

    const service = createElectronMcpRegistryService({
      prepareRuntimePaths,
      appendLog,
      now: () => MCP_FIXED_NOW,
    })

    try {
      await expect(service.loadRegistry({ includeDisabled: true })).resolves.toEqual({
        ok: false,
        error: `Failed to load the MCP registry: ${MCP_BOOTSTRAP_FAILED}`,
        code: 'internal_error',
      })

      const expectedLoadResult = {
        ok: true as const,
        registryRevision: 0,
        snapshotRevision: 0,
        servers: [],
        states: [],
      }

      await expect(service.loadRegistry({ includeDisabled: true })).resolves.toEqual(expectedLoadResult)
      await expect(service.loadRegistry({ includeDisabled: true })).resolves.toEqual(expectedLoadResult)

      expect(prepareRuntimePaths).toHaveBeenCalledTimes(2)
      expect(appendLog).toHaveBeenCalledWith(
        'error',
        '[mcp-registry] Failed to load the MCP registry.',
        { detail: MCP_BOOTSTRAP_FAILED },
      )
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('warms enabled MCP servers on startup without recreating the cached service', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-mcp-main-process-startup-'))
    const appendLog = vi.fn()
    const hostedPaths = createHostedRuntimePaths(tempRoot)
    const prepareRuntimePaths = vi.fn(async () => hostedPaths)

    const service = createElectronMcpRegistryService({
      prepareRuntimePaths,
      appendLog,
      now: () => MCP_FIXED_NOW,
    })

    try {
      await expect(service.warmupEnabledServersOnStartup()).resolves.toBeUndefined()
      await expect(service.loadRegistry({ includeDisabled: true })).resolves.toEqual({
        ok: true,
        registryRevision: 0,
        snapshotRevision: 0,
        servers: [],
        states: [],
      })

      expect(prepareRuntimePaths).toHaveBeenCalledTimes(1)
      expect(appendLog).not.toHaveBeenCalled()
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('loads an empty registry without unsupported target failures on Linux-managed runtime bootstrap', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-mcp-main-process-linux-'))
    const appendLog = vi.fn()
    const hostedPaths = createHostedRuntimePaths(tempRoot)

    const service = createElectronMcpRegistryService({
      prepareRuntimePaths: async () => hostedPaths,
      appendLog,
      now: () => MCP_FIXED_NOW,
      processPlatform: 'linux',
      processArch: 'x64',
    })

    try {
      await expect(service.loadRegistry({ includeDisabled: true })).resolves.toEqual({
        ok: true,
        registryRevision: 0,
        snapshotRevision: 0,
        servers: [],
        states: [],
      })
      expect(appendLog).not.toHaveBeenCalledWith(
        'error',
        '[mcp-registry] Failed to load the MCP registry.',
        expect.objectContaining({ detail: expect.stringContaining('Unsupported managed runtime target') }),
      )
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('returns the service-provided tool-call failure contract unchanged when executeTool fails without throwing', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-mcp-main-process-execute-tool-'))
    const appendLog = vi.fn()
    const hostedPaths = createHostedRuntimePaths(tempRoot)
    const prepareRuntimePaths = vi.fn(async () => hostedPaths)

    const service = createElectronMcpRegistryService({
      prepareRuntimePaths,
      appendLog,
      now: () => MCP_FIXED_NOW,
    })

    try {
      const loadResult = await service.loadRegistry({ includeDisabled: true })
      expect(loadResult.ok).toBe(true)

      const toolResult = await service.executeTool({
        toolId: MCP_TOOL_ID_STUB,
        serverId: MCP_SERVER_ID_STUB,
        remoteToolName: MCP_REMOTE_TOOL_NAME,
        arguments: { keyword: 'calendar' },
        runId: MCP_RUN_ID,
        toolCallId: MCP_TOOL_CALL_ID,
        snapshotRevision: 8,
      })

      expect(toolResult).toEqual({
        ok: false,
        toolId: MCP_TOOL_ID_STUB,
        serverId: MCP_SERVER_ID_STUB,
        remoteToolName: MCP_REMOTE_TOOL_NAME,
        snapshotRevision: 8,
        error: {
          code: 'directory_drift',
          message: 'The requested MCP tool no longer exists in the current snapshot.',
          retryable: false,
          observedAt: MCP_FIXED_NOW,
          details: {
            requestedServerId: MCP_SERVER_ID_STUB,
            requestedRemoteToolName: MCP_REMOTE_TOOL_NAME,
            connectorToolCount: 0,
            requestedSnapshotRevision: 8,
            snapshotRevision: 0,
          },
        },
      })

      expect(appendLog).not.toHaveBeenCalled()
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })

  it('maps unexpected executeTool failures into a typed MCP tool-call failure while preserving request context', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-mcp-main-process-execute-tool-throw-'))
    const appendLog = vi.fn()
    const hostedPaths = createHostedRuntimePaths(tempRoot)
    const prepareRuntimePaths = vi.fn(async () => hostedPaths)
    prepareRuntimePaths.mockRejectedValueOnce(new Error(MCP_BOOTSTRAP_FAILED))

    const service = createElectronMcpRegistryService({
      prepareRuntimePaths,
      appendLog,
      now: () => MCP_FIXED_NOW,
    })

    try {
      await expect(service.executeTool({
        toolId: MCP_TOOL_ID_STUB,
        serverId: MCP_SERVER_ID_STUB,
        remoteToolName: MCP_REMOTE_TOOL_NAME,
        arguments: { keyword: 'calendar' },
        runId: MCP_RUN_ID,
        toolCallId: MCP_TOOL_CALL_ID,
        snapshotRevision: 8,
      })).resolves.toEqual({
        ok: false,
        toolId: MCP_TOOL_ID_STUB,
        serverId: MCP_SERVER_ID_STUB,
        remoteToolName: MCP_REMOTE_TOOL_NAME,
        snapshotRevision: 8,
        error: {
          code: 'internal_error',
          message: `Failed to execute the MCP tool: ${MCP_BOOTSTRAP_FAILED}`,
          retryable: false,
          details: {
            toolId: MCP_TOOL_ID_STUB,
            serverId: MCP_SERVER_ID_STUB,
            remoteToolName: MCP_REMOTE_TOOL_NAME,
            snapshotRevision: 8,
            runId: MCP_RUN_ID,
            toolCallId: MCP_TOOL_CALL_ID,
          },
        },
      })

      expect(appendLog).toHaveBeenCalledWith(
        'error',
        '[mcp-registry] Failed to execute the MCP tool.',
        {
          detail: MCP_BOOTSTRAP_FAILED,
          toolId: MCP_TOOL_ID_STUB,
          serverId: MCP_SERVER_ID_STUB,
          remoteToolName: MCP_REMOTE_TOOL_NAME,
          snapshotRevision: 8,
          runId: MCP_RUN_ID,
          toolCallId: MCP_TOOL_CALL_ID,
        },
      )
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })
})
