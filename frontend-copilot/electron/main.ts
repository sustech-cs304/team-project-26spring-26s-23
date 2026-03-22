import { app, BrowserWindow, Menu, ipcMain } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  COPILOT_SETTINGS_LOAD_CHANNEL,
  COPILOT_SETTINGS_SAVE_CHANNEL,
  getCopilotSettingsStorageState,
  mergeCopilotSettings,
  normalizeCopilotSettings,
} from './copilot-settings'
import type {
  CopilotSettings,
  CopilotSettingsLoadResult,
  CopilotSettingsPatch,
  CopilotSettingsSaveResult,
} from './copilot-settings'

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
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST
const VITE_PUBLIC = process.env.VITE_PUBLIC ?? RENDERER_DIST

let win: BrowserWindow | null
const COPILOT_SETTINGS_FILE_NAME = 'copilot-settings.json'

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(VITE_PUBLIC, 'electron-vite.svg'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  win.setMenuBarVisibility(false)

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

function registerCopilotSettingsHandlers() {
  ipcMain.removeHandler(COPILOT_SETTINGS_LOAD_CHANNEL)
  ipcMain.removeHandler(COPILOT_SETTINGS_SAVE_CHANNEL)

  ipcMain.handle(COPILOT_SETTINGS_LOAD_CHANNEL, async (): Promise<CopilotSettingsLoadResult> => {
    return loadCopilotSettings()
  })

  ipcMain.handle(COPILOT_SETTINGS_SAVE_CHANNEL, async (_event, patch: CopilotSettingsPatch): Promise<CopilotSettingsSaveResult> => {
    return saveCopilotSettings(patch)
  })
}

async function loadCopilotSettings(): Promise<CopilotSettingsLoadResult> {
  const settingsFilePath = getCopilotSettingsFilePath()

  try {
    const fileContent = await readFile(settingsFilePath, 'utf8')
    const settings = normalizeCopilotSettings(JSON.parse(fileContent))

    return {
      ok: true,
      settings,
      storageState: getCopilotSettingsStorageState(settings),
    }
  } catch (error) {
    if (isFileNotFoundError(error)) {
      const emptySettings = createEmptyCopilotSettings()

      return {
        ok: true,
        settings: emptySettings,
        storageState: 'empty',
      }
    }

    return {
      ok: false,
      error: `Failed to load Copilot settings: ${formatUnknownError(error)}`,
    }
  }
}

async function saveCopilotSettings(patch: CopilotSettingsPatch): Promise<CopilotSettingsSaveResult> {
  const currentSettingsResult = await loadCopilotSettings()

  if (!currentSettingsResult.ok) {
    return currentSettingsResult
  }

  const settings = mergeCopilotSettings(currentSettingsResult.settings, patch)
  const settingsFilePath = getCopilotSettingsFilePath()

  try {
    await mkdir(path.dirname(settingsFilePath), { recursive: true })
    await writeFile(settingsFilePath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')

    return {
      ok: true,
      settings,
      storageState: getCopilotSettingsStorageState(settings),
    }
  } catch (error) {
    return {
      ok: false,
      error: `Failed to save Copilot settings: ${formatUnknownError(error)}`,
    }
  }
}

function getCopilotSettingsFilePath() {
  return path.join(app.getPath('userData'), COPILOT_SETTINGS_FILE_NAME)
}

function createEmptyCopilotSettings(): CopilotSettings {
  return normalizeCopilotSettings({})
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  registerCopilotSettingsHandlers()
  createWindow()
})
