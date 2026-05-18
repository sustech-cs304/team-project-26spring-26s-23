import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { HostedRuntimePaths } from '../runtime/runtime-paths'
import {
  SKILL_REGISTRY_DOCUMENT_KIND,
  SKILL_REGISTRY_DOCUMENT_VERSION,
  type SkillCapabilityFlags,
  type SkillRecord,
  type SkillResourceSummary,
  type SkillRevisionState,
  type SkillValidationIssue,
  type SkillValidationSummary,
} from './types'

export const SKILL_REGISTRY_DIR_NAME = 'skill-registry'
export const SKILL_REGISTRY_DOCUMENT_FILE_NAME = 'registry.json'
export const SKILL_REGISTRY_MANAGED_SKILLS_DIR_NAME = 'skills'

export interface SkillRegistryPaths {
  rootDir: string
  documentFile: string
  managedSkillsDir: string
}

export interface SkillRegistryStoreSnapshot extends SkillRevisionState {
  skills: SkillRecord[]
  source: 'stored' | 'initialized-defaults' | 'recovered-corrupt'
}

export interface SkillRegistryStore {
  load(): Promise<SkillRegistryStoreSnapshot>
  saveSkills(skills: readonly SkillRecord[], options?: { snapshotRevision?: number }): Promise<SkillRegistryStoreSnapshot>
  saveSnapshotRevision(snapshotRevision: number): Promise<SkillRegistryStoreSnapshot>
}

interface SkillRegistryDocument extends SkillRevisionState {
  version: typeof SKILL_REGISTRY_DOCUMENT_VERSION
  kind: typeof SKILL_REGISTRY_DOCUMENT_KIND
  skills: SkillRecord[]
}

export interface CreateSkillRegistryStoreOptions {
  paths: SkillRegistryPaths
}

export function createSkillRegistryPaths(
  hostedPaths: Pick<HostedRuntimePaths, 'configDir' | 'runtimeRootDir'>,
): SkillRegistryPaths {
  const rootDir = path.join(hostedPaths.configDir, SKILL_REGISTRY_DIR_NAME)
  return {
    rootDir,
    documentFile: path.join(rootDir, SKILL_REGISTRY_DOCUMENT_FILE_NAME),
    managedSkillsDir: path.join(hostedPaths.runtimeRootDir, SKILL_REGISTRY_MANAGED_SKILLS_DIR_NAME),
  }
}

