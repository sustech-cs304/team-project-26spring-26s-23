import { cp, lstat, mkdir, readFile, readdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'

import type { BuiltinSkillSource } from './builtin-skill-loader'
import { createSkillRegistryApiFailure } from './ipc'
import type {
  SkillDeleteResult,
  SkillImportRequest,
  SkillImportResult,
  SkillRefreshRequest,
  SkillRefreshResult,
  SkillRegistryLoadRequest,
  SkillRegistryLoadResult,
  SkillSetEnabledRequest,
  SkillSetEnabledResult,
} from './ipc'
import {
  collectSkillSnapshotRedactionViolations,
  createSkillCapabilitySnapshot,
  type SkillCapabilitySnapshotSink,
} from './snapshot'
import type { SkillRegistryPaths, SkillRegistryStore, SkillRegistryStoreSnapshot } from './store'
import {
  SKILL_DEFAULT_ENTRY_FILE_NAME,
  SKILL_ENTRY_MAX_BYTES,
  SKILL_PACKAGE_MAX_BYTES,
  type SkillCapabilityFlags,
  type SkillMetadata,
  type SkillRecord,
  type SkillRegistrySubscriptionEvent,
  type SkillResourceSummary,
  type SkillValidationIssue,
  type SkillValidationSummary,
} from './types'

const SKILL_REGISTRY_VALIDATION_ERROR_CODE = 'validation_failed'
const SKILL_REGISTRY_NOT_FOUND_ERROR_CODE = 'not_found'
const SKILL_REGISTRY_INVALID_REQUEST_ERROR_CODE = 'invalid_request'

const SKILL_ID_PATTERN = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/
const MAX_DESCRIPTION_LENGTH = 1000
export interface SkillRegistryService {
  loadRegistry(request?: SkillRegistryLoadRequest): Promise<SkillRegistryLoadResult>
  importSkill(request: SkillImportRequest): Promise<SkillImportResult>
  deleteSkill(skillId: string): Promise<SkillDeleteResult>
  setSkillEnabled(request: SkillSetEnabledRequest): Promise<SkillSetEnabledResult>
  refreshSkills(request?: SkillRefreshRequest): Promise<SkillRefreshResult>
}

export interface CreateSkillRegistryServiceOptions {
  store: SkillRegistryStore
  paths: SkillRegistryPaths
  snapshotSink?: SkillCapabilitySnapshotSink
  builtinSkillSources?: readonly BuiltinSkillSource[]
  now?: () => string
  publishEvent?: (event: SkillRegistrySubscriptionEvent) => void | Promise<void>
  appendLog?: (
    level: 'info' | 'warn' | 'error',
    message: string,
    context: Record<string, unknown> | null,
  ) => void | Promise<void>
}

interface ValidatedSkillPackage {
  metadata: SkillMetadata
  entrySummary: string | null
  resourceSummaries: SkillResourceSummary[]
  validation: SkillValidationSummary
}

interface ValidateSkillPackageOptions {
  sourceDirectory: string
  existingSkillIds: ReadonlySet<string>
  expectedSkillId?: string | null
}

interface DirectoryScanResult {
  totalSizeBytes: number
}

interface SkillMarkdownMetadata {
  name: string
  description: string
  body: string
}

export function createSkillRegistryService(
  options: CreateSkillRegistryServiceOptions,
): SkillRegistryService {
  const now = options.now ?? (() => new Date().toISOString())
  const builtinSkillSources = options.builtinSkillSources ?? []

  const persistSnapshotArtifacts = async (
    snapshot: SkillRegistryStoreSnapshot,
    snapshotRevision: number,
  ): Promise<SkillRegistryStoreSnapshot> => {
    let persistedSnapshot = overrideSnapshotRevision(snapshot, snapshotRevision)

    if (snapshot.snapshotRevision !== snapshotRevision) {
      try {
        persistedSnapshot = await options.store.saveSnapshotRevision(snapshotRevision)
      } catch (error) {
        await options.appendLog?.('error', '[skill-registry] Failed to persist the skill snapshot revision.', {
          registryRevision: snapshot.registryRevision,
          snapshotRevision,
          detail: formatUnknownError(error),
        })
      }
    }

    if (options.snapshotSink !== undefined) {
      try {
        const capabilitySnapshot = createSkillCapabilitySnapshot({
          registryRevision: persistedSnapshot.registryRevision,
          snapshotRevision,
          generatedAt: now(),
          skills: persistedSnapshot.skills,
        })
        const redactionViolations = collectSkillSnapshotRedactionViolations(capabilitySnapshot)
        if (redactionViolations.length > 0) {
          throw new Error(`Skill capability snapshot redaction failed: ${redactionViolations.join(', ')}`)
        }
        await options.snapshotSink.write(capabilitySnapshot)
      } catch (error) {
        await options.appendLog?.('error', '[skill-registry] Failed to persist the skill capability snapshot.', {
          registryRevision: snapshot.registryRevision,
          snapshotRevision,
          detail: formatUnknownError(error),
        })
      }
    }

    return persistedSnapshot
  }

  return {
    async loadRegistry(request) {
      const snapshot = await loadSnapshotWithBuiltinSkills()
      const persistedSnapshot = await persistSnapshotArtifacts(snapshot, snapshot.snapshotRevision)
      return buildLoadResult(persistedSnapshot, request?.includeDisabled ?? true)
    },
    async importSkill(request) {
      const sourceDirectory = typeof request.sourceDirectory === 'string'
        ? request.sourceDirectory.trim()
        : ''
      if (sourceDirectory === '') {
        return createSkillRegistryApiFailure(
          'Skill import requires a source directory.',
          SKILL_REGISTRY_INVALID_REQUEST_ERROR_CODE,
        )
      }

      const snapshot = await loadSnapshotWithBuiltinSkills()
      const validated = await validateSkillPackage({
        sourceDirectory,
        existingSkillIds: new Set(snapshot.skills.map((skill) => skill.skillId)),
      })

      if (!validated.ok) {
        return createSkillRegistryApiFailure(
          'Skill package failed validation.',
          SKILL_REGISTRY_VALIDATION_ERROR_CODE,
          validated.validation.errors,
        )
      }

      const importedAt = now()
      const managedDirectoryName = await resolveManagedDirectoryName(
        validated.package.metadata.skillId,
        options.paths.managedSkillsDir,
        snapshot.skills,
      )
      const managedDirectory = path.join(options.paths.managedSkillsDir, managedDirectoryName)
      const stagingDirectory = path.join(
        options.paths.managedSkillsDir,
        `.import-${managedDirectoryName}-${Date.now().toString(36)}`,
      )
      let finalDirectoryCreated = false

      try {
        await mkdir(options.paths.managedSkillsDir, { recursive: true })
        await cp(path.resolve(sourceDirectory), stagingDirectory, {
          recursive: true,
          errorOnExist: true,
          force: false,
          dereference: false,
        })
        await rename(stagingDirectory, managedDirectory)
        finalDirectoryCreated = true

        const skill = buildSkillRecord({
          validated: validated.package,
          managedDirectoryName,
          source: 'imported',
          enabled: request.enabled ?? true,
          importedAt,
          updatedAt: importedAt,
        })
        const currentRevisions = resolveRuntimeRevisions(snapshot)
        const nextSnapshotRevision = skill.enabled && skill.validation.status === 'valid'
          ? bumpRuntimeSnapshotRevision(currentRevisions.snapshotRevision)
          : currentRevisions.snapshotRevision
        const stored = await options.store.saveSkills(
          upsertSkill(snapshot.skills, skill),
          { snapshotRevision: currentRevisions.snapshotRevision },
        )
        const persistedSnapshot = await persistSnapshotArtifacts(stored, nextSnapshotRevision)
        const persistedSkill = persistedSnapshot.skills.find((entry) => entry.skillId === skill.skillId) ?? skill
        await publishSnapshotEvent(persistedSnapshot, options.publishEvent, nextSnapshotRevision)
        await options.publishEvent?.({
          kind: 'skill-updated',
          registryRevision: persistedSnapshot.registryRevision,
          snapshotRevision: nextSnapshotRevision,
          skillId: persistedSkill.skillId,
          skill: persistedSkill,
        })

        return {
          ok: true,
          registryRevision: persistedSnapshot.registryRevision,
          snapshotRevision: nextSnapshotRevision,
          skill: persistedSkill,
          validationErrors: [],
        }
      } catch (error) {
        await rm(stagingDirectory, { recursive: true, force: true })
        if (finalDirectoryCreated) {
          await rm(managedDirectory, { recursive: true, force: true })
        }
        await options.appendLog?.('error', '[skill-registry] Failed to import the skill package.', {
          skillId: validated.package.metadata.skillId,
          sourceDirectory,
          managedDirectoryName,
          detail: formatUnknownError(error),
        })
        return createSkillRegistryApiFailure(
          `Failed to import the skill package: ${formatUnknownError(error)}`,
          'internal_error',
        )
      }
    },
    async deleteSkill(skillId) {
      const snapshot = await loadSnapshotWithBuiltinSkills()
      const existing = snapshot.skills.find((skill) => skill.skillId === skillId)
      if (existing === undefined) {
        return createSkillRegistryApiFailure(
          `Skill "${skillId}" was not found.`,
          SKILL_REGISTRY_NOT_FOUND_ERROR_CODE,
        )
      }
      if (existing.source === 'builtin') {
        return createSkillRegistryApiFailure(
          `Builtin Skill "${skillId}" cannot be deleted.`,
          SKILL_REGISTRY_INVALID_REQUEST_ERROR_CODE,
        )
      }

      const currentRevisions = resolveRuntimeRevisions(snapshot)
      const nextSnapshotRevision = existing.enabled
        ? bumpRuntimeSnapshotRevision(currentRevisions.snapshotRevision)
        : currentRevisions.snapshotRevision
      const stored = await options.store.saveSkills(
        snapshot.skills.filter((skill) => skill.skillId !== skillId),
        { snapshotRevision: currentRevisions.snapshotRevision },
      )
      await rm(resolveManagedSkillDirectory(options.paths, existing), { recursive: true, force: true })
      const persistedSnapshot = await persistSnapshotArtifacts(stored, nextSnapshotRevision)
      await publishSnapshotEvent(persistedSnapshot, options.publishEvent, nextSnapshotRevision)
      await options.publishEvent?.({
        kind: 'skill-deleted',
        registryRevision: persistedSnapshot.registryRevision,
        snapshotRevision: nextSnapshotRevision,
        skillId,
      })

      return {
        ok: true,
        registryRevision: persistedSnapshot.registryRevision,
        snapshotRevision: nextSnapshotRevision,
        skillId,
        deleted: true,
      }
    },
    async setSkillEnabled(request) {
      const snapshot = await loadSnapshotWithBuiltinSkills()
      const existing = snapshot.skills.find((skill) => skill.skillId === request.skillId)
      if (existing === undefined) {
        return createSkillRegistryApiFailure(
          `Skill "${request.skillId}" was not found.`,
          SKILL_REGISTRY_NOT_FOUND_ERROR_CODE,
        )
      }

      const updatedSkill: SkillRecord = {
        ...cloneSkillRecord(existing),
        enabled: request.enabled,
        updatedAt: now(),
      }
      const currentRevisions = resolveRuntimeRevisions(snapshot)
      const nextSnapshotRevision = existing.enabled === request.enabled
        ? currentRevisions.snapshotRevision
        : bumpRuntimeSnapshotRevision(currentRevisions.snapshotRevision)
      const stored = await options.store.saveSkills(
        upsertSkill(snapshot.skills, updatedSkill),
        { snapshotRevision: currentRevisions.snapshotRevision },
      )
      const persistedSnapshot = await persistSnapshotArtifacts(stored, nextSnapshotRevision)
      const persistedSkill = persistedSnapshot.skills.find((skill) => skill.skillId === request.skillId) ?? updatedSkill
      await publishSnapshotEvent(persistedSnapshot, options.publishEvent, nextSnapshotRevision)
      await options.publishEvent?.({
        kind: 'skill-updated',
        registryRevision: persistedSnapshot.registryRevision,
        snapshotRevision: nextSnapshotRevision,
        skillId: persistedSkill.skillId,
        skill: persistedSkill,
      })

      return {
        ok: true,
        registryRevision: persistedSnapshot.registryRevision,
        snapshotRevision: nextSnapshotRevision,
        skill: persistedSkill,
      }
    },
    async refreshSkills(request) {
      const snapshot = await loadSnapshotWithBuiltinSkills()
      const resolvedTargets = resolveRefreshTargets(snapshot, request)
      if (!resolvedTargets.ok) {
        return resolvedTargets.failure
      }

      const refreshedRecords: SkillRecord[] = []
      const results = []
      const existingSkillIds = new Set(snapshot.skills.map((skill) => skill.skillId))

      for (const skill of resolvedTargets.skills) {
        const sourceDirectory = skill.source === 'builtin'
          ? resolveBuiltinSkillSourceDirectory(skill.skillId, builtinSkillSources)
          : resolveManagedSkillDirectory(options.paths, skill)
        const validation = await validateSkillPackage({
          sourceDirectory,
          existingSkillIds,
          expectedSkillId: skill.skillId,
        })
        if (validation.ok) {
          const refreshedRecord = buildRefreshedSkillRecord(skill, validation.package, now())
          refreshedRecords.push(refreshedRecord)
          results.push({
            skillId: refreshedRecord.skillId,
            status: refreshedRecord.validation.status,
            errors: refreshedRecord.validation.errors,
            warnings: refreshedRecord.validation.warnings,
          })
        } else {
          const invalidRecord: SkillRecord = {
            ...cloneSkillRecord(skill),
            validation: validation.validation,
            entrySummary: null,
            resourceSummaries: [],
            updatedAt: now(),
          }
          refreshedRecords.push(invalidRecord)
          results.push({
            skillId: invalidRecord.skillId,
            status: invalidRecord.validation.status,
            errors: invalidRecord.validation.errors,
            warnings: invalidRecord.validation.warnings,
          })
        }
      }

      const refreshedById = new Map(refreshedRecords.map((skill) => [skill.skillId, skill]))
      const nextSkills = snapshot.skills.map((skill) => refreshedById.get(skill.skillId) ?? skill)
      const currentRevisions = resolveRuntimeRevisions(snapshot)
      const shouldBumpSnapshot = resolvedTargets.skills.some((skill) => skill.enabled)
      const nextSnapshotRevision = shouldBumpSnapshot
        ? bumpRuntimeSnapshotRevision(currentRevisions.snapshotRevision)
        : currentRevisions.snapshotRevision
      const stored = await options.store.saveSkills(nextSkills, {
        snapshotRevision: currentRevisions.snapshotRevision,
      })
      const persistedSnapshot = await persistSnapshotArtifacts(stored, nextSnapshotRevision)
      await publishSnapshotEvent(persistedSnapshot, options.publishEvent, nextSnapshotRevision)

      return {
        ok: true,
        registryRevision: persistedSnapshot.registryRevision,
        snapshotRevision: nextSnapshotRevision,
        refreshedSkillIds: resolvedTargets.skills.map((skill) => skill.skillId),
        results,
      }
    },
  }

  async function loadSnapshotWithBuiltinSkills(): Promise<SkillRegistryStoreSnapshot> {
    const snapshot = await options.store.load()
    if (builtinSkillSources.length === 0) {
      return snapshot
    }

    const importedSkills = snapshot.skills
      .filter((skill) => skill.source !== 'builtin')
      .map(cloneSkillRecord)
    const existingBuiltinById = new Map(
      snapshot.skills
        .filter((skill) => skill.source === 'builtin')
        .map((skill) => [skill.skillId, skill] as const),
    )

    const mergedSkills = [...importedSkills]
    let changed = snapshot.skills.length !== importedSkills.length + builtinSkillSources.length
    let nextSnapshotRevision = snapshot.snapshotRevision

    for (const builtinSource of builtinSkillSources) {
      const existing = existingBuiltinById.get(builtinSource.skillId)
      const builtinSkill = await loadBuiltinSkillRecord(builtinSource, existing)
      mergedSkills.push(builtinSkill)
      if (!sameSkillRecord(existing, builtinSkill)) {
        changed = true
        if (builtinSkill.enabled && builtinSkill.validation.status === 'valid') {
          nextSnapshotRevision = bumpRuntimeSnapshotRevision(nextSnapshotRevision)
        }
      }
    }

    if (!changed) {
      return {
        ...snapshot,
        skills: mergedSkills,
      }
    }

    return await options.store.saveSkills(mergedSkills, { snapshotRevision: nextSnapshotRevision })
  }

  async function loadBuiltinSkillRecord(
    builtinSource: BuiltinSkillSource,
    existing: SkillRecord | undefined,
  ): Promise<SkillRecord> {
    const validated = await validateSkillPackage({
      sourceDirectory: builtinSource.sourceDirectory,
      existingSkillIds: new Set(),
      expectedSkillId: builtinSource.skillId,
    })
    const importedAt = existing?.importedAt ?? now()
    const updatedAt = now()

    if (!validated.ok) {
      return {
        skillId: builtinSource.skillId,
        displayName: builtinSource.skillId,
        description: '内置 Skill 样板校验失败。',
        source: 'builtin',
        enabled: existing?.enabled ?? builtinSource.enabledByDefault,
        trusted: true,
        managedDirectoryName: builtinSource.skillId,
        entryPath: SKILL_DEFAULT_ENTRY_FILE_NAME,
        tags: [],
        capabilities: createDefaultCapabilities(),
        validation: validated.validation,
        entrySummary: null,
        resourceSummaries: [],
        importedAt,
        updatedAt,
      }
    }

    return buildSkillRecord({
      validated: validated.package,
      managedDirectoryName: builtinSource.skillId,
      source: 'builtin',
      enabled: existing?.enabled ?? builtinSource.enabledByDefault,
      importedAt,
      updatedAt,
    })
  }
}

async function validateSkillPackage(
  options: ValidateSkillPackageOptions,
): Promise<
  | { ok: true, package: ValidatedSkillPackage }
  | { ok: false, validation: SkillValidationSummary }
> {
  const errors: SkillValidationIssue[] = []
  const warnings: SkillValidationIssue[] = []
  const sourceDirectory = path.resolve(options.sourceDirectory)

  try {
    const rootStat = await lstat(sourceDirectory)
    if (!rootStat.isDirectory()) {
      errors.push(createValidationIssue('sourceDirectory', 'Skill package must be a directory.', 'not_directory'))
      return validationFailure(errors, warnings)
    }
    if (rootStat.isSymbolicLink()) {
      errors.push(createValidationIssue('sourceDirectory', 'Skill package directory must not be a symbolic link.', 'symbolic_link'))
      return validationFailure(errors, warnings)
    }
  } catch (error) {
    errors.push(createValidationIssue('sourceDirectory', `Skill package directory is not readable: ${formatUnknownError(error)}`, 'not_readable'))
    return validationFailure(errors, warnings)
  }

  const packageScan = await scanPackageFiles(sourceDirectory, errors)
  if (packageScan.totalSizeBytes > SKILL_PACKAGE_MAX_BYTES) {
    errors.push(createValidationIssue(
      'sourceDirectory',
      `Skill package exceeds the ${SKILL_PACKAGE_MAX_BYTES} byte size limit.`,
      'package_too_large',
    ))
  }

  const entryFile = await readAndValidateSkillMarkdown(path.join(sourceDirectory, SKILL_DEFAULT_ENTRY_FILE_NAME), errors)
  if (entryFile === null) {
    return validationFailure(errors, warnings)
  }

  const metadata: SkillMetadata = {
    schemaVersion: 1,
    skillId: entryFile.name,
    displayName: entryFile.name,
    description: entryFile.description,
    tags: [],
    entry: SKILL_DEFAULT_ENTRY_FILE_NAME,
    capabilities: createDefaultCapabilities(),
  }

  if (options.expectedSkillId !== undefined
    && options.expectedSkillId !== null
    && metadata.skillId !== options.expectedSkillId
  ) {
    errors.push(createValidationIssue(
      'SKILL.md.frontmatter.name',
      `Skill frontmatter name "${metadata.skillId}" does not match registry id "${options.expectedSkillId}".`,
      'skill_id_mismatch',
    ))
  }

  if (options.expectedSkillId === undefined && options.existingSkillIds.has(metadata.skillId)) {
    errors.push(createValidationIssue(
      'SKILL.md.frontmatter.name',
      `Skill id "${metadata.skillId}" already exists in the registry.`,
      'duplicate_skill_id',
    ))
  }

  if (errors.length > 0) {
    return validationFailure(errors, warnings)
  }

  return {
    ok: true,
    package: {
      metadata,
      entrySummary: summarizeText(entryFile.body),
      resourceSummaries: await collectDirectoryResourceSummaries(sourceDirectory),
      validation: {
        status: 'valid',
        errors: [],
        warnings,
      },
    },
  }
}

async function readAndValidateSkillMarkdown(
  entryPath: string,
  errors: SkillValidationIssue[],
): Promise<SkillMarkdownMetadata | null> {
  try {
    const entryStat = await lstat(entryPath)
    if (!entryStat.isFile()) {
      errors.push(createValidationIssue('SKILL.md', 'Skill entry must be a file named SKILL.md.', 'entry_not_file'))
      return null
    }
    if (entryStat.isSymbolicLink()) {
      errors.push(createValidationIssue('SKILL.md', 'Skill entry must not be a symbolic link.', 'entry_symbolic_link'))
      return null
    }
    if (entryStat.size > SKILL_ENTRY_MAX_BYTES) {
      errors.push(createValidationIssue('SKILL.md', 'Skill entry exceeds the size limit.', 'entry_too_large'))
      return null
    }
  } catch (error) {
    errors.push(createValidationIssue('SKILL.md', `Skill entry file is not readable: ${formatUnknownError(error)}`, 'entry_missing'))
    return null
  }

  const content = await readFile(entryPath, 'utf8')
  const parsed = parseSkillMarkdownFrontmatter(content, errors)
  if (parsed === null) {
    return null
  }

  return parsed
}

function parseSkillMarkdownFrontmatter(
  content: string,
  errors: SkillValidationIssue[],
): SkillMarkdownMetadata | null {
  const normalizedContent = content.replace(/^\uFEFF/u, '')
  const firstLineMatch = /^(---)[ \t]*(?:\r?\n)/u.exec(normalizedContent)
  if (firstLineMatch === null) {
    errors.push(createValidationIssue('SKILL.md.frontmatter', 'SKILL.md must start with YAML frontmatter containing name and description.', 'frontmatter_missing'))
    return null
  }

  const frontmatterStart = firstLineMatch[0].length
  const closingMatch = /(?:^|\r?\n)---[ \t]*(?:\r?\n|$)/u.exec(normalizedContent.slice(frontmatterStart))
  if (closingMatch === null || closingMatch.index !== 0 && !closingMatch[0].startsWith('\n') && !closingMatch[0].startsWith('\r')) {
    errors.push(createValidationIssue('SKILL.md.frontmatter', 'SKILL.md frontmatter must be closed by a standalone --- line.', 'frontmatter_unclosed'))
    return null
  }

  const closingStart = frontmatterStart + closingMatch.index + (closingMatch[0].startsWith('\r\n') ? 2 : closingMatch[0].startsWith('\n') ? 1 : 0)
  const closingEnd = frontmatterStart + closingMatch.index + closingMatch[0].length
  const frontmatter = normalizedContent.slice(frontmatterStart, closingStart)
  const body = normalizedContent.slice(closingEnd)
  const values = parseFrontmatterStringFields(frontmatter)
  const name = normalizeString(values.name)
  const description = normalizeString(values.description)

  if (name === null || !SKILL_ID_PATTERN.test(name)) {
    errors.push(createValidationIssue('SKILL.md.frontmatter.name', 'Skill frontmatter name must match /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/.', 'invalid_skill_id'))
  }
  if (description === null || description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(createValidationIssue('SKILL.md.frontmatter.description', 'Skill frontmatter description must be a non-empty string within 1000 characters.', 'invalid_description'))
  }

  if (name === null || description === null || errors.length > 0) {
    return null
  }

  return {
    name,
    description,
    body,
  }
}

function parseFrontmatterStringFields(frontmatter: string): Record<string, string> {
  const values: Record<string, string> = {}
  const lines = frontmatter.split(/\r?\n/u)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const keyValueMatch = /^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/u.exec(line)
    if (keyValueMatch === null) {
      continue
    }

    const [, key, rawValue] = keyValueMatch
    const blockScalarMatch = /^([>|])[-+]?\s*$/u.exec(rawValue)
    if (blockScalarMatch !== null) {
      const blockLines: string[] = []
      for (index += 1; index < lines.length; index += 1) {
        const blockLine = lines[index]
        if (/^[A-Za-z][A-Za-z0-9_-]*\s*:/u.test(blockLine)) {
          index -= 1
          break
        }
        blockLines.push(blockLine.replace(/^[ \t]{1,}/u, ''))
      }
      values[key] = blockScalarMatch[1] === '>'
        ? blockLines.map((entry) => entry.trim()).filter(Boolean).join(' ')
        : blockLines.join('\n').trim()
      continue
    }

    values[key] = unquoteYamlScalar(rawValue.trim())
  }

  return values
}

