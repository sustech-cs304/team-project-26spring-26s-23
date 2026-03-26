import { app, BrowserWindow, Menu, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  COPILOT_SETTINGS_LOAD_CHANNEL,
  COPILOT_SETTINGS_SAVE_CHANNEL,
} from './copilot-settings'
import {
  CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL,
  type ConfigCenterPublicSnapshotLoadResult,
} from './config-center/public-snapshot'
import {
  COPILOT_RUNTIME_LOAD_CHANNEL,
  COPILOT_RUNTIME_RETRY_CHANNEL,
} from './copilot-runtime'
import type {
  CopilotHostedRuntimeFailureSummary,
  CopilotRuntimeLoadResult,
  CopilotRuntimeSnapshot,
} from './copilot-runtime'
import type {
  CopilotSettingsLoadResult,
  CopilotSettingsPatch,
  CopilotSettingsSaveResult,
} from './copilot-settings'
import {
  createElectronUnifiedConfigService,
  type ElectronUnifiedConfigService,
} from './config-center/main-process'
import { createHostedBackendService, type HostedBackendService } from './runtime/hosted-backend-service'
import { parseHostedRuntimeCommandLineArgumentsSafely } from './runtime/runtime-config'
import { appendRuntimeLog, type RuntimeLogLevel } from './runtime/runtime-observability'
import { createHostedRuntimePaths, ensureHostedRuntimeDirectories, type HostedRuntimePaths } from './runtime/runtime-paths'
import { isHostedBackendFailure, type HostedBackendFailure } from './runtime/runtime-diagnostics'
import { createInitialHostedBackendState, type HostedBackendState } from './runtime/runtime-state'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
const APP_ROOT = path.join(__dirname, '..')
process.env.APP_ROOT = APP_ROOT

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(APP_ROOT, 'public') : RENDERER_DIST
const VITE_PUBLIC = process.env.VITE_PUBLIC ?? RENDERER_DIST

let win: BrowserWindow | null = null
let hostedBackendService: HostedBackendService | null = null
let runtimePaths: HostedRuntimePaths | null = null
let unifiedConfigService: ElectronUnifiedConfigService | null = null
let quitSequenceStarted = false
let hostedBackendStartupInFlight = false
const electronStartupStartedAt = Date.now()

function logStartupTrace(stage: string, context: Record<string, unknown> = {}): void {
  const payload = {
    sinceMainMs: Date.now() - electronStartupStartedAt,
    ...context,
  }

  console.info(`[startup] ${stage}`, JSON.stringify(payload))
  void appendMainRuntimeLog('info', `[startup] ${stage}`, payload)
}

function createWindow() {
  logStartupTrace('createWindow:start', {
    devServerUrl: VITE_DEV_SERVER_URL ?? null,
  })

  const windowCreatedAt = Date.now()
  const generatedIconDir = path.join(VITE_PUBLIC, 'generated-icons')
  const preferredWindowIconPath =
    process.platform === 'win32'
      ? path.join(generatedIconDir, 'icon.ico')
      : path.join(generatedIconDir, 'icon.png')
  const windowIconPath = existsSync(preferredWindowIconPath)
    ? preferredWindowIconPath
    : path.join(VITE_PUBLIC, 'candue_icon.png')

  win = new BrowserWindow({
    icon: windowIconPath,
    title: '赶渡 CanDue',
    width: 1440,
    height: 960,
    autoHideMenuBar: true,
    backgroundColor: '#f3f5f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  win.setMenuBarVisibility(false)

  win.webContents.on('did-start-loading', () => {
    logStartupTrace('webContents:did-start-loading', {
      sinceWindowMs: Date.now() - windowCreatedAt,
    })
  })

  win.webContents.on('dom-ready', () => {
    logStartupTrace('webContents:dom-ready', {
      sinceWindowMs: Date.now() - windowCreatedAt,
    })
  })

  win.webContents.on('did-finish-load', () => {
    logStartupTrace('webContents:did-finish-load', {
      sinceWindowMs: Date.now() - windowCreatedAt,
    })
  })

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logStartupTrace('webContents:did-fail-load', {
      sinceWindowMs: Date.now() - windowCreatedAt,
      errorCode,
      errorDescription,
      validatedURL,
    })
  })

  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const rendererLogLevel = normalizeRendererConsoleLogLevel(level)
    const payload = {
      sinceWindowMs: Date.now() - windowCreatedAt,
      level,
      line,
      sourceId,
      message,
    }

    if (message.startsWith('[startup]')) {
      void appendMainRuntimeLog('info', '[startup] renderer-console', payload)
      return
    }

    if (rendererLogLevel === 'warn' || rendererLogLevel === 'error' || message.startsWith('[renderer]')) {
      void appendMainRuntimeLog(rendererLogLevel, 'renderer-console', payload)
    }
  })

  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    void appendMainRuntimeLog('error', 'Renderer preload script failed.', {
      sinceWindowMs: Date.now() - windowCreatedAt,
      preloadPath,
      detail: formatUnknownError(error),
    })
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    void appendMainRuntimeLog('error', 'Renderer process exited unexpectedly.', {
      sinceWindowMs: Date.now() - windowCreatedAt,
      reason: details.reason,
      exitCode: details.exitCode,
    })
  })

  win.webContents.on('unresponsive', () => {
    logStartupTrace('webContents:unresponsive', {
      sinceWindowMs: Date.now() - windowCreatedAt,
    })
  })

  if (VITE_DEV_SERVER_URL) {
    logStartupTrace('window-load:start', {
      kind: 'url',
      target: VITE_DEV_SERVER_URL,
    })
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    const target = path.join(RENDERER_DIST, 'index.html')
    logStartupTrace('window-load:start', {
      kind: 'file',
      target,
    })
    win.loadFile(target)
  }
}

