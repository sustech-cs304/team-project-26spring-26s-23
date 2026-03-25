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

export const HOSTED_RUNTIME_MODEL_ENV_NAMES = {
  PRIMARY: 'COPILOT_RUNTIME_MODEL',
  LEGACY: 'COPILOT_MODEL',
} as const

export const HOSTED_RUNTIME_MAIN_PROCESS_ARGUMENT_NAMES = {
  MODEL: '--runtime-model',
  HOST: '--runtime-host',
  APP_MODE: '--runtime-app-mode',
  ENVIRONMENT: '--runtime-environment',
  LOCAL_TOKEN: '--runtime-local-token',
} as const

const HOSTED_RUNTIME_MAIN_PROCESS_ARGUMENT_FLAGS = new Set<string>(
  Object.values(HOSTED_RUNTIME_MAIN_PROCESS_ARGUMENT_NAMES),
)

export const DESKTOP_RUNTIME_ARGUMENT_NAMES = {
  HOST: '--host',
  PORT: '--port',
  APP_MODE: '--app-mode',
  ENVIRONMENT: '--environment',
  ROOT_DIR: '--root-dir',
  USER_DATA_DIR: '--user-data-dir',
  CONFIG_DIR: '--config-dir',
  LOGS_DIR: '--logs-dir',
  DATABASE_DIR: '--database-dir',
  STATE_DIR: '--state-dir',
  SETTINGS_FILE: '--settings-file',
  HOST_LOG_FILE: '--host-log-file',
  BACKEND_STDOUT_LOG_FILE: '--backend-stdout-log-file',
  BACKEND_STDERR_LOG_FILE: '--backend-stderr-log-file',
  RUNTIME_SNAPSHOT_FILE: '--runtime-snapshot-file',
  LAST_FAILURE_FILE: '--last-failure-file',
  MODEL: '--model',
  LOCAL_TOKEN: '--local-token',
} as const

const STRIPPED_CHILD_ENV_NAMES = [
  ...Object.values(DESKTOP_RUNTIME_ENV_NAMES),
  ...Object.values(HOSTED_RUNTIME_MODEL_ENV_NAMES),
]

export interface HostedRuntimeEnvironmentOverrides {
  host?: string
  environment?: string
  startupTimeoutMs?: number
  shutdownTimeoutMs?: number
  healthcheckIntervalMs?: number
  healthcheckRequestTimeoutMs?: number
}

export interface HostedRuntimeCommandLineOptions {
  model?: string | null
  host?: string
  appMode?: string
  environment?: string
  localToken?: string
}

export interface HostedRuntimeCommandLineParseWarning {
  code: 'invalid-hosted-runtime-command-line-arguments'
  detail: string
  flag?: string
}

class HostedRuntimeCommandLineArgumentError extends Error {
  constructor(readonly flag: string) {
    super(`Missing value for hosted runtime option ${flag}.`)
    this.name = 'HostedRuntimeCommandLineArgumentError'
  }
}

export interface HostedRuntimeLaunchConfig {
  host: string
  port: number
  localToken: string
  model: string | null
  args: string[]
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
  modelConfigured: boolean
  paths: SanitizedHostedRuntimePaths
}

export interface HostedRuntimeLaunchConfigOptions {
  userDataPath: string
  processEnv: NodeJS.ProcessEnv
  port: number
  host?: string
  localToken?: string
  model?: string | null
  appMode?: string
  environment?: string
  paths?: HostedRuntimePaths
}

export function createLocalToken(): string {
  return randomBytes(24).toString('hex')
}

export function formatRuntimeBaseUrl(host: string, port: number): string {
  const formattedHost = host.includes(':') && !host.startsWith('[')
    ? `[${host}]`
    : host

  return `http://${formattedHost}:${port}`
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

export function collectForwardedElectronMainProcessArguments(
  argv: readonly string[],
): string[] {
  const separatorIndex = argv.indexOf('--')
  if (separatorIndex !== -1) {
    return argv.slice(separatorIndex + 1)
  }

  const forwardedArgs: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (typeof token !== 'string') {
      continue
    }

    const [flag, inlineValue] = splitCommandLineFlagValue(token)
    if (!HOSTED_RUNTIME_MAIN_PROCESS_ARGUMENT_FLAGS.has(flag)) {
      continue
    }

    forwardedArgs.push(token)

    if (inlineValue !== undefined) {
      continue
    }

    const nextValue = argv[index + 1]
    if (typeof nextValue === 'string' && nextValue.trim() !== '' && !nextValue.startsWith('--')) {
      forwardedArgs.push(nextValue)
      index += 1
    }
  }

  return forwardedArgs
}