function unquoteYamlScalar(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
    return value.slice(1, -1)
  }

  return value
}

async function scanPackageFiles(rootDirectory: string, errors: SkillValidationIssue[]): Promise<DirectoryScanResult> {
  let totalSizeBytes = 0
  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name)
      const entryStat = await lstat(absolutePath)
      if (entryStat.isSymbolicLink()) {
        errors.push(createValidationIssue(toPackagePath(rootDirectory, absolutePath), 'Skill package must not contain symbolic links.', 'symbolic_link'))
        continue
      }
      if (entryStat.isDirectory()) {
        await visit(absolutePath)
        continue
      }
      if (entryStat.isFile()) {
        totalSizeBytes += entryStat.size
      }
    }
  }

  try {
    await visit(rootDirectory)
  } catch (error) {
    errors.push(createValidationIssue('sourceDirectory', `Skill package directory scan failed: ${formatUnknownError(error)}`, 'scan_failed'))
  }

  return { totalSizeBytes }
}

async function collectDirectoryResourceSummaries(rootDirectory: string): Promise<SkillResourceSummary[]> {
  const resourcePaths: string[] = []

  const visit = async (directory: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = path.join(directory, entry.name)
      const entryStat = await lstat(absolutePath)
      if (entryStat.isSymbolicLink()) {
        continue
      }
      if (entryStat.isDirectory()) {
        await visit(absolutePath)
        continue
      }
      if (!entryStat.isFile()) {
        continue
      }

      const resourcePath = toPackagePath(rootDirectory, absolutePath)
      if (resourcePath === SKILL_DEFAULT_ENTRY_FILE_NAME) {
        continue
      }
      resourcePaths.push(resourcePath)
    }
  }

  await visit(rootDirectory)

  return resourcePaths
    .sort((left, right) => left.localeCompare(right, 'en'))
    .map((resourcePath) => ({ path: resourcePath, description: null }))
}

