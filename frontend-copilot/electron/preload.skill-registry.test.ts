import { describe, expect, it, vi } from 'vitest'

import {
  SKILL_REGISTRY_DELETE_SKILL_CHANNEL,
  SKILL_REGISTRY_IMPORT_SKILL_CHANNEL,
  SKILL_REGISTRY_LOAD_CHANNEL,
  SKILL_REGISTRY_SELECT_AND_IMPORT_SKILL_CHANNEL,
  SKILL_REGISTRY_REFRESH_SKILLS_CHANNEL,
  SKILL_REGISTRY_SET_SKILL_ENABLED_CHANNEL,
  SKILL_REGISTRY_SUBSCRIPTION_CHANNEL,
  type SkillRegistryApi,
  type SkillRegistrySubscriptionApi,
} from './skill-registry/ipc'
import {
  getExposedApi,
  getInvokeMock,
  getOffMock,
  getRegisteredOnListener,
  loadPreloadModule,
} from './preload.test-support'
import { createSkillRecordFixture } from './renderer-ipc.test-support'


describe('preload skill registry bridge', () => {
  it('routes registry management calls through the expected IPC channels', async () => {
    const invokeMock = getInvokeMock()
    invokeMock.mockResolvedValue(undefined)

    await loadPreloadModule()

    const skillRegistryApi = getExposedApi<SkillRegistryApi>('skillRegistry')
    const skill = createSkillRecordFixture()

    await skillRegistryApi.loadRegistry({ includeDisabled: true })
    await skillRegistryApi.importSkill({ sourceDirectory: 'D:/skills/writing-clear-docs', enabled: true })
    await skillRegistryApi.selectAndImportSkill()
    await skillRegistryApi.deleteSkill(skill.skillId)
    await skillRegistryApi.setSkillEnabled({ skillId: skill.skillId, enabled: false })
    await skillRegistryApi.refreshSkills({ skillId: skill.skillId })

    expect(invokeMock.mock.calls).toEqual([
      [SKILL_REGISTRY_LOAD_CHANNEL, { includeDisabled: true }],
      [SKILL_REGISTRY_IMPORT_SKILL_CHANNEL, { sourceDirectory: 'D:/skills/writing-clear-docs', enabled: true }],
      [SKILL_REGISTRY_SELECT_AND_IMPORT_SKILL_CHANNEL],
      [SKILL_REGISTRY_DELETE_SKILL_CHANNEL, skill.skillId],
      [SKILL_REGISTRY_SET_SKILL_ENABLED_CHANNEL, { skillId: skill.skillId, enabled: false }],
      [SKILL_REGISTRY_REFRESH_SKILLS_CHANNEL, { skillId: skill.skillId }],
    ])
  })

  it('validates registry subscription payloads before forwarding them to the renderer', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await loadPreloadModule()

    const subscriptionApi = getExposedApi<SkillRegistrySubscriptionApi>('skillRegistrySubscription')
    const listener = vi.fn()
    const unsubscribe = subscriptionApi.subscribe(listener)
    const wrappedListener = getRegisteredOnListener<(event: unknown, payload: unknown) => void>(SKILL_REGISTRY_SUBSCRIPTION_CHANNEL)
    const skill = createSkillRecordFixture()
    const snapshotEvent = {
      kind: 'snapshot',
      registryRevision: 2,
      snapshotRevision: 3,
      skills: [skill],
    }
    const updatedEvent = {
      kind: 'skill-updated',
      registryRevision: 3,
      snapshotRevision: 4,
      skillId: skill.skillId,
      skill,
    }
    const deletedEvent = {
      kind: 'skill-deleted',
      registryRevision: 4,
      snapshotRevision: 5,
      skillId: skill.skillId,
    }

    wrappedListener(undefined, snapshotEvent)
    wrappedListener(undefined, updatedEvent)
    wrappedListener(undefined, deletedEvent)
    wrappedListener(undefined, { kind: 'unknown' })
    wrappedListener(undefined, {
      kind: 'skill-deleted',
      registryRevision: 4,
      snapshotRevision: 5,
    })

    expect(listener).toHaveBeenCalledTimes(3)
    expect(listener).toHaveBeenCalledWith(snapshotEvent)
    expect(listener).toHaveBeenCalledWith(updatedEvent)
    expect(listener).toHaveBeenCalledWith(deletedEvent)
    expect(errorSpy).toHaveBeenCalledTimes(2)

    unsubscribe()

    expect(getOffMock().mock.calls).toHaveLength(1)
    expect(getOffMock().mock.calls[0]?.[0]).toBe(SKILL_REGISTRY_SUBSCRIPTION_CHANNEL)
    expect(getOffMock().mock.calls[0]?.[1]).toBe(wrappedListener)

    errorSpy.mockRestore()
  })
})
