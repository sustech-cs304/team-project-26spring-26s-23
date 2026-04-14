import { readFile, writeFile } from 'node:fs/promises'
import type { DesktopCapabilityBridgeRequest, DesktopCapabilityStateScope } from '../protocol'
import { DesktopCapabilityBridgeError } from '../errors'
import { createDesktopCapabilityBridgePaths } from '../paths'
import type { CreateDesktopCapabilityBridgeServiceOptions } from '../types'

interface PersistedStateDocument {
  version: 1
  values: {
    tool: Record<string, Record<string, Record<string, unknown>>>
    run: Record<string, Record<string, Record<string, Record<string, unknown>>>>
  }
}

export interface DesktopCapabilityStateService {
  handle(request: DesktopCapabilityBridgeRequest): Promise<Record<string, unknown>>
}

export function createDesktopCapabilityStateService(
  options: CreateDesktopCapabilityBridgeServiceOptions,
): DesktopCapabilityStateService {
  return {
    async handle(request) {
      switch (request.operation) {
        case 'get_value':
          return await getStateValue(options, request)
        case 'put_value':
          await putStateValue(options, request)
          return {}
        case 'delete_value':
          await deleteStateValue(options, request)
          return {}
        default:
          throw new DesktopCapabilityBridgeError(
            'unsupported_operation',
            `State capability does not support operation '${request.operation}'.`,
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

async function getStateValue(
  options: CreateDesktopCapabilityBridgeServiceOptions,
  request: DesktopCapabilityBridgeRequest,
): Promise<Record<string, unknown>> {
  const document = await readStateDocument(options)
  const scope = request.payload.scope as DesktopCapabilityStateScope
  const key = String(request.payload.key ?? '')
  const bucket = getStateBucket(document, request.toolId, request.runId, scope, false)
  const value = bucket?.[key]

  if (value === undefined) {
    return {
      found: false,
      value: null,
    }
  }

  return {
    found: true,
    value: { ...(value as Record<string, unknown>) },
  }
}

async function putStateValue(
  options: CreateDesktopCapabilityBridgeServiceOptions,
  request: DesktopCapabilityBridgeRequest,
): Promise<void> {
  const document = await readStateDocument(options)
  const scope = request.payload.scope as DesktopCapabilityStateScope
  const key = String(request.payload.key ?? '')
  const value = request.payload.value

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DesktopCapabilityBridgeError('invalid_request', 'State value must be an object.')
  }

  const bucket = getStateBucket(document, request.toolId, request.runId, scope, true)

  if (bucket === null) {
    throw new DesktopCapabilityBridgeError(
      'internal_error',
      'Failed to allocate a state bucket for the requested scope.',
      {
        details: {
          scope,
          toolId: request.toolId,
          runId: request.runId,
        },
      },
    )
  }

  bucket[key] = { ...(value as Record<string, unknown>) }
  await writeStateDocument(options, document)
}

async function deleteStateValue(
  options: CreateDesktopCapabilityBridgeServiceOptions,
  request: DesktopCapabilityBridgeRequest,
): Promise<void> {
  const document = await readStateDocument(options)
  const scope = request.payload.scope as DesktopCapabilityStateScope
  const key = String(request.payload.key ?? '')
  const bucket = getStateBucket(document, request.toolId, request.runId, scope, false)
  if (bucket !== null) {
    delete bucket[key]
  }
  await writeStateDocument(options, document)
}

function getStateBucket(
  document: PersistedStateDocument,
  toolId: string,
  runId: string,
  scope: DesktopCapabilityStateScope,
  createWhenMissing: boolean,
): Record<string, Record<string, unknown>> | null {
  if (scope === 'tool') {
    const toolBucket = document.values.tool[toolId]
    if (toolBucket !== undefined) {
      return toolBucket
    }
    if (!createWhenMissing) {
      return null
    }
    document.values.tool[toolId] = {}
    return document.values.tool[toolId]!
  }

  const toolRunBuckets = document.values.run[toolId]
  if (toolRunBuckets !== undefined && toolRunBuckets[runId] !== undefined) {
    return toolRunBuckets[runId]!
  }
  if (!createWhenMissing) {
    return null
  }

  document.values.run[toolId] ??= {}
  document.values.run[toolId]![runId] = {}
  return document.values.run[toolId]![runId]!
}

async function readStateDocument(
  options: CreateDesktopCapabilityBridgeServiceOptions,
): Promise<PersistedStateDocument> {
  const hostedPaths = await options.prepareRuntimePaths()
  const bridgePaths = createDesktopCapabilityBridgePaths(hostedPaths)

  try {
    const raw = JSON.parse(await readFile(bridgePaths.stateFile, 'utf8')) as Partial<PersistedStateDocument>
    const values = typeof raw.values === 'object' && raw.values !== null ? raw.values : {}

    return {
      version: 1,
      values: {
        tool: normalizeToolScopedValues((values as { tool?: unknown }).tool),
        run: normalizeRunScopedValues((values as { run?: unknown }).run),
      },
    }
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return createEmptyStateDocument()
    }

    throw new DesktopCapabilityBridgeError('internal_error', 'Failed to load capability state document.', {
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }
}

async function writeStateDocument(
  options: CreateDesktopCapabilityBridgeServiceOptions,
  document: PersistedStateDocument,
): Promise<void> {
  const hostedPaths = await options.prepareRuntimePaths()
  const bridgePaths = createDesktopCapabilityBridgePaths(hostedPaths)
  await writeFile(bridgePaths.stateFile, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
}

function createEmptyStateDocument(): PersistedStateDocument {
  return {
    version: 1,
    values: {
      tool: {},
      run: {},
    },
  }
}

function normalizeToolScopedValues(value: unknown): Record<string, Record<string, Record<string, unknown>>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([toolId, toolBucket]) => {
      return [toolId, normalizeRecordMap(toolBucket)]
    }),
  )
}

function normalizeRunScopedValues(
  value: unknown,
): Record<string, Record<string, Record<string, Record<string, unknown>>>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([toolId, runBuckets]) => {
      if (typeof runBuckets !== 'object' || runBuckets === null || Array.isArray(runBuckets)) {
        return [toolId, {}]
      }

      return [toolId, Object.fromEntries(
        Object.entries(runBuckets as Record<string, unknown>).map(([runId, runBucket]) => {
          return [runId, normalizeRecordMap(runBucket)]
        }),
      )]
    }),
  )
}

function normalizeRecordMap(value: unknown): Record<string, Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, recordValue]) => {
      if (typeof recordValue !== 'object' || recordValue === null || Array.isArray(recordValue)) {
        return [key, {}]
      }

      return [key, { ...(recordValue as Record<string, unknown>) }]
    }),
  )
}

function isFileNotFoundError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT'
}
