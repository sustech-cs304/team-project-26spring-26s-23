import type {
  SkillDeleteSuccess,
  SkillImportSuccess,
  SkillRefreshSuccess,
  SkillRegistryLoadSuccess,
  SkillRegistrySubscriptionEvent,
  SkillSetEnabledSuccess,
  SkillValidationIssue,
} from './types'

export const SKILL_REGISTRY_LOAD_CHANNEL = 'skill-registry:load'
export const SKILL_REGISTRY_IMPORT_SKILL_CHANNEL = 'skill-registry:import-skill'
export const SKILL_REGISTRY_SELECT_AND_IMPORT_SKILL_CHANNEL = 'skill-registry:select-and-import-skill'
export const SKILL_REGISTRY_DELETE_SKILL_CHANNEL = 'skill-registry:delete-skill'
export const SKILL_REGISTRY_SET_SKILL_ENABLED_CHANNEL = 'skill-registry:set-skill-enabled'
export const SKILL_REGISTRY_REFRESH_SKILLS_CHANNEL = 'skill-registry:refresh-skills'
export const SKILL_REGISTRY_SUBSCRIPTION_CHANNEL = 'skill-registry:subscription'

export const SKILL_REGISTRY_NOT_IMPLEMENTED_ERROR_CODE = 'not_implemented'

export interface SkillRegistryLoadRequest {
  includeDisabled?: boolean
}

export interface SkillImportRequest {
  sourceDirectory: string
  enabled?: boolean
}

export interface SkillSetEnabledRequest {
  skillId: string
  enabled: boolean
}

export interface SkillRefreshRequest {
  skillId?: string | null
}

export interface SkillRegistryApiFailure {
  ok: false
  error: string
  code: string
  validationErrors?: SkillValidationIssue[]
}

export interface SkillImportCancelledResult {
  ok: true
  cancelled: true
  registryRevision?: never
  snapshotRevision?: never
  skill?: never
}

export type SkillRegistryLoadResult = SkillRegistryLoadSuccess | SkillRegistryApiFailure
export type SkillImportResult = SkillImportSuccess | SkillRegistryApiFailure
export type SkillSelectAndImportResult = SkillImportSuccess | SkillImportCancelledResult | SkillRegistryApiFailure
export type SkillDeleteResult = SkillDeleteSuccess | SkillRegistryApiFailure
export type SkillSetEnabledResult = SkillSetEnabledSuccess | SkillRegistryApiFailure
export type SkillRefreshResult = SkillRefreshSuccess | SkillRegistryApiFailure

export interface SkillRegistryApi {
  loadRegistry: (request?: SkillRegistryLoadRequest) => Promise<SkillRegistryLoadResult>
  importSkill: (request: SkillImportRequest) => Promise<SkillImportResult>
  selectAndImportSkill: () => Promise<SkillSelectAndImportResult>
  deleteSkill: (skillId: string) => Promise<SkillDeleteResult>
  setSkillEnabled: (request: SkillSetEnabledRequest) => Promise<SkillSetEnabledResult>
  refreshSkills: (request?: SkillRefreshRequest) => Promise<SkillRefreshResult>
}

export interface SkillRegistrySubscriptionApi {
  subscribe: (listener: (event: SkillRegistrySubscriptionEvent) => void) => (() => void)
}

interface SkillRegistrySubscriptionEventSource {
  on: (channel: string, listener: (...args: unknown[]) => void) => void
  off: (channel: string, listener: (...args: unknown[]) => void) => void
}

export function createEmptySkillRegistryLoadSuccess(): SkillRegistryLoadSuccess {
  return {
    ok: true,
    registryRevision: 0,
    snapshotRevision: 0,
    skills: [],
  }
}

export function createSkillRegistryApiFailure(
  error: string,
  code: string = SKILL_REGISTRY_NOT_IMPLEMENTED_ERROR_CODE,
  validationErrors: SkillValidationIssue[] = [],
): SkillRegistryApiFailure {
  return {
    ok: false,
    error,
    code,
    ...(validationErrors.length > 0 ? { validationErrors } : {}),
  }
}

export function createSkillRegistrySubscriptionApi(
  eventSource: SkillRegistrySubscriptionEventSource,
): SkillRegistrySubscriptionApi {
  return {
    subscribe(listener) {
      const wrappedListener = (_event: unknown, eventPayload: unknown) => {
        if (!isSkillRegistrySubscriptionEvent(eventPayload)) {
          console.error(
            `[skill-registry] Ignored invalid subscription payload on "${SKILL_REGISTRY_SUBSCRIPTION_CHANNEL}".`,
            eventPayload,
          )
          return
        }

        listener(eventPayload)
      }

      eventSource.on(SKILL_REGISTRY_SUBSCRIPTION_CHANNEL, wrappedListener)

      return () => {
        eventSource.off(SKILL_REGISTRY_SUBSCRIPTION_CHANNEL, wrappedListener)
      }
    },
  }
}

function isSkillRegistrySubscriptionEvent(value: unknown): value is SkillRegistrySubscriptionEvent {
  if (!isPlainRecord(value) || !hasRevisionState(value)) {
    return false
  }

  if (value.kind === 'snapshot') {
    return Array.isArray(value.skills)
  }

  if (value.kind === 'skill-updated') {
    return typeof value.skillId === 'string' && isPlainRecord(value.skill)
  }

  if (value.kind === 'skill-deleted') {
    return typeof value.skillId === 'string'
  }

  return false
}

function hasRevisionState(value: Record<string, unknown>): boolean {
  return typeof value.registryRevision === 'number' && typeof value.snapshotRevision === 'number'
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
