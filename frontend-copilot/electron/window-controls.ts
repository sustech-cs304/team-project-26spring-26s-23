export const DESKTOP_WINDOW_STATE_LOAD_CHANNEL = 'desktop-window:state:load'
export const DESKTOP_WINDOW_STATE_CHANGED_CHANNEL = 'desktop-window:state:changed'
export const DESKTOP_WINDOW_MINIMIZE_CHANNEL = 'desktop-window:minimize'
export const DESKTOP_WINDOW_TOGGLE_MAXIMIZE_CHANNEL = 'desktop-window:toggle-maximize'
export const DESKTOP_WINDOW_CLOSE_CHANNEL = 'desktop-window:close'

export interface DesktopWindowState {
  isMaximized: boolean
  isFullScreen: boolean
}

export interface DesktopWindowControlsApi {
  loadState: () => Promise<DesktopWindowState>
  minimize: () => Promise<void>
  toggleMaximize: () => Promise<DesktopWindowState>
  close: () => Promise<void>
  onStateChanged: (listener: (state: DesktopWindowState) => void) => () => void
}

export function createDefaultDesktopWindowState(): DesktopWindowState {
  return {
    isMaximized: false,
    isFullScreen: false,
  }
}
