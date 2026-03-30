import { BrowserWindow } from 'electron'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { MainRuntimeLogger, MainStartupLogger } from './main-runtime-log'
import { formatUnknownError } from './main-runtime-log'
import type { RuntimeLogLevel } from './runtime/runtime-observability'

export interface CreateMainWindowOptions {
  devServerUrl?: string
  preloadPath: string
  publicDir: string
  rendererDistDir: string
  appendMainRuntimeLog: MainRuntimeLogger['appendMainRuntimeLog']
  flushPendingRendererRuntimeConsoleEntries: MainRuntimeLogger['flushPendingRendererRuntimeConsoleEntries']
  logStartupTrace: MainStartupLogger
}

export function createMainWindow(options: CreateMainWindowOptions): BrowserWindow {
  options.logStartupTrace('createWindow:start', {
    devServerUrl: options.devServerUrl ?? null,
  })

  const windowCreatedAt = Date.now()
  const generatedIconDir = path.join(options.publicDir, 'generated-icons')
  const preferredWindowIconPath =
    process.platform === 'win32'
      ? path.join(generatedIconDir, 'icon.ico')
      : path.join(generatedIconDir, 'icon.png')
  const windowIconPath = existsSync(preferredWindowIconPath)
    ? preferredWindowIconPath
    : path.join(options.publicDir, 'candue_icon.png')

  const targetWindow = new BrowserWindow({
    icon: windowIconPath,
    title: 'CanDue',
    width: 1440,
    height: 960,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f3f5f8',
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  targetWindow.setMenuBarVisibility(false)
  registerDeveloperShortcuts(targetWindow, options.appendMainRuntimeLog)

  targetWindow.webContents.on('did-start-loading', () => {
    options.logStartupTrace('webContents:did-start-loading', {
      sinceWindowMs: Date.now() - windowCreatedAt,
    })
  })

  targetWindow.webContents.on('dom-ready', () => {
    options.logStartupTrace('webContents:dom-ready', {
      sinceWindowMs: Date.now() - windowCreatedAt,
    })
  })

  targetWindow.webContents.on('did-finish-load', () => {
    options.logStartupTrace('webContents:did-finish-load', {
      sinceWindowMs: Date.now() - windowCreatedAt,
    })
    options.flushPendingRendererRuntimeConsoleEntries(targetWindow)
  })

  targetWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    options.logStartupTrace('webContents:did-fail-load', {
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
      void options.appendMainRuntimeLog(rendererLogLevel, 'renderer-console', payload, {
        relayToRenderer: false,
      })
    }
  })

  targetWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    void options.appendMainRuntimeLog('error', 'Renderer preload script failed.', {
      sinceWindowMs: Date.now() - windowCreatedAt,
      preloadPath,
      detail: formatUnknownError(error),
    })
  })

  targetWindow.webContents.on('render-process-gone', (_event, details) => {
    void options.appendMainRuntimeLog('error', 'Renderer process exited unexpectedly.', {
      sinceWindowMs: Date.now() - windowCreatedAt,
      reason: details.reason,
      exitCode: details.exitCode,
    })
  })

  targetWindow.webContents.on('unresponsive', () => {
    options.logStartupTrace('webContents:unresponsive', {
      sinceWindowMs: Date.now() - windowCreatedAt,
    })
  })

  if (options.devServerUrl) {
    options.logStartupTrace('window-load:start', {
      kind: 'url',
      target: options.devServerUrl,
    })
    void targetWindow.loadURL(options.devServerUrl)
  } else {
    const target = path.join(options.rendererDistDir, 'index.html')
    options.logStartupTrace('window-load:start', {
      kind: 'file',
      target,
    })
    void targetWindow.loadFile(target)
  }

  return targetWindow
}

function openDetachedDevTools(
  targetWindow: BrowserWindow,
  appendMainRuntimeLog: MainRuntimeLogger['appendMainRuntimeLog'],
): boolean {
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

function registerDeveloperShortcuts(
  targetWindow: BrowserWindow,
  appendMainRuntimeLog: MainRuntimeLogger['appendMainRuntimeLog'],
): void {
  targetWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.key !== 'F12' || input.isAutoRepeat) {
      return
    }

    if (!openDetachedDevTools(targetWindow, appendMainRuntimeLog)) {
      return
    }

    event.preventDefault()
  })
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
