import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { createHostedRuntimePaths } from '../runtime/runtime-paths'
import { createElectronMcpRegistryService } from './main-process'

describe('createElectronMcpRegistryService', () => {
  it('retries runtime path initialization after a failed first attempt and caches the recovered service', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-mcp-main-process-'))
    const appendLog = vi.fn()
    const hostedPaths = createHostedRuntimePaths(tempRoot)
    const prepareRuntimePaths = vi.fn(async () => hostedPaths)
    prepareRuntimePaths.mockRejectedValueOnce(new Error('runtime path bootstrap failed.'))

    const service = createElectronMcpRegistryService({
      prepareRuntimePaths,
      appendLog,
      now: () => '2026-04-21T12:00:00.000Z',
    })

    try {
      await expect(service.loadRegistry({ includeDisabled: true })).resolves.toEqual({
        ok: false,
        error: 'Failed to load the MCP registry: runtime path bootstrap failed.',
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
        { detail: 'runtime path bootstrap failed.' },
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
      now: () => '2026-04-21T12:00:00.000Z',
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
      now: () => '2026-04-21T12:00:00.000Z',
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
      now: () => '2026-04-21T12:00:00.000Z',
    })

    try {
      const loadResult = await service.loadRegistry({ includeDisabled: true })
      expect(loadResult.ok).toBe(true)

      const toolResult = await service.executeTool({
        toolId: 'mcp.mcp-stdio-stub.search-campus.00004d8d',
        serverId: 'mcp-stdio-stub',
        remoteToolName: 'search-campus',
        arguments: { keyword: 'calendar' },
        runId: 'run-1',
        toolCallId: 'tool-call-1',
        snapshotRevision: 8,
      })

      expect(toolResult).toEqual({
        ok: false,
        toolId: 'mcp.mcp-stdio-stub.search-campus.00004d8d',
        serverId: 'mcp-stdio-stub',
        remoteToolName: 'search-campus',
        snapshotRevision: 8,
        error: {
          code: 'directory_drift',
          message: 'The requested MCP tool no longer exists in the current snapshot.',
          retryable: false,
          observedAt: '2026-04-21T12:00:00.000Z',
          details: {
            requestedServerId: 'mcp-stdio-stub',
            requestedRemoteToolName: 'search-campus',
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
    prepareRuntimePaths.mockRejectedValueOnce(new Error('runtime path bootstrap failed.'))

    const service = createElectronMcpRegistryService({
      prepareRuntimePaths,
      appendLog,
      now: () => '2026-04-21T12:00:00.000Z',
    })

    try {
      await expect(service.executeTool({
        toolId: 'mcp.mcp-stdio-stub.search-campus.00004d8d',
        serverId: 'mcp-stdio-stub',
        remoteToolName: 'search-campus',
        arguments: { keyword: 'calendar' },
        runId: 'run-1',
        toolCallId: 'tool-call-1',
        snapshotRevision: 8,
      })).resolves.toEqual({
        ok: false,
        toolId: 'mcp.mcp-stdio-stub.search-campus.00004d8d',
        serverId: 'mcp-stdio-stub',
        remoteToolName: 'search-campus',
        snapshotRevision: 8,
        error: {
          code: 'internal_error',
          message: 'Failed to execute the MCP tool: runtime path bootstrap failed.',
          retryable: false,
          details: {
            toolId: 'mcp.mcp-stdio-stub.search-campus.00004d8d',
            serverId: 'mcp-stdio-stub',
            remoteToolName: 'search-campus',
            snapshotRevision: 8,
            runId: 'run-1',
            toolCallId: 'tool-call-1',
          },
        },
      })

      expect(appendLog).toHaveBeenCalledWith(
        'error',
        '[mcp-registry] Failed to execute the MCP tool.',
        {
          detail: 'runtime path bootstrap failed.',
          toolId: 'mcp.mcp-stdio-stub.search-campus.00004d8d',
          serverId: 'mcp-stdio-stub',
          remoteToolName: 'search-campus',
          snapshotRevision: 8,
          runId: 'run-1',
          toolCallId: 'tool-call-1',
        },
      )
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })
})
