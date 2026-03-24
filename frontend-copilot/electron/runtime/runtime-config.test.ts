import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BUNDLED_RUNTIME_MANIFEST_FILE_NAME,
  buildBundledPythonRuntimePlaceholder,
  buildDevelopmentPythonRuntimeLaunchSpec,
  DESKTOP_RUNTIME_ENTRY_MODULE,
  readBundledPythonRuntimeManifest,
  resolvePythonRuntimeLaunchSpec,
} from './python-runtime-resolver'
import {
  createHostedRuntimeLaunchConfig,
  DESKTOP_RUNTIME_ENV_NAMES,
  formatRuntimeBaseUrl,
  HOSTED_RUNTIME_OVERRIDE_ENV_NAMES,
  resolveHostedRuntimeEnvironmentOverrides,
  sanitizeHostedRuntimeLaunchConfig,
} from './runtime-config'
import { createHostedRuntimePaths } from './runtime-paths'

interface BundledRuntimeFixture {
  tempRoot: string
  resourcesPath: string
  bundledRuntimeRoot: string
  manifestPath: string
  backendDir: string
  pythonExecutablePath: string
  pythonPackagesDir: string
}

async function createBundledRuntimeFixture(): Promise<BundledRuntimeFixture> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-bundled-runtime-'))
  const resourcesPath = path.join(tempRoot, 'resources')
  const bundledRuntimeRoot = path.join(resourcesPath, 'python-runtime')
  const backendDir = path.join(bundledRuntimeRoot, 'backend')
  const pythonPackagesDir = path.join(bundledRuntimeRoot, 'python-packages')
  const pythonExecutableRelativePath = process.platform === 'win32'
    ? path.join('python', 'python.exe')
    : path.join('python', 'bin', 'python3')
  const pythonExecutablePath = path.join(bundledRuntimeRoot, pythonExecutableRelativePath)
  const desktopRuntimeEntryPath = path.join(backendDir, 'app', 'desktop_runtime', '__main__.py')
  const metadataDir = path.join(bundledRuntimeRoot, 'metadata')
  const requirementsPath = path.join(metadataDir, 'backend-requirements.txt')
  const manifestPath = path.join(bundledRuntimeRoot, BUNDLED_RUNTIME_MANIFEST_FILE_NAME)

  await Promise.all([
    mkdir(path.dirname(pythonExecutablePath), { recursive: true }),
    mkdir(path.dirname(desktopRuntimeEntryPath), { recursive: true }),
    mkdir(pythonPackagesDir, { recursive: true }),
    mkdir(metadataDir, { recursive: true }),
  ])

  await Promise.all([
    writeFile(pythonExecutablePath, ''),
    writeFile(desktopRuntimeEntryPath, 'raise SystemExit(0)\n'),
    writeFile(requirementsPath, 'fastapi==0.115.14\n'),
    writeFile(manifestPath, `${JSON.stringify({
      manifestVersion: 1,
      resourceLayoutVersion: 1,
      runtimeMode: 'bundled',
      generatedAt: '2026-03-23T00:00:00.000Z',
      platform: process.platform,
      arch: process.arch,
      python: {
        runtimeRootRelativePath: 'python',
        executableRelativePath: toPosixPath(pythonExecutableRelativePath),
        version: 'Python 3.12.9',
      },
      backend: {
        workingDirectoryRelativePath: 'backend',
        entryModule: DESKTOP_RUNTIME_ENTRY_MODULE,
        pythonPathRelativePaths: ['backend', 'python-packages'],
        sitePackagesRelativePaths: ['python-packages'],
      },
      metadata: {
        frontendVersion: '0.0.0',
        backendVersion: '0.1.0',
        requirementsRelativePath: 'metadata/backend-requirements.txt',
        stagingTool: 'frontend-copilot/scripts/prepare-bundled-runtime.mjs',
      },
    }, null, 2)}\n`, 'utf8'),
  ])

  return {
    tempRoot,
    resourcesPath,
    bundledRuntimeRoot,
    manifestPath,
    backendDir,
    pythonExecutablePath,
    pythonPackagesDir,
  }
}

function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join('/')
}

interface DevelopmentRuntimeFixture {
  tempRoot: string
  appRoot: string
  backendDir: string
  pythonExecutablePath: string
}

