import path from 'node:path'

export function normalizeRequiredRelativePath(value: unknown, fieldName: string): string {
  const normalizedValue = normalizeRequiredString(value, fieldName)

  if (path.isAbsolute(normalizedValue)) {
    throw new Error(`Bundled runtime manifest field "${fieldName}" must be a relative path.`)
  }

  return normalizedValue
}

export function normalizeOptionalRelativePath(value: unknown, fieldName: string): string | null {
  const normalizedValue = normalizeOptionalString(value)

  if (normalizedValue === null) {
    return null
  }

  if (path.isAbsolute(normalizedValue)) {
    throw new Error(`Bundled runtime manifest field "${fieldName}" must be a relative path when provided.`)
  }

  return normalizedValue
}

export function resolveBundledRuntimeRelativePath(
  resourcesRoot: string,
  relativePath: string,
  description: string,
): string {
  const normalizedPath = normalizeRequiredRelativePath(relativePath, description)
  const resolvedPath = path.resolve(resourcesRoot, normalizedPath)
  const relativeToRoot = path.relative(resourcesRoot, resolvedPath)

  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    throw new Error(`Bundled runtime ${description} escapes the resources root: "${relativePath}".`)
  }

  return resolvedPath
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
