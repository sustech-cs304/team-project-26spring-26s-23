import type { HostedBackendService } from '../runtime/hosted-backend-service'
import type { RuntimeToolDirectoryEntry } from '../../src/features/copilot/chat-contract'
import type { ConfigCenterPublicSnapshot } from '../config-center/public-snapshot'
import type { ToolCatalogLoadRequest, ToolCatalogLoadResult } from './ipc'

const LOCAL_RUNTIME_TOKEN_HEADER = 'X-Local-Token'
const GLOBAL_TOOL_CATALOG_METHOD = 'tools/catalog/get'

export interface CreateElectronToolCatalogServiceOptions {
  ensureHostedBackendService: () => Promise<HostedBackendService>
  getLocalToken: () => string | null | Promise<string | null>
  loadConfigCenterPublicSnapshot: () => Promise<ConfigCenterPublicSnapshot | null>
}

export interface ElectronToolCatalogService {
  load(request?: ToolCatalogLoadRequest): Promise<ToolCatalogLoadResult>
}

interface RuntimeGlobalToolCatalogPayload {
  ok: true
  directoryVersion: string
  defaultToolset: string
  language?: string | null
  tools: RuntimeToolDirectoryEntry[]
}

const RUNTIME_TOOL_CATALOG_EMPTY_ERROR = 'Hosted backend returned an empty global tool catalog.'

export function createElectronToolCatalogService(
  options: CreateElectronToolCatalogServiceOptions,
): ElectronToolCatalogService {
  return {
    async load(request) {
      try {
        const service = await options.ensureHostedBackendService()
        await service.start()

        const runtimeBaseUrl = service.getRuntimeBaseUrl()
        if (runtimeBaseUrl === null || runtimeBaseUrl.trim() === '') {
          return {
            ok: false,
            error: 'Hosted backend runtime URL is unavailable.',
          }
        }

        const token = normalizeOptionalString(service.getLocalToken())
          ?? normalizeOptionalString(await options.getLocalToken())
        const headers = new Headers({
          'Content-Type': 'application/json',
        })
        if (token !== null) {
          headers.set(LOCAL_RUNTIME_TOKEN_HEADER, token)
        }

        const language = normalizeCatalogLanguage(
          request?.language ?? await loadPreferredLanguage(options.loadConfigCenterPublicSnapshot),
        )
        const response = await fetch(normalizeRuntimeBaseUrl(runtimeBaseUrl), {
          method: 'POST',
          headers,
          body: JSON.stringify({
            method: GLOBAL_TOOL_CATALOG_METHOD,
            body: {
              language,
            },
          }),
        })
        const payload = await response.json() as unknown

        if (!response.ok) {
          return {
            ok: false,
            error: extractFailureMessage(payload, response.status, response.statusText),
          }
        }

        if (!isRuntimeGlobalToolCatalogPayload(payload)) {
          return {
            ok: false,
            error: 'Hosted backend returned an invalid global tool catalog payload.',
          }
        }

        const tools = mapToolCatalogEntries(payload.tools)
        if (tools.length === 0) {
          return {
            ok: false,
            error: RUNTIME_TOOL_CATALOG_EMPTY_ERROR,
          }
        }

        return {
          ok: true,
          directoryVersion: payload.directoryVersion,
          language: normalizeCatalogLanguage(payload.language ?? language),
          tools,
        }
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}

export function mapToolCatalogEntries(
  tools: RuntimeToolDirectoryEntry[],
): RuntimeToolDirectoryEntry[] {
  return tools.map((tool) => ({ ...tool }))
}

function normalizeRuntimeBaseUrl(value: string): string {
  return value.endsWith('/') ? value : `${value}/`
}

function normalizeOptionalString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized === '' ? null : normalized
}

function extractFailureMessage(payload: unknown, status: number, statusText: string): string {
  if (isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === 'string') {
    return payload.error.message
  }

  const normalizedStatusText = statusText.trim()
  return normalizedStatusText === ''
    ? `Hosted backend request failed with status ${status}.`
    : `Hosted backend request failed with status ${status}: ${normalizedStatusText}`
}

function isRuntimeGlobalToolCatalogPayload(value: unknown): value is RuntimeGlobalToolCatalogPayload {
  if (!isRecord(value) || value.ok !== true || !Array.isArray(value.tools)) {
    return false
  }

  return value.tools.every(isRuntimeToolDirectoryEntry)
}

function isRuntimeToolDirectoryEntry(value: unknown): value is RuntimeToolDirectoryEntry {
  return isRecord(value)
    && typeof value.toolId === 'string'
    && typeof value.kind === 'string'
    && typeof value.availability === 'string'
    && isNullableString(value.displayName)
    && isNullableString(value.description)
    && isOptionalNullableString(value.prompt)
    && isOptionalNullableString(value.displayNameZh)
    && isOptionalNullableString(value.displayNameEn)
    && isOptionalNullableString(value.descriptionZh)
    && isOptionalNullableString(value.descriptionEn)
    && isOptionalToolGroup(value.group)
}

function isOptionalToolGroup(value: unknown): boolean {
  return value === undefined || value === null || isToolGroup(value)
}

function isToolGroup(value: unknown): boolean {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.label === 'string'
    && typeof value.labelZh === 'string'
    && typeof value.labelEn === 'string'
    && typeof value.order === 'number'
    && typeof value.sourceKind === 'string'
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null
}

function isOptionalNullableString(value: unknown): boolean {
  return value === undefined || isNullableString(value)
}

async function loadPreferredLanguage(
  loadConfigCenterPublicSnapshot: () => Promise<ConfigCenterPublicSnapshot | null>,
): Promise<string | null> {
  const snapshot = await loadConfigCenterPublicSnapshot()
  return snapshot?.domains?.general?.language ?? null
}

function normalizeCatalogLanguage(language: string | null | undefined): string {
  const normalized = language?.trim().toLowerCase() ?? ''
  return normalized.startsWith('en') ? 'en-US' : 'zh-CN'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
