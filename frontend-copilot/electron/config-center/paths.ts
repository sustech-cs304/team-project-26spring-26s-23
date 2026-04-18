import path from 'node:path'
import type { HostedRuntimePaths } from '../runtime/runtime-paths'
import {
  UNIFIED_CONFIG_DOMAIN_DEFINITIONS,
  UNIFIED_CONFIG_DOMAIN_KEYS,
  type UnifiedConfigDomainKey,
} from './domain-schema'

export const UNIFIED_CONFIG_CENTER_DIR_NAME = 'config-center'

export interface UnifiedConfigCenterPaths {
  rootDir: string
  documents: { [TDomain in UnifiedConfigDomainKey]: string }
  legacySettingsFiles: readonly string[]
}

export function createUnifiedConfigCenterPaths(
  hostedPaths: Pick<HostedRuntimePaths, 'configDir' | 'copilotSettingsFile' | 'legacyCopilotSettingsFile'>,
): UnifiedConfigCenterPaths {
  const rootDir = path.join(hostedPaths.configDir, UNIFIED_CONFIG_CENTER_DIR_NAME)

  return {
    rootDir,
    documents: {
      [UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES]: path.join(
        rootDir,
        UNIFIED_CONFIG_DOMAIN_DEFINITIONS[UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES].fileName,
      ),
      [UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR]: path.join(
        rootDir,
        UNIFIED_CONFIG_DOMAIN_DEFINITIONS[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR].fileName,
      ),
      [UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG]: path.join(
        rootDir,
        UNIFIED_CONFIG_DOMAIN_DEFINITIONS[UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG].fileName,
      ),
      [UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED]: path.join(
        rootDir,
        UNIFIED_CONFIG_DOMAIN_DEFINITIONS[UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED].fileName,
      ),
      [UNIFIED_CONFIG_DOMAIN_KEYS.GENERAL]: path.join(
        rootDir,
        UNIFIED_CONFIG_DOMAIN_DEFINITIONS[UNIFIED_CONFIG_DOMAIN_KEYS.GENERAL].fileName,
      ),
    },
    legacySettingsFiles: [
      hostedPaths.copilotSettingsFile,
      hostedPaths.legacyCopilotSettingsFile,
    ],
  }
}
