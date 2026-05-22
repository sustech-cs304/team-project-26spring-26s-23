import type {
  CreateMainProcessServicesOptions,
  MainProcessServices,
} from './MainProcessServiceTypes'
import { createMainProcessServiceAccessors } from './MainProcessServiceAccessors'
import type { MainProcessServiceAccessors } from './MainProcessServiceAccessors'
import { createElectronAttachmentService } from '../attachment-service/service'
import type { ElectronAttachmentService } from '../attachment-service/service'
import type { ManagedRuntimeActionReason } from '../managed-runtime/types'
import { createElectronFileManagerService } from '../file-manager/service'
import type { ElectronFileManagerService } from '../file-manager/service'
import { getCalendarEvents, addCalendarEvent } from '../timeline-database/service'
import type {
  DesktopRuntimeCalendarEventsLoadResult,
  DesktopRuntimeWakeupIcsImportResult,
} from '../desktop-runtime'
import type { LoadTimelineEventsRequest, UnifiedCalendarEvent } from '../timeline-database/ipc'

const LOCAL_RUNTIME_TOKEN_HEADER = 'X-Local-Token'
const CALENDAR_EVENTS_PATH = '/calendar/events'
const WAKEUP_ICS_IMPORT_PATH = '/api/wakeup/import/ics'
const CALENDAR_LOAD_FAILURE_MESSAGE = '无法加载日历事件：本地无缓存数据且远端 API 请求失败，请检查网络连接或后端服务状态。'

// ===== Builder functions for service API groups =====

function buildConfigCenterApi(accessors: MainProcessServiceAccessors) {
  return {
    async loadConfigCenterPublicSnapshot() {
      return await accessors.getUnifiedConfigService().loadPublicSnapshot()
    },
    async applyConfigCenterPublicPatch(patch: Parameters<MainProcessServices['applyConfigCenterPublicPatch']>[0]) {
      return await accessors.getUnifiedConfigService().applyPublicPatch(patch)
    },
  }
}

function buildSettingsWorkspaceApi(accessors: MainProcessServiceAccessors) {
  return {
    async loadSettingsWorkspaceState() {
      return await accessors.getSettingsWorkspaceService().loadState()
    },
    async saveSettingsWorkspaceState(input: Parameters<MainProcessServices['saveSettingsWorkspaceState']>[0]) {
      return await accessors.getSettingsWorkspaceService().saveState(input)
    },
    async loadSettingsWorkspaceSecretStates(request: Parameters<MainProcessServices['loadSettingsWorkspaceSecretStates']>[0]) {
      return await accessors.getSettingsWorkspaceService().loadSecretStates(request)
    },
    async loadSettingsWorkspaceSustechCasSecret() {
      return await accessors.getSettingsWorkspaceService().loadSustechCasSecret()
    },
    async saveSettingsWorkspaceProfileSecret(request: Parameters<MainProcessServices['saveSettingsWorkspaceProfileSecret']>[0]) {
      return await accessors.getSettingsWorkspaceService().saveProfileSecret(request)
    },
    async clearSettingsWorkspaceProfileSecret(request: Parameters<MainProcessServices['clearSettingsWorkspaceProfileSecret']>[0]) {
      return await accessors.getSettingsWorkspaceService().clearProfileSecret(request)
    },
    async saveSettingsWorkspaceSustechCasSecret(request: Parameters<MainProcessServices['saveSettingsWorkspaceSustechCasSecret']>[0]) {
      return await accessors.getSettingsWorkspaceService().saveSustechCasSecret(request)
    },
    async clearSettingsWorkspaceSustechCasSecret() {
      return await accessors.getSettingsWorkspaceService().clearSustechCasSecret()
    },
    async resolveSettingsWorkspaceProviderRoute(request: Parameters<MainProcessServices['resolveSettingsWorkspaceProviderRoute']>[0]) {
      return await accessors.getSettingsWorkspaceService().resolveProviderRoute(request)
    },
  }
}

