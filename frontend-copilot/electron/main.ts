import { app, BrowserWindow, Menu, ipcMain } from 'electron'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import type {
  ConfigCenterPublicPatch,
  ConfigCenterPublicPatchResult,
} from './config-center/public-patch'
import {
  CONFIG_CENTER_PUBLIC_SNAPSHOT_UPDATED_CHANNEL,
  type ConfigCenterPublicSnapshot,
  type ConfigCenterPublicSnapshotLoadResult,
} from './config-center/public-snapshot'
import type {
  CopilotHostedRuntimeFailureSummary,
  CopilotRuntimeLoadResult,
  CopilotRuntimeSnapshot,
} from './copilot-runtime'
import {
  createElectronUnifiedConfigService,
  type ElectronUnifiedConfigService,
} from './config-center/main-process'
import {
  createElectronSettingsWorkspaceService,
  type ElectronSettingsWorkspaceService,
} from './settings-workspace/main-process'
import type {
  SettingsWorkspaceClearProviderApiKeyRequest,
  SettingsWorkspaceProviderSecretMutationResult,
  SettingsWorkspaceSaveProviderApiKeyRequest,
  SettingsWorkspaceSecretsLoadStatusesRequest,
  SettingsWorkspaceSecretsLoadStatusesResult,
  SettingsWorkspaceStateLoadResult,
  SettingsWorkspaceStateSaveResult,
} from './settings-workspace/ipc'
import type { SettingsWorkspaceStateSaveInput } from './settings-workspace/schema'
import { UNIFIED_CONFIG_DOMAIN_KEYS } from './config-center/schema'
import {
  MAIN_PROCESS_RUNTIME_CONSOLE_CHANNEL,
  registerRendererIpcHandlers,
  writeRuntimeConsoleEntryToTerminal,
  type RuntimeConsoleEntry,
} from './renderer-ipc'
import { showWindowWhenBootstrapScreenIsReady } from './bootstrap-window-controller'
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
let hostedBackendServicePromise: Promise<HostedBackendService> | null = null
let runtimePaths: HostedRuntimePaths | null = null
let unifiedConfigService: ElectronUnifiedConfigService | null = null
let settingsWorkspaceService: ElectronSettingsWorkspaceService | null = null
let quitSequenceStarted = false
let hostedBackendStartupInFlight = false
const electronStartupStartedAt = Date.now()
const pendingRendererRuntimeConsoleEntries: RuntimeConsoleEntry[] = []

function logStartupTrace(stage: string, context: Record<string, unknown> = {}): void {
  const payload = {
    sinceMainMs: Date.now() - electronStartupStartedAt,
    ...context,
  }

  void appendMainRuntimeLog('debug', `[startup] ${stage}`, payload)
}

function openDetachedDevTools(targetWindow: BrowserWindow): boolean {
  if (targetWindow.isDestroyed()) {
    return false
  }

  const { webContents } = targetWindow

  if (webContents.isDestroyed() || webContents.isDevToolsOpened()) {
    return false
  }

  try {
    webContents.openDevTools({
      mode: 'detach',
      activate: true,
    })

    void appendMainRuntimeLog('info', 'Opening detached DevTools window.', {
      triggeredBy: 'F12',
      windowId: targetWindow.id,
    })
    return true
  } catch (error) {
    void appendMainRuntimeLog('warn', 'Failed to open detached DevTools window.', {
      triggeredBy: 'F12',
      windowId: targetWindow.id,
      detail: formatUnknownError(error),
    })
    return false
  }
}