function registerCopilotSettingsHandlers() {
  ipcMain.removeHandler(COPILOT_SETTINGS_LOAD_CHANNEL)
  ipcMain.removeHandler(COPILOT_SETTINGS_SAVE_CHANNEL)

  ipcMain.handle(COPILOT_SETTINGS_LOAD_CHANNEL, async (): Promise<CopilotSettingsLoadResult> => {
    return await loadCopilotSettings()
  })

  ipcMain.handle(COPILOT_SETTINGS_SAVE_CHANNEL, async (_event, patch: CopilotSettingsPatch): Promise<CopilotSettingsSaveResult> => {
    return await saveCopilotSettings(patch)
  })
}

function registerConfigCenterHandlers() {
  ipcMain.removeHandler(CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL)

  ipcMain.handle(CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL, async (): Promise<ConfigCenterPublicSnapshotLoadResult> => {
    return await loadConfigCenterPublicSnapshot()
  })
}

function registerCopilotRuntimeHandlers() {
  ipcMain.removeHandler(COPILOT_RUNTIME_LOAD_CHANNEL)
  ipcMain.removeHandler(COPILOT_RUNTIME_RETRY_CHANNEL)

  ipcMain.handle(COPILOT_RUNTIME_LOAD_CHANNEL, async (): Promise<CopilotRuntimeLoadResult> => {
    return loadCopilotRuntime()
  })

  ipcMain.handle(COPILOT_RUNTIME_RETRY_CHANNEL, async (): Promise<CopilotRuntimeLoadResult> => {
    return retryCopilotRuntime()
  })
}

async function loadCopilotRuntime(): Promise<CopilotRuntimeLoadResult> {
  try {
    if (hostedBackendStartupInFlight) {
      const service = ensureHostedBackendService()

      try {
        await service.start()
      } catch (error) {
        const failure = isHostedBackendFailure(error) ? error : service.getLastFailure()
        logHostedBackendFailure('Hosted backend startup failed while loading the runtime snapshot.', failure, error)
      }
    }

    return {
      ok: true,
      snapshot: buildCopilotRuntimeSnapshot(),
    }
  } catch (error) {
    return {
      ok: false,
      error: `Failed to load Copilot runtime snapshot: ${formatUnknownError(error)}`,
    }
  }
}

async function retryCopilotRuntime(): Promise<CopilotRuntimeLoadResult> {
  try {
    await prepareApplicationRuntimePaths()
    const service = ensureHostedBackendService()

    try {
      const state = await service.start()
      logHostedBackendState('Hosted backend retry reached a stable state.', state)
    } catch (error) {
      const failure = isHostedBackendFailure(error) ? error : service.getLastFailure()
      logHostedBackendFailure('Hosted backend retry failed.', failure, error)
    }

    return {
      ok: true,
      snapshot: buildCopilotRuntimeSnapshot(),
    }
  } catch (error) {
    return {
      ok: false,
      error: `Failed to retry hosted backend startup: ${formatUnknownError(error)}`,
    }
  }
}