function buildMcpRegistryApi(accessors: MainProcessServiceAccessors) {
  return {
    async loadMcpRegistry(request: Parameters<MainProcessServices['loadMcpRegistry']>[0]) {
      return await accessors.getMcpRegistryService().loadRegistry(request)
    },
    async saveMcpServer(draft: Parameters<MainProcessServices['saveMcpServer']>[0]) {
      return await accessors.getMcpRegistryService().saveServer(draft)
    },
    async deleteMcpServer(serverId: Parameters<MainProcessServices['deleteMcpServer']>[0]) {
      return await accessors.getMcpRegistryService().deleteServer(serverId)
    },
    async setMcpServerEnabled(request: Parameters<MainProcessServices['setMcpServerEnabled']>[0]) {
      return await accessors.getMcpRegistryService().setServerEnabled(request)
    },
    async testMcpConnection(request: Parameters<MainProcessServices['testMcpConnection']>[0]) {
      return await accessors.getMcpRegistryService().testConnection(request)
    },
    async refreshMcpCatalog(request: Parameters<MainProcessServices['refreshMcpCatalog']>[0]) {
      return await accessors.getMcpRegistryService().refreshCatalog(request)
    },
    async warmupEnabledMcpServersOnStartup() {
      await accessors.getMcpRegistryService().warmupEnabledServersOnStartup()
    },
  }
}

function buildToolCatalogApi(accessors: MainProcessServiceAccessors) {
  return {
    async loadToolCatalog() {
      return await accessors.getToolCatalogService().load()
    },
  }
}

function buildSkillRegistryApi(accessors: MainProcessServiceAccessors) {
  return {
    async loadSkillRegistry(request: Parameters<MainProcessServices['loadSkillRegistry']>[0]) {
      return await accessors.getSkillRegistryService().loadRegistry(request)
    },
    async importSkill(request: Parameters<MainProcessServices['importSkill']>[0]) {
      return await accessors.getSkillRegistryService().importSkill(request)
    },
    async selectAndImportSkill() {
      return await accessors.getSkillRegistryService().selectAndImportSkill()
    },
    async deleteSkill(skillId: Parameters<MainProcessServices['deleteSkill']>[0]) {
      return await accessors.getSkillRegistryService().deleteSkill(skillId)
    },
    async setSkillEnabled(request: Parameters<MainProcessServices['setSkillEnabled']>[0]) {
      return await accessors.getSkillRegistryService().setSkillEnabled(request)
    },
    async refreshSkills(request: Parameters<MainProcessServices['refreshSkills']>[0]) {
      return await accessors.getSkillRegistryService().refreshSkills(request)
    },
  }
}

function buildManagedRuntimeApi(accessors: MainProcessServiceAccessors) {
  return {
    async loadManagedRuntime() {
      return await accessors.getManagedRuntimeService().load()
    },
    async installOrRepairManagedRuntime(reason?: ManagedRuntimeActionReason) {
      return await accessors.getManagedRuntimeService().installOrRepair(reason)
    },
  }
}

function buildCapabilityBridgeApi(accessors: MainProcessServiceAccessors) {
  return {
    async handleDesktopCapabilityBridgeRequest(request: Parameters<MainProcessServices['handleDesktopCapabilityBridgeRequest']>[0]) {
      return await accessors.getDesktopCapabilityBridgeService().handleRequest(request)
    },
  }
}

function buildCopilotHistoryApi(copilotHistoryService: ReturnType<CreateMainProcessServicesOptions['createCopilotHistoryService']>) {
  return {
    async listCopilotHistoryThreads() {
      return await copilotHistoryService.listThreads()
    },
    async getCopilotHistoryThreadDetail(threadId: Parameters<MainProcessServices['getCopilotHistoryThreadDetail']>[0]) {
      return await copilotHistoryService.getThreadDetail(threadId)
    },
    async getCopilotHistoryRunReplay(runId: Parameters<MainProcessServices['getCopilotHistoryRunReplay']>[0]) {
      return await copilotHistoryService.getRunReplay(runId)
    },
    async renameCopilotHistoryThread(threadId: Parameters<MainProcessServices['renameCopilotHistoryThread']>[0], request: Parameters<MainProcessServices['renameCopilotHistoryThread']>[1]) {
      return await copilotHistoryService.renameThread(threadId, request)
    },
    async duplicateCopilotHistoryThread(threadId: Parameters<MainProcessServices['duplicateCopilotHistoryThread']>[0], request: Parameters<MainProcessServices['duplicateCopilotHistoryThread']>[1]) {
      return await copilotHistoryService.duplicateThread(threadId, request)
    },
    async deleteCopilotHistoryThread(threadId: Parameters<MainProcessServices['deleteCopilotHistoryThread']>[0]) {
      return await copilotHistoryService.deleteThread(threadId)
    },
    async backupCopilotHistoryDatabase(request: Parameters<MainProcessServices['backupCopilotHistoryDatabase']>[0]) {
      return await copilotHistoryService.backupDatabase(request)
    },
    async restoreCopilotHistoryDatabase(request: Parameters<MainProcessServices['restoreCopilotHistoryDatabase']>[0]) {
      return await copilotHistoryService.restoreDatabase(request)
    },
  }
}

