import { access } from 'node:fs/promises'

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

export async function assertPathExists(filePath: string, description: string): Promise<void> {
  try {
    await access(filePath)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Cannot resolve ${description} at "${filePath}": ${detail}`)
  }
}
