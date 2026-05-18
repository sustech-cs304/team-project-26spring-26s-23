import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { HostedBackendService } from '../runtime/hosted-backend-service'
import { createHostedRuntimePaths, ensureHostedRuntimeDirectories } from '../runtime/runtime-paths'
import { createElectronUnifiedConfigService } from './main-process'

async function createPreparedPaths(testName: string) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), `candue-config-center-main-${testName}-`))
  const hostedPaths = createHostedRuntimePaths(tempRoot)
  await ensureHostedRuntimeDirectories(hostedPaths)

  return {
    tempRoot,
    hostedPaths,
  } as const
}

describe('createElectronUnifiedConfigService', () => {
  it('loads a renderer-safe public snapshot from the unified config center', async () => {
    const fixture = await createPreparedPaths('load-public-snapshot')
    const service = createElectronUnifiedConfigService({
      prepareRuntimePaths: async () => fixture.hostedPaths,
    })

    try {
      const result = await service.loadPublicSnapshot()

      expect(result).toEqual({
        ok: true,
        snapshot: {
          version: 1,
          domains: {
            frontendPreferences: {
              theme: 'light',
              animationsEnabled: true,
            },
            assistantBehavior: {
              agentName: null,
              debugModeEnabled: false,
            },
            hostConfig: {
              runtimeUrl: null,
            },
            backendExposed: {
              model: null,
            },
            general: {
              language: 'zh-CN',
            },
          },
        },
      })
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })

  it('applies a public patch and returns the latest public snapshot', async () => {
    const fixture = await createPreparedPaths('apply-public-patch')
    const service = createElectronUnifiedConfigService({
      prepareRuntimePaths: async () => fixture.hostedPaths,
    })

    try {
      const result = await service.applyPublicPatch({
        domains: {
          frontendPreferences: {
            theme: 'dark',
            animationsEnabled: false,
          },
          assistantBehavior: {
            agentName: '  planner  ',
            debugModeEnabled: true,
          },
          hostConfig: {
            runtimeUrl: '  http://127.0.0.1:4400  ',
          },
          backendExposed: {
            model: '  qwen-plus  ',
          },
        },
      })

      expect(result).toEqual({
        ok: true,
        snapshot: {
          version: 1,
          domains: {
            frontendPreferences: {
              theme: 'dark',
              animationsEnabled: false,
            },
            assistantBehavior: {
              agentName: 'planner',
              debugModeEnabled: true,
            },
            hostConfig: {
              runtimeUrl: 'http://127.0.0.1:4400',
            },
            backendExposed: {
              model: 'qwen-plus',
            },
            general: {
              language: 'zh-CN',
            },
          },
        },
      })
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })

  it('publishes a public snapshot update after a public patch succeeds', async () => {
    const publishPublicSnapshotUpdate = vi.fn()
    const fixture = await createPreparedPaths('publish-public-snapshot-update')
    const service = createElectronUnifiedConfigService({
      prepareRuntimePaths: async () => fixture.hostedPaths,
      publishPublicSnapshotUpdate,
    })

    try {
      const result = await service.applyPublicPatch({
        domains: {
          frontendPreferences: {
            theme: 'dark',
          },
          assistantBehavior: {
            agentName: '  planner  ',
            debugModeEnabled: false,
          },
        },
      })

      expect(result.ok).toBe(true)
      if (!result.ok) {
        throw new Error('Expected public patch application to succeed.')
      }

      expect(publishPublicSnapshotUpdate).toHaveBeenCalledOnce()
      expect(publishPublicSnapshotUpdate).toHaveBeenCalledWith(result.snapshot)
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })

  it('rejects invalid public patch payloads with a structured failure', async () => {
    const fixture = await createPreparedPaths('reject-invalid-public-patch')
    const service = createElectronUnifiedConfigService({
      prepareRuntimePaths: async () => fixture.hostedPaths,
    })

    try {
      const result = await service.applyPublicPatch({
        domains: {
          assistantBehavior: {
            agentName: 42 as never,
          },
        },
      })

      expect(result.ok).toBe(false)
      if (result.ok) {
        throw new Error('Expected public patch application to fail.')
      }

      expect(result.error).toContain('Failed to apply config center public patch:')
      expect(result.error).toContain('assistantBehavior.agentName')
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })

  it('exposes the hosted backend service accessor when configured', async () => {
    const fixture = await createPreparedPaths('hosted-backend-accessor')
    const hostedBackendService = {
      start: vi.fn(),
      stop: vi.fn(),
      getState: vi.fn(),
      getLastFailure: vi.fn(),
      getRuntimeBaseUrl: vi.fn(() => 'http://127.0.0.1:8765'),
      getLocalToken: vi.fn(() => 'runtime-token'),
    } as unknown as HostedBackendService
    const ensureHostedBackendService = vi.fn(async () => hostedBackendService)
    const service = createElectronUnifiedConfigService({
      prepareRuntimePaths: async () => fixture.hostedPaths,
      ensureHostedBackendService,
    })

    try {
      await expect(service.getHostedBackendService()).resolves.toBe(hostedBackendService)
      expect(ensureHostedBackendService).toHaveBeenCalledOnce()
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })
})
