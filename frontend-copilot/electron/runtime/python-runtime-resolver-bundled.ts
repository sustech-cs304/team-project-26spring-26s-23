import path from 'node:path'
import { readBundledPythonRuntimeManifest } from './python-runtime-manifest'
import { resolveBundledRuntimeRelativePath } from './python-runtime-path-security'
import {
  assertPathExists,
  BUNDLED_RUNTIME_DIRECTORY_NAME,
  BUNDLED_RUNTIME_MANIFEST_FILE_NAME,
  type BundledPythonRuntimePlaceholder,
  type PythonRuntimeLaunchSpec,
  type PythonRuntimeResolverContext,
} from './python-runtime-resolver-shared'

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

export async function buildBundledPythonRuntimeLaunchSpec(
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
