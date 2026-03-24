import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import {
  createHostedRuntimePaths,
  sanitizeHostedRuntimePaths,
  type HostedRuntimePaths,
  type SanitizedHostedRuntimePaths,
} from './runtime-paths'

export const DEFAULT_RUNTIME_HOST = '127.0.0.1'
export const DEFAULT_RUNTIME_APP_MODE = 'desktop'
export const DEFAULT_RUNTIME_ENVIRONMENT = 'development'
export const DEFAULT_STARTUP_TIMEOUT_MS = 30_000
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000
export const DEFAULT_HEALTHCHECK_INTERVAL_MS = 300
export const DEFAULT_HEALTHCHECK_REQUEST_TIMEOUT_MS = 1_500

export const DESKTOP_RUNTIME_ENV_NAMES = {
  HOST: 'COPILOT_DESKTOP_RUNTIME_HOST',
  PORT: 'COPILOT_DESKTOP_RUNTIME_PORT',
  LOCAL_TOKEN: 'COPILOT_DESKTOP_RUNTIME_LOCAL_TOKEN',
  USER_DATA_DIR: 'COPILOT_DESKTOP_RUNTIME_USER_DATA_DIR',
  ROOT_DIR: 'COPILOT_DESKTOP_RUNTIME_ROOT_DIR',
  CONFIG_DIR: 'COPILOT_DESKTOP_RUNTIME_CONFIG_DIR',
  LOGS_DIR: 'COPILOT_DESKTOP_RUNTIME_LOGS_DIR',
  DATABASE_DIR: 'COPILOT_DESKTOP_RUNTIME_DATABASE_DIR',
  STATE_DIR: 'COPILOT_DESKTOP_RUNTIME_STATE_DIR',
  COPILOT_SETTINGS_FILE: 'COPILOT_DESKTOP_RUNTIME_SETTINGS_FILE',
  HOST_LOG_FILE: 'COPILOT_DESKTOP_RUNTIME_HOST_LOG_FILE',
  BACKEND_STDOUT_LOG_FILE: 'COPILOT_DESKTOP_RUNTIME_BACKEND_STDOUT_LOG_FILE',
  BACKEND_STDERR_LOG_FILE: 'COPILOT_DESKTOP_RUNTIME_BACKEND_STDERR_LOG_FILE',
  RUNTIME_SNAPSHOT_FILE: 'COPILOT_DESKTOP_RUNTIME_SNAPSHOT_FILE',
  LAST_FAILURE_FILE: 'COPILOT_DESKTOP_RUNTIME_LAST_FAILURE_FILE',
  APP_MODE: 'COPILOT_DESKTOP_RUNTIME_APP_MODE',
  ENVIRONMENT: 'COPILOT_DESKTOP_RUNTIME_ENVIRONMENT',
} as const

export const HOSTED_RUNTIME_OVERRIDE_ENV_NAMES = {
  HOST: DESKTOP_RUNTIME_ENV_NAMES.HOST,
  ENVIRONMENT: DESKTOP_RUNTIME_ENV_NAMES.ENVIRONMENT,
  STARTUP_TIMEOUT_MS: 'COPILOT_DESKTOP_RUNTIME_STARTUP_TIMEOUT_MS',
  SHUTDOWN_TIMEOUT_MS: 'COPILOT_DESKTOP_RUNTIME_SHUTDOWN_TIMEOUT_MS',
  HEALTHCHECK_INTERVAL_MS: 'COPILOT_DESKTOP_RUNTIME_HEALTHCHECK_INTERVAL_MS',
  HEALTHCHECK_REQUEST_TIMEOUT_MS: 'COPILOT_DESKTOP_RUNTIME_HEALTHCHECK_REQUEST_TIMEOUT_MS',
} as const

export interface HostedRuntimeEnvironmentOverrides {
  host?: string
  environment?: string
  startupTimeoutMs?: number
  shutdownTimeoutMs?: number
  healthcheckIntervalMs?: number
  healthcheckRequestTimeoutMs?: number
}

export interface HostedRuntimeLaunchConfig {
  host: string
  port: number
  localToken: string
  baseUrl: string
  readyUrl: string
  healthUrl: string
  diagnosticsUrl: string
  appMode: string
  environment: string
  paths: HostedRuntimePaths
  env: NodeJS.ProcessEnv
}

export interface SanitizedHostedRuntimeLaunchConfig {
  host: string
  port: number
  baseUrl: string
  readyUrl: string
  healthUrl: string
  diagnosticsUrl: string
  appMode: string
  environment: string
  localTokenConfigured: boolean
  paths: SanitizedHostedRuntimePaths
}

export interface HostedRuntimeLaunchConfigOptions {
  userDataPath: string
  processEnv: NodeJS.ProcessEnv
  port: number
  host?: string
  localToken?: string
  appMode?: string
  environment?: string
  paths?: HostedRuntimePaths
}

export function createLocalToken(): string {
  return randomBytes(24).toString('hex')
}

