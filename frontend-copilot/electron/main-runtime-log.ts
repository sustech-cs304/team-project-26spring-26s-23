import { BrowserWindow } from 'electron'
import {
  MAIN_PROCESS_RUNTIME_CONSOLE_CHANNEL,
  type RuntimeConsoleEntry,
} from './renderer-ipc-contract'
import { writeRuntimeConsoleEntryToTerminal } from './runtime-console-terminal'
import { appendRuntimeLog, type RuntimeLogLevel } from './runtime/runtime-observability'
import type { HostedRuntimePaths } from './runtime/runtime-paths'

export type MainStartupLogger = (stage: string, context?: Record<string, unknown>) => void

export interface AppendMainRuntimeLogOptions {
  relayToRenderer?: boolean
}

export interface MainRuntimeLogger {
  appendMainRuntimeLog: (
    level: RuntimeLogLevel,
    message: string,
    context: Record<string, unknown> | null,
    options?: AppendMainRuntimeLogOptions,
  ) => Promise<void>
  flushPendingRendererRuntimeConsoleEntries: (targetWindow: BrowserWindow) => void
  logStartupTrace: MainStartupLogger
}

export interface CreateMainRuntimeLoggerOptions {
  electronStartupStartedAt: number
  prepareRuntimePaths: () => Promise<HostedRuntimePaths>
}

export function createMainRuntimeLogger(options: CreateMainRuntimeLoggerOptions): MainRuntimeLogger {
  const pendingRendererRuntimeConsoleEntries: RuntimeConsoleEntry[] = []

  async function appendMainRuntimeLog(
    level: RuntimeLogLevel,
    message: string,
    context: Record<string, unknown> | null,
    appendOptions: AppendMainRuntimeLogOptions = {},
  ): Promise<void> {
    const entry = createMainRuntimeConsoleEntry(level, message, context)

    if (appendOptions.relayToRenderer ?? true) {
      publishMainRuntimeConsoleEntry(entry, pendingRendererRuntimeConsoleEntries)
    }

    if (writeRuntimeConsoleEntryToTerminal(entry)) {
      // Terminal emission is intentionally limited to warning-and-above entries.
    }

    try {
      const paths = await options.prepareRuntimePaths()
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

  function logStartupTrace(stage: string, context: Record<string, unknown> = {}): void {
    const payload = {
      sinceMainMs: Date.now() - options.electronStartupStartedAt,
      ...context,
    }

    void appendMainRuntimeLog('debug', `[startup] ${stage}`, payload)
  }

  return {
    appendMainRuntimeLog,
    flushPendingRendererRuntimeConsoleEntries,
    logStartupTrace,
  }
}

function publishMainRuntimeConsoleEntry(
  entry: RuntimeConsoleEntry,
  pendingRendererRuntimeConsoleEntries: RuntimeConsoleEntry[],
): void {
  const liveWindows = BrowserWindow.getAllWindows().filter((browserWindow) => !browserWindow.isDestroyed())

  if (liveWindows.length === 0) {
    pendingRendererRuntimeConsoleEntries.push(entry)
    return
  }

  for (const browserWindow of liveWindows) {
    browserWindow.webContents.send(MAIN_PROCESS_RUNTIME_CONSOLE_CHANNEL, entry)
  }
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

export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
