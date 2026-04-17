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

describe('createHostedRuntimeLaunchConfig', () => {
  it('builds loopback URLs, canonical runtime args, and minimal child env for the Python runtime', () => {
    const paths = createHostedRuntimePaths(path.resolve('.tmp-userdata'))
    const config = createHostedRuntimeLaunchConfig({
      environment: 'development',
      userDataPath: path.resolve('.tmp-userdata'),
      processEnv: {
        EXISTING_ENV: 'kept',
        COPILOT_DESKTOP_RUNTIME_HOST: 'should-not-reach-child',
        COPILOT_DESKTOP_RUNTIME_PORT: '9999',
        COPILOT_DESKTOP_RUNTIME_LOCAL_TOKEN: 'env-token',
        COPILOT_RUNTIME_MODEL: 'qwen-plus',
        COPILOT_MODEL: 'legacy-model',
      },
      port: 43210,
      host: '127.0.0.1',
      localToken: 'token-123',
      paths,
    })

    expect(config.baseUrl).toBe('http://127.0.0.1:43210')
    expect(config.readyUrl).toBe('http://127.0.0.1:43210/ready')
    expect(config.healthUrl).toBe('http://127.0.0.1:43210/health')
    expect(config.diagnosticsUrl).toBe('http://127.0.0.1:43210/diagnostics')
    expect(config.args).toEqual([
      '--host', '127.0.0.1',
      '--port', '43210',
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
      '--local-token', 'token-123',
    ])
    expect(config.env).toEqual({
      EXISTING_ENV: 'kept',
      PYTHONUNBUFFERED: '1',
    })

    expect(sanitizeHostedRuntimeLaunchConfig(config)).toEqual({
      host: '127.0.0.1',
      port: 43210,
      baseUrl: 'http://127.0.0.1:43210',
      readyUrl: 'http://127.0.0.1:43210/ready',
      healthUrl: 'http://127.0.0.1:43210/health',
      diagnosticsUrl: 'http://127.0.0.1:43210/diagnostics',
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
      userDataPath: path.resolve('.tmp-userdata-model'),
      processEnv: {
        COPILOT_RUNTIME_MODEL: 'env-primary',
        COPILOT_MODEL: 'env-legacy',
      },
      port: 43210,
      localToken: 'token-model',
    })

    expect(config.args).not.toContain('--model')
    expect(sanitizeHostedRuntimeLaunchConfig(config)).not.toHaveProperty('modelConfigured')
  })

  it('passes host model route bridge bootstrap through runtime args without leaking it into sanitized output', () => {
    const config = createHostedRuntimeLaunchConfig({
      userDataPath: path.resolve('.tmp-userdata-route-bridge'),
      processEnv: {},
      port: 43210,
      localToken: 'token-bridge',
      hostModelRouteBridgeUrl: 'http://127.0.0.1:45678/host/private/provider-routes/resolve',
      hostModelRouteBridgeToken: 'bridge-token-123',
    })

    expect(config.args).toEqual(expect.arrayContaining([
      '--host-model-route-bridge-url', 'http://127.0.0.1:45678/host/private/provider-routes/resolve',
      '--host-model-route-bridge-token', 'bridge-token-123',
    ]))
    expect(sanitizeHostedRuntimeLaunchConfig(config).hostModelRouteBridgeConfigured).toBe(true)
  })

  it('passes host capability bridge bootstrap through runtime args without leaking it into sanitized output', () => {
    const config = createHostedRuntimeLaunchConfig({
      userDataPath: path.resolve('.tmp-userdata-capability-bridge'),
      processEnv: {},
      port: 43210,
      localToken: 'token-capability-bridge',
      hostCapabilityBridgeUrl: 'http://127.0.0.1:45679/host/private/capability-bridge',
      hostCapabilityBridgeToken: 'capability-bridge-token-123',
    })

    expect(config.args).toEqual(expect.arrayContaining([
      '--host-capability-bridge-url', 'http://127.0.0.1:45679/host/private/capability-bridge',
      '--host-capability-bridge-token', 'capability-bridge-token-123',
    ]))
    expect(sanitizeHostedRuntimeLaunchConfig(config).hostCapabilityBridgeConfigured).toBe(true)
  })

  it('brackets IPv6 loopback hosts when composing runtime urls', () => {
    const config = createHostedRuntimeLaunchConfig({
      userDataPath: path.resolve('.tmp-userdata-ipv6'),
      processEnv: {},
      port: 43210,
      host: '::1',
      localToken: 'token-ipv6',
    })

    expect(config.baseUrl).toBe('http://[::1]:43210')
    expect(config.readyUrl).toBe('http://[::1]:43210/ready')
    expect(config.healthUrl).toBe('http://[::1]:43210/health')
    expect(config.diagnosticsUrl).toBe('http://[::1]:43210/diagnostics')
    expect(formatRuntimeBaseUrl('::1', 9000)).toBe('http://[::1]:9000')
  })

  it('derives runtime directories from Electron userData', () => {
    const paths = createHostedRuntimePaths(path.resolve('.tmp-userdata'))

    expect(paths).toEqual({
      userDataDir: path.resolve('.tmp-userdata'),
      runtimeRootDir: path.resolve('.tmp-userdata', 'desktop-runtime'),
      configDir: path.resolve('.tmp-userdata', 'desktop-runtime', 'config'),
      logsDir: path.resolve('.tmp-userdata', 'desktop-runtime', 'logs'),
      databaseDir: path.resolve('.tmp-userdata', 'desktop-runtime', 'database'),
      stateDir: path.resolve('.tmp-userdata', 'desktop-runtime', 'state'),
      copilotSettingsFile: path.resolve('.tmp-userdata', 'desktop-runtime', 'config', 'copilot-settings.json'),
      legacyCopilotSettingsFile: path.resolve('.tmp-userdata', 'copilot-settings.json'),
      hostLogFile: path.resolve('.tmp-userdata', 'desktop-runtime', 'logs', 'electron-host.log'),
      backendStdoutLogFile: path.resolve('.tmp-userdata', 'desktop-runtime', 'logs', 'backend.stdout.log'),
      backendStderrLogFile: path.resolve('.tmp-userdata', 'desktop-runtime', 'logs', 'backend.stderr.log'),
      runtimeSnapshotFile: path.resolve('.tmp-userdata', 'desktop-runtime', 'state', 'runtime-snapshot.json'),
      lastFailureFile: path.resolve('.tmp-userdata', 'desktop-runtime', 'state', 'last-failure.json'),
    })
    expect(formatRuntimeBaseUrl('127.0.0.1', 9000)).toBe('http://127.0.0.1:9000')
  })
})