function buildSkillRecord(input: {
  validated: ValidatedSkillPackage
  managedDirectoryName: string
  source: SkillRecord['source']
  enabled: boolean
  importedAt: string
  updatedAt: string
}): SkillRecord {
  const metadata = input.validated.metadata
  return {
    skillId: metadata.skillId,
    displayName: metadata.displayName,
    description: metadata.description,
    ...(metadata.version === undefined ? {} : { version: metadata.version }),
    source: input.source,
    enabled: input.enabled,
    trusted: true,
    managedDirectoryName: input.managedDirectoryName,
    entryPath: metadata.entry,
    tags: [...(metadata.tags ?? [])],
    capabilities: metadata.capabilities ?? createDefaultCapabilities(),
    validation: input.validated.validation,
    entrySummary: input.validated.entrySummary,
    resourceSummaries: input.validated.resourceSummaries.map((resource) => ({ ...resource })),
    importedAt: input.importedAt,
    updatedAt: input.updatedAt,
  }
}

function buildRefreshedSkillRecord(
  existing: SkillRecord,
  validated: ValidatedSkillPackage,
  updatedAt: string,
): SkillRecord {
  return {
    ...cloneSkillRecord(existing),
    displayName: validated.metadata.displayName,
    description: validated.metadata.description,
    ...(validated.metadata.version === undefined ? { version: undefined } : { version: validated.metadata.version }),
    entryPath: validated.metadata.entry,
    tags: [...(validated.metadata.tags ?? [])],
    capabilities: validated.metadata.capabilities ?? createDefaultCapabilities(),
    validation: validated.validation,
    entrySummary: validated.entrySummary,
    resourceSummaries: validated.resourceSummaries.map((resource) => ({ ...resource })),
    updatedAt,
  }
}

