import path from 'node:path'

import type {
  ManagedRuntimeFamily,
  ManagedRuntimeFamilySnapshot,
  ManagedRuntimeLauncherName,
  ManagedRuntimeLauncherResolution,
  ManagedRuntimeLauncherResolutionFailure,
  ManagedRuntimeLauncherResolutionSuccess,
  ManagedRuntimeSnapshot,
} from './types'

const MANAGED_LAUNCHER_FAMILY: Record<string, ManagedRuntimeFamily> = {
  npx: 'node',
  uvx: 'uv',
}

export function resolveManagedRuntimeLauncher(
  snapshot: ManagedRuntimeSnapshot,
  command: string,
): ManagedRuntimeLauncherResolution {
  if (path.isAbsolute(command.trim())) {
    return {
      ok: false,
      reason: 'unmanaged_command',
      command,
    }
  }

  const normalizedCommand = normalizeLauncherCommand(command)
  const family = MANAGED_LAUNCHER_FAMILY[normalizedCommand]
  if (family === undefined) {
    return {
      ok: false,
      reason: 'unmanaged_command',
      command,
    }
  }

  const managedLauncher = normalizedCommand as ManagedRuntimeLauncherName

  const familySnapshot = snapshot.families[family]
  const launcherPath = familySnapshot.launcherPaths[managedLauncher]
  if (familySnapshot.status !== 'ready' || typeof launcherPath !== 'string' || launcherPath.trim() === '') {
    return createUnavailableResolution(command, managedLauncher, family, familySnapshot)
  }

  return {
    ok: true,
    command,
    normalizedCommand: managedLauncher,
    family,
    executablePath: launcherPath,
    windowsCommandChain: resolveWindowsCommandChain(launcherPath),
  }
}

function createUnavailableResolution(
  command: string,
  normalizedCommand: ManagedRuntimeLauncherName,
  family: ManagedRuntimeFamily,
  familySnapshot: ManagedRuntimeFamilySnapshot,
): ManagedRuntimeLauncherResolutionFailure {
  const action = familySnapshot.status === 'broken' ? 'repair' : 'install'
  const displayName = family === 'node' ? 'Node/npm' : 'Python/uv'
  return {
    ok: false,
    reason: 'managed_runtime_unavailable',
    command,
    normalizedCommand,
    family,
    status: familySnapshot.status,
    message: `The managed ${displayName} runtime is ${familySnapshot.status}; ${action} is required before MCP can run ${normalizedCommand}.`,
    detail: familySnapshot.lastErrorSummary?.message
      ?? `Managed runtime family ${family} is not ready for launcher ${normalizedCommand}.`,
  }
}

function resolveWindowsCommandChain(launcherPath: string): ManagedRuntimeLauncherResolutionSuccess['windowsCommandChain'] {
  const extension = path.extname(launcherPath).toLowerCase()
  if (process.platform === 'win32' && extension === '.cmd') {
    return {
      command: process.env.ComSpec ?? 'cmd.exe',
      argsPrefix: ['/d', '/s', '/c', launcherPath],
    }
  }

  return null
}

function normalizeLauncherCommand(command: string): ManagedRuntimeLauncherName | string {
  return path.basename(command.trim()).toLowerCase().replace(/\.(cmd|exe)$/u, '')
}