export function parseHostedRuntimeCommandLineArguments(
  argv: readonly string[],
): HostedRuntimeCommandLineOptions {
  const options: HostedRuntimeCommandLineOptions = {}

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (typeof token !== 'string') {
      continue
    }

    const [flag, inlineValue] = splitCommandLineFlagValue(token)

    switch (flag) {
      case HOSTED_RUNTIME_MAIN_PROCESS_ARGUMENT_NAMES.MODEL: {
        const { nextIndex, value } = readCommandLineFlagValue(argv, index, flag, inlineValue)
        options.model = value ?? null
        index = nextIndex
        break
      }
      case HOSTED_RUNTIME_MAIN_PROCESS_ARGUMENT_NAMES.HOST: {
        const { nextIndex, value } = readCommandLineFlagValue(argv, index, flag, inlineValue)
        options.host = value
        index = nextIndex
        break
      }
      case HOSTED_RUNTIME_MAIN_PROCESS_ARGUMENT_NAMES.APP_MODE: {
        const { nextIndex, value } = readCommandLineFlagValue(argv, index, flag, inlineValue)
        options.appMode = value
        index = nextIndex
        break
      }
      case HOSTED_RUNTIME_MAIN_PROCESS_ARGUMENT_NAMES.ENVIRONMENT: {
        const { nextIndex, value } = readCommandLineFlagValue(argv, index, flag, inlineValue)
        options.environment = value
        index = nextIndex
        break
      }
      case HOSTED_RUNTIME_MAIN_PROCESS_ARGUMENT_NAMES.LOCAL_TOKEN: {
        const { nextIndex, value } = readCommandLineFlagValue(argv, index, flag, inlineValue)
        options.localToken = value
        index = nextIndex
        break
      }
      default:
        break
    }
  }

  return options
}

export function parseHostedRuntimeCommandLineArgumentsSafely(
  argv: readonly string[],
): { options: HostedRuntimeCommandLineOptions, warning: HostedRuntimeCommandLineParseWarning | null } {
  try {
    return {
      options: parseHostedRuntimeCommandLineArguments(argv),
      warning: null,
    }
  } catch (error) {
    return {
      options: {},
      warning: buildHostedRuntimeCommandLineParseWarning(error),
    }
  }
}

export function resolveHostedRuntimeModel(
  processEnv: NodeJS.ProcessEnv,
  explicitModel?: string | null,
): string | null {
  const normalizedExplicitModel = normalizeOptionalString(explicitModel)
  if (normalizedExplicitModel !== undefined) {
    return normalizedExplicitModel
  }

  return normalizeOptionalString(processEnv[HOSTED_RUNTIME_MODEL_ENV_NAMES.PRIMARY])
    ?? normalizeOptionalString(processEnv[HOSTED_RUNTIME_MODEL_ENV_NAMES.LEGACY])
    ?? null
}

export function buildDesktopRuntimeEnvironment(
  baseEnv: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...stripEnvironmentKeys(baseEnv, STRIPPED_CHILD_ENV_NAMES),
    PYTHONUNBUFFERED: '1',
  }
}

