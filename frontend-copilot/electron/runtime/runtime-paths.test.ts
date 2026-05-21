import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  createHostedRuntimePaths,
  DESKTOP_RUNTIME_CONFIG_DIR_NAME,
  DESKTOP_RUNTIME_DATABASE_DIR_NAME,
  DESKTOP_RUNTIME_LOGS_DIR_NAME,
  DESKTOP_RUNTIME_ROOT_DIR_NAME,
  DESKTOP_RUNTIME_STATE_DIR_NAME,
  getHostedRuntimeDirectoryList,
  sanitizeHostedRuntimePaths,
} from './runtime-paths'

function normalizeExpected(base: string, ...segments: string[]): string {
  return path.resolve(path.join(base, ...segments))
}

describe('createHostedRuntimePaths', () => {
  const userDataPathPosix = '/home/user/app-data'
  const userDataPathWindows = 'C:\\Users\\user\\AppData\\Roaming'

  it('resolves userDataDir to an absolute path', () => {
    const paths = createHostedRuntimePaths(userDataPathPosix)

    expect(path.isAbsolute(paths.userDataDir)).toBe(true)
    if (process.platform !== 'win32') {
      expect(paths.userDataDir).toBe(userDataPathPosix)
    }
  })

  it('places runtimeRootDir under userDataDir with the desktop-runtime name', () => {
    const paths = createHostedRuntimePaths(userDataPathPosix)

    expect(paths.runtimeRootDir).toBe(normalizeExpected(userDataPathPosix, DESKTOP_RUNTIME_ROOT_DIR_NAME))
  })

  it('places configDir under runtimeRootDir', () => {
    const paths = createHostedRuntimePaths(userDataPathPosix)

    expect(paths.configDir).toBe(normalizeExpected(userDataPathPosix, DESKTOP_RUNTIME_ROOT_DIR_NAME, DESKTOP_RUNTIME_CONFIG_DIR_NAME))
  })

  it('places logsDir under runtimeRootDir', () => {
    const paths = createHostedRuntimePaths(userDataPathPosix)

    expect(paths.logsDir).toBe(normalizeExpected(userDataPathPosix, DESKTOP_RUNTIME_ROOT_DIR_NAME, DESKTOP_RUNTIME_LOGS_DIR_NAME))
  })

  it('places databaseDir under runtimeRootDir', () => {
    const paths = createHostedRuntimePaths(userDataPathPosix)

    expect(paths.databaseDir).toBe(normalizeExpected(userDataPathPosix, DESKTOP_RUNTIME_ROOT_DIR_NAME, DESKTOP_RUNTIME_DATABASE_DIR_NAME))
  })

  it('places stateDir under runtimeRootDir', () => {
    const paths = createHostedRuntimePaths(userDataPathPosix)

    expect(paths.stateDir).toBe(normalizeExpected(userDataPathPosix, DESKTOP_RUNTIME_ROOT_DIR_NAME, DESKTOP_RUNTIME_STATE_DIR_NAME))
  })

  it('places copilotSettingsFile under configDir', () => {
    const paths = createHostedRuntimePaths(userDataPathPosix)

    expect(paths.copilotSettingsFile).toBe(path.join(paths.configDir, 'copilot-settings.json'))
  })

  it('places legacyCopilotSettingsFile under userDataDir', () => {
    const paths = createHostedRuntimePaths(userDataPathPosix)

    expect(paths.legacyCopilotSettingsFile).toBe(path.join(paths.userDataDir, 'copilot-settings.json'))
  })

  it('places hostLogFile under logsDir', () => {
    const paths = createHostedRuntimePaths(userDataPathPosix)

    expect(paths.hostLogFile).toBe(path.join(paths.logsDir, 'electron-host.log'))
  })

  it('places backend stdout stderr logs under logsDir', () => {
    const paths = createHostedRuntimePaths(userDataPathPosix)

    expect(paths.backendStdoutLogFile).toBe(path.join(paths.logsDir, 'backend.stdout.log'))
    expect(paths.backendStderrLogFile).toBe(path.join(paths.logsDir, 'backend.stderr.log'))
  })

  it('places snapshot and lastFailure files under stateDir', () => {
    const paths = createHostedRuntimePaths(userDataPathPosix)

    expect(paths.runtimeSnapshotFile).toBe(path.join(paths.stateDir, 'runtime-snapshot.json'))
    expect(paths.lastFailureFile).toBe(path.join(paths.stateDir, 'last-failure.json'))
  })

  it('works with Windows-style paths', () => {
    const paths = createHostedRuntimePaths(userDataPathWindows)

    expect(path.isAbsolute(paths.userDataDir)).toBe(true)
    expect(paths.runtimeRootDir).toBe(normalizeExpected(userDataPathWindows, DESKTOP_RUNTIME_ROOT_DIR_NAME))
    expect(paths.configDir).toBe(normalizeExpected(userDataPathWindows, DESKTOP_RUNTIME_ROOT_DIR_NAME, DESKTOP_RUNTIME_CONFIG_DIR_NAME))
    expect(paths.logsDir).toBe(normalizeExpected(userDataPathWindows, DESKTOP_RUNTIME_ROOT_DIR_NAME, DESKTOP_RUNTIME_LOGS_DIR_NAME))
  })

  it('resolves relative userDataPath to an absolute path', () => {
    const paths = createHostedRuntimePaths('relative/path')

    expect(path.isAbsolute(paths.userDataDir)).toBe(true)
    expect(paths.userDataDir).toContain('relative')
    expect(paths.userDataDir).toContain('path')
  })
})

describe('getHostedRuntimeDirectoryList', () => {
  it('returns all six directory paths in a consistent order', () => {
    const paths = createHostedRuntimePaths('/tmp/test')
    const dirs = getHostedRuntimeDirectoryList(paths)

    expect(dirs).toHaveLength(6)
    expect(dirs).toEqual([
      paths.userDataDir,
      paths.runtimeRootDir,
      paths.configDir,
      paths.logsDir,
      paths.databaseDir,
      paths.stateDir,
    ])
  })
})

describe('sanitizeHostedRuntimePaths', () => {
  it('returns a structurally identical copy with all the same paths', () => {
    const paths = createHostedRuntimePaths('/tmp/test')
    const sanitized = sanitizeHostedRuntimePaths(paths)

    expect(sanitized.userDataDir).toBe(paths.userDataDir)
    expect(sanitized.runtimeRootDir).toBe(paths.runtimeRootDir)
    expect(sanitized.configDir).toBe(paths.configDir)
    expect(sanitized.logsDir).toBe(paths.logsDir)
    expect(sanitized.databaseDir).toBe(paths.databaseDir)
    expect(sanitized.stateDir).toBe(paths.stateDir)
    expect(sanitized.copilotSettingsFile).toBe(paths.copilotSettingsFile)
    expect(sanitized.legacyCopilotSettingsFile).toBe(paths.legacyCopilotSettingsFile)
    expect(sanitized.hostLogFile).toBe(paths.hostLogFile)
    expect(sanitized.backendStdoutLogFile).toBe(paths.backendStdoutLogFile)
    expect(sanitized.backendStderrLogFile).toBe(paths.backendStderrLogFile)
    expect(sanitized.runtimeSnapshotFile).toBe(paths.runtimeSnapshotFile)
    expect(sanitized.lastFailureFile).toBe(paths.lastFailureFile)
  })
})
