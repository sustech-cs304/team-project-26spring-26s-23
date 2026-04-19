import { access, readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const FRONTEND_ROOT = path.resolve(__dirname, '..')

const STAGING_ROOT = path.join(FRONTEND_ROOT, '.bundled-runtime', 'staging')
const RELEASE_ROOT = path.join(FRONTEND_ROOT, 'release')

const MANIFEST_FILE_NAME = 'backend-runtime-manifest.json'
const EXPECTED_ENTRY_MODULE = 'app.desktop_runtime'

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const runtimeRoot = options.mode === 'staging'
    ? path.resolve(process.cwd(), options.input ?? STAGING_ROOT)
    : await resolveUnpackedRuntimeRoot(options)

  const result = await verifyRuntimeRoot({
    mode: options.mode,
    runtimeRoot,
  })

  console.log(JSON.stringify(result, null, 2))

  if (result.missingItems.length > 0) {
    throw new Error(`Bundled runtime verification failed with ${result.missingItems.length} missing or invalid item(s).`)
  }
}

function parseArguments(argv) {
  const options = {
    mode: null,
    input: null,
    searchRoot: null,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]

    switch (argument) {
      case '--mode':
        options.mode = argv[index + 1] ?? null
        index += 1
        break
      case '--input':
        options.input = argv[index + 1] ?? null
        index += 1
        break
      case '--search-root':
        options.searchRoot = argv[index + 1] ?? null
        index += 1
        break
      default:
        throw new Error(`Unknown argument: ${argument}`)
    }
  }

  if (options.mode !== 'staging' && options.mode !== 'unpacked') {
    throw new Error('Expected --mode staging or --mode unpacked.')
  }

  return options
}

async function resolveUnpackedRuntimeRoot(options) {
  const searchRoot = path.resolve(process.cwd(), options.input ?? options.searchRoot ?? RELEASE_ROOT)
  const runtimeRoots = await findBundledRuntimeRoots(searchRoot)

  if (runtimeRoots.length === 0) {
    throw new Error(`Cannot locate an unpacked bundled runtime beneath "${searchRoot}".`)
  }

  if (runtimeRoots.length > 1) {
    throw new Error(
      `Expected exactly one unpacked bundled runtime beneath "${searchRoot}", but found ${runtimeRoots.length}:\n${runtimeRoots.join('\n')}`,
    )
  }

  return runtimeRoots[0]
}

async function findBundledRuntimeRoots(searchRoot) {
  const resolvedRoot = path.resolve(searchRoot)
  const candidates = []

  await walkDirectories(resolvedRoot, async (directoryPath, directoryEntry) => {
    if (directoryEntry.name !== 'python-runtime') {
      return
    }

    const manifestPath = path.join(directoryPath, MANIFEST_FILE_NAME)
    if (await pathExists(manifestPath)) {
      candidates.push(directoryPath)
    }
  })

  if (path.basename(resolvedRoot) === 'python-runtime' && await pathExists(path.join(resolvedRoot, MANIFEST_FILE_NAME))) {
    candidates.unshift(resolvedRoot)
  }

  return uniquePaths(candidates)
}

async function walkDirectories(rootDirectory, visit) {
  const entries = await readdir(rootDirectory, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }

    if (entry.name === '.git' || entry.name === 'node_modules') {
      continue
    }

    const absolutePath = path.join(rootDirectory, entry.name)
    await visit(absolutePath, entry)
    await walkDirectories(absolutePath, visit)
  }
}

