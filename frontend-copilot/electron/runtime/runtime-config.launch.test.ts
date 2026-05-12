import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createHostedRuntimePaths } from './runtime-paths'
import {
  createHostedRuntimeLaunchConfig,
  formatRuntimeBaseUrl,
  HOSTED_RUNTIME_OVERRIDE_ENV_NAMES,
  resolveHostedRuntimeEnvironmentOverrides,
  sanitizeHostedRuntimeLaunchConfig,
} from './runtime-config'

const BASE_URL = 'http://127.0.0.1:43210'
const PORT = 43210
const HOST = '127.0.0.1'
const DEFAULT_TOKEN = 'token-123'
const BRIDGE_URL = 'http://127.0.0.1:45678/host/private/provider-routes/resolve'
const BRIDGE_TOKEN = 'bridge-token-123'
const CAPABILITY_URL = 'http://127.0.0.1:45679/host/private/capability-bridge'
const CAPABILITY_TOKEN = 'capability-bridge-token-123'
const TMP_USERDATA = '.tmp-userdata'
const DESKTOP_RUNTIME = 'desktop-runtime'
const IPV6_HOST = '::1'
const IPV6_BASE_URL = 'http://[::1]:43210'

function resolveTmp(...segments: string[]) {
  return path.resolve(TMP_USERDATA, ...segments)
}

function makeConfig(overrides: { userDataPath: string; processEnv?: Record<string, string>; localToken?: string; host?: string; hostModelRouteBridgeUrl?: string; hostModelRouteBridgeToken?: string; hostCapabilityBridgeUrl?: string; hostCapabilityBridgeToken?: string }) {
  return createHostedRuntimeLaunchConfig({
    environment: 'development',
    userDataPath: overrides.userDataPath,
    processEnv: overrides.processEnv ?? {},
    port: PORT,
    host: overrides.host ?? HOST,
    localToken: overrides.localToken ?? DEFAULT_TOKEN,
    hostModelRouteBridgeUrl: overrides.hostModelRouteBridgeUrl,
    hostModelRouteBridgeToken: overrides.hostModelRouteBridgeToken,
    hostCapabilityBridgeUrl: overrides.hostCapabilityBridgeUrl,
    hostCapabilityBridgeToken: overrides.hostCapabilityBridgeToken,
  })
}

function expectBaseUrls(config: { baseUrl: string; readyUrl: string; healthUrl: string; diagnosticsUrl: string }, baseUrl: string) {
  expect(config.baseUrl).toBe(baseUrl)
  expect(config.readyUrl).toBe(`${baseUrl}/ready`)
  expect(config.healthUrl).toBe(`${baseUrl}/health`)
  expect(config.diagnosticsUrl).toBe(`${baseUrl}/diagnostics`)
}