export function createHostedRuntimeLaunchConfig(
  options: HostedRuntimeLaunchConfigOptions,
): HostedRuntimeLaunchConfig {
  const host = options.host ?? DEFAULT_RUNTIME_HOST
  const localToken = options.localToken ?? createLocalToken()
  const model = resolveHostedRuntimeModel(options.processEnv, options.model)
  const appMode = options.appMode ?? DEFAULT_RUNTIME_APP_MODE
  const environment = options.environment ?? DEFAULT_RUNTIME_ENVIRONMENT
  const paths = options.paths ?? createHostedRuntimePaths(options.userDataPath)
  const baseUrl = formatRuntimeBaseUrl(host, options.port)

  return {
    host,
    port: options.port,
    localToken,
    model,
    args: buildDesktopRuntimeArguments({
      host,
      port: options.port,
      localToken,
      model,
      appMode,
      environment,
      paths,
    }),
    baseUrl,
    readyUrl: `${baseUrl}/ready`,
    healthUrl: `${baseUrl}/health`,
    diagnosticsUrl: `${baseUrl}/diagnostics`,
    appMode,
    environment,
    paths,
    env: buildDesktopRuntimeEnvironment(options.processEnv),
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
    modelConfigured: config.model !== null,
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

function normalizeOptionalString(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalizedValue = value.trim()
  return normalizedValue === '' ? undefined : normalizedValue
}

function splitCommandLineFlagValue(token: string): [string, string | undefined] {
  const equalsIndex = token.indexOf('=')
  if (equalsIndex === -1) {
    return [token, undefined]
  }

  return [token.slice(0, equalsIndex), token.slice(equalsIndex + 1)]
}

function readCommandLineFlagValue(
  argv: readonly string[],
  index: number,
  flag: string,
  inlineValue?: string,
): { value: string | undefined, nextIndex: number } {
  if (inlineValue !== undefined) {
    return {
      value: normalizeOptionalString(inlineValue),
      nextIndex: index,
    }
  }

  const nextValue = argv[index + 1]
  if (
    typeof nextValue !== 'string'
    || nextValue.trim() === ''
    || nextValue.startsWith('--')
    || HOSTED_RUNTIME_MAIN_PROCESS_ARGUMENT_FLAGS.has(nextValue)
  ) {
    throw new HostedRuntimeCommandLineArgumentError(flag)
  }

  return {
    value: normalizeOptionalString(nextValue),
    nextIndex: index + 1,
  }
}

function buildHostedRuntimeCommandLineParseWarning(error: unknown): HostedRuntimeCommandLineParseWarning {
  const warning: HostedRuntimeCommandLineParseWarning = {
    code: 'invalid-hosted-runtime-command-line-arguments',
    detail: error instanceof Error ? error.message : String(error),
  }

  if (error instanceof HostedRuntimeCommandLineArgumentError) {
    warning.flag = error.flag
  }

  return warning
}

function buildDesktopRuntimeArguments(input: {
  host: string
  port: number
  localToken: string
  model: string | null
  appMode: string
  environment: string
  paths: HostedRuntimePaths
}): string[] {
  const args: string[] = []

  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.HOST, input.host)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.PORT, input.port)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.APP_MODE, input.appMode)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.ENVIRONMENT, input.environment)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.ROOT_DIR, input.paths.runtimeRootDir)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.USER_DATA_DIR, input.paths.userDataDir)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.CONFIG_DIR, input.paths.configDir)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.LOGS_DIR, input.paths.logsDir)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.DATABASE_DIR, input.paths.databaseDir)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.STATE_DIR, input.paths.stateDir)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.SETTINGS_FILE, input.paths.copilotSettingsFile)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.HOST_LOG_FILE, input.paths.hostLogFile)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.BACKEND_STDOUT_LOG_FILE, input.paths.backendStdoutLogFile)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.BACKEND_STDERR_LOG_FILE, input.paths.backendStderrLogFile)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.RUNTIME_SNAPSHOT_FILE, input.paths.runtimeSnapshotFile)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.LAST_FAILURE_FILE, input.paths.lastFailureFile)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.MODEL, input.model)
  appendCommandLineArgument(args, DESKTOP_RUNTIME_ARGUMENT_NAMES.LOCAL_TOKEN, input.localToken)

  return args
}

function appendCommandLineArgument(
  args: string[],
  flag: string,
  value: string | number | { toString(): string } | null | undefined,
): void {
  const normalizedValue = value === null || value === undefined
    ? undefined
    : normalizeOptionalString(String(value))

  if (normalizedValue === undefined) {
    return
  }

  args.push(flag, normalizedValue)
}

function stripEnvironmentKeys(
  baseEnv: NodeJS.ProcessEnv,
  keysToStrip: readonly string[],
): NodeJS.ProcessEnv {
  const nextEnv: NodeJS.ProcessEnv = { ...baseEnv }

  for (const key of keysToStrip) {
    delete nextEnv[key]
  }

  return nextEnv
}

function parseIntegerOverride(value: string | undefined): number | undefined {
  const normalizedValue = normalizeOptionalString(value)
  if (normalizedValue === undefined) {
    return undefined
  }

  const parsedValue = Number.parseInt(normalizedValue, 10)
  return Number.isFinite(parsedValue) ? parsedValue : undefined
}
