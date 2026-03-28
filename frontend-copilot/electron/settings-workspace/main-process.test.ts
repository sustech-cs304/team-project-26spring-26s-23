import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createHostedRuntimePaths, ensureHostedRuntimeDirectories } from '../runtime/runtime-paths'
import { createElectronSettingsWorkspaceService } from './main-process'

async function createPreparedPaths(testName: string) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), `candue-settings-main-${testName}-`))
  const hostedPaths = createHostedRuntimePaths(tempRoot)
  await ensureHostedRuntimeDirectories(hostedPaths)

  return {
    tempRoot,
    hostedPaths,
  }
}

describe('createElectronSettingsWorkspaceService', () => {
  it('loads settings workspace state and records initialization logging once', async () => {
    const fixture = await createPreparedPaths('load-state')
    const appendLog = vi.fn()
    const service = createElectronSettingsWorkspaceService({
      prepareRuntimePaths: async () => fixture.hostedPaths,
      appendLog,
    })

    try {
      const result = await service.loadState()

      expect(result.ok).toBe(true)
      if (!result.ok) {
        throw new Error('Expected settings workspace load to succeed.')
      }

      expect(result.source).toBe('initialized-defaults')
      expect(result.state.providerProfiles.length).toBeGreaterThan(0)
      expect(appendLog).toHaveBeenCalledWith('info', 'Initialized settings workspace persistence documents.', null)
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })

  it('saves state and mutates provider secret status through the settings workspace main-process API', async () => {
    const fixture = await createPreparedPaths('save-state-and-secret')
    const service = createElectronSettingsWorkspaceService({
      prepareRuntimePaths: async () => fixture.hostedPaths,
    })

    try {
      const loaded = await service.loadState()
      expect(loaded.ok).toBe(true)
      if (!loaded.ok) {
        throw new Error('Expected initial settings workspace load to succeed.')
      }

      const saveResult = await service.saveState({
        ...loaded.state,
        providerProfiles: loaded.state.providerProfiles.map(({ hasApiKey: _hasApiKey, ...profile }, index) => {
          return index === 0
            ? {
              ...profile,
              name: 'Main Process Persisted Provider',
            }
            : profile
        }),
      })

      expect(saveResult.ok).toBe(true)
      if (!saveResult.ok) {
        throw new Error('Expected settings workspace save to succeed.')
      }
      expect(saveResult.state.providerProfiles[0]?.name).toBe('Main Process Persisted Provider')

      const saveSecretResult = await service.saveProviderSecret({
        providerId: loaded.state.providerProfiles[0]?.id ?? 'openrouter',
        apiKey: 'main-process-secret',
      })
      expect(saveSecretResult).toEqual({
        ok: true,
        providerId: loaded.state.providerProfiles[0]?.id ?? 'openrouter',
        state: {
          hasApiKey: true,
          apiKey: 'main-process-secret',
        },
      })

      const secretStatesResult = await service.loadSecretStates({
        providerIds: [loaded.state.providerProfiles[0]?.id ?? 'openrouter'],
      })
      expect(secretStatesResult).toEqual({
        ok: true,
        states: {
          [loaded.state.providerProfiles[0]?.id ?? 'openrouter']: {
            hasApiKey: true,
            apiKey: 'main-process-secret',
          },
        },
      })

      const clearSecretResult = await service.clearProviderSecret({
        providerId: loaded.state.providerProfiles[0]?.id ?? 'openrouter',
      })
      expect(clearSecretResult).toEqual({
        ok: true,
        providerId: loaded.state.providerProfiles[0]?.id ?? 'openrouter',
        state: {
          hasApiKey: false,
          apiKey: '',
        },
      })
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })
})
