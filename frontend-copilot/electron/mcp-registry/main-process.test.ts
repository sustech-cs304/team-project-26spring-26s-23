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
})
