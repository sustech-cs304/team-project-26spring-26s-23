import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DesktopCapabilityBridgeRequest } from '../protocol'
import { DesktopCapabilityBridgeError } from '../errors'
import { createDesktopCapabilityBridgePaths } from '../paths'
import type { CreateDesktopCapabilityBridgeServiceOptions } from '../types'

const DESKTOP_HOSTED_ARTIFACT_METADATA_FIELD = '__desktopCapabilityArtifact'
const DESKTOP_HOSTED_ARTIFACT_STORAGE_KIND = 'electron-desktop-capability-bridge'
const BASE64_PAYLOAD_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

interface PersistedArtifactRecord {
  artifactId: string
  uri: string
  name: string
  contentType?: string
  metadata: Record<string, unknown>
  fileName: string
}

interface PersistedArtifactIndex {
  version: 1
  artifacts: Record<string, PersistedArtifactRecord>
}

export interface DesktopCapabilityArtifactService {
  handle(request: DesktopCapabilityBridgeRequest): Promise<Record<string, unknown>>
}

let artifactMutationQueue = Promise.resolve()

export function createDesktopCapabilityArtifactService(
  options: CreateDesktopCapabilityBridgeServiceOptions,
): DesktopCapabilityArtifactService {
  return {
    async handle(request) {
      switch (request.operation) {
        case 'save_text':
          return await enqueueArtifactMutation(async () => await saveArtifactText(options, request))
        case 'save_bytes':
          return await enqueueArtifactMutation(async () => await saveArtifactBytes(options, request))
        case 'describe_artifact':
          return await describeArtifact(options, request)
        default:
          throw new DesktopCapabilityBridgeError(
            'unsupported_operation',
            `Artifact capability does not support operation '${request.operation}'.`,
            {
              details: {
                capability: request.capability,
                operation: request.operation,
              },
            },
          )
      }
    },
  }
}

async function saveArtifactText(
  options: CreateDesktopCapabilityBridgeServiceOptions,
  request: DesktopCapabilityBridgeRequest,
): Promise<Record<string, unknown>> {
  const name = requireNonEmptyString(request.payload.name, 'Artifact name must be a non-empty string.')
  const text = requireString(request.payload.text, 'Artifact text must be a string.')
  const contentType = normalizeOptionalString(request.payload.contentType) ?? 'text/plain'
  const metadata = normalizeMetadata(request.payload.metadata)

  return await persistArtifact(options, request, {
    name,
    contentType,
    metadata,
    buffer: Buffer.from(text, 'utf8'),
  })
}

async function saveArtifactBytes(
  options: CreateDesktopCapabilityBridgeServiceOptions,
  request: DesktopCapabilityBridgeRequest,
): Promise<Record<string, unknown>> {
  const name = requireNonEmptyString(request.payload.name, 'Artifact name must be a non-empty string.')
  const contentBase64 = requireNonEmptyString(
    request.payload.contentBase64,
    'contentBase64 must be a non-empty string.',
  )
  const contentType = normalizeOptionalString(request.payload.contentType) ?? 'application/octet-stream'
  const metadata = normalizeMetadata(request.payload.metadata)
  const buffer = decodeBase64Payload(contentBase64)

  return await persistArtifact(options, request, {
    name,
    contentType,
    metadata,
    buffer,
  })
}

async function persistArtifact(
  options: CreateDesktopCapabilityBridgeServiceOptions,
  request: DesktopCapabilityBridgeRequest,
  input: {
    name: string
    contentType: string
    metadata: Record<string, unknown>
    buffer: Buffer
  },
): Promise<Record<string, unknown>> {
  const hostedPaths = await options.prepareRuntimePaths()
  const bridgePaths = createDesktopCapabilityBridgePaths(hostedPaths)
  await mkdir(bridgePaths.artifactsDir, { recursive: true })
  await mkdir(path.dirname(bridgePaths.artifactIndexFile), { recursive: true })

  const index = await readArtifactIndex(bridgePaths.artifactIndexFile)
  const artifactId = `artifact-${randomBytes(12).toString('hex')}`
  const fileName = `${artifactId}-${sanitizeArtifactName(input.name)}`
  const filePath = path.join(bridgePaths.artifactsDir, fileName)
  const storedAt = new Date().toISOString()
  const descriptor = {
    artifactId,
    uri: `artifact://desktop/${artifactId}`,
    name: input.name,
    contentType: input.contentType,
    metadata: buildArtifactMetadata(input.metadata, {
      storageKind: DESKTOP_HOSTED_ARTIFACT_STORAGE_KIND,
      byteLength: input.buffer.byteLength,
      sha256: createHash('sha256').update(input.buffer).digest('hex'),
      storedAt,
    }),
  }

  await writeFile(filePath, input.buffer)

  index.artifacts[artifactId] = {
    ...descriptor,
    fileName,
  }
  await writeArtifactIndex(bridgePaths.artifactIndexFile, index)

  await options.appendLog?.('info', '[capability-bridge] Artifact persisted.', {
    capability: request.capability,
    operation: request.operation,
    toolId: request.toolId,
    runId: request.runId,
    toolCallId: request.toolCallId,
    artifactId,
    name: input.name,
    contentType: input.contentType,
    byteLength: input.buffer.byteLength,
    metadataKeys: Object.keys(input.metadata),
  }, {
    relayToRenderer: false,
  })

  return descriptor
}

