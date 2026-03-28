import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createElectronUnifiedConfigService } from '../config-center/main-process'
import { createHostedRuntimePaths, ensureHostedRuntimeDirectories } from '../runtime/runtime-paths'
import { createSettingsWorkspacePaths } from './paths'
import { createSettingsWorkspaceStorage } from './service'

interface SettingsWorkspaceFixture {
  tempRoot: string
  hostedPaths: ReturnType<typeof createHostedRuntimePaths>
  storage: ReturnType<typeof createSettingsWorkspaceStorage>
  paths: ReturnType<typeof createSettingsWorkspacePaths>
}

async function createSettingsWorkspaceFixture(): Promise<SettingsWorkspaceFixture> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-settings-workspace-'))
  const hostedPaths = createHostedRuntimePaths(tempRoot)
  await ensureHostedRuntimeDirectories(hostedPaths)
  const paths = createSettingsWorkspacePaths(hostedPaths)

  return {
    tempRoot,
    hostedPaths,
    paths,
    storage: createSettingsWorkspaceStorage({ paths }),
  }
}

async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, 'utf8')) as unknown
}

describe('createSettingsWorkspaceStorage', () => {
  it('initializes state and secrets documents with defaults when storage is empty', async () => {
    const fixture = await createSettingsWorkspaceFixture()

    try {
      const result = await fixture.storage.loadState()

      expect(result.source).toBe('initialized-defaults')
      expect(result.state.providerProfiles.length).toBeGreaterThan(0)
      expect(result.state.providerProfiles.every((profile) => profile.hasApiKey === false)).toBe(true)

      expect(await readJsonFile(fixture.paths.stateDocument)).toMatchObject({
        version: 1,
        kind: 'settings-workspace-state',
      })
      expect(await readJsonFile(fixture.paths.secretsDocument)).toEqual({
        version: 1,
        kind: 'settings-workspace-secrets',
        values: {
          providerSecrets: {},
        },
      })
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })

  it('persists provider non-sensitive settings and restores them after reload', async () => {
    const fixture = await createSettingsWorkspaceFixture()

    try {
      const initial = await fixture.storage.loadState()
      const stateToSave = {
        ...initial.state,
        providerProfiles: initial.state.providerProfiles.map((profile, index) => {
          return index === 0
            ? {
              ...profile,
              name: 'Persisted Router',
              endpoint: 'https://persisted.example.com/v1',
              notes: 'persisted-note',
            }
            : profile
        }),
        defaultModelRouting: {
          primaryAssistantModel: 'persisted-primary',
          fastAssistantModel: 'persisted-fast',
        },
        general: {
          ...initial.state.general,
          language: 'en-US',
        },
      }

      await fixture.storage.saveState({
        ...stateToSave,
        providerProfiles: stateToSave.providerProfiles.map(({ hasApiKey: _hasApiKey, ...profile }) => profile),
      })

      const reloadedStorage = createSettingsWorkspaceStorage({ paths: fixture.paths })
      const reloaded = await reloadedStorage.loadState()

      expect(reloaded.source).toBe('stored')
      expect(reloaded.state.providerProfiles[0]).toMatchObject({
        name: 'Persisted Router',
        endpoint: 'https://persisted.example.com/v1',
        notes: 'persisted-note',
        hasApiKey: false,
      })
      expect(reloaded.state.defaultModelRouting).toEqual({
        primaryAssistantModel: 'persisted-primary',
        fastAssistantModel: 'persisted-fast',
      })
      expect(reloaded.state.general.language).toBe('en-US')
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })

  it('writes, replaces, clears, and reports provider secret status without exposing raw secret in public snapshot', async () => {
    const fixture = await createSettingsWorkspaceFixture()

    try {
      await fixture.storage.loadState()

      await fixture.storage.saveProviderSecret('openrouter', 'first-secret')
      expect(await readJsonFile(fixture.paths.secretsDocument)).toEqual({
        version: 1,
        kind: 'settings-workspace-secrets',
        values: {
          providerSecrets: {
            openrouter: {
              apiKey: 'first-secret',
            },
          },
        },
      })

      await fixture.storage.saveProviderSecret('openrouter', 'second-secret')
      expect(await readJsonFile(fixture.paths.secretsDocument)).toEqual({
        version: 1,
        kind: 'settings-workspace-secrets',
        values: {
          providerSecrets: {
            openrouter: {
              apiKey: 'second-secret',
            },
          },
        },
      })

      const loadedStateWithSecret = await fixture.storage.loadState()
      expect(loadedStateWithSecret.state.providerProfiles.find((profile) => profile.id === 'openrouter')?.hasApiKey).toBe(true)

      const secretStatuses = await fixture.storage.loadSecretStates(['openrouter', 'ollama-local'])
      expect(secretStatuses.states).toEqual({
        openrouter: {
          hasApiKey: true,
        },
        'ollama-local': {
          hasApiKey: false,
        },
      })

      const unifiedConfigService = createElectronUnifiedConfigService({
        prepareRuntimePaths: async () => fixture.hostedPaths,
      })
      const publicSnapshotResult = await unifiedConfigService.loadPublicSnapshot()
      expect(publicSnapshotResult.ok).toBe(true)
      if (!publicSnapshotResult.ok) {
        throw new Error('Expected config center public snapshot load to succeed.')
      }

      const publicSnapshotJson = JSON.stringify(publicSnapshotResult.snapshot)
      expect(publicSnapshotJson).not.toContain('second-secret')
      expect(publicSnapshotJson).not.toContain('providerSecrets')
      expect(publicSnapshotJson).not.toContain('apiKey')

      await fixture.storage.clearProviderSecret('openrouter')
      expect(await readJsonFile(fixture.paths.secretsDocument)).toEqual({
        version: 1,
        kind: 'settings-workspace-secrets',
        values: {
          providerSecrets: {},
        },
      })

      const clearedStatuses = await fixture.storage.loadSecretStates(['openrouter'])
      expect(clearedStatuses.states).toEqual({
        openrouter: {
          hasApiKey: false,
        },
      })
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })
})