async function verifyRuntimeRoot(input) {
  const { mode, runtimeRoot } = input
  const manifestPath = path.join(runtimeRoot, MANIFEST_FILE_NAME)
  const result = {
    mode,
    runtimeRoot,
    manifestPath,
    pythonRuntimeRootPath: null,
    pythonExecutablePath: null,
    backendWorkingDirectory: null,
    requirementsPath: null,
    manifestEntryModule: null,
    pythonVersion: null,
    pythonPathEntries: [],
    sitePackagesEntries: [],
    missingItems: [],
  }

  if (!await pathExists(runtimeRoot)) {
    result.missingItems.push(`Bundled runtime root is missing: ${runtimeRoot}`)
    return result
  }

  if (!await pathExists(manifestPath)) {
    result.missingItems.push(`Bundled runtime manifest is missing: ${manifestPath}`)
    return result
  }

  let manifest
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  } catch (error) {
    result.missingItems.push(`Bundled runtime manifest is not valid JSON: ${formatError(error)}`)
    return result
  }

  result.manifestEntryModule = readOptionalString(manifest?.backend?.entryModule)
  result.pythonVersion = readOptionalString(manifest?.python?.version)

  result.pythonRuntimeRootPath = await resolveAndValidateManifestPath({
    runtimeRoot,
    relativePath: manifest?.python?.runtimeRootRelativePath,
    description: 'Python runtime root',
    missingItems: result.missingItems,
  })

  result.pythonExecutablePath = await resolveAndValidateManifestPath({
    runtimeRoot,
    relativePath: manifest?.python?.executableRelativePath,
    description: 'Python executable',
    missingItems: result.missingItems,
  })

  result.backendWorkingDirectory = await resolveAndValidateManifestPath({
    runtimeRoot,
    relativePath: manifest?.backend?.workingDirectoryRelativePath,
    description: 'backend working directory',
    missingItems: result.missingItems,
  })

  result.requirementsPath = await resolveAndValidateManifestPath({
    runtimeRoot,
    relativePath: manifest?.metadata?.requirementsRelativePath,
    description: 'exported backend requirements file',
    missingItems: result.missingItems,
  })

  if (result.manifestEntryModule !== EXPECTED_ENTRY_MODULE) {
    result.missingItems.push(
      `Bundled runtime manifest entry module must remain "${EXPECTED_ENTRY_MODULE}", received "${result.manifestEntryModule ?? 'null'}".`,
    )
  }

  const pythonPathRelativePaths = readRelativePathArray(manifest?.backend?.pythonPathRelativePaths, 'backend.pythonPathRelativePaths', result.missingItems)
  const sitePackagesRelativePaths = readRelativePathArray(manifest?.backend?.sitePackagesRelativePaths, 'backend.sitePackagesRelativePaths', result.missingItems)

  result.pythonPathEntries = await Promise.all(pythonPathRelativePaths.map((relativePath) => resolveAndValidateManifestPath({
    runtimeRoot,
    relativePath,
    description: `bundled PYTHONPATH entry "${relativePath}"`,
    missingItems: result.missingItems,
  })))

  result.sitePackagesEntries = await Promise.all(sitePackagesRelativePaths.map((relativePath) => resolveAndValidateManifestPath({
    runtimeRoot,
    relativePath,
    description: `bundled site-packages entry "${relativePath}"`,
    missingItems: result.missingItems,
  })))

  if (result.backendWorkingDirectory !== null) {
    const entryModulePath = path.join(result.backendWorkingDirectory, 'app', 'desktop_runtime', '__main__.py')
    if (!await pathExists(entryModulePath)) {
      result.missingItems.push(`Bundled backend entry module is missing: ${entryModulePath}`)
    }
  }

  return result
}

async function resolveAndValidateManifestPath(input) {
  const { runtimeRoot, relativePath, description, missingItems } = input
  const normalizedPath = readOptionalString(relativePath)

  if (normalizedPath === null) {
    missingItems.push(`Bundled runtime manifest ${description} must be a non-empty relative path.`)
    return null
  }

  if (path.isAbsolute(normalizedPath)) {
    missingItems.push(`Bundled runtime manifest ${description} must stay relative to the runtime root: "${normalizedPath}".`)
    return null
  }

  const resolvedPath = path.resolve(runtimeRoot, normalizedPath)
  const relativeToRoot = path.relative(runtimeRoot, resolvedPath)

  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    missingItems.push(`Bundled runtime manifest ${description} escapes the runtime root: "${normalizedPath}".`)
    return null
  }

  if (!await pathExists(resolvedPath)) {
    missingItems.push(`Cannot resolve ${description} at "${resolvedPath}".`)
    return resolvedPath
  }

  return resolvedPath
}

function readRelativePathArray(value, description, missingItems) {
  if (!Array.isArray(value) || value.length === 0) {
    missingItems.push(`Bundled runtime manifest ${description} must be a non-empty array of relative paths.`)
    return []
  }

  const paths = []

  for (const entry of value) {
    const normalizedEntry = readOptionalString(entry)
    if (normalizedEntry === null) {
      missingItems.push(`Bundled runtime manifest ${description} contains an empty entry.`)
      continue
    }

    paths.push(normalizedEntry)
  }

  return paths
}

function readOptionalString(value) {
  if (typeof value !== 'string') {
    return null
  }

  const normalizedValue = value.trim()
  return normalizedValue === '' ? null : normalizedValue
}

async function pathExists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function uniquePaths(paths) {
  return [...new Set(paths)]
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error)
}

main().catch((error) => {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error)
  console.error('[bundled-runtime-verify] Verification failed.')
  console.error(detail)
  process.exitCode = 1
})
