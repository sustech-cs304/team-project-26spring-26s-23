import path from 'node:path'
import type { HostedRuntimePaths } from '../runtime/runtime-paths'
import { createUnifiedConfigCenterPaths } from '../config-center/paths'

export const SETTINGS_WORKSPACE_STATE_FILE_NAME = 'settings-workspace-state.json'
export const SETTINGS_WORKSPACE_SECRETS_FILE_NAME = 'settings-workspace-secrets.json'

export interface SettingsWorkspacePaths {
  rootDir: string
  stateDocument: string
  secretsDocument: string
}

export function createSettingsWorkspacePaths(
  hostedPaths: Pick<HostedRuntimePaths, 'configDir' | 'copilotSettingsFile' | 'legacyCopilotSettingsFile'>,
): SettingsWorkspacePaths {
  const configCenterPaths = createUnifiedConfigCenterPaths(hostedPaths)

  return {
    rootDir: configCenterPaths.rootDir,
    stateDocument: path.join(configCenterPaths.rootDir, SETTINGS_WORKSPACE_STATE_FILE_NAME),
    secretsDocument: path.join(configCenterPaths.rootDir, SETTINGS_WORKSPACE_SECRETS_FILE_NAME),
  }
}
