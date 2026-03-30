import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createProviderProfile } from '../../src/workbench/settings/settings-workspace-test-fixtures'
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
      expect(result.state.providerProfiles).toEqual([])
      expect(result.state.defaultModelRouting).toEqual({
        primaryAssistantModel: '',
        fastAssistantModel: '',
      })
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

      const persistedProvider = createProviderProfile({
        id: 'main-process-provider',
        name: 'Main Process Persisted Provider',
      })

      const saveResult = await service.saveState({
        ...loaded.state,
        providerProfiles: [
          (() => {
            const { hasApiKey: _hasApiKey, ...profile } = persistedProvider
            return profile
          })(),
        ],
      })

      expect(saveResult.ok).toBe(true)
      if (!saveResult.ok) {
        throw new Error('Expected settings workspace save to succeed.')
      }
      expect(saveResult.state.providerProfiles[0]?.name).toBe('Main Process Persisted Provider')

      const saveSecretResult = await service.saveProviderSecret({
        providerId: 'main-process-provider',
        apiKey: 'main-process-secret',
      })
      expect(saveSecretResult).toEqual({
        ok: true,
        providerId: 'main-process-provider',
        state: {
          hasApiKey: true,
          apiKey: 'main-process-secret',
        },
      })

      const secretStatesResult = await service.loadSecretStates({
        providerIds: ['main-process-provider'],
      })
      expect(secretStatesResult).toEqual({
        ok: true,
        states: {
          'main-process-provider': {
            hasApiKey: true,
            apiKey: 'main-process-secret',
          },
        },
      })

      const clearSecretResult = await service.clearProviderSecret({
        providerId: 'main-process-provider',
      })
      expect(clearSecretResult).toEqual({
        ok: true,
        providerId: 'main-process-provider',
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