async function describeArtifact(
  options: CreateDesktopCapabilityBridgeServiceOptions,
  request: DesktopCapabilityBridgeRequest,
): Promise<Record<string, unknown>> {
  const artifactId = requireNonEmptyString(request.payload.artifactId, 'artifactId must be a non-empty string.')
  const hostedPaths = await options.prepareRuntimePaths()
  const bridgePaths = createDesktopCapabilityBridgePaths(hostedPaths)
  const index = await readArtifactIndex(bridgePaths.artifactIndexFile)
  const artifact = index.artifacts[artifactId]
  if (artifact === undefined) {
    throw new DesktopCapabilityBridgeError('not_found', `Artifact '${artifactId}' was not found.`, {
      details: { artifactId },
    })
  }

  await options.appendLog?.('info', '[capability-bridge] Artifact described.', {
    capability: request.capability,
    operation: request.operation,
    toolId: request.toolId,
    runId: request.runId,
    toolCallId: request.toolCallId,
    artifactId,
  }, {
    relayToRenderer: false,
  })

  return {
    artifactId: artifact.artifactId,
    uri: artifact.uri,
    name: artifact.name,
    contentType: artifact.contentType,
    metadata: cloneRecord(artifact.metadata),
  }
}

async function readArtifactIndex(filePath: string): Promise<PersistedArtifactIndex> {
  try {
    const raw = JSON.parse(await readFile(filePath, 'utf8')) as Partial<PersistedArtifactIndex>
    const artifacts = typeof raw.artifacts === 'object' && raw.artifacts !== null
      ? raw.artifacts
      : {}

    return {
      version: 1,
      artifacts: Object.fromEntries(
        Object.entries(artifacts).map(([artifactId, artifact]) => {
          const record = artifact as Partial<PersistedArtifactRecord>
          return [artifactId, {
            artifactId: typeof record.artifactId === 'string' ? record.artifactId : artifactId,
            uri: typeof record.uri === 'string' ? record.uri : `artifact://desktop/${artifactId}`,
            name: typeof record.name === 'string' ? record.name : artifactId,
            contentType: typeof record.contentType === 'string' ? record.contentType : undefined,
            metadata: normalizeMetadata(record.metadata),
            fileName: typeof record.fileName === 'string' ? record.fileName : artifactId,
          }]
        }),
      ),
    }
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return {
        version: 1,
        artifacts: {},
      }
    }

    throw new DesktopCapabilityBridgeError('internal_error', 'Failed to load artifact index.', {
      details: {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

async function enqueueArtifactMutation<TValue>(
  operation: () => Promise<TValue>,
): Promise<TValue> {
  const nextOperation = artifactMutationQueue.then(operation)
  artifactMutationQueue = nextOperation.then(
    () => undefined,
    () => undefined,
  )
  return await nextOperation
}

async function writeArtifactIndex(filePath: string, index: PersistedArtifactIndex): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
}

function buildArtifactMetadata(
  metadata: Record<string, unknown>,
  hostedMetadata: {
    storageKind: string
    byteLength: number
    sha256: string
    storedAt: string
  },
): Record<string, unknown> {
  if (metadata[DESKTOP_HOSTED_ARTIFACT_METADATA_FIELD] !== undefined) {
    throw new DesktopCapabilityBridgeError(
      'invalid_request',
      `Artifact metadata must not include reserved field '${DESKTOP_HOSTED_ARTIFACT_METADATA_FIELD}'.`,
    )
  }

  return {
    ...cloneRecord(metadata),
    [DESKTOP_HOSTED_ARTIFACT_METADATA_FIELD]: {
      storageKind: hostedMetadata.storageKind,
      byteLength: hostedMetadata.byteLength,
      sha256: hostedMetadata.sha256,
      storedAt: hostedMetadata.storedAt,
    },
  }
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }

  return cloneRecord(value as Record<string, unknown>)
}

function decodeBase64Payload(value: string): Buffer {
  const normalized = value.replace(/\s+/g, '')
  const remainder = normalized.length % 4
  const padded = remainder === 0
    ? normalized
    : normalized.padEnd(normalized.length + (4 - remainder), '=')

  if (!BASE64_PAYLOAD_PATTERN.test(padded)) {
    throw new DesktopCapabilityBridgeError('invalid_request', 'contentBase64 must be valid base64.')
  }

  const buffer = Buffer.from(padded, 'base64')
  if (buffer.toString('base64') !== padded) {
    throw new DesktopCapabilityBridgeError('invalid_request', 'contentBase64 must be valid base64.')
  }

  return buffer
}

function sanitizeArtifactName(name: string): string {
  const baseName = path.basename(name.trim()) || 'artifact'
  return baseName.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'artifact'
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== 'string') {
    throw new DesktopCapabilityBridgeError('invalid_request', message)
  }

  return value
}

function requireNonEmptyString(value: unknown, message: string): string {
  const normalized = normalizeOptionalString(value)
  if (normalized === null) {
    throw new DesktopCapabilityBridgeError('invalid_request', message)
  }

  return normalized
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized === '' ? null : normalized
}

function cloneRecord<TValue extends Record<string, unknown>>(value: TValue): TValue {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }

  return JSON.parse(JSON.stringify(value)) as TValue
}

function isFileNotFoundError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT'
}
