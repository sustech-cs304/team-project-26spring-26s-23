import {
  HOSTED_RUNTIME_CHILD_ENV_NAMES_TO_STRIP,
  HOSTED_RUNTIME_OVERRIDE_ENV_NAMES,
} from './runtime-config-flags'
import {
  normalizeOptionalString,
  parseIntegerOverride,
  stripEnvironmentKeys,
} from './runtime-config-support'

export interface HostedRuntimeEnvironmentOverrides {
  host?: string
  environment?: string
  startupTimeoutMs?: number
  shutdownTimeoutMs?: number
  healthcheckIntervalMs?: number
  healthcheckRequestTimeoutMs?: number
}

export function resolveHostedRuntimeEnvironmentOverrides(
  processEnv: NodeJS.ProcessEnv,
): HostedRuntimeEnvironmentOverrides {
  return {
    host: normalizeOptionalString(processEnv[HOSTED_RUNTIME_OVERRIDE_ENV_NAMES.HOST]),
    environment: normalizeOptionalString(processEnv[HOSTED_RUNTIME_OVERRIDE_ENV_NAMES.ENVIRONMENT]),
    startupTimeoutMs: parseIntegerOverride(processEnv[HOSTED_RUNTIME_OVERRIDE_ENV_NAMES.STARTUP_TIMEOUT_MS]),
    shutdownTimeoutMs: parseIntegerOverride(processEnv[HOSTED_RUNTIME_OVERRIDE_ENV_NAMES.SHUTDOWN_TIMEOUT_MS]),
    healthcheckIntervalMs: parseIntegerOverride(processEnv[HOSTED_RUNTIME_OVERRIDE_ENV_NAMES.HEALTHCHECK_INTERVAL_MS]),
    healthcheckRequestTimeoutMs: parseIntegerOverride(processEnv[HOSTED_RUNTIME_OVERRIDE_ENV_NAMES.HEALTHCHECK_REQUEST_TIMEOUT_MS]),
  }
}

export function buildDesktopRuntimeEnvironment(
  baseEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...stripEnvironmentKeys(baseEnv, HOSTED_RUNTIME_CHILD_ENV_NAMES_TO_STRIP),
    PYTHONUNBUFFERED: '1',
  }
}