function buildLoadResult(
  snapshot: SkillRegistryStoreSnapshot,
  includeDisabled: boolean,
): SkillRegistryLoadResult {
  return {
    ok: true,
    registryRevision: snapshot.registryRevision,
    snapshotRevision: snapshot.snapshotRevision,
    skills: snapshot.skills
      .filter((skill) => includeDisabled || skill.enabled)
      .map(cloneSkillRecord),
  }
}

function resolveRefreshTargets(
  snapshot: SkillRegistryStoreSnapshot,
  request?: SkillRefreshRequest,
): { ok: true, skills: SkillRecord[] } | { ok: false, failure: SkillRefreshResult } {
  const skillId = typeof request?.skillId === 'string' ? request.skillId.trim() : ''
  if (skillId === '') {
    return { ok: true, skills: snapshot.skills.map(cloneSkillRecord) }
  }

  const skill = snapshot.skills.find((entry) => entry.skillId === skillId)
  if (skill === undefined) {
    return {
      ok: false,
      failure: createSkillRegistryApiFailure(`Skill "${skillId}" was not found.`, SKILL_REGISTRY_NOT_FOUND_ERROR_CODE),
    }
  }

  return { ok: true, skills: [cloneSkillRecord(skill)] }
}

async function resolveManagedDirectoryName(
  skillId: string,
  managedSkillsDir: string,
  existingSkills: readonly SkillRecord[],
): Promise<string> {
  const usedNames = new Set(existingSkills.map((skill) => skill.managedDirectoryName.toLowerCase()))
  let candidate = skillId
  let suffix = 2
  while (usedNames.has(candidate.toLowerCase()) || await pathExists(path.join(managedSkillsDir, candidate))) {
    candidate = `${skillId}-${suffix}`
    suffix += 1
  }
  return candidate
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath)
    return true
  } catch (error) {
    return !isMissingFileError(error)
  }
}