function buildAttachmentApi(attachmentService: Omit<ElectronAttachmentService, 'resolveFilePath'>) {
  return {
    async readClipboardAttachmentData() {
      return await attachmentService.readClipboardData()
    },
    async writeAttachmentTempFile(request: Parameters<MainProcessServices['writeAttachmentTempFile']>[0]) {
      return await attachmentService.writeTempFile(request)
    },
    async readAttachmentPreview(request: Parameters<MainProcessServices['readAttachmentPreview']>[0]) {
      return await attachmentService.readPreview(request)
    },
    async cleanupAttachmentTempFiles(request: Parameters<MainProcessServices['cleanupAttachmentTempFiles']>[0]) {
      return await attachmentService.cleanupTempFiles(request)
    },
  }
}

function buildFileManagerApiBridge(fileManagerService: ElectronFileManagerService) {
  return {
    async selectRootDirectory(request?: Parameters<MainProcessServices['selectRootDirectory']>[0]) {
      return request === undefined
        ? await fileManagerService.selectRootDirectory()
        : await fileManagerService.selectRootDirectory(request)
    },
    async listDirectory(request: Parameters<MainProcessServices['listDirectory']>[0]) {
      return await fileManagerService.listDirectory(request)
    },
    async probeDirectory(request: Parameters<MainProcessServices['probeDirectory']>[0]) {
      return await fileManagerService.probeDirectory(request)
    },
    async createDirectory(request: Parameters<MainProcessServices['createDirectory']>[0]) {
      return await fileManagerService.createDirectory(request)
    },
    async copyEntries(request: Parameters<MainProcessServices['copyEntries']>[0]) {
      return await fileManagerService.copyEntries(request)
    },
    async moveEntries(request: Parameters<MainProcessServices['moveEntries']>[0]) {
      return await fileManagerService.moveEntries(request)
    },
    async renameEntry(request: Parameters<MainProcessServices['renameEntry']>[0]) {
      return await fileManagerService.renameEntry(request)
    },
    async trashEntries(request: Parameters<MainProcessServices['trashEntries']>[0]) {
      return await fileManagerService.trashEntries(request)
    },
    async deleteEntriesPermanently(request: Parameters<MainProcessServices['deleteEntriesPermanently']>[0]) {
      return await fileManagerService.deleteEntriesPermanently(request)
    },
    async watchDirectories(request: Parameters<MainProcessServices['watchDirectories']>[0]) {
      return await fileManagerService.watchDirectories(request)
    },
    async unwatchDirectories(request: Parameters<MainProcessServices['unwatchDirectories']>[0]) {
      return await fileManagerService.unwatchDirectories(request)
    },
    async loadLastRootDirectory() {
      return await fileManagerService.loadLastRootDirectory()
    },
    async saveLastRootDirectory(request: Parameters<MainProcessServices['saveLastRootDirectory']>[0]) {
      return await fileManagerService.saveLastRootDirectory(request)
    },
    async clearLastRootDirectory() {
      return await fileManagerService.clearLastRootDirectory()
    },
    async openEntryWithSystem(request: Parameters<MainProcessServices['openEntryWithSystem']>[0]) {
      return await fileManagerService.openEntryWithSystem(request)
    },
    async revealEntryInFolder(request: Parameters<MainProcessServices['revealEntryInFolder']>[0]) {
      return await fileManagerService.revealEntryInFolder(request)
    },
    async copyTextToClipboard(request: Parameters<MainProcessServices['copyTextToClipboard']>[0]) {
      return await fileManagerService.copyTextToClipboard(request)
    },
  }
}