function registerDeveloperShortcuts(targetWindow: BrowserWindow): void {
  targetWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.key !== 'F12' || input.isAutoRepeat) {
      return
    }

    if (!openDetachedDevTools(targetWindow)) {
      return
    }

    event.preventDefault()
  })
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
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f3f5f8',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  const targetWindow = win

  targetWindow.setMenuBarVisibility(false)
  registerDeveloperShortcuts(targetWindow)

  targetWindow.webContents.on('did-start-loading', () => {
    logStartupTrace('webContents:did-start-loading', {
      sinceWindowMs: Date.now() - windowCreatedAt,
    })
  })

  targetWindow.webContents.on('dom-ready', () => {
    logStartupTrace('webContents:dom-ready', {
      sinceWindowMs: Date.now() - windowCreatedAt,
    })
  })

  targetWindow.webContents.on('did-finish-load', () => {
    logStartupTrace('webContents:did-finish-load', {
      sinceWindowMs: Date.now() - windowCreatedAt,
    })
    flushPendingRendererRuntimeConsoleEntries(targetWindow)
  })

  targetWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logStartupTrace('webContents:did-fail-load', {
      sinceWindowMs: Date.now() - windowCreatedAt,
      errorCode,
      errorDescription,
      validatedURL,
    })
  })

  targetWindow.webContents.on('console-message', (details) => {
    const rendererLogLevel = normalizeRendererConsoleLogLevel(details.level)
    const payload = {
      sinceWindowMs: Date.now() - windowCreatedAt,
      level: details.level,
      line: details.lineNumber,
      sourceId: details.sourceId,
      message: details.message,
    }

    if (rendererLogLevel === 'warn' || rendererLogLevel === 'error' || details.message.startsWith('[renderer]')) {
      void appendMainRuntimeLog(rendererLogLevel, 'renderer-console', payload, {
        relayToRenderer: false,
      })
    }
  })

  targetWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    void appendMainRuntimeLog('error', 'Renderer preload script failed.', {
      sinceWindowMs: Date.now() - windowCreatedAt,
      preloadPath,
      detail: formatUnknownError(error),
    })
  })

  targetWindow.webContents.on('render-process-gone', (_event, details) => {
    void appendMainRuntimeLog('error', 'Renderer process exited unexpectedly.', {
      sinceWindowMs: Date.now() - windowCreatedAt,
      reason: details.reason,
      exitCode: details.exitCode,
    })
  })

  targetWindow.webContents.on('unresponsive', () => {
    logStartupTrace('webContents:unresponsive', {
      sinceWindowMs: Date.now() - windowCreatedAt,
    })
  })

  if (VITE_DEV_SERVER_URL) {
    logStartupTrace('window-load:start', {
      kind: 'url',
      target: VITE_DEV_SERVER_URL,
    })
    targetWindow.loadURL(VITE_DEV_SERVER_URL)
  } else {
    const target = path.join(RENDERER_DIST, 'index.html')
    logStartupTrace('window-load:start', {
      kind: 'file',
      target,
    })
    targetWindow.loadFile(target)
  }
}

async function notifyBootstrapWindowReady(): Promise<void> {
  showWindowWhenBootstrapScreenIsReady(win, logStartupTrace)
}