function resolveManagedSkillDirectory(paths: SkillRegistryPaths, skill: SkillRecord): string {
  const managedDirectory = path.resolve(paths.managedSkillsDir, skill.managedDirectoryName)
  if (!isWithinDirectory(paths.managedSkillsDir, managedDirectory)) {
    throw new Error(`Managed skill directory escaped the registry root: ${skill.managedDirectoryName}`)
  }
  return managedDirectory
}

function resolveBuiltinSkillSourceDirectory(
  skillId: string,
  builtinSkillSources: readonly BuiltinSkillSource[],
): string {
  const match = builtinSkillSources.find((entry) => entry.skillId === skillId)
  if (match === undefined) {
    throw new Error(`Builtin Skill source directory is not registered: ${skillId}`)
  }

  return match.sourceDirectory
}

function upsertSkill(skills: readonly SkillRecord[], skill: SkillRecord): SkillRecord[] {
  const existingIndex = skills.findIndex((entry) => entry.skillId === skill.skillId)
  if (existingIndex === -1) {
    return [...skills.map(cloneSkillRecord), cloneSkillRecord(skill)]
  }

  return skills.map((entry, index) => index === existingIndex ? cloneSkillRecord(skill) : cloneSkillRecord(entry))
}

function overrideSnapshotRevision(
  snapshot: SkillRegistryStoreSnapshot,
  snapshotRevision: number,
): SkillRegistryStoreSnapshot {
  return {
    ...snapshot,
    snapshotRevision,
    skills: snapshot.skills.map(cloneSkillRecord),
  }
}

