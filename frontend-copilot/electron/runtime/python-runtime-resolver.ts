import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'

export type PythonRuntimeMode = 'development' | 'bundled'

export interface PythonRuntimeResolverContext {
  appRoot: string
  resourcesPath: string
  isPackaged: boolean
}

export interface PythonRuntimeLaunchSpec {
  mode: PythonRuntimeMode
  workspaceRoot: string | null
  backendDir: string
  resourcesRoot: string
  workingDirectory: string
  entryModule: string
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  manifestPath: string | null
  pythonExecutablePath: string | null
  pythonPathEntries: string[]
  sitePackagesEntries: string[]
}

export interface BundledPythonRuntimePlaceholder {
  mode: 'bundled'
  resourcesRoot: string
  manifestPath: string
}

export interface BundledPythonRuntimeManifest {
  manifestVersion: number
  resourceLayoutVersion: number
  runtimeMode: 'bundled'
  generatedAt: string | null
  platform: string | null
  arch: string | null
  python: {
    runtimeRootRelativePath: string
    executableRelativePath: string
    version: string | null
  }
  backend: {
    workingDirectoryRelativePath: string
    entryModule: string
    pythonPathRelativePaths: string[]
    sitePackagesRelativePaths: string[]
  }
  metadata: {
    frontendVersion: string | null
    backendVersion: string | null
    requirementsRelativePath: string | null
    stagingTool: string | null
  }
}

export const DESKTOP_RUNTIME_ENTRY_MODULE = 'app.desktop_runtime'
export const BUNDLED_RUNTIME_DIRECTORY_NAME = 'python-runtime'
export const BUNDLED_RUNTIME_MANIFEST_FILE_NAME = 'backend-runtime-manifest.json'
const DEVELOPMENT_VENV_DIRECTORY_NAME = '.venv'

interface DevelopmentPythonLaunchCandidate {
  command: string
  args: string[]
  pythonExecutablePath: string | null
}

export function buildDevelopmentPythonRuntimeLaunchSpec(
  context: PythonRuntimeResolverContext,
): PythonRuntimeLaunchSpec {
  const normalizedAppRoot = path.resolve(context.appRoot)
  const workspaceRoot = path.resolve(normalizedAppRoot, '..')
  const backendDir = path.join(workspaceRoot, 'backend')
  const pythonLaunchCandidate = resolveDevelopmentPythonLaunchCandidate(backendDir)
    ?? getFallbackDevelopmentPythonLaunchCandidate(backendDir)

  return {
    mode: 'development',
    workspaceRoot,
    backendDir,
    resourcesRoot: backendDir,
    workingDirectory: backendDir,
    entryModule: DESKTOP_RUNTIME_ENTRY_MODULE,
    command: pythonLaunchCandidate.command,
    args: [...pythonLaunchCandidate.args, '-m', DESKTOP_RUNTIME_ENTRY_MODULE],
    env: {},
    manifestPath: null,
    pythonExecutablePath: pythonLaunchCandidate.pythonExecutablePath,
    pythonPathEntries: [backendDir],
    sitePackagesEntries: [],
  }
}

function resolveDevelopmentPythonLaunchCandidate(backendDir: string): DevelopmentPythonLaunchCandidate | null {
  const pythonExecutablePath = resolveDevelopmentPythonExecutablePath(backendDir)

  if (pythonExecutablePath !== null) {
    return {
      command: pythonExecutablePath,
      args: [],
      pythonExecutablePath,
    }
  }

  for (const candidate of getFallbackDevelopmentPythonLaunchCandidates(backendDir)) {
    if (canExecuteDevelopmentPythonCandidate(candidate)) {
      return candidate
    }
  }

  return null
}

function resolveDevelopmentPythonExecutablePath(backendDir: string): string | null {
  for (const candidatePath of getDevelopmentPythonExecutableCandidates(backendDir)) {
    if (existsSync(candidatePath)) {
      return candidatePath
    }
  }

  return null
}

