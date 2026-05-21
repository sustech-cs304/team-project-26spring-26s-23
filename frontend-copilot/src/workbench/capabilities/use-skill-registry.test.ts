/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { renderHook } from '@testing-library/react'

import type {
  SkillRecord,
  SkillRegistrySubscriptionEvent,
  SkillValidationIssue,
} from '../../../electron/skill-registry/types'
import type {
  SkillDeleteResult,
  SkillImportResult,
  SkillRefreshResult,
  SkillRegistryLoadResult,
  SkillSelectAndImportResult,
  SkillSetEnabledResult,
} from '../../../electron/skill-registry/ipc'
import type { SkillRegistryClient } from './skill-registry-client'
import { useSkillRegistry, type UseSkillRegistryResult } from './use-skill-registry'

const SKILL_1: SkillRecord = {
  skillId: 'skill-1',
  displayName: 'Alpha Skill',
  description: 'First test skill',
  version: '1.0.0',
  source: 'imported',
  sourceDirectory: null,
  enabled: true,
  trusted: true,
  managedDirectoryName: 'skill-1',
  entryPath: 'SKILL.md',
  tags: ['test', 'alpha'],
  capabilities: { readOnlyResources: true, scripts: false },
  validation: { status: 'valid', errors: [], warnings: [] },
  entrySummary: 'A test skill for alpha.',
  resourceSummaries: [{ path: 'resources/guide.md', description: null }],
  importedAt: '2026-05-01T00:00:00.000Z',
  updatedAt: '2026-05-01T00:00:00.000Z',
}

const SKILL_2: SkillRecord = {
  skillId: 'skill-2',
  displayName: 'Beta Skill',
  description: 'Second test skill',
  version: null,
  source: 'builtin',
  sourceDirectory: null,
  enabled: false,
  trusted: true,
  managedDirectoryName: 'skill-2',
  entryPath: 'SKILL.md',
  tags: [],
  capabilities: { readOnlyResources: false, scripts: false },
  validation: { status: 'valid', errors: [], warnings: [] },
  entrySummary: null,
  resourceSummaries: [],
  importedAt: '2026-05-15T00:00:00.000Z',
  updatedAt: '2026-05-15T00:00:00.000Z',
}

function buildLoadSuccess(overrides: Partial<SkillRegistryLoadResult & { ok: true }> = {}): SkillRegistryLoadResult {
  return {
    ok: true,
    registryRevision: 1,
    snapshotRevision: 1,
    skills: [SKILL_1, SKILL_2],
    ...overrides,
  } as SkillRegistryLoadResult
}

function buildLoadError(error: string): SkillRegistryLoadResult {
  return { ok: false, error, code: 'load_failed' }
}

interface MockClientResult {
  client: SkillRegistryClient
  fireEvent: (event: SkillRegistrySubscriptionEvent) => void
}

function createMockClient(): MockClientResult {
  let subListener: ((event: SkillRegistrySubscriptionEvent) => void) | null = null

  return {
    client: {
      loadRegistry: vi.fn<() => Promise<SkillRegistryLoadResult>>().mockResolvedValue(buildLoadSuccess()),
      importSkill: vi.fn<() => Promise<SkillImportResult>>().mockResolvedValue({
        ok: true,
        registryRevision: 2,
        snapshotRevision: 2,
        skill: { ...SKILL_1, skillId: 'imported-skill', displayName: 'Imported Skill' },
        validationErrors: [],
      }),
      selectAndImportSkill: vi.fn<() => Promise<SkillSelectAndImportResult>>().mockResolvedValue({
        ok: true,
        registryRevision: 2,
        snapshotRevision: 2,
        skill: { ...SKILL_1, skillId: 'imported-skill', displayName: 'Imported Skill' },
        validationErrors: [],
      }),
      deleteSkill: vi.fn<() => Promise<SkillDeleteResult>>().mockResolvedValue({
        ok: true,
        skillId: 'skill-1',
        deleted: true,
        registryRevision: 2,
        snapshotRevision: 2,
      }),
      setSkillEnabled: vi.fn<() => Promise<SkillSetEnabledResult>>().mockResolvedValue({
        ok: true,
        registryRevision: 2,
        snapshotRevision: 2,
        skill: { ...SKILL_1, enabled: false },
      }),
      refreshSkills: vi.fn<() => Promise<SkillRefreshResult>>().mockResolvedValue({
        ok: true,
        registryRevision: 2,
        snapshotRevision: 2,
        refreshedSkillIds: ['skill-1'],
        results: [{ skillId: 'skill-1', status: 'valid', errors: [], warnings: [] }],
      }),
      subscribe: vi.fn((listener: (event: SkillRegistrySubscriptionEvent) => void) => {
        subListener = listener
        return () => { subListener = null }
      }),
    },
    fireEvent(event: SkillRegistrySubscriptionEvent) {
      subListener?.(event)
    },
  }
}

