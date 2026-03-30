import { formatRuntimeConsoleEntryForTerminal } from './runtime-console-format'
import type { ConsoleLike, RuntimeConsoleEntry } from './renderer-ipc-contract'

export function writeRuntimeConsoleEntryToTerminal(
  entry: RuntimeConsoleEntry,
  targetConsole: ConsoleLike = console,
): boolean {
  if (!shouldWriteRuntimeConsoleEntryToTerminal(entry)) {
    return false
  }

  const formattedMessage = formatRuntimeConsoleEntryForTerminal(entry)

  if (entry.level === 'error') {
    targetConsole.error(formattedMessage)
  } else {
    targetConsole.warn(formattedMessage)
  }

  return true
}

export function shouldWriteRuntimeConsoleEntryToTerminal(entry: RuntimeConsoleEntry): boolean {
  return entry.level === 'warn' || entry.level === 'error'
}
