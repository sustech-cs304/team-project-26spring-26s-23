import { randomBytes } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DesktopCapabilityBridgeRequest } from '../protocol'
import { DesktopCapabilityBridgeError } from '../errors'
import { createDesktopCapabilityBridgePaths } from '../paths'
import type { CreateDesktopCapabilityBridgeServiceOptions } from '../types'

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

export function createDesktopCapabilityArtifactService(
  options: CreateDesktopCapabilityBridgeServiceOptions,
): DesktopCapabilityArtifactService {
  return {
    async handle(request) {
      switch (request.operation) {
        case 'save_text':
          return await saveArtifactText(options, request)
        case 'save_bytes':
          return await saveArtifactBytes(options, request)
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
  const name = String(request.payload.name ?? '').trim()
  const text = typeof request.payload.text === 'string' ? request.payload.text : ''
  const contentType = typeof request.payload.contentType === 'string' && request.payload.contentType.trim() !== ''
    ? request.payload.contentType.trim()
    : 'text/plain'
  const metadata = normalizeMetadata(request.payload.metadata)

  return await persistArtifact(options, {
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
  const name = String(request.payload.name ?? '').trim()
  const contentBase64 = String(request.payload.contentBase64 ?? '').trim()
  const contentType = typeof request.payload.contentType === 'string' && request.payload.contentType.trim() !== ''
    ? request.payload.contentType.trim()
    : 'application/octet-stream'
  const metadata = normalizeMetadata(request.payload.metadata)

  let buffer: Buffer
  try {
    buffer = Buffer.from(contentBase64, 'base64')
  } catch (error) {
    throw new DesktopCapabilityBridgeError('invalid_request', 'contentBase64 must be valid base64.', {
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }

  return await persistArtifact(options, {
    name,
    contentType,
    metadata,
    buffer,
  })
}

async function persistArtifact(
  options: CreateDesktopCapabilityBridgeServiceOptions,
  input: {
    name: string
    contentType: string
    metadata: Record<string, unknown>
    buffer: Buffer
  },
): Promise<Record<string, unknown>> {
  if (input.name === '') {
    throw new DesktopCapabilityBridgeError('invalid_request', 'Artifact name must be a non-empty string.')
  }

  const hostedPaths = await options.prepareRuntimePaths()
  const bridgePaths = createDesktopCapabilityBridgePaths(hostedPaths)
  const index = await readArtifactIndex(bridgePaths.artifactIndexFile)
  const artifactId = `artifact-${randomBytes(12).toString('hex')}`
  const fileName = `${artifactId}-${sanitizeArtifactName(input.name)}`
  const filePath = path.join(bridgePaths.artifactsDir, fileName)
  const descriptor = {
    artifactId,
    uri: `artifact://desktop/${artifactId}`,
    name: input.name,
    contentType: input.contentType,
    metadata: { ...input.metadata },
  }

  await mkdir(bridgePaths.artifactsDir, { recursive: true })
  await writeFile(filePath, input.buffer)

  index.artifacts[artifactId] = {
    ...descriptor,
    fileName,
  }
  await writeArtifactIndex(bridgePaths.artifactIndexFile, index)

  return descriptor
}

async function describeArtifact(
  options: CreateDesktopCapabilityBridgeServiceOptions,
  request: DesktopCapabilityBridgeRequest,
): Promise<Record<string, unknown>> {
  const artifactId = String(request.payload.artifactId ?? '').trim()
  if (artifactId === '') {
    throw new DesktopCapabilityBridgeError('invalid_request', 'artifactId must be a non-empty string.')
  }

  const hostedPaths = await options.prepareRuntimePaths()
  const bridgePaths = createDesktopCapabilityBridgePaths(hostedPaths)
  const index = await readArtifactIndex(bridgePaths.artifactIndexFile)
  const artifact = index.artifacts[artifactId]
  if (artifact === undefined) {
    throw new DesktopCapabilityBridgeError('not_found', `Artifact '${artifactId}' was not found.`, {
      details: { artifactId },
    })
  }

  return {
    artifactId: artifact.artifactId,
    uri: artifact.uri,
    name: artifact.name,
    contentType: artifact.contentType,
    metadata: { ...artifact.metadata },
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

async function writeArtifactIndex(filePath: string, index: PersistedArtifactIndex): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }

  return { ...(value as Record<string, unknown>) }
}

function sanitizeArtifactName(name: string): string {
  const baseName = path.basename(name.trim()) || 'artifact'
  return baseName.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'artifact'
}

function isFileNotFoundError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT'
}