function renderSkillRegistry(client?: SkillRegistryClient) {
  return renderHook(() => useSkillRegistry(client), {
    initialProps: undefined,
  })
}

async function renderAndSettle(client?: SkillRegistryClient) {
  const mock = client ? { client, fireEvent: () => {} } : createMockClient()
  const rendered = renderSkillRegistry(mock.client)
  await act(async () => { await Promise.resolve(); await Promise.resolve() })
  return { rendered, mock }
}

describe('useSkillRegistry', () => {
  describe('initial load', () => {
    it('transitions from loading to ready when the registry loads successfully', async () => {
      const { rendered } = await renderAndSettle()

      expect(rendered.result.current.loadStatus).toBe('ready')
      expect(rendered.result.current.skills).toHaveLength(2)
      expect(rendered.result.current.registryRevision).toBe(1)
      expect(rendered.result.current.snapshotRevision).toBe(1)
      expect(rendered.result.current.rawSkills).toHaveLength(2)
    })

    it('transitions to error when the registry load fails', async () => {
      const mock = createMockClient()
      mock.client.loadRegistry = vi.fn<() => Promise<SkillRegistryLoadResult>>()
        .mockResolvedValue(buildLoadError('Network failure'))

      const { rendered } = await renderAndSettle(mock.client)

      expect(rendered.result.current.loadStatus).toBe('error')
    })

    it('returns status message during loading', () => {
      const mock = createMockClient()
      mock.client.loadRegistry = vi.fn(() => new Promise<SkillRegistryLoadResult>(() => {}))

      const { result } = renderSkillRegistry(mock.client)

      expect(result.current.loadStatus).toBe('loading')
      expect(result.current.statusMessage).toBe('正在加载 Skills 列表…')
    })

    it('returns error as status message when load fails', async () => {
      const mock = createMockClient()
      mock.client.loadRegistry = vi.fn<() => Promise<SkillRegistryLoadResult>>()
        .mockResolvedValue(buildLoadError('Connection refused'))

      const { rendered } = await renderAndSettle(mock.client)

      expect(rendered.result.current.statusMessage).toBe('Connection refused')
    })

    it('returns null status message when load succeeds', async () => {
      const { rendered } = await renderAndSettle()

      expect(rendered.result.current.statusMessage).toBeNull()
    })
  })

  describe('toggleSkillEnabled', () => {
    it('toggles skill enabled state and calls IPC', async () => {
      const mock = createMockClient()

      const { rendered } = await renderAndSettle(mock.client)

      await act(async () => {
        await rendered.result.current.toggleSkillEnabled('skill-1')
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(mock.client.setSkillEnabled).toHaveBeenCalledWith({ skillId: 'skill-1', enabled: false })
      expect(rendered.result.current.skills.find((s) => s.skillId === 'skill-1')?.enabled).toBe(false)
    })

    it('does nothing when skill is not found', async () => {
      const mock = createMockClient()

      const { rendered } = await renderAndSettle(mock.client)

      await act(async () => {
        await rendered.result.current.toggleSkillEnabled('nonexistent')
        await Promise.resolve()
      })

      expect(mock.client.setSkillEnabled).not.toHaveBeenCalled()
    })

    it('sets an error message when toggle fails', async () => {
      const mock = createMockClient()
      mock.client.setSkillEnabled = vi.fn<() => Promise<SkillSetEnabledResult>>()
        .mockResolvedValue({ ok: false, error: 'Toggle failed', code: 'toggle_error' })

      const { rendered } = await renderAndSettle(mock.client)

      await act(async () => {
        await rendered.result.current.toggleSkillEnabled('skill-1')
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(rendered.result.current.skills.find((s) => s.skillId === 'skill-1')?.message).toBe('Toggle failed')
    })
  })

  describe('deleteSkill', () => {
    it('deletes a skill from state and calls IPC', async () => {
      const mock = createMockClient()

      const { rendered } = await renderAndSettle(mock.client)

      await act(async () => {
        await rendered.result.current.deleteSkill('skill-1')
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(mock.client.deleteSkill).toHaveBeenCalledWith('skill-1')
      expect(rendered.result.current.skills).toHaveLength(1)
      expect(rendered.result.current.snapshotRevision).toBe(2)
    })

    it('sets an error message when delete fails', async () => {
      const mock = createMockClient()
      mock.client.deleteSkill = vi.fn<() => Promise<SkillDeleteResult>>()
        .mockResolvedValue({ ok: false, error: 'Delete denied', code: 'delete_error' })

      const { rendered } = await renderAndSettle(mock.client)

      await act(async () => {
        await rendered.result.current.deleteSkill('skill-1')
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(rendered.result.current.skills.find((s) => s.skillId === 'skill-1')?.message).toBe('Delete denied')
    })
  })

  describe('refreshSkills', () => {
    it('refreshes all skills', async () => {
      const mock = createMockClient()

      const { rendered } = await renderAndSettle(mock.client)

      await act(async () => {
        await rendered.result.current.refreshSkills()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(mock.client.refreshSkills).toHaveBeenCalledWith()
      expect(rendered.result.current.snapshotRevision).toBe(2)
    })

    it('refreshes a single skill', async () => {
      const mock = createMockClient()

      const { rendered } = await renderAndSettle(mock.client)

      await act(async () => {
        await rendered.result.current.refreshSkill('skill-1')
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(mock.client.refreshSkills).toHaveBeenCalledWith({ skillId: 'skill-1' })
    })

    it('sets an error message when bulk refresh fails', async () => {
      const mock = createMockClient()
      mock.client.refreshSkills = vi.fn<() => Promise<SkillRefreshResult>>()
        .mockResolvedValue({ ok: false, error: 'Refresh failed', code: 'refresh_error' })

      const { rendered } = await renderAndSettle(mock.client)

      await act(async () => {
        await rendered.result.current.refreshSkills()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(rendered.result.current.globalMessage).toBe('Refresh failed')
    })

    it('sets an error message on per-skill refresh failure', async () => {
      const mock = createMockClient()
      mock.client.refreshSkills = vi.fn<() => Promise<SkillRefreshResult>>()
        .mockResolvedValue({ ok: false, error: 'Refresh failed', code: 'refresh_error' })

      const { rendered } = await renderAndSettle(mock.client)

      await act(async () => {
        await rendered.result.current.refreshSkill('skill-1')
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(mock.client.refreshSkills).toHaveBeenCalledWith({ skillId: 'skill-1' })
      expect(rendered.result.current.skills.find((s) => s.skillId === 'skill-1')?.message).toBe('Refresh failed')
    })
  })

  describe('selectAndImportSkill', () => {
    it('imports a skill successfully', async () => {
      const mock = createMockClient()

      const { rendered } = await renderAndSettle(mock.client)

      let result: Awaited<ReturnType<UseSkillRegistryResult['selectAndImportSkill']>>
      await act(async () => {
        result = await rendered.result.current.selectAndImportSkill()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(result.ok).toBe(true)
    })

    it('returns validation errors when import has issues', async () => {
      const validationErrors: SkillValidationIssue[] = [
        { fieldPath: 'displayName', message: 'Display name is too long', code: 'name_too_long' },
      ]
      const mock = createMockClient()
      mock.client.selectAndImportSkill = vi.fn<() => Promise<SkillSelectAndImportResult>>()
        .mockResolvedValue({
          ok: false,
          error: 'Import failed validation',
          code: 'validation_error',
          validationErrors,
        })

      const { rendered } = await renderAndSettle(mock.client)

      let result: Awaited<ReturnType<UseSkillRegistryResult['selectAndImportSkill']>>
      await act(async () => {
        result = await rendered.result.current.selectAndImportSkill()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(result.ok).toBe(false)
      if (result.ok === false) {
        expect(result.validationErrors).toHaveLength(1)
      }
    })

    it('handles cancelled import gracefully', async () => {
      const mock = createMockClient()
      mock.client.selectAndImportSkill = vi.fn<() => Promise<SkillSelectAndImportResult>>()
        .mockResolvedValue({ ok: true, cancelled: true } as SkillSelectAndImportResult)

      const { rendered } = await renderAndSettle(mock.client)

      let result: Awaited<ReturnType<UseSkillRegistryResult['selectAndImportSkill']>>
      await act(async () => {
        result = await rendered.result.current.selectAndImportSkill()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(result.ok).toBe(true)
    })

    it('handles import without returned skill gracefully', async () => {
      const mock = createMockClient()
      mock.client.selectAndImportSkill = vi.fn<() => Promise<SkillSelectAndImportResult>>()
        .mockResolvedValue({
          ok: true,
          registryRevision: 2,
          snapshotRevision: 2,
        } as SkillSelectAndImportResult)

      const { rendered } = await renderAndSettle(mock.client)

      let result: Awaited<ReturnType<UseSkillRegistryResult['selectAndImportSkill']>>
      await act(async () => {
        result = await rendered.result.current.selectAndImportSkill()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(result.ok).toBe(true)
    })
  })

  describe('real-time subscription', () => {
    it('replaces state with a full snapshot subscription event', async () => {
      const mock = createMockClient()

      const { rendered } = await renderAndSettle(mock.client)

      const newSkill: SkillRecord = {
        ...SKILL_1,
        skillId: 'skill-3',
        displayName: 'Gamma Skill',
      }

      await act(async () => {
        mock.fireEvent({
          kind: 'snapshot',
          registryRevision: 5,
          snapshotRevision: 5,
          skills: [newSkill],
        })
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(rendered.result.current.skills).toHaveLength(1)
      expect(rendered.result.current.skills[0]?.skillId).toBe('skill-3')
      expect(rendered.result.current.registryRevision).toBe(5)
    })

    it('updates state when a skill-updated event arrives', async () => {
      const mock = createMockClient()

      const { rendered } = await renderAndSettle(mock.client)

      const updatedSkill: SkillRecord = {
        ...SKILL_1,
        displayName: 'Alpha Skill Updated',
        enabled: false,
      }

      await act(async () => {
        mock.fireEvent({
          kind: 'skill-updated',
          registryRevision: 3,
          snapshotRevision: 3,
          skillId: 'skill-1',
          skill: updatedSkill,
        })
        await Promise.resolve()
        await Promise.resolve()
      })

      const skill = rendered.result.current.skills.find((s) => s.skillId === 'skill-1')
      expect(skill?.displayName).toBe('Alpha Skill Updated')
      expect(skill?.enabled).toBe(false)
      expect(rendered.result.current.registryRevision).toBe(3)
    })

    it('adds a new skill when a skill-updated event arrives for an unknown skill', async () => {
      const mock = createMockClient()

      const { rendered } = await renderAndSettle(mock.client)

      const newSkill: SkillRecord = {
        ...SKILL_1,
        skillId: 'skill-3',
        displayName: 'Gamma Skill',
      }

      await act(async () => {
        mock.fireEvent({
          kind: 'skill-updated',
          registryRevision: 4,
          snapshotRevision: 4,
          skillId: 'skill-3',
          skill: newSkill,
        })
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(rendered.result.current.skills).toHaveLength(3)
    })

    it('removes a skill when a skill-deleted event arrives', async () => {
      const mock = createMockClient()

      const { rendered } = await renderAndSettle(mock.client)

      await act(async () => {
        mock.fireEvent({
          kind: 'skill-deleted',
          registryRevision: 6,
          snapshotRevision: 6,
          skillId: 'skill-1',
        })
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(rendered.result.current.skills).toHaveLength(1)
      expect(rendered.result.current.skills[0]?.skillId).toBe('skill-2')
    })
  })

  describe('view model construction', () => {
    it('builds view models with correct properties', async () => {
      const { rendered } = await renderAndSettle()

      const alphaSkill = rendered.result.current.skills.find((s) => s.skillId === 'skill-1')
      const betaSkill = rendered.result.current.skills.find((s) => s.skillId === 'skill-2')

      expect(alphaSkill?.displayName).toBe('Alpha Skill')
      expect(alphaSkill?.source).toBe('imported')
      expect(alphaSkill?.deletable).toBe(true)
      expect(alphaSkill?.versionLabel).toBe('1.0.0')
      expect(alphaSkill?.enabled).toBe(true)
      expect(alphaSkill?.status).toBe('valid')
      expect(alphaSkill?.tags).toContain('test')

      expect(betaSkill?.deletable).toBe(false)
      expect(betaSkill?.versionLabel).toBe('未声明版本')
      expect(betaSkill?.enabled).toBe(false)
    })

    it('does not include scripts capability flag', async () => {
      const { rendered } = await renderAndSettle()

      const alphaSkill = rendered.result.current.rawSkills.find((s) => s.skillId === 'skill-1')
      expect(alphaSkill?.capabilities.scripts).toBe(false) // always false per clone
    })
  })

  describe('busy operation tracking', () => {
    it('tracks busy operations during async actions', async () => {
      const mock = createMockClient()
      let resolveToggle: (value: SkillSetEnabledResult) => void = () => {}
      mock.client.setSkillEnabled = vi.fn(() => new Promise<SkillSetEnabledResult>((resolve) => { resolveToggle = resolve }))

      const { rendered } = await renderAndSettle(mock.client)

      let togglePromise: Promise<void>
      await act(async () => {
        togglePromise = rendered.result.current.toggleSkillEnabled('skill-1')
        await Promise.resolve()
      })

      expect(rendered.result.current.skills.find((s) => s.skillId === 'skill-1')?.busy).toBe(true)
      expect(rendered.result.current.skills.find((s) => s.skillId === 'skill-1')?.busyOperation).toBe('toggling')

      await act(async () => {
        resolveToggle({
          ok: true,
          registryRevision: 2,
          snapshotRevision: 2,
          skill: { ...SKILL_1, enabled: false },
        })
        await togglePromise
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(rendered.result.current.skills.find((s) => s.skillId === 'skill-1')?.busy).toBe(false)
    })
  })

  describe('initial state snapshot', () => {
    it('initializes with default empty state', () => {
      const mock = createMockClient()
      mock.client.loadRegistry = vi.fn(() => new Promise(() => {})) // never resolves

      const { result } = renderSkillRegistry(mock.client)

      expect(result.current.rawSkills).toHaveLength(0)
      expect(result.current.skills).toHaveLength(0)
      expect(result.current.registryRevision).toBe(0)
      expect(result.current.snapshotRevision).toBe(0)
    })
  })
})
