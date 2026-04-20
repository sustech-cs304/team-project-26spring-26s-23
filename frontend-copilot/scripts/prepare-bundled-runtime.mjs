import { spawnSync } from 'node:child_process'
import { access, cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const FRONTEND_ROOT = path.resolve(__dirname, '..')
const WORKSPACE_ROOT = path.resolve(FRONTEND_ROOT, '..')
const BACKEND_ROOT = path.join(WORKSPACE_ROOT, 'backend')
const PROVIDER_CATALOG_ROOT = path.join(WORKSPACE_ROOT, 'provider-catalog')
const STAGING_ROOT = path.join(FRONTEND_ROOT, '.bundled-runtime', 'staging')

const PYTHON_RUNTIME_DIRECTORY_NAME = 'python'
const BACKEND_DIRECTORY_NAME = 'backend'
const PROVIDER_CATALOG_DIRECTORY_NAME = 'provider-catalog'
const PYTHON_PACKAGES_DIRECTORY_NAME = 'python-packages'
const METADATA_DIRECTORY_NAME = 'metadata'
const MANIFEST_FILE_NAME = 'backend-runtime-manifest.json'
const REQUIREMENTS_FILE_NAME = 'backend-requirements.txt'
const DESKTOP_RUNTIME_ENTRY_MODULE = 'app.desktop_runtime'
const LAYOUT_VERSION = 1

const REQUIRED_ENVIRONMENT_NAMES = {
  PYTHON_DIR: 'CANDUE_BUNDLED_PYTHON_DIR',
  PYTHON_EXECUTABLE_RELATIVE: 'CANDUE_BUNDLED_PYTHON_EXECUTABLE_RELATIVE',
  PYTHON_VERSION: 'CANDUE_BUNDLED_PYTHON_VERSION',
}

async function main() {
  const frontendPackage = await loadJson(path.join(FRONTEND_ROOT, 'package.json'))
  const backendVersion = await readBackendProjectVersion()
  const pythonSource = await resolveBundledPythonSource()

  console.info('[bundled-runtime] Preparing staging directory:', STAGING_ROOT)
  await rm(STAGING_ROOT, { recursive: true, force: true })
  await mkdir(STAGING_ROOT, { recursive: true })

  const stagedPythonRoot = path.join(STAGING_ROOT, PYTHON_RUNTIME_DIRECTORY_NAME)
  const stagedBackendRoot = path.join(STAGING_ROOT, BACKEND_DIRECTORY_NAME)
  const stagedProviderCatalogRoot = path.join(STAGING_ROOT, PROVIDER_CATALOG_DIRECTORY_NAME)
  const stagedPythonPackagesRoot = path.join(STAGING_ROOT, PYTHON_PACKAGES_DIRECTORY_NAME)
  const stagedMetadataRoot = path.join(STAGING_ROOT, METADATA_DIRECTORY_NAME)
  const stagedManifestPath = path.join(STAGING_ROOT, MANIFEST_FILE_NAME)
  const stagedRequirementsPath = path.join(stagedMetadataRoot, REQUIREMENTS_FILE_NAME)

  await Promise.all([
    mkdir(stagedPythonPackagesRoot, { recursive: true }),
    mkdir(stagedMetadataRoot, { recursive: true }),
  ])

  console.info('[bundled-runtime] Copying distributable Python runtime from source directory.')
  await cp(pythonSource.sourceDirectory, stagedPythonRoot, {
    recursive: true,
    force: true,
  })

  const stagedPythonExecutable = path.join(stagedPythonRoot, pythonSource.executableRelativePath)
  await assertPathExists(stagedPythonExecutable, 'staged Python executable')

  console.info('[bundled-runtime] Exporting locked backend dependency set with uv.')
  runCommand('uv', [
    'export',
    '--frozen',
    '--no-dev',
    '--no-hashes',
    '--no-editable',
    '--no-emit-project',
    '--output-file',
    stagedRequirementsPath,
  ], {
    cwd: BACKEND_ROOT,
    description: 'export backend requirements from uv.lock',
  })

  console.info('[bundled-runtime] Installing backend dependencies into staging.')
  runCommand('uv', [
    'pip',
    'install',
    '--python',
    stagedPythonExecutable,
    '--target',
    stagedPythonPackagesRoot,
    '--link-mode',
    'copy',
    '--requirement',
    stagedRequirementsPath,
  ], {
    cwd: BACKEND_ROOT,
    description: 'install backend dependencies into staging',
  })

  console.info('[bundled-runtime] Copying backend runtime resources into staging.')
  await mkdir(stagedBackendRoot, { recursive: true })
  await Promise.all([
    cp(path.join(BACKEND_ROOT, 'app'), path.join(stagedBackendRoot, 'app'), {
      recursive: true,
      force: true,
    }),
    cp(path.join(BACKEND_ROOT, 'alembic.ini'), path.join(stagedBackendRoot, 'alembic.ini'), {
      force: true,
    }),
    cp(path.join(BACKEND_ROOT, 'alembic'), path.join(stagedBackendRoot, 'alembic'), {
      recursive: true,
      force: true,
    }),
    cp(PROVIDER_CATALOG_ROOT, stagedProviderCatalogRoot, {
      recursive: true,
      force: true,
    }),
  ])

  const pythonVersion = resolvePythonVersion(stagedPythonExecutable)

  const manifest = {
    manifestVersion: 1,
    resourceLayoutVersion: LAYOUT_VERSION,
    runtimeMode: 'bundled',
    generatedAt: new Date().toISOString(),
    platform: process.platform,
    arch: process.arch,
    python: {
      runtimeRootRelativePath: toPosixPath(PYTHON_RUNTIME_DIRECTORY_NAME),
      executableRelativePath: toPosixPath(path.join(PYTHON_RUNTIME_DIRECTORY_NAME, pythonSource.executableRelativePath)),
      version: pythonVersion,
    },
    backend: {
      workingDirectoryRelativePath: toPosixPath(BACKEND_DIRECTORY_NAME),
      entryModule: DESKTOP_RUNTIME_ENTRY_MODULE,
      pythonPathRelativePaths: [
        toPosixPath(BACKEND_DIRECTORY_NAME),
        toPosixPath(PYTHON_PACKAGES_DIRECTORY_NAME),
      ],
      sitePackagesRelativePaths: [
        toPosixPath(PYTHON_PACKAGES_DIRECTORY_NAME),
      ],
    },
    metadata: {
      frontendVersion: normalizeOptionalString(frontendPackage.version),
      backendVersion,
      requirementsRelativePath: toPosixPath(path.join(METADATA_DIRECTORY_NAME, REQUIREMENTS_FILE_NAME)),
      stagingTool: 'frontend-copilot/scripts/prepare-bundled-runtime.mjs',
    },
  }

  await writeFile(stagedManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await verifyStagedRuntimeLayout({
    stagingRoot: STAGING_ROOT,
    manifest,
    requirementsPath: stagedRequirementsPath,
  })

  console.info('[bundled-runtime] Bundled runtime staging completed successfully.')
  console.info('[bundled-runtime] Manifest:', stagedManifestPath)
  console.info('[bundled-runtime] Python executable:', stagedPythonExecutable)
}

async function resolveBundledPythonSource() {
  const configuredDirectory = readRequiredEnvironmentVariable(REQUIRED_ENVIRONMENT_NAMES.PYTHON_DIR)
  const sourceDirectory = path.resolve(WORKSPACE_ROOT, configuredDirectory)
  await assertPathExists(sourceDirectory, `${REQUIRED_ENVIRONMENT_NAMES.PYTHON_DIR} directory`)

  const configuredExecutable = normalizeOptionalString(
    process.env[REQUIRED_ENVIRONMENT_NAMES.PYTHON_EXECUTABLE_RELATIVE],
  )
  const executableRelativePath = configuredExecutable
    ?? await detectPythonExecutableRelativePath(sourceDirectory)

  const sourceExecutablePath = path.join(sourceDirectory, executableRelativePath)
  await assertPathExists(sourceExecutablePath, 'source Python executable')

  return {
    sourceDirectory,
    executableRelativePath,
  }
}

async function detectPythonExecutableRelativePath(sourceDirectory) {
  const candidates = process.platform === 'win32'
    ? ['python.exe', 'python3.exe']
    : ['bin/python3', 'bin/python']

  for (const candidate of candidates) {
    const candidatePath = path.join(sourceDirectory, candidate)

    try {
      await access(candidatePath)
      return candidate
    } catch {
      // Continue searching through known distributable layouts.
    }
  }

  throw new Error(
    `Cannot detect a Python executable inside "${sourceDirectory}". Set ${REQUIRED_ENVIRONMENT_NAMES.PYTHON_EXECUTABLE_RELATIVE} to the executable path relative to ${REQUIRED_ENVIRONMENT_NAMES.PYTHON_DIR}.`,
  )
}

function resolvePythonVersion(pythonExecutablePath) {
  const configuredVersion = normalizeOptionalString(process.env[REQUIRED_ENVIRONMENT_NAMES.PYTHON_VERSION])

  if (configuredVersion !== null) {
    return configuredVersion
  }

  const result = spawnSync(pythonExecutablePath, ['--version'], {
    encoding: 'utf8',
    cwd: BACKEND_ROOT,
  })

  if (result.error) {
    throw new Error(`Failed to resolve bundled Python version from "${pythonExecutablePath}": ${result.error.message}`)
  }

  if (result.status !== 0) {
    throw new Error(
      `Failed to resolve bundled Python version from "${pythonExecutablePath}" (exit code ${result.status ?? 'unknown'}): ${formatCommandOutput(result)}`,
    )
  }

  const versionOutput = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  return versionOutput === '' ? null : versionOutput
}

async function readBackendProjectVersion() {
  const pyprojectContent = await readFile(path.join(BACKEND_ROOT, 'pyproject.toml'), 'utf8')
  const versionMatch = pyprojectContent.match(/^version\s*=\s*"([^"]+)"/m)
  return versionMatch === null ? null : versionMatch[1]
}

async function verifyStagedRuntimeLayout(input) {
  const { stagingRoot, manifest, requirementsPath } = input
  const pythonExecutablePath = resolveManifestRelativePath(stagingRoot, manifest.python.executableRelativePath, 'Python executable')
  const backendWorkingDirectory = resolveManifestRelativePath(
    stagingRoot,
    manifest.backend.workingDirectoryRelativePath,
    'backend working directory',
  )

  const providerCatalogRoot = path.join(stagingRoot, PROVIDER_CATALOG_DIRECTORY_NAME)

  await Promise.all([
    assertPathExists(pythonExecutablePath, 'manifest Python executable'),
    assertPathExists(backendWorkingDirectory, 'manifest backend working directory'),
    assertPathExists(path.join(backendWorkingDirectory, 'app', 'desktop_runtime', '__main__.py'), 'desktop runtime entry module'),
    assertPathExists(requirementsPath, 'exported backend requirements file'),
    assertPathExists(providerCatalogRoot, 'bundled provider catalog root'),
    assertPathExists(path.join(providerCatalogRoot, 'schema.json'), 'bundled provider catalog schema'),
    assertPathExists(path.join(providerCatalogRoot, 'registry.json'), 'bundled provider catalog registry'),
    ...manifest.backend.pythonPathRelativePaths.map((relativePath) => assertPathExists(
      resolveManifestRelativePath(stagingRoot, relativePath, 'bundled Python path entry'),
      `bundled Python path entry "${relativePath}"`,
    )),
    ...manifest.backend.sitePackagesRelativePaths.map((relativePath) => assertPathExists(
      resolveManifestRelativePath(stagingRoot, relativePath, 'bundled site-packages path'),
      `bundled site-packages path "${relativePath}"`,
    )),
  ])

  await assertDirectoryNotEmpty(providerCatalogRoot, 'bundled provider catalog root')

  const alembicIniPath = path.join(backendWorkingDirectory, 'alembic.ini')
  await assertPathExists(alembicIniPath, 'bundled Alembic configuration file')

  const alembicScriptRoot = await resolveAlembicScriptLocation(alembicIniPath)
  await assertPathExists(alembicScriptRoot, 'bundled Alembic script location')
  await assertDirectoryNotEmpty(alembicScriptRoot, 'bundled Alembic script location')

  const alembicVersionsDirectory = path.join(alembicScriptRoot, 'versions')
  await assertPathExists(alembicVersionsDirectory, 'bundled Alembic versions directory')
  await assertDirectoryNotEmpty(alembicVersionsDirectory, 'bundled Alembic versions directory')
}

async function resolveAlembicScriptLocation(alembicIniPath) {
  const alembicIniContent = await readFile(alembicIniPath, 'utf8')
  const scriptLocationMatch = alembicIniContent.match(/^\s*script_location\s*=\s*(.+)$/m)

  if (scriptLocationMatch === null) {
    throw new Error(`Bundled Alembic configuration must define script_location: "${alembicIniPath}"`)
  }

  const configuredScriptLocation = normalizeOptionalString(scriptLocationMatch[1])

  if (configuredScriptLocation === null) {
    throw new Error(`Bundled Alembic configuration script_location must be non-empty: "${alembicIniPath}"`)
  }

  const expandedScriptLocation = configuredScriptLocation.replaceAll('%(here)s', path.dirname(alembicIniPath))
  return path.resolve(path.dirname(alembicIniPath), expandedScriptLocation)
}

function resolveManifestRelativePath(rootDirectory, relativePath, description) {
  const normalizedPath = normalizeOptionalString(relativePath)

  if (normalizedPath === null) {
    throw new Error(`Bundled runtime manifest ${description} must be a non-empty relative path.`)
  }

  if (path.isAbsolute(normalizedPath)) {
    throw new Error(`Bundled runtime manifest ${description} must stay relative to the staging root: "${normalizedPath}".`)
  }

  const resolvedPath = path.resolve(rootDirectory, normalizedPath)
  const relativeToRoot = path.relative(rootDirectory, resolvedPath)

  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    throw new Error(`Bundled runtime manifest ${description} escapes the staging root: "${normalizedPath}".`)
  }

  return resolvedPath
}