async function loadCopilotRuntime(): Promise<CopilotRuntimeLoadResult> {
  try {
    if (hostedBackendStartupInFlight) {
      const service = await ensureHostedBackendService()

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
    const service = await ensureHostedBackendService()

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

async function loadConfigCenterPublicSnapshot(): Promise<ConfigCenterPublicSnapshotLoadResult> {
  return await getUnifiedConfigService().loadPublicSnapshot()
}

async function applyConfigCenterPublicPatch(
  patch: ConfigCenterPublicPatch,
): Promise<ConfigCenterPublicPatchResult> {
  return await getUnifiedConfigService().applyPublicPatch(patch)
}

async function loadSettingsWorkspaceState(): Promise<SettingsWorkspaceStateLoadResult> {
  return await getSettingsWorkspaceService().loadState()
}

async function saveSettingsWorkspaceState(
  input: SettingsWorkspaceStateSaveInput,
): Promise<SettingsWorkspaceStateSaveResult> {
  return await getSettingsWorkspaceService().saveState(input)
}

async function loadSettingsWorkspaceSecretStates(
  request?: SettingsWorkspaceSecretsLoadStatusesRequest,
): Promise<SettingsWorkspaceSecretsLoadStatusesResult> {
  return await getSettingsWorkspaceService().loadSecretStates(request)
}

async function saveSettingsWorkspaceProviderSecret(
  request: SettingsWorkspaceSaveProviderApiKeyRequest,
): Promise<SettingsWorkspaceProviderSecretMutationResult> {
  return await getSettingsWorkspaceService().saveProviderSecret(request)
}

async function clearSettingsWorkspaceProviderSecret(
  request: SettingsWorkspaceClearProviderApiKeyRequest,
): Promise<SettingsWorkspaceProviderSecretMutationResult> {
  return await getSettingsWorkspaceService().clearProviderSecret(request)
}

async function ensureHostedBackendService(): Promise<HostedBackendService> {
  if (hostedBackendService !== null) {
    return hostedBackendService
  }

  if (hostedBackendServicePromise !== null) {
    return await hostedBackendServicePromise
  }

  hostedBackendServicePromise = (async () => {
    const paths = getHostedRuntimePaths()
    const runtimeCommandLineOptions = resolveHostedRuntimeCommandLineOptions()
    const configuredModel = await loadConfiguredHostedRuntimeModel()

    const service = createHostedBackendService({
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
      configuredModel,
    })

    hostedBackendService = service
    return service
  })()

  try {
    return await hostedBackendServicePromise
  } finally {
    hostedBackendServicePromise = null
  }
}

async function loadConfiguredHostedRuntimeModel(): Promise<string | null> {
  const loadResult = await getUnifiedConfigService().loadSnapshot()
  return loadResult.snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED].values.model
}

async function startHostedBackend(): Promise<void> {
  hostedBackendStartupInFlight = true

  try {
    const service = await ensureHostedBackendService()
    const paths = getHostedRuntimePaths()

    void appendMainRuntimeLog('info', '[desktop-runtime] Starting hosted desktop backend.', {
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
    }
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
    void appendMainRuntimeLog('info', '[desktop-runtime] Electron main process entered before-quit cleanup.', null)

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
    const message = '[desktop-runtime] Ignoring invalid hosted runtime command-line arguments.'
    void appendMainRuntimeLog('warn', message, { ...warning })
  }

  return options
}

function logHostedBackendState(message: string, state: HostedBackendState): void {
  const summary = summarizeHostedBackendState(state)
  void appendMainRuntimeLog('info', `[desktop-runtime] ${message}`, summary)
}

function logHostedBackendFailure(
  message: string,
  failure: HostedBackendFailure | null,
  error?: unknown,
): void {
  const runtimeMessage = `[desktop-runtime] ${message}`

  if (failure !== null) {
    const summary = summarizeHostedBackendFailure(failure)
    void appendMainRuntimeLog('error', runtimeMessage, summary)
    return
  }

  const detail = formatUnknownError(error)
  void appendMainRuntimeLog('error', runtimeMessage, { detail })
}

function getHostedRuntimePaths(): HostedRuntimePaths {
  runtimePaths ??= createHostedRuntimePaths(app.getPath('userData'))
  return runtimePaths
}

function publishConfigCenterPublicSnapshotUpdate(snapshot: ConfigCenterPublicSnapshot): void {
  for (const browserWindow of BrowserWindow.getAllWindows()) {
    if (browserWindow.isDestroyed()) {
      continue
    }

    browserWindow.webContents.send(CONFIG_CENTER_PUBLIC_SNAPSHOT_UPDATED_CHANNEL, snapshot)
  }
}

function getUnifiedConfigService(): ElectronUnifiedConfigService {
  unifiedConfigService ??= createElectronUnifiedConfigService({
    prepareRuntimePaths: prepareApplicationRuntimePaths,
    appendLog(level, message, context) {
      void appendMainRuntimeLog(level, message, context)
    },
    publishPublicSnapshotUpdate: publishConfigCenterPublicSnapshotUpdate,
  })

  return unifiedConfigService
}

function getSettingsWorkspaceService(): ElectronSettingsWorkspaceService {
  settingsWorkspaceService ??= createElectronSettingsWorkspaceService({
    prepareRuntimePaths: prepareApplicationRuntimePaths,
    appendLog(level, message, context) {
      void appendMainRuntimeLog(level, message, context)
    },
  })

  return settingsWorkspaceService
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
  options: {
    relayToRenderer?: boolean
  } = {},
): Promise<void> {
  const entry = createMainRuntimeConsoleEntry(level, message, context)

  if (options.relayToRenderer ?? true) {
    publishMainRuntimeConsoleEntry(entry)
  }

  if (writeRuntimeConsoleEntryToTerminal(entry)) {
    // Terminal emission is intentionally limited to warning-and-above entries.
  }

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

function publishMainRuntimeConsoleEntry(entry: RuntimeConsoleEntry): void {
  const liveWindows = BrowserWindow.getAllWindows().filter((browserWindow) => !browserWindow.isDestroyed())

  if (liveWindows.length === 0) {
    pendingRendererRuntimeConsoleEntries.push(entry)
    return
  }

  for (const browserWindow of liveWindows) {
    browserWindow.webContents.send(MAIN_PROCESS_RUNTIME_CONSOLE_CHANNEL, entry)
  }
}

function flushPendingRendererRuntimeConsoleEntries(targetWindow: BrowserWindow): void {
  if (targetWindow.isDestroyed() || pendingRendererRuntimeConsoleEntries.length === 0) {
    return
  }

  for (const entry of pendingRendererRuntimeConsoleEntries) {
    if (targetWindow.isDestroyed()) {
      return
    }

    targetWindow.webContents.send(MAIN_PROCESS_RUNTIME_CONSOLE_CHANNEL, entry)
  }

  pendingRendererRuntimeConsoleEntries.length = 0
}

function createMainRuntimeConsoleEntry(
  level: RuntimeLogLevel,
  message: string,
  context: Record<string, unknown> | null,
): RuntimeConsoleEntry {
  return {
    source: 'electron-main',
    level,
    message,
    context: context ?? undefined,
    timestamp: new Date().toISOString(),
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

function normalizeRendererConsoleLogLevel(level: number | 'info' | 'warning' | 'error' | 'debug'): RuntimeLogLevel {
  if (level === 'debug') {
    return 'debug'
  }

  if (level === 'error') {
    return 'error'
  }

  if (level === 'warning') {
    return 'warn'
  }

  if (typeof level === 'number') {
    if (level <= 0) {
      return 'debug'
    }

    if (level >= 3) {
      return 'error'
    }

    if (level === 2) {
      return 'warn'
    }
  }

  return 'info'
}

registerApplicationLifecycleHandlers()

void app.whenReady()
  .then(() => {
    logStartupTrace('app:ready')
    Menu.setApplicationMenu(null)
    registerRendererIpcHandlers(ipcMain, {
      loadConfigCenterPublicSnapshot,
      applyConfigCenterPublicPatch,
      loadSettingsWorkspaceState,
      saveSettingsWorkspaceState,
      loadSettingsWorkspaceSecretStates,
      saveSettingsWorkspaceProviderSecret,
      clearSettingsWorkspaceProviderSecret,
      loadCopilotRuntime,
      retryCopilotRuntime,
      notifyBootstrapWindowReady,
    })
    void startHostedBackend()
    createWindow()
  })
  .catch((error) => {
    const message = '[desktop-runtime] Failed to bootstrap the Electron main process.'
    const detail = formatUnknownError(error)
    void appendMainRuntimeLog('error', message, {
      detail,
    })
    app.quit()
  })