export function createSkillRegistryStore(
  options: CreateSkillRegistryStoreOptions,
): SkillRegistryStore {
  return {
    async load() {
      await Promise.all([
        mkdir(options.paths.rootDir, { recursive: true }),
        mkdir(options.paths.managedSkillsDir, { recursive: true }),
      ])

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
    async saveSkills(skills, saveOptions) {
      const current = await this.load()
      const nextDocument: SkillRegistryDocument = {
        version: SKILL_REGISTRY_DOCUMENT_VERSION,
        kind: SKILL_REGISTRY_DOCUMENT_KIND,
        registryRevision: current.registryRevision + 1,
        snapshotRevision: typeof saveOptions?.snapshotRevision === 'number'
          ? normalizeNonNegativeInteger(saveOptions.snapshotRevision)
          : current.snapshotRevision,
        skills: skills.map(cloneSkillRecord),
      }

      await writeDocument(options.paths.documentFile, nextDocument)
      return projectSnapshot(nextDocument, 'stored')
    },
    async saveSnapshotRevision(snapshotRevision) {
      const current = await this.load()
      const nextDocument: SkillRegistryDocument = {
        version: SKILL_REGISTRY_DOCUMENT_VERSION,
        kind: SKILL_REGISTRY_DOCUMENT_KIND,
        registryRevision: current.registryRevision,
        snapshotRevision: normalizeNonNegativeInteger(snapshotRevision),
        skills: current.skills.map(cloneSkillRecord),
      }

      await writeDocument(options.paths.documentFile, nextDocument)
      return projectSnapshot(nextDocument, 'stored')
    },
  }
}

async function readDocument(documentFile: string): Promise<
  | { status: 'missing' }
  | { status: 'stored', document: SkillRegistryDocument }
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

async function writeDocument(documentFile: string, document: SkillRegistryDocument): Promise<void> {
  await mkdir(path.dirname(documentFile), { recursive: true })
  await writeFile(documentFile, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
}

function projectSnapshot(
  document: SkillRegistryDocument,
  source: SkillRegistryStoreSnapshot['source'],
): SkillRegistryStoreSnapshot {
  return {
    source,
    registryRevision: document.registryRevision,
    snapshotRevision: document.snapshotRevision,
    skills: document.skills.map(cloneSkillRecord),
  }
}

function createDefaultDocument(): SkillRegistryDocument {
  return {
    version: SKILL_REGISTRY_DOCUMENT_VERSION,
    kind: SKILL_REGISTRY_DOCUMENT_KIND,
    registryRevision: 0,
    snapshotRevision: 0,
    skills: [],
  }
}

function normalizeDocument(value: unknown): SkillRegistryDocument | null {
  if (!isPlainRecord(value)) {
    return null
  }

  if (value.version !== undefined && value.version !== SKILL_REGISTRY_DOCUMENT_VERSION) {
    return null
  }

  if (value.kind !== undefined && value.kind !== SKILL_REGISTRY_DOCUMENT_KIND) {
    return null
  }

  if (!Array.isArray(value.skills)) {
    return null
  }

  const skills = value.skills
    .map(normalizeSkillRecord)
    .filter((skill): skill is SkillRecord => skill !== null)

  return {
    version: SKILL_REGISTRY_DOCUMENT_VERSION,
    kind: SKILL_REGISTRY_DOCUMENT_KIND,
    registryRevision: normalizeNonNegativeInteger(value.registryRevision),
    snapshotRevision: normalizeNonNegativeInteger(value.snapshotRevision),
    skills,
  }
}

function normalizeSkillRecord(value: unknown): SkillRecord | null {
  if (!isPlainRecord(value)
    || typeof value.skillId !== 'string'
    || typeof value.displayName !== 'string'
    || typeof value.description !== 'string'
    || (value.source !== 'builtin' && value.source !== 'imported')
    || !(typeof value.sourceDirectory === 'string' || value.sourceDirectory === null || value.sourceDirectory === undefined)
    || typeof value.enabled !== 'boolean'
    || value.trusted !== true
    || typeof value.managedDirectoryName !== 'string'
    || typeof value.entryPath !== 'string'
    || !isPlainRecord(value.validation)
    || typeof value.importedAt !== 'string'
    || typeof value.updatedAt !== 'string'
  ) {
    return null
  }

  const validation = normalizeValidationSummary(value.validation)
  if (validation === null) {
    return null
  }

  const capabilities = normalizeCapabilities(value.capabilities)
  if (capabilities === null) {
    return null
  }

  const resourceSummaries = Array.isArray(value.resourceSummaries)
    ? value.resourceSummaries
      .map(normalizeResourceSummary)
      .filter((resource): resource is SkillResourceSummary => resource !== null)
    : []

  return {
    skillId: value.skillId,
    displayName: value.displayName,
    description: value.description,
    ...(typeof value.version === 'string' || value.version === null ? { version: value.version } : {}),
    source: value.source,
    ...(typeof value.sourceDirectory === 'string' || value.sourceDirectory === null ? { sourceDirectory: value.sourceDirectory } : {}),
    enabled: value.enabled,
    trusted: true,
    managedDirectoryName: value.managedDirectoryName,
    entryPath: value.entryPath,
    tags: normalizeStringArray(value.tags),
    capabilities,
    validation,
    entrySummary: typeof value.entrySummary === 'string' || value.entrySummary === null ? value.entrySummary : null,
    resourceSummaries,
    importedAt: value.importedAt,
    updatedAt: value.updatedAt,
  }
}

function normalizeCapabilities(value: unknown): SkillCapabilityFlags | null {
  if (!isPlainRecord(value)
    || typeof value.readOnlyResources !== 'boolean'
    || value.scripts !== false
  ) {
    return null
  }

  return {
    readOnlyResources: value.readOnlyResources,
    scripts: false,
  }
}

function normalizeValidationSummary(value: Record<string, unknown>): SkillValidationSummary | null {
  if (value.status !== 'valid' && value.status !== 'invalid') {
    return null
  }

  return {
    status: value.status,
    errors: normalizeIssueArray(value.errors),
    warnings: normalizeIssueArray(value.warnings),
  }
}

function normalizeIssueArray(value: unknown): SkillValidationIssue[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((entry): SkillValidationIssue | null => {
      if (!isPlainRecord(entry)
        || typeof entry.fieldPath !== 'string'
        || typeof entry.message !== 'string'
        || typeof entry.code !== 'string'
      ) {
        return null
      }

      return {
        fieldPath: entry.fieldPath,
        message: entry.message,
        code: entry.code,
      }
    })
    .filter((entry): entry is SkillValidationIssue => entry !== null)
}

function normalizeResourceSummary(value: unknown): SkillResourceSummary | null {
  if (!isPlainRecord(value) || typeof value.path !== 'string') {
    return null
  }

  return {
    path: value.path,
    ...(typeof value.description === 'string' || value.description === null ? { description: value.description } : {}),
  }
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter((entry): entry is string => typeof entry === 'string')
}

function normalizeNonNegativeInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return 0
  }

  return Math.floor(value)
}

function cloneSkillRecord(skill: SkillRecord): SkillRecord {
  return {
    ...skill,
    ...(skill.version === undefined ? {} : { version: skill.version }),
    tags: [...skill.tags],
    capabilities: { ...skill.capabilities, scripts: false },
    validation: {
      status: skill.validation.status,
      errors: skill.validation.errors.map((error) => ({ ...error })),
      warnings: skill.validation.warnings.map((warning) => ({ ...warning })),
    },
    resourceSummaries: skill.resourceSummaries.map((resource) => ({ ...resource })),
  }
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT'
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