async function publishSnapshotEvent(
  snapshot: SkillRegistryStoreSnapshot,
  publishEvent: CreateSkillRegistryServiceOptions['publishEvent'],
  snapshotRevision: number,
): Promise<void> {
  await publishEvent?.({
    kind: 'snapshot',
    registryRevision: snapshot.registryRevision,
    snapshotRevision,
    skills: snapshot.skills.map(cloneSkillRecord),
  })
}

function validationFailure(
  errors: SkillValidationIssue[],
  warnings: SkillValidationIssue[],
): { ok: false, validation: SkillValidationSummary } {
  return {
    ok: false,
    validation: {
      status: 'invalid',
      errors,
      warnings,
    },
  }
}

function createValidationIssue(fieldPath: string, message: string, code: string): SkillValidationIssue {
  return { fieldPath, message, code }
}

function createDefaultCapabilities(): SkillCapabilityFlags {
  return {
    readOnlyResources: true,
    scripts: false,
  }
}

function resolveRuntimeRevisions(snapshot: SkillRegistryStoreSnapshot): { registryRevision: number, snapshotRevision: number } {
  return {
    registryRevision: Math.max(0, Math.trunc(snapshot.registryRevision)),
    snapshotRevision: Math.max(0, Math.trunc(snapshot.snapshotRevision)),
  }
}

function bumpRuntimeSnapshotRevision(snapshotRevision: number): number {
  return Math.max(0, Math.trunc(snapshotRevision)) + 1
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized === '' ? null : normalized
}

function summarizeText(value: string): string | null {
  const summary = value.replace(/^\uFEFF/u, '').trim()
  return summary === '' ? null : summary
}

function toPackagePath(rootDirectory: string, absolutePath: string): string {
  return path.relative(rootDirectory, absolutePath).split(path.sep).join('/')
}

function isWithinDirectory(rootDirectory: string, targetPath: string): boolean {
  const relative = path.relative(path.resolve(rootDirectory), path.resolve(targetPath))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function cloneSkillRecord(skill: SkillRecord): SkillRecord {
  return {
    ...skill,
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

function sameSkillRecord(left: SkillRecord | undefined, right: SkillRecord): boolean {
  if (left === undefined) {
    return false
  }

  return JSON.stringify(cloneSkillRecord(left)) === JSON.stringify(cloneSkillRecord(right))
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function isMissingFileError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT'
}
