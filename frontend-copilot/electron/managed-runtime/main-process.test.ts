import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createHostedRuntimePaths } from '../runtime/runtime-paths'
import { createElectronManagedRuntimeService } from './main-process'

describe('createElectronManagedRuntimeService', () => {
  it('retries path preparation after a failed first load and caches the recovered service', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-managed-runtime-main-process-'))
    const appendLog = vi.fn()
    const hostedPaths = createHostedRuntimePaths(tempRoot)
    const prepareRuntimePaths = vi.fn(async () => hostedPaths)
    prepareRuntimePaths.mockRejectedValueOnce(new Error('runtime path bootstrap failed.'))

    const service = createElectronManagedRuntimeService({
      prepareRuntimePaths,
      userDataPath: tempRoot,
      appendLog,
    })

    try {
      await expect(service.load()).resolves.toEqual({
        ok: false,
        error: 'Failed to load managed runtime snapshot: runtime path bootstrap failed.',
        code: 'internal_error',
      })

      await expect(service.load()).resolves.toMatchObject({
        ok: true,
        snapshot: {
          overallStatus: 'missing',
        },
      })

      expect(prepareRuntimePaths).toHaveBeenCalledTimes(2)
      expect(appendLog).toHaveBeenCalledWith(
        'error',
        '[managed-runtime] Failed to load managed runtime snapshot.',
        { detail: 'runtime path bootstrap failed.' },
      )
    } finally {
      await rm(tempRoot, { recursive: true, force: true })
    }
  })
})