function buildDesktopRuntimeApi(options: CreateMainProcessServicesOptions) {
  return {
    async loadDesktopRuntimeCalendarEvents(): Promise<DesktopRuntimeCalendarEventsLoadResult> {
      return await requestProtectedRuntimeJson<DesktopRuntimeCalendarEventsLoadResult>({
        options,
        path: CALENDAR_EVENTS_PATH,
        method: 'GET',
        failureLabel: 'Failed to load desktop runtime calendar events',
      })
    },
    async importDesktopRuntimeWakeupIcs(request: Parameters<MainProcessServices['importDesktopRuntimeWakeupIcs']>[0]): Promise<DesktopRuntimeWakeupIcsImportResult> {
      return await requestProtectedRuntimeJson<DesktopRuntimeWakeupIcsImportResult>({
        options,
        path: WAKEUP_ICS_IMPORT_PATH,
        method: 'POST',
        body: request,
        failureLabel: 'Failed to import WakeUP ICS payload',
      })
    },
  }
}

function buildTimelineDatabaseApi(options: CreateMainProcessServicesOptions) {
  return {
    async loadTimelineEvents(request?: LoadTimelineEventsRequest) {
      const localItems = getCalendarEvents()
      const runtimeUrl = normalizeOptionalString(request?.runtimeUrl)
      if (runtimeUrl === null) {
        return { items: localItems }
      }

      const remoteItems = await fetchRemoteCalendarEvents(runtimeUrl, options)
      if (remoteItems === null) {
        if (localItems.length === 0) {
          throw new Error(CALENDAR_LOAD_FAILURE_MESSAGE)
        }
        return { items: localItems }
      }

      return { items: mergeCalendarEvents(localItems, remoteItems) }
    },
    async addTimelineEvent(request: Parameters<MainProcessServices['addTimelineEvent']>[0]) {
      const id = addCalendarEvent(request.event)
      return { id }
    },
  }
}

