import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createProviderProfile } from '../../src/workbench/settings/settings-workspace-test-fixtures'
import { createHostedRuntimePaths, ensureHostedRuntimeDirectories } from '../runtime/runtime-paths'
import { createElectronSettingsWorkspaceService } from './main-process'
import { createSettingsWorkspacePaths } from './paths'

async function createPreparedPaths(testName: string) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), `candue-settings-main-${testName}-`))
  const hostedPaths = createHostedRuntimePaths(tempRoot)
  await ensureHostedRuntimeDirectories(hostedPaths)

  return {
    tempRoot,
    hostedPaths,
  }
}

async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8')) as unknown
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

  it('loads legacy defaultModel fields through the main-process API and clears them on save', async () => {
    const fixture = await createPreparedPaths('legacy-default-model-cleanup')
    const service = createElectronSettingsWorkspaceService({
      prepareRuntimePaths: async () => fixture.hostedPaths,
    })
    const paths = createSettingsWorkspacePaths(fixture.hostedPaths)

    try {
      const initialized = await service.loadState()
      expect(initialized.ok).toBe(true)
      if (!initialized.ok) {
        throw new Error('Expected initial settings workspace load to succeed.')
      }

      await writeFile(paths.stateDocument, `${JSON.stringify({
        version: 1,
        kind: 'settings-workspace-state',
        values: {
          ...initialized.state,
          providerProfiles: [
            {
              id: 'legacy-main-process-provider',
              name: 'Legacy Main Process Provider',
              protocol: 'openai',
              endpoint: 'https://legacy.example.com/v1',
              defaultModel: 'legacy-model',
              fastModel: '',
              fallbackModel: '',
              organization: '',
              region: 'Global',
              notes: 'legacy-default-model',
              availableModels: [
                {
                  id: 'legacy-main-process-provider:model-1',
                  modelId: 'legacy-model',
                  displayName: 'Legacy Model',
                  groupName: 'Legacy',
                  capabilities: ['reasoning', 'tools'],
                  supportsStreaming: true,
                  currency: 'usd',
                  inputPrice: '1',
                  outputPrice: '2',
                },
              ],
            },
          ],
        },
      }, null, 2)}\n`)

      const loaded = await service.loadState()
      expect(loaded.ok).toBe(true)
      if (!loaded.ok) {
        throw new Error('Expected legacy settings workspace load to succeed.')
      }

      expect(loaded.state.providerProfiles[0]).toMatchObject({
        id: 'legacy-main-process-provider',
        fastModel: 'legacy-model',
        fallbackModel: 'legacy-model',
      })
      expect(loaded.state.providerProfiles[0]).not.toHaveProperty('defaultModel')

      const saveResult = await service.saveState({
        ...loaded.state,
        providerProfiles: loaded.state.providerProfiles.map(({ hasApiKey: _hasApiKey, ...profile }) => profile),
      })
      expect(saveResult.ok).toBe(true)
      if (!saveResult.ok) {
        throw new Error('Expected legacy settings workspace save to succeed.')
      }
      expect(saveResult.state.providerProfiles[0]).not.toHaveProperty('defaultModel')

      const persistedDocument = await readJsonFile(paths.stateDocument) as {
        values: {
          providerProfiles: Array<Record<string, unknown>>
        }
      }
      expect(persistedDocument.values.providerProfiles[0]).not.toHaveProperty('defaultModel')
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
