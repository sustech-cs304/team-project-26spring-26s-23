import path from 'node:path'
import {
  assertDevelopmentPythonLaunchSpecResolved,
  buildDevelopmentPythonRuntimeLaunchSpec,
} from './python-runtime-resolver-dev'
import { buildBundledPythonRuntimeLaunchSpec, buildBundledPythonRuntimePlaceholder } from './python-runtime-resolver-bundled'
import {
  assertPathExists,
  BUNDLED_RUNTIME_DIRECTORY_NAME,
  BUNDLED_RUNTIME_MANIFEST_FILE_NAME,
  DESKTOP_RUNTIME_ENTRY_MODULE,
  type BundledPythonRuntimeManifest,
  type BundledPythonRuntimePlaceholder,
  type PythonRuntimeLaunchSpec,
  type PythonRuntimeMode,
  type PythonRuntimeResolverContext,
} from './python-runtime-resolver-shared'
import { readBundledPythonRuntimeManifest } from './python-runtime-manifest'

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

export {
  BUNDLED_RUNTIME_DIRECTORY_NAME,
  BUNDLED_RUNTIME_MANIFEST_FILE_NAME,
  buildBundledPythonRuntimePlaceholder,
  buildDevelopmentPythonRuntimeLaunchSpec,
  DESKTOP_RUNTIME_ENTRY_MODULE,
  readBundledPythonRuntimeManifest,
}

export type {
  BundledPythonRuntimeManifest,
  BundledPythonRuntimePlaceholder,
  PythonRuntimeLaunchSpec,
  PythonRuntimeMode,
  PythonRuntimeResolverContext,
}