function getDevelopmentPythonExecutableCandidates(backendDir: string): string[] {
  const venvDir = path.join(backendDir, DEVELOPMENT_VENV_DIRECTORY_NAME)

  if (process.platform === 'win32') {
    return [path.join(venvDir, 'Scripts', 'python.exe')]
  }

  return [
    path.join(venvDir, 'bin', 'python'),
    path.join(venvDir, 'bin', 'python3'),
  ]
}

function getFallbackDevelopmentPythonLaunchCandidate(backendDir: string): DevelopmentPythonLaunchCandidate {
  return getFallbackDevelopmentPythonLaunchCandidates(backendDir)[0]
}

function getFallbackDevelopmentPythonLaunchCandidates(backendDir: string): DevelopmentPythonLaunchCandidate[] {
  const uvCandidate: DevelopmentPythonLaunchCandidate = {
    command: 'uv',
    args: ['run', '--directory', path.resolve(backendDir), 'python'],
    pythonExecutablePath: null,
  }

  if (process.platform === 'win32') {
    return [
      uvCandidate,
      {
        command: 'py',
        args: ['-3'],
        pythonExecutablePath: null,
      },
      {
        command: 'python',
        args: [],
        pythonExecutablePath: null,
      },
      {
        command: 'python3',
        args: [],
        pythonExecutablePath: null,
      },
    ]
  }

  return [
    uvCandidate,
    {
      command: 'python3',
      args: [],
      pythonExecutablePath: null,
    },
    {
      command: 'python',
      args: [],
      pythonExecutablePath: null,
    },
  ]
}

function canExecuteDevelopmentPythonCandidate(candidate: DevelopmentPythonLaunchCandidate): boolean {
  const result = spawnSync(candidate.command, [...candidate.args, '--version'], {
    stdio: 'ignore',
    windowsHide: true,
  })

  return result.error === undefined && result.status === 0
}

export function buildBundledPythonRuntimePlaceholder(
  context: PythonRuntimeResolverContext,
): BundledPythonRuntimePlaceholder {
  const resourcesRoot = path.join(path.resolve(context.resourcesPath), BUNDLED_RUNTIME_DIRECTORY_NAME)

  return {
    mode: 'bundled',
    resourcesRoot,
    manifestPath: path.join(resourcesRoot, BUNDLED_RUNTIME_MANIFEST_FILE_NAME),
  }
}

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

export async function resolvePythonRuntimeLaunchSpec(
  context: PythonRuntimeResolverContext,
): Promise<PythonRuntimeLaunchSpec> {
  if (context.isPackaged) {
    return await buildBundledPythonRuntimeLaunchSpec(context)
  }

  const spec = buildDevelopmentPythonRuntimeLaunchSpec(context)

  await Promise.all([
    assertPathExists(path.join(spec.backendDir, 'pyproject.toml'), 'backend project file'),
    assertPathExists(path.join(spec.backendDir, 'app', 'desktop_runtime', '__main__.py'), 'desktop runtime entry module'),
  ])
  assertDevelopmentPythonLaunchSpecResolved(spec)

  return spec
}