async function createDevelopmentRuntimeFixture(): Promise<DevelopmentRuntimeFixture> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-development-runtime-'))
  const appRoot = path.join(tempRoot, 'frontend-copilot')
  const backendDir = path.join(tempRoot, 'backend')
  const pythonExecutablePath = process.platform === 'win32'
    ? path.join(backendDir, '.venv', 'Scripts', 'python.exe')
    : path.join(backendDir, '.venv', 'bin', 'python')
  const desktopRuntimeEntryPath = path.join(backendDir, 'app', 'desktop_runtime', '__main__.py')

  await Promise.all([
    mkdir(appRoot, { recursive: true }),
    mkdir(path.dirname(pythonExecutablePath), { recursive: true }),
    mkdir(path.dirname(desktopRuntimeEntryPath), { recursive: true }),
  ])

  await Promise.all([
    writeFile(path.join(backendDir, 'pyproject.toml'), '[project]\nname = "backend"\nversion = "0.0.0"\n', 'utf8'),
    writeFile(pythonExecutablePath, '', 'utf8'),
    writeFile(desktopRuntimeEntryPath, 'raise SystemExit(0)\n', 'utf8'),
  ])

  return {
    tempRoot,
    appRoot,
    backendDir,
    pythonExecutablePath,
  }
}