async function loadCopilotSettings(): Promise<CopilotSettingsLoadResult> {
  return await getUnifiedConfigService().loadCopilotSettings()
}

async function saveCopilotSettings(patch: CopilotSettingsPatch): Promise<CopilotSettingsSaveResult> {
  return await getUnifiedConfigService().saveCopilotSettings(patch)
}

async function loadConfigCenterPublicSnapshot(): Promise<ConfigCenterPublicSnapshotLoadResult> {
  return await getUnifiedConfigService().loadPublicSnapshot()
}

function ensureHostedBackendService(): HostedBackendService {
  if (hostedBackendService === null) {
    const paths = getHostedRuntimePaths()
    const runtimeCommandLineOptions = resolveHostedRuntimeCommandLineOptions()

    hostedBackendService = createHostedBackendService({
      appRoot: APP_ROOT,
      resourcesPath: process.resourcesPath,
      isPackaged: app.isPackaged,
      userDataPath: paths.userDataDir,
      runtimePaths: paths,
      host: runtimeCommandLineOptions.host,
      appMode: runtimeCommandLineOptions.appMode,
      environment: runtimeCommandLineOptions.environment,
      localToken: runtimeCommandLineOptions.localToken,
      model: runtimeCommandLineOptions.model,
    })
  }

  return hostedBackendService
}

async function startHostedBackend(): Promise<void> {
  hostedBackendStartupInFlight = true
  const service = ensureHostedBackendService()
  const paths = getHostedRuntimePaths()

  void appendMainRuntimeLog('info', 'Starting hosted desktop backend.', {
    isPackaged: app.isPackaged,
    userDataPath: paths.userDataDir,
    runtimeRootDir: paths.runtimeRootDir,
    configDir: paths.configDir,
    logsDir: paths.logsDir,
    databaseDir: paths.databaseDir,
    stateDir: paths.stateDir,
  })

  try {
    const state = await service.start()
    logHostedBackendState('Hosted backend is ready.', state)
  } catch (error) {
    const failure = isHostedBackendFailure(error) ? error : service.getLastFailure()
    logHostedBackendFailure('Hosted backend startup failed.', failure, error)
  } finally {
    hostedBackendStartupInFlight = false
  }
}

async function stopHostedBackend(): Promise<void> {
  if (hostedBackendService === null) {
    return
  }

  try {
    await hostedBackendService.stop()
  } catch (error) {
    logHostedBackendFailure('Hosted backend shutdown threw an unexpected error.', null, error)
    return
  }

  const state = hostedBackendService.getState()

  if (state.status === 'failed' && state.lastFailure !== null) {
    logHostedBackendFailure('Hosted backend shutdown completed with a recorded failure.', state.lastFailure)
    return
  }

  logHostedBackendState('Hosted backend stopped.', state)
}

function registerApplicationLifecycleHandlers() {
  app.on('window-all-closed', () => {
    win = null

    if (process.platform !== 'darwin') {
      app.quit()
    }
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })

  app.on('before-quit', (event) => {
    if (quitSequenceStarted) {
      return
    }

    quitSequenceStarted = true
    event.preventDefault()
    void appendMainRuntimeLog('info', 'Electron main process entered before-quit cleanup.', null)

    void stopHostedBackend()
      .catch((error) => {
        logHostedBackendFailure('Hosted backend shutdown failed during application quit.', null, error)
      })
      .finally(() => {
        app.quit()
      })
  })
}

function resolveHostedRuntimeCommandLineOptions() {
  const { options, warning } = parseHostedRuntimeCommandLineArgumentsSafely(process.argv)

  if (warning !== null) {
    console.warn('[desktop-runtime] Ignoring invalid hosted runtime command-line arguments.', JSON.stringify(warning))
    void appendMainRuntimeLog('warn', 'Ignoring invalid hosted runtime command-line arguments.', { ...warning })
  }

  return options
}

function logHostedBackendState(message: string, state: HostedBackendState): void {
  const summary = summarizeHostedBackendState(state)
  console.info(`[desktop-runtime] ${message}`, JSON.stringify(summary))
  void appendMainRuntimeLog('info', message, summary)
}

