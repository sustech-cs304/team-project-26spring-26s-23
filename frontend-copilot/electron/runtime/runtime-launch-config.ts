import { randomBytes } from 'node:crypto'
import {
  createHostedRuntimePaths,
  sanitizeHostedRuntimePaths,
  type HostedRuntimePaths,
  type SanitizedHostedRuntimePaths,
} from './runtime-paths'
import {
  DEFAULT_RUNTIME_APP_MODE,
  DEFAULT_RUNTIME_ENVIRONMENT,
  DEFAULT_RUNTIME_HOST,
} from './runtime-config-flags'
import {
  buildDesktopRuntimeEnvironment,
  resolveHostedRuntimeModel,
} from './runtime-config-model'
import { buildDesktopRuntimeArguments } from './runtime-spawn-args'

export interface HostedRuntimeLaunchConfig {
  host: string
  port: number
  localToken: string
  model: string | null
  hostModelRouteBridgeUrl: string | null
  hostModelRouteBridgeToken: string | null
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
  hostModelRouteBridgeConfigured: boolean
  paths: SanitizedHostedRuntimePaths
}

export interface HostedRuntimeLaunchConfigOptions {
  userDataPath: string
  processEnv: NodeJS.ProcessEnv
  port: number
  host?: string
  localToken?: string
  model?: string | null
  configuredModel?: string | null
  hostModelRouteBridgeUrl?: string | null
  hostModelRouteBridgeToken?: string | null
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

export function createHostedRuntimeLaunchConfig(
  options: HostedRuntimeLaunchConfigOptions,
): HostedRuntimeLaunchConfig {
  const host = options.host ?? DEFAULT_RUNTIME_HOST
  const localToken = options.localToken ?? createLocalToken()
  const model = resolveHostedRuntimeModel(options.processEnv, options.model, options.configuredModel)
  const appMode = options.appMode ?? DEFAULT_RUNTIME_APP_MODE
  const environment = options.environment ?? DEFAULT_RUNTIME_ENVIRONMENT
  const paths = options.paths ?? createHostedRuntimePaths(options.userDataPath)
  const baseUrl = formatRuntimeBaseUrl(host, options.port)
  const hostModelRouteBridgeUrl = options.hostModelRouteBridgeUrl ?? null
  const hostModelRouteBridgeToken = options.hostModelRouteBridgeToken ?? null

  return {
    host,
    port: options.port,
    localToken,
    model,
    hostModelRouteBridgeUrl,
    hostModelRouteBridgeToken,
    args: buildDesktopRuntimeArguments({
      host,
      port: options.port,
      localToken,
      model,
      hostModelRouteBridgeUrl,
      hostModelRouteBridgeToken,
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
    hostModelRouteBridgeConfigured:
      config.hostModelRouteBridgeUrl !== null && (config.hostModelRouteBridgeToken?.trim() ?? '') !== '',
    paths: sanitizeHostedRuntimePaths(config.paths),
  }
}
