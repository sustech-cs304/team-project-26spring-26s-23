import type { ConsoleLike, IpcRendererLike, RuntimeConsoleEntry, RuntimeConsoleLevel } from './renderer-ipc-contract'
import { MAIN_PROCESS_RUNTIME_CONSOLE_CHANNEL } from './renderer-ipc-contract'

export function registerRuntimeConsoleForwarding(
  ipcRenderer: IpcRendererLike,
  targetConsole: ConsoleLike = console,
): () => void {
  const listener = (_event: unknown, entry: RuntimeConsoleEntry) => {
    writeRuntimeConsoleEntryToBrowserConsole(entry, targetConsole)
  }

  ipcRenderer.on(MAIN_PROCESS_RUNTIME_CONSOLE_CHANNEL, listener)

  return () => {
    ipcRenderer.off(MAIN_PROCESS_RUNTIME_CONSOLE_CHANNEL, listener)
  }
}

export function writeRuntimeConsoleEntryToBrowserConsole(
  entry: RuntimeConsoleEntry,
  targetConsole: ConsoleLike = console,
): void {
  writeRuntimeConsoleEntry(entry, targetConsole)
}

function writeRuntimeConsoleEntry(entry: RuntimeConsoleEntry, targetConsole: ConsoleLike): void {
  const method = getConsoleMethod(targetConsole, entry.level)

  if (entry.context === undefined) {
    method(`[${entry.source}]`, entry.message)
    return
  }

  method(`[${entry.source}]`, entry.message, entry.context)
}

function getConsoleMethod(targetConsole: ConsoleLike, level: RuntimeConsoleLevel): (...data: unknown[]) => void {
  switch (level) {
    case 'debug':
      return targetConsole.debug.bind(targetConsole)
    case 'warn':
      return targetConsole.warn.bind(targetConsole)
    case 'error':
      return targetConsole.error.bind(targetConsole)
    case 'info':
    default:
      return targetConsole.info.bind(targetConsole)
  }
}