function logHostedBackendFailure(
  message: string,
  failure: HostedBackendFailure | null,
  error?: unknown,
): void {
  if (failure !== null) {
    const summary = summarizeHostedBackendFailure(failure)
    console.error(`[desktop-runtime] ${message}`, JSON.stringify(summary))
    void appendMainRuntimeLog('error', message, summary)
    return
  }

  const detail = formatUnknownError(error)
  console.error(`[desktop-runtime] ${message}`, detail)
  void appendMainRuntimeLog('error', message, { detail })
}

function getHostedRuntimePaths(): HostedRuntimePaths {
  runtimePaths ??= createHostedRuntimePaths(app.getPath('userData'))
  return runtimePaths
}

function getUnifiedConfigService(): ElectronUnifiedConfigService {
  unifiedConfigService ??= createElectronUnifiedConfigService({
    prepareRuntimePaths: prepareApplicationRuntimePaths,
    appendLog(level, message, context) {
      void appendMainRuntimeLog(level, message, context)
    },
  })

  return unifiedConfigService
}

async function prepareApplicationRuntimePaths(): Promise<HostedRuntimePaths> {
  const paths = getHostedRuntimePaths()
  await ensureHostedRuntimeDirectories(paths)
  return paths
}

async function appendMainRuntimeLog(
  level: RuntimeLogLevel,
  message: string,
  context: Record<string, unknown> | null,
): Promise<void> {
  try {
    const paths = await prepareApplicationRuntimePaths()
    await appendRuntimeLog(paths.hostLogFile, {
      source: 'electron-main',
      level,
      message,
      context: context ?? undefined,
    })
  } catch (error) {
    console.error('[desktop-runtime] Failed to append Electron main log entry.', formatUnknownError(error))
  }
}

function buildCopilotRuntimeSnapshot(): CopilotRuntimeSnapshot {
  const state = hostedBackendService?.getState() ?? createInitialHostedBackendState()
  const status = state.status === 'stopped' && hostedBackendStartupInFlight
    ? 'starting'
    : state.status

  return {
    hosted: {
      status,
      expectedMode: app.isPackaged ? 'bundled' : 'development',
      resolvedMode: state.mode,
      runtimeUrl: hostedBackendService?.getRuntimeBaseUrl() ?? state.baseUrl,
      isPackaged: app.isPackaged,
      failure: summarizeCopilotHostedRuntimeFailure(state.lastFailure),
    },
  }
}

function summarizeCopilotHostedRuntimeFailure(
  failure: HostedBackendFailure | null,
): CopilotHostedRuntimeFailureSummary | null {
  if (failure === null) {
    return null
  }

  return {
    code: failure.code,
    phase: failure.phase,
    message: failure.message,
    retryable: failure.retryable,
    exitCode: failure.exitCode,
    signal: failure.signal,
    timestamp: failure.timestamp,
  }
}

function summarizeHostedBackendState(state: HostedBackendState): Record<string, unknown> {
  return {
    status: state.status,
    mode: state.mode,
    baseUrl: state.baseUrl,
    pid: state.pid,
    startedAt: state.startedAt,
    readyAt: state.readyAt,
    stoppedAt: state.stoppedAt,
    exitCode: state.exitCode,
    signal: state.signal,
    lastFailureCode: state.lastFailure?.code ?? null,
    lastFailurePhase: state.lastFailure?.phase ?? null,
  }
}

function summarizeHostedBackendFailure(failure: HostedBackendFailure): Record<string, unknown> {
  return {
    code: failure.code,
    phase: failure.phase,
    message: failure.message,
    retryable: failure.retryable,
    exitCode: failure.exitCode,
    signal: failure.signal,
    timestamp: failure.timestamp,
  }
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function normalizeRendererConsoleLogLevel(level: number): RuntimeLogLevel {
  if (level >= 3) {
    return 'error'
  }

  if (level === 2) {
    return 'warn'
  }

  return 'info'
}

registerApplicationLifecycleHandlers()

void app.whenReady()
  .then(() => {
    logStartupTrace('app:ready')
    Menu.setApplicationMenu(null)
    registerCopilotSettingsHandlers()
    registerConfigCenterHandlers()
    registerCopilotRuntimeHandlers()
    void startHostedBackend()
    createWindow()
  })
  .catch((error) => {
    console.error('[desktop-runtime] Failed to bootstrap the Electron main process.', formatUnknownError(error))
    void appendMainRuntimeLog('error', 'Failed to bootstrap the Electron main process.', {
      detail: formatUnknownError(error),
    })
    app.quit()
  })
