import path from 'node:path'
import type { HostedRuntimePaths } from '../runtime/runtime-paths'

export const DESKTOP_CAPABILITY_ARTIFACTS_DIR_NAME = 'artifacts'
export const DESKTOP_CAPABILITY_ARTIFACT_INDEX_FILE_NAME = 'capability-bridge-artifacts.json'
export const DESKTOP_CAPABILITY_STATE_FILE_NAME = 'capability-bridge-state.json'

export interface DesktopCapabilityBridgePaths {
  workspaceRootDir: string
  artifactsDir: string
  artifactIndexFile: string
  stateFile: string
}

export function createDesktopCapabilityBridgePaths(
  hostedPaths: Pick<HostedRuntimePaths, 'runtimeRootDir' | 'stateDir'>,
): DesktopCapabilityBridgePaths {
  return {
    workspaceRootDir: hostedPaths.runtimeRootDir,
    artifactsDir: path.join(hostedPaths.runtimeRootDir, DESKTOP_CAPABILITY_ARTIFACTS_DIR_NAME),
    artifactIndexFile: path.join(hostedPaths.stateDir, DESKTOP_CAPABILITY_ARTIFACT_INDEX_FILE_NAME),
    stateFile: path.join(hostedPaths.stateDir, DESKTOP_CAPABILITY_STATE_FILE_NAME),
  }
}
