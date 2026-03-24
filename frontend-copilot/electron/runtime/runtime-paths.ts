import { mkdir } from 'node:fs/promises'
import path from 'node:path'

export const DESKTOP_RUNTIME_ROOT_DIR_NAME = 'desktop-runtime'
export const DESKTOP_RUNTIME_CONFIG_DIR_NAME = 'config'
export const DESKTOP_RUNTIME_LOGS_DIR_NAME = 'logs'
export const DESKTOP_RUNTIME_DATABASE_DIR_NAME = 'database'
export const DESKTOP_RUNTIME_STATE_DIR_NAME = 'state'

export const COPILOT_SETTINGS_FILE_NAME = 'copilot-settings.json'
export const HOST_RUNTIME_LOG_FILE_NAME = 'electron-host.log'
export const BACKEND_STDOUT_LOG_FILE_NAME = 'backend.stdout.log'
export const BACKEND_STDERR_LOG_FILE_NAME = 'backend.stderr.log'
export const RUNTIME_SNAPSHOT_FILE_NAME = 'runtime-snapshot.json'
export const LAST_FAILURE_FILE_NAME = 'last-failure.json'

export interface HostedRuntimePaths {
  userDataDir: string
  runtimeRootDir: string
  configDir: string
  logsDir: string
  databaseDir: string
  stateDir: string
  copilotSettingsFile: string
  legacyCopilotSettingsFile: string
  hostLogFile: string
  backendStdoutLogFile: string
  backendStderrLogFile: string
  runtimeSnapshotFile: string
  lastFailureFile: string
}

export interface SanitizedHostedRuntimePaths {
  userDataDir: string
  runtimeRootDir: string
  configDir: string
  logsDir: string
  databaseDir: string
  stateDir: string
  copilotSettingsFile: string
  legacyCopilotSettingsFile: string
  hostLogFile: string
  backendStdoutLogFile: string
  backendStderrLogFile: string
  runtimeSnapshotFile: string
  lastFailureFile: string
}

export function createHostedRuntimePaths(userDataPath: string): HostedRuntimePaths {
  const userDataDir = path.resolve(userDataPath)
  const runtimeRootDir = path.join(userDataDir, DESKTOP_RUNTIME_ROOT_DIR_NAME)
  const configDir = path.join(runtimeRootDir, DESKTOP_RUNTIME_CONFIG_DIR_NAME)
  const logsDir = path.join(runtimeRootDir, DESKTOP_RUNTIME_LOGS_DIR_NAME)
  const databaseDir = path.join(runtimeRootDir, DESKTOP_RUNTIME_DATABASE_DIR_NAME)
  const stateDir = path.join(runtimeRootDir, DESKTOP_RUNTIME_STATE_DIR_NAME)

  return {
    userDataDir,
    runtimeRootDir,
    configDir,
    logsDir,
    databaseDir,
    stateDir,
    copilotSettingsFile: path.join(configDir, COPILOT_SETTINGS_FILE_NAME),
    legacyCopilotSettingsFile: path.join(userDataDir, COPILOT_SETTINGS_FILE_NAME),
    hostLogFile: path.join(logsDir, HOST_RUNTIME_LOG_FILE_NAME),
    backendStdoutLogFile: path.join(logsDir, BACKEND_STDOUT_LOG_FILE_NAME),
    backendStderrLogFile: path.join(logsDir, BACKEND_STDERR_LOG_FILE_NAME),
    runtimeSnapshotFile: path.join(stateDir, RUNTIME_SNAPSHOT_FILE_NAME),
    lastFailureFile: path.join(stateDir, LAST_FAILURE_FILE_NAME),
  }
}

export async function ensureHostedRuntimeDirectories(paths: HostedRuntimePaths): Promise<void> {
  await Promise.all(
    getHostedRuntimeDirectoryList(paths).map((directoryPath) => mkdir(directoryPath, { recursive: true })),
  )
}

export function getHostedRuntimeDirectoryList(paths: HostedRuntimePaths): string[] {
  return [
    paths.userDataDir,
    paths.runtimeRootDir,
    paths.configDir,
    paths.logsDir,
    paths.databaseDir,
    paths.stateDir,
  ]
}

export function sanitizeHostedRuntimePaths(paths: HostedRuntimePaths): SanitizedHostedRuntimePaths {
  return {
    userDataDir: paths.userDataDir,
    runtimeRootDir: paths.runtimeRootDir,
    configDir: paths.configDir,
    logsDir: paths.logsDir,
    databaseDir: paths.databaseDir,
    stateDir: paths.stateDir,
    copilotSettingsFile: paths.copilotSettingsFile,
    legacyCopilotSettingsFile: paths.legacyCopilotSettingsFile,
    hostLogFile: paths.hostLogFile,
    backendStdoutLogFile: paths.backendStdoutLogFile,
    backendStderrLogFile: paths.backendStderrLogFile,
    runtimeSnapshotFile: paths.runtimeSnapshotFile,
    lastFailureFile: paths.lastFailureFile,
  }
}
