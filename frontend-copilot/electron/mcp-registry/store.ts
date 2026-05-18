import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { HostedRuntimePaths } from '../runtime/runtime-paths'
import {
  MCP_REGISTRY_DOCUMENT_VERSION,
  type McpRevisionState,
  type McpServerRecord,
} from './types'

export const MCP_REGISTRY_DIR_NAME = 'mcp-registry'
export const MCP_REGISTRY_DOCUMENT_FILE_NAME = 'registry.json'

export interface McpRegistryPaths {
  rootDir: string
  documentFile: string
}

export interface McpRegistryStoreSnapshot extends McpRevisionState {
  servers: McpServerRecord[]
  source: 'stored' | 'initialized-defaults' | 'recovered-corrupt'
}

export interface McpRegistryStore {
  load(): Promise<McpRegistryStoreSnapshot>
  saveServers(servers: readonly McpServerRecord[], options?: { snapshotRevision?: number }): Promise<McpRegistryStoreSnapshot>
  saveSnapshotRevision(snapshotRevision: number): Promise<McpRegistryStoreSnapshot>
}

interface McpRegistryDocument extends McpRevisionState {
  version: typeof MCP_REGISTRY_DOCUMENT_VERSION
  servers: McpServerRecord[]
}

export interface CreateMcpRegistryStoreOptions {
  paths: McpRegistryPaths
}

export function createMcpRegistryPaths(
  hostedPaths: Pick<HostedRuntimePaths, 'configDir'>,
): McpRegistryPaths {
  const rootDir = path.join(hostedPaths.configDir, MCP_REGISTRY_DIR_NAME)
  return {
    rootDir,
    documentFile: path.join(rootDir, MCP_REGISTRY_DOCUMENT_FILE_NAME),
  }
}

export function createMcpRegistryStore(
  options: CreateMcpRegistryStoreOptions,
): McpRegistryStore {
  return {
    async load() {
      await mkdir(options.paths.rootDir, { recursive: true })

      const readResult = await readDocument(options.paths.documentFile)
      if (readResult.status === 'missing') {
        const initialDocument = createDefaultDocument()
        await writeDocument(options.paths.documentFile, initialDocument)
        return projectSnapshot(initialDocument, 'initialized-defaults')
      }

      if (readResult.status === 'stored') {
        return projectSnapshot(readResult.document, 'stored')
      }

      await recoverCorruptDocument(options.paths.documentFile)
      const recoveredDocument = createDefaultDocument()
      await writeDocument(options.paths.documentFile, recoveredDocument)
      return projectSnapshot(recoveredDocument, 'recovered-corrupt')
    },
    async saveServers(servers, saveOptions) {
      const current = await this.load()
      const nextDocument: McpRegistryDocument = {
        version: MCP_REGISTRY_DOCUMENT_VERSION,
        registryRevision: current.registryRevision + 1,
        snapshotRevision: typeof saveOptions?.snapshotRevision === 'number'
          ? normalizeNonNegativeInteger(saveOptions.snapshotRevision)
          : current.snapshotRevision,
        servers: servers.map(cloneServerRecord),
      }

      await writeDocument(options.paths.documentFile, nextDocument)
      return projectSnapshot(nextDocument, 'stored')
    },
    async saveSnapshotRevision(snapshotRevision) {
      const current = await this.load()
      const nextDocument: McpRegistryDocument = {
        version: MCP_REGISTRY_DOCUMENT_VERSION,
        registryRevision: current.registryRevision,
        snapshotRevision: normalizeNonNegativeInteger(snapshotRevision),
        servers: current.servers.map(cloneServerRecord),
      }

      await writeDocument(options.paths.documentFile, nextDocument)
      return projectSnapshot(nextDocument, 'stored')
    },
  }
}

async function readDocument(documentFile: string): Promise<
  | { status: 'missing' }
  | { status: 'stored', document: McpRegistryDocument }
  | { status: 'corrupt' }