async function requestProtectedRuntimeJson<TResult extends { ok?: boolean; error?: string }>(input: {
  options: CreateMainProcessServicesOptions
  path: string
  method: 'GET' | 'POST'
  body?: unknown
  failureLabel: string
}): Promise<TResult> {
  try {
    const service = await input.options.ensureHostedBackendService()
    await service.start()

    const runtimeBaseUrl = service.getRuntimeBaseUrl()
    if (runtimeBaseUrl === null || runtimeBaseUrl.trim() === '') {
      throw new Error('Hosted backend runtime URL is unavailable.')
    }

    const token = service.getLocalToken()
    const headers = new Headers()
    if (token !== null && token.trim() !== '') {
      headers.set(LOCAL_RUNTIME_TOKEN_HEADER, token)
    }

    let body: string | undefined
    if (input.body !== undefined) {
      body = JSON.stringify(input.body)
      headers.set('Content-Type', 'application/json')
    }

    const response = await fetch(new URL(input.path, normalizeRuntimeBaseUrl(runtimeBaseUrl)).toString(), {
      method: input.method,
      headers,
      body,
    })
    const payload = await response.json().catch(() => null)

    if (!response.ok) {
      const detail = extractRuntimeFailureMessage(payload, response.status, response.statusText)
      return { ok: false, error: `${input.failureLabel}: ${detail}` } as TResult
    }

    if (!isPlainRecord(payload)) {
      return { ok: false, error: `${input.failureLabel}: backend returned an invalid response payload.` } as TResult
    }

    return payload as TResult
  } catch (error) {
    return { ok: false, error: `${input.failureLabel}: ${formatUnknownError(error)}` } as TResult
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function extractRuntimeFailureMessage(payload: unknown, status: number, statusText: string): string {
  if (isPlainRecord(payload)) {
    if (typeof payload.error === 'string' && payload.error.trim() !== '') {
      return payload.error
    }
    if (typeof payload.detail === 'string' && payload.detail.trim() !== '') {
      return payload.detail
    }
  }

  const normalizedStatusText = statusText.trim()
  return normalizedStatusText ? `HTTP ${status} ${normalizedStatusText}` : `HTTP ${status}`
}

async function fetchRemoteCalendarEvents(
  runtimeUrl: string,
  options: CreateMainProcessServicesOptions,
): Promise<UnifiedCalendarEvent[] | null> {
  const request = await buildTrustedCalendarEventsRequest(runtimeUrl, options)
  if (request === null) {
    return null
  }

  try {
    const response = await fetch(request.apiUrl, { headers: request.headers })
    if (!response.ok) {
      await appendTimelineLog(options, 'warn', 'Calendar API responded with a non-success status.', {
        runtimeUrl: request.requestedRuntimeUrl,
        trustedRuntimeUrl: request.trustedRuntimeUrl,
        status: response.status,
        statusText: response.statusText,
      })
      return null
    }

    const payload = await response.json() as { items?: UnifiedCalendarEvent[] }
    return Array.isArray(payload.items) ? payload.items : []
  } catch (error) {
    await appendTimelineLog(options, 'warn', 'Failed to fetch backend calendar events.', {
      runtimeUrl: request.requestedRuntimeUrl,
      trustedRuntimeUrl: request.trustedRuntimeUrl,
      error: formatUnknownError(error),
    })
    return null
  }
}

interface TrustedCalendarEventsRequest {
  apiUrl: string
  headers: Headers
  requestedRuntimeUrl: string
  trustedRuntimeUrl: string
}

async function buildTrustedCalendarEventsRequest(
  requestedRuntimeUrl: string,
  options: CreateMainProcessServicesOptions,
): Promise<TrustedCalendarEventsRequest | null> {
  const requestedRuntimeBaseUrl = parseRuntimeBaseUrl(requestedRuntimeUrl)
  if (requestedRuntimeBaseUrl === null) {
    await appendTimelineLog(options, 'warn', 'Invalid renderer runtime URL for calendar events request.', {
      runtimeUrl: requestedRuntimeUrl,
    })
    return null
  }

  let service: Awaited<ReturnType<CreateMainProcessServicesOptions['ensureHostedBackendService']>>
  try {
    service = await options.ensureHostedBackendService()
    await service.start()
  } catch (error) {
    await appendTimelineLog(options, 'warn', 'Unable to resolve hosted runtime for calendar events request.', {
      runtimeUrl: requestedRuntimeBaseUrl.toString(),
      error: formatUnknownError(error),
    })
    return null
  }

  let trustedRuntimeUrl: string | null
  try {
    trustedRuntimeUrl = normalizeOptionalString(service.getRuntimeBaseUrl())
  } catch (error) {
    await appendTimelineLog(options, 'warn', 'Unable to resolve trusted backend calendar events base URL.', {
      runtimeUrl: requestedRuntimeBaseUrl.toString(),
      error: formatUnknownError(error),
    })
    return null
  }

  if (trustedRuntimeUrl === null) {
    await appendTimelineLog(options, 'warn', 'Trusted backend calendar events base URL is empty.', {
      runtimeUrl: requestedRuntimeBaseUrl.toString(),
    })
    return null
  }

  const trustedRuntimeBaseUrl = parseRuntimeBaseUrl(trustedRuntimeUrl)
  if (trustedRuntimeBaseUrl === null) {
    await appendTimelineLog(options, 'warn', 'Failed to build trusted backend calendar events URL.', {
      runtimeUrl: requestedRuntimeBaseUrl.toString(),
      trustedRuntimeUrl,
    })
    return null
  }

  if (requestedRuntimeBaseUrl.origin !== trustedRuntimeBaseUrl.origin) {
    await appendTimelineLog(options, 'warn', 'Renderer calendar runtime URL does not match trusted hosted runtime; using trusted runtime URL.', {
      runtimeUrl: requestedRuntimeBaseUrl.toString(),
      trustedRuntimeUrl: trustedRuntimeBaseUrl.toString(),
    })
  }

  const apiUrl = new URL(CALENDAR_EVENTS_PATH, trustedRuntimeBaseUrl).toString()
  const headers = new Headers()
  try {
    const token = normalizeOptionalString(service.getLocalToken())
    if (token !== null) {
      headers.set(LOCAL_RUNTIME_TOKEN_HEADER, token)
    }
  } catch (error) {
    await appendTimelineLog(options, 'warn', 'Unable to resolve local runtime token for calendar events request.', {
      runtimeUrl: requestedRuntimeBaseUrl.toString(),
      trustedRuntimeUrl: trustedRuntimeBaseUrl.toString(),
      error: formatUnknownError(error),
    })
  }

  return {
    apiUrl,
    headers,
    requestedRuntimeUrl: requestedRuntimeBaseUrl.toString(),
    trustedRuntimeUrl: trustedRuntimeBaseUrl.toString(),
  }
}

function mergeCalendarEvents(
  localItems: UnifiedCalendarEvent[],
  remoteItems: UnifiedCalendarEvent[],
): UnifiedCalendarEvent[] {
  const eventsByKey = new Map<string, UnifiedCalendarEvent>()

  for (const localEvent of localItems) {
    eventsByKey.set(buildCompositeKey(localEvent), localEvent)
  }

  for (const remoteEvent of remoteItems) {
    eventsByKey.set(buildCompositeKey(remoteEvent), remoteEvent)
  }

  const combinedEvents = Array.from(eventsByKey.values())
  combinedEvents.sort(compareCalendarEvents)
  return combinedEvents
}

function compareCalendarEvents(a: UnifiedCalendarEvent, b: UnifiedCalendarEvent): number {
  const aTime = new Date(a.start_time).getTime()
  const bTime = new Date(b.start_time).getTime()
  if (aTime !== bTime) return aTime - bTime
  return (a.title ?? '').localeCompare(b.title ?? '') || String(a.source).localeCompare(String(b.source))
}

function buildCompositeKey(event: {
  source: string
  source_id: string | null
  title?: string
  start_time?: string
}): string {
  if (event.source_id != null && String(event.source_id).trim().length > 0) {
    return `${String(event.source)}:${String(event.source_id)}`
  }
  return `${String(event.source)}:${String(event.title ?? '')}:${String(event.start_time ?? '')}`
}

function parseRuntimeBaseUrl(runtimeBaseUrl: string): URL | null {
  try {
    return new URL(normalizeRuntimeBaseUrl(runtimeBaseUrl))
  } catch {
    return null
  }
}

function normalizeRuntimeBaseUrl(runtimeBaseUrl: string): string {
  return runtimeBaseUrl.endsWith('/') ? runtimeBaseUrl : `${runtimeBaseUrl}/`
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalizedValue = value.trim()
  return normalizedValue.length > 0 ? normalizedValue : null
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function appendTimelineLog(
  options: CreateMainProcessServicesOptions,
  level: 'warn' | 'error',
  message: string,
  context: Record<string, unknown>,
): Promise<void> {
  await options.appendMainRuntimeLog(level, `[timeline-database] ${message}`, context)
}

// ===== Main factory function =====

export function createMainProcessServices(
  options: CreateMainProcessServicesOptions,
): MainProcessServices {
  const accessors = createMainProcessServiceAccessors(options)
  const copilotHistoryService = options.createCopilotHistoryService()
  const attachmentService = createElectronAttachmentService({
    appendLog(level, message, context) {
      return options.appendMainRuntimeLog(level, `[attachment-service] ${message}`, context ?? null)
    },
  })
  const fileManagerService = createElectronFileManagerService({
    getMainWindow: options.getMainWindow,
    userDataPath: options.userDataPath,
    appendLog(level, message, context) {
      return options.appendMainRuntimeLog(level, `[file-manager] ${message}`, context ?? null)
    },
  })

  return {
    ...buildConfigCenterApi(accessors),
    ...buildToolCatalogApi(accessors),
    ...buildSettingsWorkspaceApi(accessors),
    ...buildMcpRegistryApi(accessors),
    ...buildSkillRegistryApi(accessors),
    ...buildManagedRuntimeApi(accessors),
    ...buildCapabilityBridgeApi(accessors),
    ...buildCopilotHistoryApi(copilotHistoryService),
    ...buildDesktopRuntimeApi(options),
    ...buildAttachmentApi(attachmentService),
    ...buildFileManagerApiBridge(fileManagerService),
    ...buildTimelineDatabaseApi(options),
  }
}
