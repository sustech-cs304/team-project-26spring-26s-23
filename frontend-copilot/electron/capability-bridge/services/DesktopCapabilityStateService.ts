import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
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

let stateMutationQueue = Promise.resolve()

export function createDesktopCapabilityStateService(
  options: CreateDesktopCapabilityBridgeServiceOptions,
): DesktopCapabilityStateService {
  return {
    async handle(request) {
      switch (request.operation) {
        case 'get_value':
          return await getStateValue(options, request)
        case 'put_value':
          await enqueueStateMutation(async () => {
            await putStateValue(options, request)
          })
          return {}
        case 'delete_value':
          await enqueueStateMutation(async () => {
            await deleteStateValue(options, request)
          })
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
  const { scope, key } = normalizeStateAddress(request)
  const document = await readStateDocument(options)
  const bucket = getStateBucket(document, { toolId: request.toolId, runId: request.runId, scope }, false)
  const value = bucket?.[key]
  const result = value === undefined
    ? {
      found: false,
      value: null,
    }
    : {
      found: true,
      value: cloneRecord(value),
    }

  await options.appendLog?.('info', '[capability-bridge] State value loaded.', {
    capability: request.capability,
    operation: request.operation,
    toolId: request.toolId,
    runId: request.runId,
    toolCallId: request.toolCallId,
    scope,
    key,
    found: value !== undefined,
  }, {
    relayToRenderer: false,
  })

  return result
}

async function putStateValue(
  options: CreateDesktopCapabilityBridgeServiceOptions,
  request: DesktopCapabilityBridgeRequest,
): Promise<void> {
  const { scope, key } = normalizeStateAddress(request)
  const value = normalizeStateValue(request.payload.value)
  const document = await readStateDocument(options)
  const bucket = getStateBucket(document, { toolId: request.toolId, runId: request.runId, scope }, true)

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

  bucket[key] = cloneRecord(value)
  await writeStateDocument(options, document)

  await options.appendLog?.('info', '[capability-bridge] State value persisted.', {
    capability: request.capability,
    operation: request.operation,
    toolId: request.toolId,
    runId: request.runId,
    toolCallId: request.toolCallId,
    scope,
    key,
  }, {
    relayToRenderer: false,
  })
}

async function deleteStateValue(
  options: CreateDesktopCapabilityBridgeServiceOptions,
  request: DesktopCapabilityBridgeRequest,
): Promise<void> {
  const { scope, key } = normalizeStateAddress(request)
  const document = await readStateDocument(options)
  const bucket = getStateBucket(document, { toolId: request.toolId, runId: request.runId, scope }, false)
  const deleted = bucket !== null && key in bucket

  if (deleted) {
    delete bucket[key]
    pruneEmptyStateBuckets(document, request.toolId, request.runId, scope)
    await writeStateDocument(options, document)
  }

  await options.appendLog?.('info', '[capability-bridge] State value deleted.', {
    capability: request.capability,
    operation: request.operation,
    toolId: request.toolId,
    runId: request.runId,
    toolCallId: request.toolCallId,
    scope,
    key,
    deleted,
  }, {
    relayToRenderer: false,
  })
}

function normalizeStateAddress(request: DesktopCapabilityBridgeRequest): {
  scope: DesktopCapabilityStateScope
  key: string
} {
  return {
    scope: normalizeStateScope(request.payload.scope),
    key: normalizeStateKey(request.payload.key),
  }
}

function normalizeStateScope(value: unknown): DesktopCapabilityStateScope {
  if (value === 'tool' || value === 'run') {
    return value
  }

  throw new DesktopCapabilityBridgeError('invalid_request', "scope must be either 'tool' or 'run'.")
}

function normalizeStateKey(value: unknown): string {
  if (typeof value !== 'string') {
    throw new DesktopCapabilityBridgeError('invalid_request', 'State key must be a non-empty string.')
  }

  const normalized = value.trim()
  if (normalized === '') {
    throw new DesktopCapabilityBridgeError('invalid_request', 'State key must be a non-empty string.')
  }

  return normalized
}

function normalizeStateValue(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DesktopCapabilityBridgeError('invalid_request', 'State value must be an object.')
  }

  return cloneRecord(value as Record<string, unknown>)
}

interface StateBucketContext {
  toolId: string
  runId: string
  scope: DesktopCapabilityStateScope
}

function getStateBucket(
  document: PersistedStateDocument,
  context: StateBucketContext,
  createWhenMissing: boolean,
): Record<string, Record<string, unknown>> | null {
  if (context.scope === 'tool') {
    return resolveToolBucket(document, context.toolId, createWhenMissing)
  }

  return resolveRunBucket(document, context.toolId, context.runId, createWhenMissing)
}

function resolveToolBucket(
  document: PersistedStateDocument,
  toolId: string,
  createWhenMissing: boolean,
): Record<string, Record<string, unknown>> | null {
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

function resolveRunBucket(
  document: PersistedStateDocument,
  toolId: string,
  runId: string,
  createWhenMissing: boolean,
): Record<string, Record<string, unknown>> | null {
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

function pruneEmptyStateBuckets(
  document: PersistedStateDocument,
  toolId: string,
  runId: string,
  scope: DesktopCapabilityStateScope,
): void {
  if (scope === 'tool') {
    if (Object.keys(document.values.tool[toolId] ?? {}).length === 0) {
      delete document.values.tool[toolId]
    }
    return
  }

  const runBuckets = document.values.run[toolId]
  if (runBuckets === undefined) {
    return
  }

  if (Object.keys(runBuckets[runId] ?? {}).length === 0) {
    delete runBuckets[runId]
  }
  if (Object.keys(runBuckets).length === 0) {
    delete document.values.run[toolId]
  }
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
  await mkdir(path.dirname(bridgePaths.stateFile), { recursive: true })
  await writeFile(bridgePaths.stateFile, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
}

async function enqueueStateMutation<TValue>(
  operation: () => Promise<TValue>,
): Promise<TValue> {
  const nextOperation = stateMutationQueue.then(operation)
  stateMutationQueue = nextOperation.then(
    () => undefined,
    () => undefined,
  )
  return await nextOperation
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

      return [key, cloneRecord(recordValue as Record<string, unknown>)]
    }),
  )
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