describe('buildDevelopmentPythonRuntimeLaunchSpec', () => {
  it('resolves backend paths from the Electron app root in development mode', () => {
    const spec = buildDevelopmentPythonRuntimeLaunchSpec({
      appRoot: path.resolve('.'),
      resourcesPath: path.resolve('dist-electron'),
      isPackaged: false,
    })

    expect(spec.mode).toBe('development')
    expect(spec.workspaceRoot).toBe(path.resolve('..'))
    expect(spec.backendDir).toBe(path.resolve('..', 'backend'))
    expect(spec.workingDirectory).toBe(path.resolve('..', 'backend'))
    expect(spec.command).not.toBe('uv')
    expect(spec.args.slice(-2)).toEqual(['-m', 'app.desktop_runtime'])
  })

  it('prefers the project virtualenv interpreter when present', async () => {
    const fixture = await createDevelopmentRuntimeFixture()

    try {
      const spec = buildDevelopmentPythonRuntimeLaunchSpec({
        appRoot: fixture.appRoot,
        resourcesPath: path.join(fixture.tempRoot, 'dist-electron'),
        isPackaged: false,
      })

      expect(spec.backendDir).toBe(fixture.backendDir)
      expect(spec.command).toBe(fixture.pythonExecutablePath)
      expect(spec.args).toEqual(['-m', DESKTOP_RUNTIME_ENTRY_MODULE])
      expect(spec.pythonExecutablePath).toBe(fixture.pythonExecutablePath)
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })
})

describe('buildBundledPythonRuntimePlaceholder', () => {
  it('keeps packaged-runtime paths behind a dedicated placeholder boundary', () => {
    const placeholder = buildBundledPythonRuntimePlaceholder({
      appRoot: path.resolve('.'),
      resourcesPath: path.resolve('resources'),
      isPackaged: true,
    })

    expect(placeholder).toEqual({
      mode: 'bundled',
      resourcesRoot: path.resolve('resources', 'python-runtime'),
      manifestPath: path.resolve('resources', 'python-runtime', 'backend-runtime-manifest.json'),
    })
  })
})

describe('readBundledPythonRuntimeManifest', () => {
  it('parses staged bundled runtime metadata into a structured manifest', async () => {
    const fixture = await createBundledRuntimeFixture()

    try {
      const manifest = await readBundledPythonRuntimeManifest(fixture.manifestPath)

      expect(manifest).toMatchObject({
        manifestVersion: 1,
        resourceLayoutVersion: 1,
        runtimeMode: 'bundled',
        python: {
          runtimeRootRelativePath: 'python',
          version: 'Python 3.12.9',
        },
        backend: {
          workingDirectoryRelativePath: 'backend',
          entryModule: DESKTOP_RUNTIME_ENTRY_MODULE,
          pythonPathRelativePaths: ['backend', 'python-packages'],
          sitePackagesRelativePaths: ['python-packages'],
        },
        metadata: {
          requirementsRelativePath: 'metadata/backend-requirements.txt',
          stagingTool: 'frontend-copilot/scripts/prepare-bundled-runtime.mjs',
        },
      })
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })
})

describe('resolvePythonRuntimeLaunchSpec', () => {
  it('accepts the current repository layout in development mode', async () => {
    const spec = await resolvePythonRuntimeLaunchSpec({
      appRoot: path.resolve('.'),
      resourcesPath: path.resolve('dist-electron'),
      isPackaged: false,
    })

    expect(spec.backendDir).toBe(path.resolve('..', 'backend'))
    expect(spec.entryModule).toBe('app.desktop_runtime')
    expect(spec.command).not.toBe('uv')
    expect(spec.args.slice(-2)).toEqual(['-m', 'app.desktop_runtime'])
  })

  it('resolves packaged runtime paths from process.resourcesPath in bundled mode', async () => {
    const fixture = await createBundledRuntimeFixture()

    try {
      const spec = await resolvePythonRuntimeLaunchSpec({
        appRoot: path.join(fixture.tempRoot, 'dist-electron'),
        resourcesPath: fixture.resourcesPath,
        isPackaged: true,
      })

      expect(spec).toMatchObject({
        mode: 'bundled',
        workspaceRoot: null,
        backendDir: fixture.backendDir,
        resourcesRoot: fixture.bundledRuntimeRoot,
        workingDirectory: fixture.backendDir,
        entryModule: DESKTOP_RUNTIME_ENTRY_MODULE,
        command: fixture.pythonExecutablePath,
        args: ['-m', DESKTOP_RUNTIME_ENTRY_MODULE],
        manifestPath: fixture.manifestPath,
        pythonExecutablePath: fixture.pythonExecutablePath,
        pythonPathEntries: [fixture.backendDir, fixture.pythonPackagesDir],
        sitePackagesEntries: [fixture.pythonPackagesDir],
      })
      expect(spec.env).toEqual({
        PYTHONPATH: [fixture.backendDir, fixture.pythonPackagesDir].join(path.delimiter),
      })
    } finally {
      await rm(fixture.tempRoot, { recursive: true, force: true })
    }
  })
})

describe('createHostedRuntimeLaunchConfig', () => {
  it('builds loopback URLs and environment variables for the Python runtime', () => {
    const paths = createHostedRuntimePaths(path.resolve('.tmp-userdata'))
    const config = createHostedRuntimeLaunchConfig({
      environment: 'development',
      userDataPath: path.resolve('.tmp-userdata'),
      processEnv: { EXISTING_ENV: 'kept' },
      port: 43210,
      host: '127.0.0.1',
      localToken: 'token-123',
      paths,
    })

    expect(config.baseUrl).toBe('http://127.0.0.1:43210')
    expect(config.readyUrl).toBe('http://127.0.0.1:43210/ready')
    expect(config.healthUrl).toBe('http://127.0.0.1:43210/health')
    expect(config.diagnosticsUrl).toBe('http://127.0.0.1:43210/diagnostics')
    expect(config.env).toMatchObject({
      EXISTING_ENV: 'kept',
      PYTHONUNBUFFERED: '1',
      [DESKTOP_RUNTIME_ENV_NAMES.HOST]: '127.0.0.1',
      [DESKTOP_RUNTIME_ENV_NAMES.PORT]: '43210',
      [DESKTOP_RUNTIME_ENV_NAMES.LOCAL_TOKEN]: 'token-123',
      [DESKTOP_RUNTIME_ENV_NAMES.USER_DATA_DIR]: paths.userDataDir,
      [DESKTOP_RUNTIME_ENV_NAMES.ROOT_DIR]: paths.runtimeRootDir,
      [DESKTOP_RUNTIME_ENV_NAMES.CONFIG_DIR]: paths.configDir,
      [DESKTOP_RUNTIME_ENV_NAMES.LOGS_DIR]: paths.logsDir,
      [DESKTOP_RUNTIME_ENV_NAMES.DATABASE_DIR]: paths.databaseDir,
      [DESKTOP_RUNTIME_ENV_NAMES.STATE_DIR]: paths.stateDir,
      [DESKTOP_RUNTIME_ENV_NAMES.COPILOT_SETTINGS_FILE]: paths.copilotSettingsFile,
      [DESKTOP_RUNTIME_ENV_NAMES.HOST_LOG_FILE]: paths.hostLogFile,
      [DESKTOP_RUNTIME_ENV_NAMES.BACKEND_STDOUT_LOG_FILE]: paths.backendStdoutLogFile,
      [DESKTOP_RUNTIME_ENV_NAMES.BACKEND_STDERR_LOG_FILE]: paths.backendStderrLogFile,
      [DESKTOP_RUNTIME_ENV_NAMES.RUNTIME_SNAPSHOT_FILE]: paths.runtimeSnapshotFile,
      [DESKTOP_RUNTIME_ENV_NAMES.LAST_FAILURE_FILE]: paths.lastFailureFile,
      [DESKTOP_RUNTIME_ENV_NAMES.APP_MODE]: 'desktop',
      [DESKTOP_RUNTIME_ENV_NAMES.ENVIRONMENT]: 'development',
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
