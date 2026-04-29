import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => {
  const webContents = {
    on: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isDevToolsOpened: vi.fn(() => false),
    openDevTools: vi.fn(),
  }
  const targetWindow = {
    webContents,
    setMenuBarVisibility: vi.fn(),
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    isDestroyed: vi.fn(() => false),
    id: 1,
  }
  const constructorOptions: unknown[] = []
  const BrowserWindow = vi.fn(function BrowserWindowMock(options: unknown) {
    constructorOptions.push(options)
    return targetWindow
  })

  return {
    BrowserWindow,
    constructorOptions,
    targetWindow,
    webContents,
  }
})

vi.mock('electron', () => ({
  BrowserWindow: electronMocks.BrowserWindow,
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
}))

interface BrowserWindowConstructorOptions {
  frame?: boolean
  webPreferences?: {
    preload?: string
    contextIsolation?: boolean
    nodeIntegration?: boolean
    sandbox?: boolean
  }
}

beforeEach(() => {
  vi.resetModules()
  electronMocks.BrowserWindow.mockClear()
  electronMocks.constructorOptions.length = 0
  electronMocks.targetWindow.setMenuBarVisibility.mockClear()
  electronMocks.targetWindow.loadURL.mockClear()
  electronMocks.targetWindow.loadFile.mockClear()
  electronMocks.targetWindow.isDestroyed.mockClear()
  electronMocks.webContents.on.mockClear()
  electronMocks.webContents.isDestroyed.mockClear()
  electronMocks.webContents.isDevToolsOpened.mockClear()
  electronMocks.webContents.openDevTools.mockClear()
})

describe('createMainWindow', () => {
  it('pins explicit renderer security options while preserving the preload bridge', async () => {
    const { createMainWindow } = await import('./main-window')

    createMainWindow({
      devServerUrl: 'http://127.0.0.1:5173',
      preloadPath: 'C:/candue/preload.mjs',
      publicDir: 'C:/candue/public',
      rendererDistDir: 'C:/candue/dist',
      appendMainRuntimeLog: vi.fn(async () => undefined),
      flushPendingRendererRuntimeConsoleEntries: vi.fn(),
      logStartupTrace: vi.fn(),
    })

    expect(electronMocks.BrowserWindow).toHaveBeenCalledOnce()
    expect(electronMocks.targetWindow.setMenuBarVisibility).toHaveBeenCalledWith(false)
    expect(electronMocks.targetWindow.loadURL).toHaveBeenCalledWith('http://127.0.0.1:5173')

    const constructorOptions = electronMocks.constructorOptions[0] as BrowserWindowConstructorOptions
    expect(constructorOptions.frame).toBe(false)
    expect(constructorOptions.webPreferences).toEqual({
      preload: 'C:/candue/preload.mjs',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    })
  })
})
