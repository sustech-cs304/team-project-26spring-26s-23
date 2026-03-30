import type { RuntimeConsoleEntry, RuntimeConsoleLevel } from './renderer-ipc-contract'

export function formatRuntimeConsoleEntryForTerminal(entry: RuntimeConsoleEntry): string {
  const timestamp = colorize(TerminalAnsi.Dim, formatRuntimeConsoleTimestamp(entry.timestamp))
  const levelBadge = formatRuntimeConsoleLevelBadge(entry.level)
  const moduleLabel = colorize(TerminalAnsi.Cyan, `[${resolveRuntimeConsoleModule(entry)}]`)

  if (isRendererConsolePayload(entry.context)) {
    return `${timestamp} ${levelBadge} ${moduleLabel} ${formatRendererConsoleEntryForTerminal(entry.context)}`
  }

  const message = sanitizeConsoleText(entry.message)

  if (entry.context === undefined) {
    return `${timestamp} ${levelBadge} ${moduleLabel} ${message}`
  }

  return `${timestamp} ${levelBadge} ${moduleLabel} ${message} ${formatRuntimeContextForTerminal(entry.context)}`
}

function formatRendererConsoleEntryForTerminal(payload: RendererConsolePayload): string {
  const severity = normalizeRendererConsoleSeverity(payload.level)
  const message = sanitizeConsoleText(payload.message)
  const location = formatRendererConsoleLocation(payload.sourceId, payload.line)
  const severityLabel = colorize(TerminalAnsi.Yellow, severity.toUpperCase())

  if (location === '') {
    return `${severityLabel} ${message}`
  }

  return `${severityLabel} ${message} ${colorize(TerminalAnsi.Dim, location)}`
}

function formatRuntimeContextForTerminal(context: unknown): string {
  if (typeof context === 'object' && context !== null && !Array.isArray(context)) {
    const entries = Object.entries(context as Record<string, unknown>)

    if (entries.length > 0) {
      return entries.map(([key, value]) => `${key}=${formatRuntimeContextValue(value)}`).join(' ')
    }
  }

  try {
    return JSON.stringify(context)
  } catch {
    return String(context)
  }
}

function formatRendererConsoleLocation(sourceId: string | null, line: number | null): string {
  if (sourceId === null && line === null) {
    return ''
  }

  if (sourceId !== null && line !== null) {
    return `(${sourceId}:${line})`
  }

  if (sourceId !== null) {
    return `(${sourceId})`
  }

  return `(line ${line})`
}

function normalizeRendererConsoleSeverity(level: string | number): string {
  if (level === 'warning' || level === 2) {
    return 'warning'
  }

  if (level === 'error' || level === 3) {
    return 'error'
  }

  if (level === 'debug' || level === 0) {
    return 'debug'
  }

  return 'info'
}

function sanitizeConsoleText(value: string): string {
  return value.replace(/%c/g, '').replace(/\s+/g, ' ').trim()
}

function formatRuntimeContextValue(value: unknown): string {
  if (typeof value === 'string') {
    const sanitized = sanitizeConsoleText(value)
    return /\s/.test(sanitized) ? JSON.stringify(sanitized) : sanitized
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) {
    return String(value)
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function resolveRuntimeConsoleModule(entry: RuntimeConsoleEntry): string {
  if (entry.message === 'renderer-console') {
    return 'renderer-console'
  }

  const messagePrefixMatch = entry.message.match(/^\[([^\]]+)\]/)
  if (messagePrefixMatch !== null) {
    return messagePrefixMatch[1]
  }

  return entry.source
}

function formatRuntimeConsoleTimestamp(timestamp?: string): string {
  const date = timestamp === undefined ? new Date() : new Date(timestamp)

  if (Number.isNaN(date.valueOf())) {
    return '--:--:--.---'
  }

  return `${padTimePart(date.getHours(), 2)}:${padTimePart(date.getMinutes(), 2)}:${padTimePart(date.getSeconds(), 2)}.${padTimePart(date.getMilliseconds(), 3)}`
}

function formatRuntimeConsoleLevelBadge(level: RuntimeConsoleLevel): string {
  switch (level) {
    case 'error':
      return colorize(`${TerminalAnsi.BgRed}${TerminalAnsi.BrightWhite}`, ' ERROR ')
    case 'warn':
      return colorize(`${TerminalAnsi.BgYellow}${TerminalAnsi.Black}`, ' WARN ')
    case 'debug':
      return colorize(`${TerminalAnsi.BgBlue}${TerminalAnsi.BrightWhite}`, ' DEBUG ')
    case 'info':
    default:
      return colorize(`${TerminalAnsi.BgCyan}${TerminalAnsi.Black}`, ' INFO ')
  }
}

function padTimePart(value: number, length: number): string {
  return String(value).padStart(length, '0')
}

function colorize(ansiCode: string, value: string): string {
  return `${ansiCode}${value}${TerminalAnsi.Reset}`
}

const enum TerminalAnsi {
  Reset = '\u001B[0m',
  Black = '\u001B[30m',
  BrightWhite = '\u001B[97m',
  Yellow = '\u001B[33m',
  Cyan = '\u001B[36m',
  Dim = '\u001B[90m',
  BgRed = '\u001B[41m',
  BgYellow = '\u001B[43m',
  BgBlue = '\u001B[44m',
  BgCyan = '\u001B[46m',
}

interface RendererConsolePayload {
  level: string | number
  line: number | null
  sourceId: string | null
  message: string
}

function isRendererConsolePayload(value: unknown): value is RendererConsolePayload {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Record<string, unknown>
  return candidate['message'] !== undefined
    && candidate['sourceId'] !== undefined
    && candidate['line'] !== undefined
    && candidate['level'] !== undefined
}
