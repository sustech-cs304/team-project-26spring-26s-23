import type { IpcRenderer } from 'electron'

export type IpcRendererLike = Pick<IpcRenderer, 'on' | 'off'>
export type ConsoleLike = Pick<Console, 'debug' | 'info' | 'warn' | 'error'>

export const MAIN_PROCESS_RUNTIME_CONSOLE_CHANNEL = 'runtime:main-console'

export type RuntimeConsoleLevel = 'debug' | 'info' | 'warn' | 'error'

export interface RuntimeConsoleEntry {
  source: 'electron-main'
  level: RuntimeConsoleLevel
  message: string
  context?: unknown
  timestamp?: string
}
