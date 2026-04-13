import { app, BrowserWindow, Menu, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  CONFIG_CENTER_PUBLIC_SNAPSHOT_UPDATED_CHANNEL,
  type ConfigCenterPublicSnapshot,
} from './config-center/public-snapshot'
import type {
  CopilotHostedRuntimeFailureSummary,
  CopilotRuntimeLoadResult,
  CopilotRuntimeSnapshot,
} from './copilot-runtime'
import { createElectronCopilotHistoryService } from './copilot-history-service'
import { showWindowWhenBootstrapScreenIsReady } from './bootstrap-window-controller'
import { registerMainProcessIpcHandlers } from './main-ipc'
import { createMainRuntimeLogger, formatUnknownError } from './main-runtime-log'
import { createMainProcessServices } from './main-services'
import { createMainWindow } from './main-window'
import { createHostedBackendService, type HostedBackendService } from './runtime/hosted-backend-service'
import { createHostModelRouteBridge, type HostModelRouteBridge } from './runtime/host-model-route-bridge'
import { parseHostedRuntimeCommandLineArgumentsSafely } from './runtime/runtime-config'
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
const ELECTRON_APPLICATION_NAME = 'CanDue'
process.env.APP_ROOT = APP_ROOT

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(APP_ROOT, 'public') : RENDERER_DIST
const VITE_PUBLIC = process.env.VITE_PUBLIC ?? RENDERER_DIST

// Set the Electron application name before any userData-derived path is resolved.
app.setName(ELECTRON_APPLICATION_NAME)

let win: BrowserWindow | null = null
let hostedBackendService: HostedBackendService | null = null
let hostedBackendServicePromise: Promise<HostedBackendService> | null = null
let hostModelRouteBridge: HostModelRouteBridge | null = null
let hostModelRouteBridgePromise: Promise<HostModelRouteBridge> | null = null
let runtimePaths: HostedRuntimePaths | null = null
let quitSequenceStarted = false
let hostedBackendStartupInFlight = false
const electronStartupStartedAt = Date.now()
const mainRuntimeLogger = createMainRuntimeLogger({
  electronStartupStartedAt,
  prepareRuntimePaths: prepareApplicationRuntimePaths,
})

const mainProcessServices = createMainProcessServices({
  prepareRuntimePaths: prepareApplicationRuntimePaths,
  appendMainRuntimeLog(level, message, context) {
    return mainRuntimeLogger.appendMainRuntimeLog(level, message, context)
  },
  publishConfigCenterPublicSnapshotUpdate,
  createCopilotHistoryService() {
    return createElectronCopilotHistoryService({
      ensureHostedBackendService,
      getLocalToken() {
        return hostedBackendService?.getLocalToken() ?? null
      },
    })
  },
})

function createWindow(): void {
  win = createMainWindow({
    devServerUrl: VITE_DEV_SERVER_URL,
    preloadPath: path.join(__dirname, 'preload.mjs'),
    publicDir: VITE_PUBLIC,
    rendererDistDir: RENDERER_DIST,
    appendMainRuntimeLog: mainRuntimeLogger.appendMainRuntimeLog,
    flushPendingRendererRuntimeConsoleEntries: mainRuntimeLogger.flushPendingRendererRuntimeConsoleEntries,
    logStartupTrace: mainRuntimeLogger.logStartupTrace,
  })
}

async function notifyBootstrapWindowReady(): Promise<void> {
  showWindowWhenBootstrapScreenIsReady(win, mainRuntimeLogger.logStartupTrace)
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

async function ensureHostModelRouteBridge(): Promise<HostModelRouteBridge> {
  if (hostModelRouteBridge !== null) {
    return hostModelRouteBridge
  }

  if (hostModelRouteBridgePromise !== null) {
    return await hostModelRouteBridgePromise
  }

  hostModelRouteBridgePromise = (async () => {
    const bridge = await createHostModelRouteBridge({
      async resolveProviderRoute(request) {
        return await mainProcessServices.resolveSettingsWorkspaceProviderRoute(request)
      },
    })

    hostModelRouteBridge = bridge
    return bridge
  })()

  try {
    return await hostModelRouteBridgePromise
  } finally {
    hostModelRouteBridgePromise = null
  }
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
    const routeBridge = await ensureHostModelRouteBridge()

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
      hostModelRouteBridgeUrl: routeBridge.bootstrap.url,
      hostModelRouteBridgeToken: routeBridge.bootstrap.token,
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

async function startHostedBackend(): Promise<void> {
  hostedBackendStartupInFlight = true

  try {
    const service = await ensureHostedBackendService()
    const paths = getHostedRuntimePaths()

    void mainRuntimeLogger.appendMainRuntimeLog('info', '[desktop-runtime] Starting hosted desktop backend.', {
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

async function stopHostModelRouteBridge(): Promise<void> {
  if (hostModelRouteBridge === null) {
    return
  }

  const activeBridge = hostModelRouteBridge
  hostModelRouteBridge = null
  hostModelRouteBridgePromise = null
  await activeBridge.stop()
}

async function stopHostedBackend(): Promise<void> {
  if (hostedBackendService === null) {
    await stopHostModelRouteBridge()
    return
  }

  try {
    await hostedBackendService.stop()
  } catch (error) {
    logHostedBackendFailure('Hosted backend shutdown threw an unexpected error.', null, error)
  }

  const state = hostedBackendService.getState()

  if (state.status === 'failed' && state.lastFailure !== null) {
    logHostedBackendFailure('Hosted backend shutdown completed with a recorded failure.', state.lastFailure)
  } else {
    logHostedBackendState('Hosted backend stopped.', state)
  }

  try {
    await stopHostModelRouteBridge()
  } catch (error) {
    logHostedBackendFailure('Host model route bridge shutdown threw an unexpected error.', null, error)
  }
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
    void mainRuntimeLogger.appendMainRuntimeLog('info', '[desktop-runtime] Electron main process entered before-quit cleanup.', null)

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
    void mainRuntimeLogger.appendMainRuntimeLog('warn', message, { ...warning })
  }

  return options
}

function logHostedBackendState(message: string, state: HostedBackendState): void {
  const summary = summarizeHostedBackendState(state)
  void mainRuntimeLogger.appendMainRuntimeLog('info', `[desktop-runtime] ${message}`, summary)
}

function logHostedBackendFailure(
  message: string,
  failure: HostedBackendFailure | null,
  error?: unknown,
): void {
  const runtimeMessage = `[desktop-runtime] ${message}`

  if (failure !== null) {
    const summary = summarizeHostedBackendFailure(failure)
    void mainRuntimeLogger.appendMainRuntimeLog('error', runtimeMessage, summary)
    return
  }

  const detail = formatUnknownError(error)
  void mainRuntimeLogger.appendMainRuntimeLog('error', runtimeMessage, { detail })
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

async function prepareApplicationRuntimePaths(): Promise<HostedRuntimePaths> {
  const paths = getHostedRuntimePaths()
  await ensureHostedRuntimeDirectories(paths)
  return paths
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

registerApplicationLifecycleHandlers()

void app.whenReady()
  .then(() => {
    mainRuntimeLogger.logStartupTrace('app:ready')
    Menu.setApplicationMenu(null)
    registerMainProcessIpcHandlers(ipcMain, {
      services: mainProcessServices,
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
    void mainRuntimeLogger.appendMainRuntimeLog('error', message, {
      detail,
    })
    app.quit()
  })