> {
  try {
    const raw = await readFile(documentFile, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    const normalized = normalizeDocument(parsed)
    return normalized === null
      ? { status: 'corrupt' }
      : { status: 'stored', document: normalized }
  } catch (error) {
    if (isMissingFileError(error)) {
      return { status: 'missing' }
    }

    return { status: 'corrupt' }
  }
}

async function recoverCorruptDocument(documentFile: string): Promise<void> {
  try {
    await rename(documentFile, `${documentFile}.corrupt-${Date.now()}`)
  } catch (error) {
    if (isMissingFileError(error)) {
      return
    }
  }
}

async function writeDocument(documentFile: string, document: McpRegistryDocument): Promise<void> {
  await writeFile(documentFile, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
}

function projectSnapshot(
  document: McpRegistryDocument,
  source: McpRegistryStoreSnapshot['source'],
): McpRegistryStoreSnapshot {
  return {
    source,
    registryRevision: document.registryRevision,
    snapshotRevision: document.snapshotRevision,
    servers: document.servers.map(cloneServerRecord),
  }
}

function createDefaultDocument(): McpRegistryDocument {
  return {
    version: MCP_REGISTRY_DOCUMENT_VERSION,
    registryRevision: 0,
    snapshotRevision: 0,
    servers: [],
  }
}

function normalizeDocument(value: unknown): McpRegistryDocument | null {
  if (!isPlainRecord(value)) {
    return null
  }

  const version = value.version
  if (version !== undefined && version !== MCP_REGISTRY_DOCUMENT_VERSION) {
    return null
  }

  const servers = Array.isArray(value.servers)
    ? value.servers.map(normalizeServerRecord).filter((server): server is McpServerRecord => server !== null)
    : null

  if (servers === null) {
    return null
  }

  return {
    version: MCP_REGISTRY_DOCUMENT_VERSION,
    registryRevision: normalizeNonNegativeInteger(value.registryRevision),
    snapshotRevision: normalizeNonNegativeInteger(value.snapshotRevision),
    servers,
  }
}

function normalizeServerRecord(value: unknown): McpServerRecord | null {
  if (!isPlainRecord(value)) {
    return null
  }

  if (typeof value.serverId !== 'string'
    || typeof value.displayName !== 'string'
    || typeof value.enabled !== 'boolean'
    || typeof value.transportKind !== 'string'
    || typeof value.createdAt !== 'string'
    || typeof value.updatedAt !== 'string'
    || !isPlainRecord(value.transportConfig)
  ) {
    return null
  }

  const transportKind = normalizeTransportKind(value.transportKind)
  if (transportKind === null) {
    return null
  }

  const transportConfig = normalizeTransportConfig(value.transportConfig, transportKind)
  if (transportConfig === null) {
    return null
  }

  return {
    serverId: value.serverId,
    displayName: value.displayName,
    enabled: value.enabled,
    transportKind,
    description: typeof value.description === 'string' ? value.description : null,
    transportConfig,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    reservedSensitiveFields: normalizeStringArray(value.reservedSensitiveFields),
  }
}

function normalizeTransportConfig(
  value: Record<string, unknown>,
  transportKind: McpServerRecord['transportKind'],
): McpServerRecord['transportConfig'] | null {
  if (transportKind === 'stdio') {
    return normalizeStdioTransportConfig(value)
  }

  return normalizeHttpSseTransportConfig(value)
}

function normalizeStdioTransportConfig(
  value: Record<string, unknown>,
): McpServerRecord['transportConfig'] | null {
  if (value.kind !== 'stdio' || typeof value.command !== 'string' || !Array.isArray(value.args)) {
    return null
  }

  if (!value.args.every((entry) => typeof entry === 'string')) {
    return null
  }

  const env = normalizeStringRecord(value.env)
  if (env === null) {
    return null
  }

  return {
    kind: 'stdio',
    command: value.command,
    args: [...value.args],
    cwd: typeof value.cwd === 'string' ? value.cwd : null,
    ...(env === undefined ? {} : { env }),
  }
}

function normalizeHttpSseTransportConfig(
  value: Record<string, unknown>,
): McpServerRecord['transportConfig'] | null {
  if (value.kind !== 'http-sse' || typeof value.baseUrl !== 'string') {
    return null
  }

  const headers = normalizeStringRecord(value.headers)
  const env = normalizeStringRecord(value.env)
  if (headers === null || env === null) {
    return null
  }

  return {
    kind: 'http-sse',
    baseUrl: value.baseUrl,
    ...(headers === undefined ? {} : { headers }),
    ...(env === undefined ? {} : { env }),
    ssePathOverride: typeof value.ssePathOverride === 'string' ? value.ssePathOverride : null,
  }
}

function normalizeTransportKind(value: string): McpServerRecord['transportKind'] | null {
  return value === 'stdio' || value === 'http-sse' ? value : null
}

function normalizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  return value.filter((entry): entry is string => typeof entry === 'string')
}

function normalizeStringRecord(value: unknown): Record<string, string> | undefined | null {
  if (value === undefined) {
    return undefined
  }

  if (!isPlainRecord(value)) {
    return null
  }

  const entries = Object.entries(value)
  if (!entries.every(([, entryValue]) => typeof entryValue === 'string')) {
    return null
  }

  return Object.fromEntries(entries as [string, string][])
}

function normalizeNonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0
  }

  return Math.floor(value)
}

function cloneServerRecord(server: McpServerRecord): McpServerRecord {
  if (server.transportConfig.kind === 'stdio') {
    return {
      ...server,
      transportConfig: {
        ...server.transportConfig,
        args: [...server.transportConfig.args],
        ...(server.transportConfig.env === undefined ? {} : { env: { ...server.transportConfig.env } }),
      },
      ...(server.reservedSensitiveFields === undefined
        ? {}
        : { reservedSensitiveFields: [...server.reservedSensitiveFields] }),
    }
  }

  return {
    ...server,
    transportConfig: {
      ...server.transportConfig,
      ...(server.transportConfig.headers === undefined ? {} : { headers: { ...server.transportConfig.headers } }),
      ...(server.transportConfig.env === undefined ? {} : { env: { ...server.transportConfig.env } }),
    },
    ...(server.reservedSensitiveFields === undefined
      ? {}
      : { reservedSensitiveFields: [...server.reservedSensitiveFields] }),
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && error.code === 'ENOENT'
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
