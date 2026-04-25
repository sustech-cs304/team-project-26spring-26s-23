import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { HostedRuntimePaths } from '../runtime/runtime-paths'
import { createDesktopCapabilityBridgePaths } from '../capability-bridge/paths'
import {
  SKILL_CAPABILITY_SNAPSHOT_BRIDGE_KEY,
  SKILL_CAPABILITY_SNAPSHOT_BRIDGE_TOOL_ID,
  SKILL_CAPABILITY_SNAPSHOT_FILE_NAME,
  SKILL_SNAPSHOT_VERSION,
  type SkillCapabilitySnapshot,
  type SkillRecord,
} from './types'

const SKILL_SNAPSHOT_FORBIDDEN_KEY_SET = new Set([
  'absolutepath',
  'apikey',
  'authorization',
  'command',
  'env',
  'headers',
  'localpath',
  'localtoken',
  'manageddirectoryname',
  'password',
  'passwords',
  'secret',
  'secrets',
  'sourcepath',
  'token',
  'tokens',
])

export const SKILL_SNAPSHOT_FORBIDDEN_FIELD_KEYS = Object.freeze([
  'absolutePath',
  'apiKey',
  'authorization',
  'command',
  'env',
  'headers',
  'localPath',
  'localToken',
  'managedDirectoryName',
  'password',
  'secret',
  'sourcePath',
  'token',
])

export interface CreateSkillCapabilitySnapshotInput {
  registryRevision: number
  snapshotRevision: number
  generatedAt: string
  skills: readonly SkillRecord[]
}

export interface SkillCapabilitySnapshotSink {
  write(snapshot: SkillCapabilitySnapshot): Promise<void>
}

export interface CreateSkillCapabilitySnapshotSinkOptions {
  runtimePaths: Pick<HostedRuntimePaths, 'stateDir' | 'runtimeRootDir' | 'databaseDir'>
}

interface PersistedBridgeStateDocument {
  version: 1
  values: {
    tool: Record<string, Record<string, Record<string, unknown>>>
    run: Record<string, Record<string, Record<string, Record<string, unknown>>>>
  }
}

export function createSkillCapabilitySnapshot(input: CreateSkillCapabilitySnapshotInput): SkillCapabilitySnapshot {
  return {
    version: SKILL_SNAPSHOT_VERSION,
    registryRevision: normalizeNonNegativeInteger(input.registryRevision),
    snapshotRevision: normalizeNonNegativeInteger(input.snapshotRevision),
    generatedAt: input.generatedAt,
    skills: input.skills
      .filter((skill) => skill.enabled && skill.trusted && skill.validation.status === 'valid')
      .map((skill) => ({
        skillId: skill.skillId,
        displayName: skill.displayName,
        description: skill.description,
        ...(skill.version === undefined || skill.version === null ? {} : { version: skill.version }),
        tags: [...skill.tags],
        entrySummary: skill.entrySummary,
        resourceSummaries: skill.resourceSummaries.map((resource) => ({ ...resource })),
      }))
      .sort((left, right) => left.skillId.localeCompare(right.skillId, 'en')),
  }
}

export function createSkillCapabilitySnapshotFilePath(
  hostedPaths: Pick<HostedRuntimePaths, 'stateDir'>,
): string {
  return path.join(hostedPaths.stateDir, SKILL_CAPABILITY_SNAPSHOT_FILE_NAME)
}

export function createSkillCapabilitySnapshotSink(
  options: CreateSkillCapabilitySnapshotSinkOptions,
): SkillCapabilitySnapshotSink {
  return {
    async write(snapshot) {
      await Promise.all([
        writeSnapshotFile(createSkillCapabilitySnapshotFilePath(options.runtimePaths), snapshot),
        writeSnapshotToCapabilityBridgeState(options.runtimePaths, snapshot),
      ])
    },
  }
}

export function collectSkillSnapshotRedactionViolations(snapshot: unknown): string[] {
  return collectForbiddenPaths(snapshot, '')
}

export function isSkillCapabilitySnapshotRedacted(snapshot: SkillCapabilitySnapshot): boolean {
  return collectSkillSnapshotRedactionViolations(snapshot).length === 0
}

