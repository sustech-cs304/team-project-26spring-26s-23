import { readFile } from 'node:fs/promises'
import {
  normalizeOptionalRelativePath,
  normalizeRequiredRelativePath,
} from './python-runtime-path-security'
import type { BundledPythonRuntimeManifest } from './python-runtime-resolver-shared'

export async function readBundledPythonRuntimeManifest(
  manifestPath: string,
): Promise<BundledPythonRuntimeManifest> {
  const rawManifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
  const rawPython = getRecordField(rawManifest, 'python')
  const rawBackend = getRecordField(rawManifest, 'backend')
  const rawMetadata = getOptionalRecordField(rawManifest, 'metadata')

  return {
    manifestVersion: normalizeRequiredInteger(rawManifest.manifestVersion, 'manifestVersion'),
    resourceLayoutVersion: normalizeRequiredInteger(rawManifest.resourceLayoutVersion, 'resourceLayoutVersion'),
    runtimeMode: normalizeRuntimeMode(rawManifest.runtimeMode),
    generatedAt: normalizeOptionalString(rawManifest.generatedAt),
    platform: normalizeOptionalString(rawManifest.platform),
    arch: normalizeOptionalString(rawManifest.arch),
    python: {
      runtimeRootRelativePath: normalizeRequiredRelativePath(rawPython.runtimeRootRelativePath, 'python.runtimeRootRelativePath'),
      executableRelativePath: normalizeRequiredRelativePath(rawPython.executableRelativePath, 'python.executableRelativePath'),
      version: normalizeOptionalString(rawPython.version),
    },
    backend: {
      workingDirectoryRelativePath: normalizeRequiredRelativePath(
        rawBackend.workingDirectoryRelativePath,
        'backend.workingDirectoryRelativePath',
      ),
      entryModule: normalizeRequiredString(rawBackend.entryModule, 'backend.entryModule'),
      pythonPathRelativePaths: normalizeRequiredRelativePathArray(
        rawBackend.pythonPathRelativePaths,
        'backend.pythonPathRelativePaths',
      ),
      sitePackagesRelativePaths: normalizeRequiredRelativePathArray(
        rawBackend.sitePackagesRelativePaths,
        'backend.sitePackagesRelativePaths',
        { allowEmpty: true },
      ),
    },
    metadata: {
      frontendVersion: normalizeOptionalString(rawMetadata?.frontendVersion),
      backendVersion: normalizeOptionalString(rawMetadata?.backendVersion),
      requirementsRelativePath: normalizeOptionalRelativePath(rawMetadata?.requirementsRelativePath, 'metadata.requirementsRelativePath'),
      stagingTool: normalizeOptionalString(rawMetadata?.stagingTool),
    },
  }
}

function getRecordField(source: Record<string, unknown>, fieldName: string): Record<string, unknown> {
  const value = source[fieldName]

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Bundled runtime manifest field "${fieldName}" must be an object.`)
  }

  return value as Record<string, unknown>
}

function getOptionalRecordField(source: Record<string, unknown>, fieldName: string): Record<string, unknown> | null {
  const value = source[fieldName]

  if (value === undefined || value === null) {
    return null
  }

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Bundled runtime manifest field "${fieldName}" must be an object when provided.`)
  }

  return value as Record<string, unknown>
}

function normalizeRuntimeMode(value: unknown): 'bundled' {
  if (value !== 'bundled') {
    throw new Error(`Bundled runtime manifest field "runtimeMode" must equal "bundled", received "${String(value)}".`)
  }

  return 'bundled'
}

function normalizeRequiredInteger(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Bundled runtime manifest field "${fieldName}" must be an integer.`)
  }

  return value
}

function normalizeRequiredRelativePathArray(
  value: unknown,
  fieldName: string,
  options: { allowEmpty?: boolean } = {},
): string[] {
  const { allowEmpty = false } = options

  if (!Array.isArray(value)) {
    throw new Error(
      `Bundled runtime manifest field "${fieldName}" must be ${allowEmpty ? 'an' : 'a non-empty'} array of relative paths.`,
    )
  }

  if (!allowEmpty && value.length === 0) {
    throw new Error(`Bundled runtime manifest field "${fieldName}" must be a non-empty array of relative paths.`)
  }

  return value.map((entry, index) => normalizeRequiredRelativePath(entry, `${fieldName}[${index}]`))
}

function normalizeRequiredString(value: unknown, fieldName: string): string {
  const normalizedValue = normalizeOptionalString(value)

  if (normalizedValue === null) {
    throw new Error(`Bundled runtime manifest field "${fieldName}" must be a non-empty string.`)
  }

  return normalizedValue
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalizedValue = value.trim()
  return normalizedValue === '' ? null : normalizedValue
}
