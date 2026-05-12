/* eslint-disable sonarjs/no-duplicate-string -- test fixture data inherently contains repeated string literals */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { createProviderProfile } from '../../src/workbench/settings/settings-workspace-test-fixtures'
import { normalizeSettingsWorkspaceStateValues } from './state-schema'
import { createHostedRuntimePaths, ensureHostedRuntimeDirectories } from '../runtime/runtime-paths'
import { createElectronSettingsWorkspaceService } from './main-process'
import { createSettingsWorkspacePaths } from './paths'

const EXPECTED_LOAD_SUCCEED = 'Expected settings workspace load to succeed.'
const EXPECTED_SAVE_SUCCEED = 'Expected settings workspace save to succeed.'
const INITIALIZED_DOCS_LOG = 'Initialized settings workspace persistence documents.'

async function createPreparedPaths(testName: string) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), `candue-settings-main-${testName}-`))
  const hostedPaths = createHostedRuntimePaths(tempRoot)
  await ensureHostedRuntimeDirectories(hostedPaths)
  return { tempRoot, hostedPaths }
}

async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8')) as unknown
}

function assertOk<T extends { ok: boolean }>(result: T, message: string): asserts result is T & { ok: true } {
  if (!result.ok) throw new Error(message)
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
      assertOk(result, EXPECTED_LOAD_SUCCEED)

      expect(result.source).toBe('initialized-defaults')
      expect(result.state.providerProfiles).toEqual([])
      expect(result.state.defaultModelRouting).toMatchObject({
        primaryAssistantModel: '',
        fastAssistantModel: '',
        primaryAssistantModelRoute: null,
        fastAssistantModelRoute: null,
      })
      expect(appendLog).toHaveBeenCalledWith('info', INITIALIZED_DOCS_LOG, null)
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })

  it('drops legacy provider defaultModel fields through the main-process API and clears them on save', async () => {
    const fixture = await createPreparedPaths('legacy-default-model-cleanup')
    const service = createElectronSettingsWorkspaceService({
      prepareRuntimePaths: async () => fixture.hostedPaths,
    })
    const paths = createSettingsWorkspacePaths(fixture.hostedPaths)

    try {
      const initialized = await service.loadState()
      assertOk(initialized, EXPECTED_LOAD_SUCCEED)

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
      assertOk(loaded, EXPECTED_LOAD_SUCCEED)

      expect(loaded.state.providerProfiles[0]).toMatchObject({ id: 'legacy-main-process-provider', fastModel: '', fallbackModel: '' })
      expect(loaded.state.providerProfiles[0]).not.toHaveProperty('defaultModel')
      expect(loaded.state.providerProfiles[0]).not.toHaveProperty('defaultModelId')

      const saveResult = await service.saveState(normalizeSettingsWorkspaceStateValues(loaded.state))
      assertOk(saveResult, EXPECTED_SAVE_SUCCEED)
      expect(saveResult.state.providerProfiles[0]).not.toHaveProperty('defaultModel')
      expect(saveResult.state.providerProfiles[0]).not.toHaveProperty('defaultModelId')

      const persistedDocument = await readJsonFile(paths.stateDocument) as {
        values: { providerProfiles: Array<Record<string, unknown>> }
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
      assertOk(loaded, EXPECTED_LOAD_SUCCEED)

      const persistedProvider = createProviderProfile({ id: 'main-process-provider', name: 'Main Process Persisted Provider' })
      const saveResult = await service.saveState(normalizeSettingsWorkspaceStateValues({
        ...loaded.state,
        providerProfiles: [persistedProvider],
      }))
      assertOk(saveResult, EXPECTED_SAVE_SUCCEED)
      expect(saveResult.state.providerProfiles[0]?.name).toBe('Main Process Persisted Provider')

      const saveSecretResult = await service.saveProfileSecret({ profileId: 'main-process-provider', apiKey: 'main-process-secret' })
      expect(saveSecretResult).toEqual({ ok: true, profileId: 'main-process-provider', state: { hasApiKey: true, apiKey: 'main-process-secret' } })

      const secretStatesResult = await service.loadSecretStates({ profileIds: ['main-process-provider'] })
      expect(secretStatesResult).toEqual({ ok: true, states: { 'main-process-provider': { hasApiKey: true, apiKey: 'main-process-secret' } } })

      const clearSecretResult = await service.clearProfileSecret({ profileId: 'main-process-provider' })
      expect(clearSecretResult).toEqual({ ok: true, profileId: 'main-process-provider', state: { hasApiKey: false, apiKey: '' } })
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })
})