function runCommand(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  })

  if (result.error) {
    throw new Error(`Failed to ${options.description}: ${result.error.message}`)
  }

  if (result.status !== 0) {
    throw new Error(
      `Failed to ${options.description} (exit code ${result.status ?? 'unknown'}).\n${formatCommandOutput(result)}`,
    )
  }
}

function formatCommandOutput(result) {
  const stdout = typeof result.stdout === 'string' ? result.stdout.trim() : ''
  const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : ''

  if (stdout !== '' && stderr !== '') {
    return `stdout:\n${stdout}\n\nstderr:\n${stderr}`
  }

  if (stdout !== '') {
    return `stdout:\n${stdout}`
  }

  if (stderr !== '') {
    return `stderr:\n${stderr}`
  }

  return 'Command produced no output.'
}

function readRequiredEnvironmentVariable(name) {
  const value = normalizeOptionalString(process.env[name])

  if (value === null) {
    throw new Error(
      `${name} is required. Set it to a distributable Python runtime directory so Electron packaging can bundle a self-contained backend runtime.`,
    )
  }

  return value
}

function normalizeOptionalString(value) {
  if (typeof value !== 'string') {
    return null
  }

  const normalizedValue = value.trim()
  return normalizedValue === '' ? null : normalizedValue
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/')
}

async function assertPathExists(filePath, description) {
  try {
    await access(filePath)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Cannot resolve ${description} at "${filePath}": ${detail}`)
  }
}

async function assertDirectoryNotEmpty(directoryPath, description) {
  const entries = await readdir(directoryPath)

  if (entries.length === 0) {
    throw new Error(`Cannot resolve ${description} at "${directoryPath}": directory is empty`)
  }
}

async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'))
}

main().catch((error) => {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error)
  console.error('[bundled-runtime] Staging failed.')
  console.error(detail)
  process.exitCode = 1
})