async function buildBundledPythonRuntimeLaunchSpec(
  context: PythonRuntimeResolverContext,
): Promise<PythonRuntimeLaunchSpec> {
  const placeholder = buildBundledPythonRuntimePlaceholder(context)

  await assertPathExists(placeholder.manifestPath, 'bundled runtime manifest')

  const manifest = await readBundledPythonRuntimeManifest(placeholder.manifestPath)
  const backendDir = resolveBundledRuntimeRelativePath(
    placeholder.resourcesRoot,
    manifest.backend.workingDirectoryRelativePath,
    'backend working directory',
  )
  const pythonExecutablePath = resolveBundledRuntimeRelativePath(
    placeholder.resourcesRoot,
    manifest.python.executableRelativePath,
    'Python executable',
  )
  const pythonPathEntries = manifest.backend.pythonPathRelativePaths.map((relativePath) => resolveBundledRuntimeRelativePath(
    placeholder.resourcesRoot,
    relativePath,
    'bundled Python path entry',
  ))
  const sitePackagesEntries = manifest.backend.sitePackagesRelativePaths.map((relativePath) => resolveBundledRuntimeRelativePath(
    placeholder.resourcesRoot,
    relativePath,
    'bundled site-packages entry',
  ))

  await Promise.all([
    assertPathExists(pythonExecutablePath, 'bundled Python executable'),
    assertPathExists(backendDir, 'bundled backend working directory'),
    assertPathExists(path.join(backendDir, 'app', 'desktop_runtime', '__main__.py'), 'bundled desktop runtime entry module'),
    ...pythonPathEntries.map((pythonPathEntry) => assertPathExists(pythonPathEntry, 'bundled Python path entry')),
    ...sitePackagesEntries.map((sitePackagesEntry) => assertPathExists(sitePackagesEntry, 'bundled site-packages entry')),
  ])

  return {
    mode: 'bundled',
    workspaceRoot: null,
    backendDir,
    resourcesRoot: placeholder.resourcesRoot,
    workingDirectory: backendDir,
    entryModule: manifest.backend.entryModule,
    command: pythonExecutablePath,
    args: ['-m', manifest.backend.entryModule],
    env: buildBundledPythonRuntimeEnvironment(pythonPathEntries),
    manifestPath: placeholder.manifestPath,
    pythonExecutablePath,
    pythonPathEntries,
    sitePackagesEntries,
  }
}

function buildBundledPythonRuntimeEnvironment(pythonPathEntries: string[]): NodeJS.ProcessEnv {
  return {
    PYTHONPATH: pythonPathEntries.join(path.delimiter),
  }
}

function assertDevelopmentPythonLaunchSpecResolved(spec: PythonRuntimeLaunchSpec): void {
  if (spec.mode !== 'development' || spec.pythonExecutablePath !== null) {
    return
  }

  if (canExecuteDevelopmentPythonCandidate({
    command: spec.command,
    args: spec.args.slice(0, -2),
    pythonExecutablePath: null,
  })) {
    return
  }

  const venvCandidates = getDevelopmentPythonExecutableCandidates(spec.backendDir)
    .map((candidate) => `"${candidate}"`)
    .join(', ')
  const fallbackCandidates = getFallbackDevelopmentPythonLaunchCandidates(spec.backendDir)
    .map((candidate) => candidate.args.length === 0
      ? candidate.command
      : `${candidate.command} ${candidate.args.join(' ')}`)
    .join(', ')

  throw new Error(
    `Cannot resolve a usable Python interpreter for the development desktop runtime. Checked project virtualenv candidates (${venvCandidates}) and fallback commands (${fallbackCandidates}).`,
  )
}

function resolveBundledRuntimeRelativePath(
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

function normalizeRequiredRelativePath(value: unknown, fieldName: string): string {
  const normalizedValue = normalizeRequiredString(value, fieldName)

  if (path.isAbsolute(normalizedValue)) {
    throw new Error(`Bundled runtime manifest field "${fieldName}" must be a relative path.`)
  }

  return normalizedValue
}

function normalizeOptionalRelativePath(value: unknown, fieldName: string): string | null {
  const normalizedValue = normalizeOptionalString(value)

  if (normalizedValue === null) {
    return null
  }

  if (path.isAbsolute(normalizedValue)) {
    throw new Error(`Bundled runtime manifest field "${fieldName}" must be a relative path when provided.`)
  }

  return normalizedValue
}

function normalizeRequiredRelativePathArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
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

async function assertPathExists(filePath: string, description: string): Promise<void> {
  try {
    await access(filePath)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Cannot resolve ${description} at "${filePath}": ${detail}`)
  }
}