// eslint-disable-next-line max-lines-per-function -- describe block covers 6 related test cases for URL/runtime config, just over limit
describe('createHostedRuntimeLaunchConfig', () => {
  it('builds loopback URLs, canonical runtime args, and minimal child env for the Python runtime', () => {
    const paths = createHostedRuntimePaths(path.resolve(TMP_USERDATA))
    const config = createHostedRuntimeLaunchConfig({
      environment: 'development',
      userDataPath: path.resolve(TMP_USERDATA),
      processEnv: {
        EXISTING_ENV: 'kept',
        COPILOT_DESKTOP_RUNTIME_HOST: 'should-not-reach-child',
        COPILOT_DESKTOP_RUNTIME_PORT: '9999',
        COPILOT_DESKTOP_RUNTIME_LOCAL_TOKEN: 'env-token',
        COPILOT_RUNTIME_MODEL: 'qwen-plus',
        COPILOT_MODEL: 'legacy-model',
      },
      port: PORT,
      host: HOST,
      localToken: DEFAULT_TOKEN,
      paths,
    })

    expectBaseUrls(config, BASE_URL)
    expect(config.args).toEqual([
      '--host', HOST,
      '--port', String(PORT),
      '--app-mode', 'desktop',
      '--environment', 'development',
      '--root-dir', paths.runtimeRootDir,
      '--user-data-dir', paths.userDataDir,
      '--config-dir', paths.configDir,
      '--logs-dir', paths.logsDir,
      '--database-dir', paths.databaseDir,
      '--state-dir', paths.stateDir,
      '--settings-file', paths.copilotSettingsFile,
      '--host-log-file', paths.hostLogFile,
      '--backend-stdout-log-file', paths.backendStdoutLogFile,
      '--backend-stderr-log-file', paths.backendStderrLogFile,
      '--runtime-snapshot-file', paths.runtimeSnapshotFile,
      '--last-failure-file', paths.lastFailureFile,
      '--local-token', DEFAULT_TOKEN,
    ])
    expect(config.env).toEqual({ EXISTING_ENV: 'kept', PYTHONUNBUFFERED: '1' })

    expect(sanitizeHostedRuntimeLaunchConfig(config)).toEqual({
      host: HOST,
      port: PORT,
      baseUrl: BASE_URL,
      readyUrl: `${BASE_URL}/ready`,
      healthUrl: `${BASE_URL}/health`,
      diagnosticsUrl: `${BASE_URL}/diagnostics`,
      appMode: 'desktop',
      environment: 'development',
      localTokenConfigured: true,
      hostModelRouteBridgeConfigured: false,
      hostCapabilityBridgeConfigured: false,
      paths: {
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
      },
    })
  })

  it('does not project retired startup model compatibility into runtime args', () => {
    const config = createHostedRuntimeLaunchConfig({
      userDataPath: path.resolve(`${TMP_USERDATA}-model`),
      processEnv: { COPILOT_RUNTIME_MODEL: 'env-primary', COPILOT_MODEL: 'env-legacy' },
      port: PORT,
      localToken: 'token-model',
    })

    expect(config.args).not.toContain('--model')
    expect(sanitizeHostedRuntimeLaunchConfig(config)).not.toHaveProperty('modelConfigured')
  })

  it('passes host model route bridge bootstrap through runtime args without leaking it into sanitized output', () => {
    const config = makeConfig({
      userDataPath: path.resolve(`${TMP_USERDATA}-route-bridge`),
      hostModelRouteBridgeUrl: BRIDGE_URL,
      hostModelRouteBridgeToken: BRIDGE_TOKEN,
    })

    expect(config.args).toEqual(expect.arrayContaining([
      '--host-model-route-bridge-url', BRIDGE_URL,
      '--host-model-route-bridge-token', BRIDGE_TOKEN,
    ]))
    expect(sanitizeHostedRuntimeLaunchConfig(config).hostModelRouteBridgeConfigured).toBe(true)
  })

  it('passes host capability bridge bootstrap through runtime args without leaking it into sanitized output', () => {
    const config = makeConfig({
      userDataPath: path.resolve(`${TMP_USERDATA}-capability-bridge`),
      hostCapabilityBridgeUrl: CAPABILITY_URL,
      hostCapabilityBridgeToken: CAPABILITY_TOKEN,
    })

    expect(config.args).toEqual(expect.arrayContaining([
      '--host-capability-bridge-url', CAPABILITY_URL,
      '--host-capability-bridge-token', CAPABILITY_TOKEN,
    ]))
    expect(sanitizeHostedRuntimeLaunchConfig(config).hostCapabilityBridgeConfigured).toBe(true)
  })

  it('brackets IPv6 loopback hosts when composing runtime urls', () => {
    const config = makeConfig({ userDataPath: path.resolve(`${TMP_USERDATA}-ipv6`), host: IPV6_HOST, localToken: 'token-ipv6' })

    expectBaseUrls(config, IPV6_BASE_URL)
    expect(formatRuntimeBaseUrl(IPV6_HOST, 9000)).toBe('http://[::1]:9000')
  })

  it('derives runtime directories from Electron userData', () => {
    const paths = createHostedRuntimePaths(path.resolve(TMP_USERDATA))

    expect(paths).toEqual({
      userDataDir: resolveTmp(),
      runtimeRootDir: resolveTmp(DESKTOP_RUNTIME),
      configDir: resolveTmp(DESKTOP_RUNTIME, 'config'),
      logsDir: resolveTmp(DESKTOP_RUNTIME, 'logs'),
      databaseDir: resolveTmp(DESKTOP_RUNTIME, 'database'),
      stateDir: resolveTmp(DESKTOP_RUNTIME, 'state'),
      copilotSettingsFile: resolveTmp(DESKTOP_RUNTIME, 'config', 'copilot-settings.json'),
      legacyCopilotSettingsFile: resolveTmp('copilot-settings.json'),
      hostLogFile: resolveTmp(DESKTOP_RUNTIME, 'logs', 'electron-host.log'),
      backendStdoutLogFile: resolveTmp(DESKTOP_RUNTIME, 'logs', 'backend.stdout.log'),
      backendStderrLogFile: resolveTmp(DESKTOP_RUNTIME, 'logs', 'backend.stderr.log'),
      runtimeSnapshotFile: resolveTmp(DESKTOP_RUNTIME, 'state', 'runtime-snapshot.json'),
      lastFailureFile: resolveTmp(DESKTOP_RUNTIME, 'state', 'last-failure.json'),
    })
    expect(formatRuntimeBaseUrl(HOST, 9000)).toBe('http://127.0.0.1:9000')
  })
})

describe('resolveHostedRuntimeEnvironmentOverrides', () => {
  it('reads optional override values from process env', () => {
    expect(resolveHostedRuntimeEnvironmentOverrides({
      [HOSTED_RUNTIME_OVERRIDE_ENV_NAMES.HOST]: HOST,
      [HOSTED_RUNTIME_OVERRIDE_ENV_NAMES.ENVIRONMENT]: 'production',
      [HOSTED_RUNTIME_OVERRIDE_ENV_NAMES.STARTUP_TIMEOUT_MS]: '45000',
      [HOSTED_RUNTIME_OVERRIDE_ENV_NAMES.SHUTDOWN_TIMEOUT_MS]: '9000',
      [HOSTED_RUNTIME_OVERRIDE_ENV_NAMES.HEALTHCHECK_INTERVAL_MS]: '750',
      [HOSTED_RUNTIME_OVERRIDE_ENV_NAMES.HEALTHCHECK_REQUEST_TIMEOUT_MS]: '2200',
    })).toEqual({
      host: HOST,
      environment: 'production',
      startupTimeoutMs: 45000,
      shutdownTimeoutMs: 9000,
      healthcheckIntervalMs: 750,
      healthcheckRequestTimeoutMs: 2200,
    })
  })
})
