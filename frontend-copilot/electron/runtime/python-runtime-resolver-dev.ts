import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import {
  DESKTOP_RUNTIME_ENTRY_MODULE,
  type PythonRuntimeLaunchSpec,
  type PythonRuntimeResolverContext,
} from './python-runtime-resolver-shared'

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
    ?? getFallbackDevelopmentPythonLaunchCandidate()

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

export function assertDevelopmentPythonLaunchSpecResolved(spec: PythonRuntimeLaunchSpec): void {
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
  const fallbackCandidates = getFallbackDevelopmentPythonLaunchCandidates()
    .map((candidate) => candidate.args.length === 0
      ? candidate.command
      : `${candidate.command} ${candidate.args.join(' ')}`)
    .join(', ')

  throw new Error(
    `Cannot resolve a usable Python interpreter for the development desktop runtime. Checked project virtualenv candidates (${venvCandidates}) and fallback commands (${fallbackCandidates}).`,
  )
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

  for (const candidate of getFallbackDevelopmentPythonLaunchCandidates()) {
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

function getFallbackDevelopmentPythonLaunchCandidate(): DevelopmentPythonLaunchCandidate {
  return getFallbackDevelopmentPythonLaunchCandidates()[0]
}

function getFallbackDevelopmentPythonLaunchCandidates(): DevelopmentPythonLaunchCandidate[] {
  if (process.platform === 'win32') {
    return [
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