describe('resolveHostedRuntimeEnvironmentOverrides', () => {
  it('reads optional override values from process env', () => {
    expect(resolveHostedRuntimeEnvironmentOverrides({
      [HOSTED_RUNTIME_OVERRIDE_ENV_NAMES.HOST]: '127.0.0.1',
      [HOSTED_RUNTIME_OVERRIDE_ENV_NAMES.ENVIRONMENT]: 'production',
      [HOSTED_RUNTIME_OVERRIDE_ENV_NAMES.STARTUP_TIMEOUT_MS]: '45000',
      [HOSTED_RUNTIME_OVERRIDE_ENV_NAMES.SHUTDOWN_TIMEOUT_MS]: '9000',
      [HOSTED_RUNTIME_OVERRIDE_ENV_NAMES.HEALTHCHECK_INTERVAL_MS]: '750',
      [HOSTED_RUNTIME_OVERRIDE_ENV_NAMES.HEALTHCHECK_REQUEST_TIMEOUT_MS]: '2200',
    })).toEqual({
      host: '127.0.0.1',
      environment: 'production',
      startupTimeoutMs: 45000,
      shutdownTimeoutMs: 9000,
      healthcheckIntervalMs: 750,
      healthcheckRequestTimeoutMs: 2200,
    })
  })
})