async function writeSnapshotFile(
  snapshotFile: string,
  snapshot: SkillCapabilitySnapshot,
): Promise<void> {
  await mkdir(path.dirname(snapshotFile), { recursive: true })
  await writeFile(snapshotFile, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
}

async function writeSnapshotToCapabilityBridgeState(
  runtimePaths: Pick<HostedRuntimePaths, 'stateDir' | 'runtimeRootDir' | 'databaseDir'>,
  snapshot: SkillCapabilitySnapshot,
): Promise<void> {
  const bridgePaths = createDesktopCapabilityBridgePaths(runtimePaths)
  const document = await readCapabilityBridgeStateDocument(bridgePaths.stateFile)
  document.values.tool[SKILL_CAPABILITY_SNAPSHOT_BRIDGE_TOOL_ID] ??= {}
  document.values.tool[SKILL_CAPABILITY_SNAPSHOT_BRIDGE_TOOL_ID][SKILL_CAPABILITY_SNAPSHOT_BRIDGE_KEY] = cloneRecord(snapshot as unknown as Record<string, unknown>)
  await mkdir(path.dirname(bridgePaths.stateFile), { recursive: true })
  await writeFile(bridgePaths.stateFile, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
}

async function readCapabilityBridgeStateDocument(stateFile: string): Promise<PersistedBridgeStateDocument> {
  try {
    const parsed = JSON.parse(await readFile(stateFile, 'utf8')) as unknown
    return normalizeCapabilityBridgeStateDocument(parsed)
  } catch (error) {
    if (isMissingFileError(error)) {
      return createEmptyBridgeStateDocument()
    }

    throw error
  }
}

function normalizeCapabilityBridgeStateDocument(value: unknown): PersistedBridgeStateDocument {
  if (!isPlainRecord(value) || !isPlainRecord(value.values)) {
    return createEmptyBridgeStateDocument()
  }

  return {
    version: 1,
    values: {
      tool: normalizeToolStateBuckets(value.values.tool),
      run: normalizeRunStateBuckets(value.values.run),
    },
  }
}

function createEmptyBridgeStateDocument(): PersistedBridgeStateDocument {
  return {
    version: 1,
    values: {
      tool: {},
      run: {},
    },
  }
}

function normalizeToolStateBuckets(value: unknown): Record<string, Record<string, Record<string, unknown>>> {
  if (!isPlainRecord(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).map(([toolId, bucket]) => [toolId, normalizeRecordBucket(bucket)]),
  )
}

function normalizeRunStateBuckets(
  value: unknown,
): Record<string, Record<string, Record<string, Record<string, unknown>>>> {
  if (!isPlainRecord(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).map(([toolId, runBuckets]) => {
      if (!isPlainRecord(runBuckets)) {
        return [toolId, {}]
      }

      return [toolId, Object.fromEntries(
        Object.entries(runBuckets).map(([runId, bucket]) => [runId, normalizeRecordBucket(bucket)]),
      )]
    }),
  )
}

function normalizeRecordBucket(value: unknown): Record<string, Record<string, unknown>> {
  if (!isPlainRecord(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, recordValue]) => {
      return [key, isPlainRecord(recordValue) ? cloneRecord(recordValue) : {}]
    }),
  )
}

function collectForbiddenPaths(value: unknown, currentPath: string): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectForbiddenPaths(item, `${currentPath}[${index}]`))
  }

  if (!isPlainRecord(value)) {
    return []
  }

  const violations: string[] = []

  for (const [key, nestedValue] of Object.entries(value)) {
    const nextPath = currentPath ? `${currentPath}.${key}` : key
    if (SKILL_SNAPSHOT_FORBIDDEN_KEY_SET.has(normalizeForbiddenKey(key))) {
      violations.push(nextPath)
      continue
    }
    violations.push(...collectForbiddenPaths(nestedValue, nextPath))
  }

  return violations
}

function normalizeForbiddenKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function normalizeNonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
}

function cloneRecord<TValue extends Record<string, unknown>>(value: TValue): TValue {
  if (typeof structuredClone === 'function') {
    return structuredClone(value)
  }

  return JSON.parse(JSON.stringify(value)) as TValue
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT'
}