export function formatRuntimeBaseUrl(host: string, port: number): string {
  return `http://${host}:${port}`
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
  input: {
    host: string
    port: number
    localToken: string
    appMode: string
    environment: string
    paths: HostedRuntimePaths
  },
): NodeJS.ProcessEnv {
  return {
    ...baseEnv,
    PYTHONUNBUFFERED: '1',
    [DESKTOP_RUNTIME_ENV_NAMES.HOST]: input.host,
    [DESKTOP_RUNTIME_ENV_NAMES.PORT]: String(input.port),
    [DESKTOP_RUNTIME_ENV_NAMES.LOCAL_TOKEN]: input.localToken,
    [DESKTOP_RUNTIME_ENV_NAMES.USER_DATA_DIR]: input.paths.userDataDir,
    [DESKTOP_RUNTIME_ENV_NAMES.ROOT_DIR]: input.paths.runtimeRootDir,
    [DESKTOP_RUNTIME_ENV_NAMES.CONFIG_DIR]: input.paths.configDir,
    [DESKTOP_RUNTIME_ENV_NAMES.LOGS_DIR]: input.paths.logsDir,
    [DESKTOP_RUNTIME_ENV_NAMES.DATABASE_DIR]: input.paths.databaseDir,
    [DESKTOP_RUNTIME_ENV_NAMES.STATE_DIR]: input.paths.stateDir,
    [DESKTOP_RUNTIME_ENV_NAMES.COPILOT_SETTINGS_FILE]: input.paths.copilotSettingsFile,
    [DESKTOP_RUNTIME_ENV_NAMES.HOST_LOG_FILE]: input.paths.hostLogFile,
    [DESKTOP_RUNTIME_ENV_NAMES.BACKEND_STDOUT_LOG_FILE]: input.paths.backendStdoutLogFile,
    [DESKTOP_RUNTIME_ENV_NAMES.BACKEND_STDERR_LOG_FILE]: input.paths.backendStderrLogFile,
    [DESKTOP_RUNTIME_ENV_NAMES.RUNTIME_SNAPSHOT_FILE]: input.paths.runtimeSnapshotFile,
    [DESKTOP_RUNTIME_ENV_NAMES.LAST_FAILURE_FILE]: input.paths.lastFailureFile,
    [DESKTOP_RUNTIME_ENV_NAMES.APP_MODE]: input.appMode,
    [DESKTOP_RUNTIME_ENV_NAMES.ENVIRONMENT]: input.environment,
  }
}

export function createHostedRuntimeLaunchConfig(
  options: HostedRuntimeLaunchConfigOptions,
): HostedRuntimeLaunchConfig {
  const host = options.host ?? DEFAULT_RUNTIME_HOST
  const localToken = options.localToken ?? createLocalToken()
  const appMode = options.appMode ?? DEFAULT_RUNTIME_APP_MODE
  const environment = options.environment ?? DEFAULT_RUNTIME_ENVIRONMENT
  const paths = options.paths ?? createHostedRuntimePaths(options.userDataPath)
  const baseUrl = formatRuntimeBaseUrl(host, options.port)

  return {
    host,
    port: options.port,
    localToken,
    baseUrl,
    readyUrl: `${baseUrl}/ready`,
    healthUrl: `${baseUrl}/health`,
    diagnosticsUrl: `${baseUrl}/diagnostics`,
    appMode,
    environment,
    paths,
    env: buildDesktopRuntimeEnvironment(options.processEnv, {
      host,
      port: options.port,
      localToken,
      appMode,
      environment,
      paths,
    }),
  }
}

export function sanitizeHostedRuntimeLaunchConfig(
  config: HostedRuntimeLaunchConfig,
): SanitizedHostedRuntimeLaunchConfig {
  return {
    host: config.host,
    port: config.port,
    baseUrl: config.baseUrl,
    readyUrl: config.readyUrl,
    healthUrl: config.healthUrl,
    diagnosticsUrl: config.diagnosticsUrl,
    appMode: config.appMode,
    environment: config.environment,
    localTokenConfigured: config.localToken.trim() !== '',
    paths: sanitizeHostedRuntimePaths(config.paths),
  }
}

export async function allocateLoopbackPort(host = DEFAULT_RUNTIME_HOST): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.unref()

    server.once('error', (error) => {
      reject(error)
    })

    server.listen(0, host, () => {
      const address = server.address()

      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('Failed to allocate a loopback port for the desktop runtime.'))
        return
      }

      server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve(address.port)
      })
    })
  })
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalizedValue = value.trim()
  return normalizedValue === '' ? undefined : normalizedValue
}

function parseIntegerOverride(value: string | undefined): number | undefined {
  const normalizedValue = normalizeOptionalString(value)
  if (normalizedValue === undefined) {
    return undefined
  }

  const parsedValue = Number.parseInt(normalizedValue, 10)
  return Number.isFinite(parsedValue) ? parsedValue : undefined
}
