import { dialog } from 'electron'

import { discoverBuiltinSkillSources } from './builtin-skill-loader'
import { createSkillCapabilitySnapshotSink } from './snapshot'
import { createSkillRegistryApiFailure } from './ipc'
import { createSkillRegistryService, type SkillRegistryService } from './service'
import { createSkillRegistryPaths, createSkillRegistryStore } from './store'
import type { HostedRuntimePaths } from '../runtime/runtime-paths'
import type {
  SkillDeleteResult,
  SkillImportRequest,
  SkillImportResult,
  SkillRefreshRequest,
  SkillRefreshResult,
  SkillRegistryLoadRequest,
  SkillSelectAndImportResult,
  SkillRegistryLoadResult,
  SkillSetEnabledRequest,
  SkillSetEnabledResult,
} from './ipc'
import type { SkillRegistrySubscriptionEvent } from './types'

export interface ElectronSkillRegistryLogger {
  (
    level: 'info' | 'warn' | 'error',
    message: string,
    context: Record<string, unknown> | null,
  ): void | Promise<void>
}

export interface CreateElectronSkillRegistryServiceOptions {
  prepareRuntimePaths: () => Promise<HostedRuntimePaths>
  appendLog?: ElectronSkillRegistryLogger
  publishRegistryEvent?: (event: SkillRegistrySubscriptionEvent) => void | Promise<void>
  now?: () => string
}

export interface ElectronSkillRegistryService {
  loadRegistry: (request?: SkillRegistryLoadRequest) => Promise<SkillRegistryLoadResult>
  importSkill: (request: SkillImportRequest) => Promise<SkillImportResult>
  selectAndImportSkill: () => Promise<SkillSelectAndImportResult>
  deleteSkill: (skillId: string) => Promise<SkillDeleteResult>
  setSkillEnabled: (request: SkillSetEnabledRequest) => Promise<SkillSetEnabledResult>
  refreshSkills: (request?: SkillRefreshRequest) => Promise<SkillRefreshResult>
}

export function createElectronSkillRegistryService(
  options: CreateElectronSkillRegistryServiceOptions,
): ElectronSkillRegistryService {
  let servicePromise: Promise<SkillRegistryService> | null = null

  const getService = async (): Promise<SkillRegistryService> => {
    if (servicePromise === null) {
      const nextServicePromise = (async () => {
        const runtimePaths = await options.prepareRuntimePaths()
        const paths = createSkillRegistryPaths(runtimePaths)
        const builtinSkillSources = await discoverBuiltinSkillSources()
        return createSkillRegistryService({
          store: createSkillRegistryStore({ paths }),
          paths,
          snapshotSink: createSkillCapabilitySnapshotSink({
            runtimePaths,
          }),
          builtinSkillSources,
          now: options.now,
          publishEvent: options.publishRegistryEvent,
          appendLog: options.appendLog,
        })
      })()

      servicePromise = nextServicePromise
      void nextServicePromise.catch(() => {
        if (servicePromise === nextServicePromise) {
          servicePromise = null
        }
      })
    }

    return await servicePromise
  }

  return {
    async loadRegistry(request) {
      return await wrapOperation('load the skill registry', options.appendLog, async () => {
        return await (await getService()).loadRegistry(request)
      })
    },
    async importSkill(request) {
      return await wrapOperation('import the skill package', options.appendLog, async () => {
        return await (await getService()).importSkill(request)
      })
    },
    async selectAndImportSkill() {
      return await wrapOperation('select and import the skill package', options.appendLog, async () => {
        const selection = await dialog.showOpenDialog({
          title: '选择 Skill 文件夹',
          properties: ['openDirectory'],
        })

        const sourceDirectory = selection.filePaths[0]?.trim()
        if (selection.canceled || sourceDirectory === undefined || sourceDirectory === '') {
          return { ok: true, cancelled: true }
        }

        return await (await getService()).importSkill({ sourceDirectory, enabled: true })
      })
    },
    async deleteSkill(skillId) {
      return await wrapOperation('delete the skill', options.appendLog, async () => {
        return await (await getService()).deleteSkill(skillId)
      })
    },
    async setSkillEnabled(request) {
      return await wrapOperation('toggle the skill enabled flag', options.appendLog, async () => {
        return await (await getService()).setSkillEnabled(request)
      })
    },
    async refreshSkills(request) {
      return await wrapOperation('refresh skills', options.appendLog, async () => {
        return await (await getService()).refreshSkills(request)
      })
    },
  }
}

async function wrapOperation<TResult>(
  action: string,
  appendLog: ElectronSkillRegistryLogger | undefined,
  run: () => Promise<TResult>,
): Promise<TResult> {
  try {
    return await run()
  } catch (error) {
    const detail = formatUnknownError(error)
    await appendLog?.('error', `[skill-registry] Failed to ${action}.`, { detail })
    return createSkillRegistryApiFailure(`Failed to ${action}: ${detail}`, 'internal_error') as TResult
  }
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
