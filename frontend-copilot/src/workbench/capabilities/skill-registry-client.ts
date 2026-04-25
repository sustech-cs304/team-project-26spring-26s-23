import {
  createSkillRegistryApiFailure,
  type SkillDeleteResult,
  type SkillImportRequest,
  type SkillImportResult,
  type SkillSelectAndImportResult,
  type SkillRefreshRequest,
  type SkillRefreshResult,
  type SkillRegistryApi,
  type SkillRegistryLoadRequest,
  type SkillRegistryLoadResult,
  type SkillRegistrySubscriptionApi,
  type SkillSetEnabledRequest,
  type SkillSetEnabledResult,
} from '../../../electron/skill-registry/ipc'
import type { SkillRegistrySubscriptionEvent } from '../../../electron/skill-registry/types'

const SKILL_REGISTRY_API_UNAVAILABLE_ERROR = 'window.skillRegistry is unavailable in the renderer process.'

export interface SkillRegistryClient {
  loadRegistry(request?: SkillRegistryLoadRequest): Promise<SkillRegistryLoadResult>
  importSkill(request: SkillImportRequest): Promise<SkillImportResult>
  selectAndImportSkill(): Promise<SkillSelectAndImportResult>
  deleteSkill(skillId: string): Promise<SkillDeleteResult>
  setSkillEnabled(request: SkillSetEnabledRequest): Promise<SkillSetEnabledResult>
  refreshSkills(request?: SkillRefreshRequest): Promise<SkillRefreshResult>
  subscribe(listener: (event: SkillRegistrySubscriptionEvent) => void): () => void
}

export function createWindowSkillRegistryClient(): SkillRegistryClient {
  return {
    async loadRegistry(request) {
      const api = getSkillRegistryApi()
      return api ? await api.loadRegistry(request) : createFailureResult(SKILL_REGISTRY_API_UNAVAILABLE_ERROR)
    },
    async importSkill(request) {
      const api = getSkillRegistryApi()
      return api ? await api.importSkill(request) : createFailureResult(SKILL_REGISTRY_API_UNAVAILABLE_ERROR)
    },
    async selectAndImportSkill() {
      const api = getSkillRegistryApi()
      return api ? await api.selectAndImportSkill() : createFailureResult(SKILL_REGISTRY_API_UNAVAILABLE_ERROR)
    },
    async deleteSkill(skillId) {
      const api = getSkillRegistryApi()
      return api ? await api.deleteSkill(skillId) : createFailureResult(SKILL_REGISTRY_API_UNAVAILABLE_ERROR)
    },
    async setSkillEnabled(request) {
      const api = getSkillRegistryApi()
      return api ? await api.setSkillEnabled(request) : createFailureResult(SKILL_REGISTRY_API_UNAVAILABLE_ERROR)
    },
    async refreshSkills(request) {
      const api = getSkillRegistryApi()
      return api ? await api.refreshSkills(request) : createFailureResult(SKILL_REGISTRY_API_UNAVAILABLE_ERROR)
    },
    subscribe(listener) {
      const subscriptionApi = getSkillRegistrySubscriptionApi()
      return subscriptionApi ? subscriptionApi.subscribe(listener) : () => {}
    },
  }
}

function getSkillRegistryApi(): SkillRegistryApi | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  return window.skillRegistry
}

function getSkillRegistrySubscriptionApi(): SkillRegistrySubscriptionApi | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  return window.skillRegistrySubscription
}

function createFailureResult<TResult>(error: string): TResult {
  return createSkillRegistryApiFailure(error, 'api_unavailable') as TResult
}
