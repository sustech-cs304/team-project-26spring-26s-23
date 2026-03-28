import type { IpcMain, IpcRenderer } from 'electron'
import {
  CONFIG_CENTER_PUBLIC_PATCH_CHANNEL,
  type ConfigCenterPublicPatch,
  type ConfigCenterPublicPatchResult,
} from './config-center/public-patch'
import {
  CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL,
  type ConfigCenterPublicSnapshotLoadResult,
} from './config-center/public-snapshot'
import {
  SETTINGS_WORKSPACE_SECRETS_CLEAR_PROVIDER_API_KEY_CHANNEL,
  SETTINGS_WORKSPACE_SECRETS_LOAD_STATUSES_CHANNEL,
  SETTINGS_WORKSPACE_SECRETS_SAVE_PROVIDER_API_KEY_CHANNEL,
  SETTINGS_WORKSPACE_STATE_LOAD_CHANNEL,
  SETTINGS_WORKSPACE_STATE_SAVE_CHANNEL,
  type SettingsWorkspaceClearProviderApiKeyRequest,
  type SettingsWorkspaceProviderSecretMutationResult,
  type SettingsWorkspaceSaveProviderApiKeyRequest,
  type SettingsWorkspaceSecretsLoadStatusesRequest,
  type SettingsWorkspaceSecretsLoadStatusesResult,
  type SettingsWorkspaceStateLoadResult,
  type SettingsWorkspaceStateSaveResult,
} from './settings-workspace/ipc'
import type { SettingsWorkspaceStateSaveInput } from './settings-workspace/schema'
import {
  COPILOT_RUNTIME_LOAD_CHANNEL,
  COPILOT_RUNTIME_RETRY_CHANNEL,
  type CopilotRuntimeLoadResult,
} from './copilot-runtime'
import { BOOTSTRAP_WINDOW_READY_CHANNEL } from './bootstrap-window'

type IpcMainLike = Pick<IpcMain, 'handle' | 'removeHandler'>
type IpcRendererLike = Pick<IpcRenderer, 'on'>
type ConsoleLike = Pick<Console, 'debug' | 'info' | 'warn' | 'error'>

export const MAIN_PROCESS_RUNTIME_CONSOLE_CHANNEL = 'runtime:main-console'

export type RuntimeConsoleLevel = 'debug' | 'info' | 'warn' | 'error'

export interface RuntimeConsoleEntry {
  source: 'electron-main'
  level: RuntimeConsoleLevel
  message: string
  context?: unknown
  timestamp?: string
}

export interface RendererIpcHandlers {
  loadConfigCenterPublicSnapshot: () => Promise<ConfigCenterPublicSnapshotLoadResult>
  applyConfigCenterPublicPatch: (patch: ConfigCenterPublicPatch) => Promise<ConfigCenterPublicPatchResult>
  loadSettingsWorkspaceState: () => Promise<SettingsWorkspaceStateLoadResult>
  saveSettingsWorkspaceState: (input: SettingsWorkspaceStateSaveInput) => Promise<SettingsWorkspaceStateSaveResult>
  loadSettingsWorkspaceSecretStates: (
    request?: SettingsWorkspaceSecretsLoadStatusesRequest,
  ) => Promise<SettingsWorkspaceSecretsLoadStatusesResult>
  saveSettingsWorkspaceProviderSecret: (
    request: SettingsWorkspaceSaveProviderApiKeyRequest,
  ) => Promise<SettingsWorkspaceProviderSecretMutationResult>
  clearSettingsWorkspaceProviderSecret: (
    request: SettingsWorkspaceClearProviderApiKeyRequest,
  ) => Promise<SettingsWorkspaceProviderSecretMutationResult>
  loadCopilotRuntime: () => Promise<CopilotRuntimeLoadResult>
  retryCopilotRuntime: () => Promise<CopilotRuntimeLoadResult>
  notifyBootstrapWindowReady: () => Promise<void>
}

export function registerRuntimeConsoleForwarding(
  ipcRenderer: IpcRendererLike,
  targetConsole: ConsoleLike = console,
): void {
  ipcRenderer.on(MAIN_PROCESS_RUNTIME_CONSOLE_CHANNEL, (_event, entry: RuntimeConsoleEntry) => {
    writeRuntimeConsoleEntryToBrowserConsole(entry, targetConsole)
  })
}

export function writeRuntimeConsoleEntryToBrowserConsole(
  entry: RuntimeConsoleEntry,
  targetConsole: ConsoleLike = console,
): void {
  writeRuntimeConsoleEntry(entry, targetConsole)
}

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

export function registerRendererIpcHandlers(
  ipcMain: IpcMainLike,
  handlers: RendererIpcHandlers,
): void {
  ipcMain.removeHandler(CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL)
  ipcMain.removeHandler(CONFIG_CENTER_PUBLIC_PATCH_CHANNEL)
  ipcMain.removeHandler(SETTINGS_WORKSPACE_STATE_LOAD_CHANNEL)
  ipcMain.removeHandler(SETTINGS_WORKSPACE_STATE_SAVE_CHANNEL)
  ipcMain.removeHandler(SETTINGS_WORKSPACE_SECRETS_LOAD_STATUSES_CHANNEL)
  ipcMain.removeHandler(SETTINGS_WORKSPACE_SECRETS_SAVE_PROVIDER_API_KEY_CHANNEL)
  ipcMain.removeHandler(SETTINGS_WORKSPACE_SECRETS_CLEAR_PROVIDER_API_KEY_CHANNEL)
  ipcMain.removeHandler(COPILOT_RUNTIME_LOAD_CHANNEL)
  ipcMain.removeHandler(COPILOT_RUNTIME_RETRY_CHANNEL)
  ipcMain.removeHandler(BOOTSTRAP_WINDOW_READY_CHANNEL)

  ipcMain.handle(CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL, async (): Promise<ConfigCenterPublicSnapshotLoadResult> => {
    return await handlers.loadConfigCenterPublicSnapshot()
  })

  ipcMain.handle(
    CONFIG_CENTER_PUBLIC_PATCH_CHANNEL,
    async (_event, patch: ConfigCenterPublicPatch): Promise<ConfigCenterPublicPatchResult> => {
      return await handlers.applyConfigCenterPublicPatch(patch)
    },
  )

  ipcMain.handle(SETTINGS_WORKSPACE_STATE_LOAD_CHANNEL, async (): Promise<SettingsWorkspaceStateLoadResult> => {
    return await handlers.loadSettingsWorkspaceState()
  })

  ipcMain.handle(
    SETTINGS_WORKSPACE_STATE_SAVE_CHANNEL,
    async (_event, input: SettingsWorkspaceStateSaveInput): Promise<SettingsWorkspaceStateSaveResult> => {
    return await handlers.saveSettingsWorkspaceState(input)
    },
  )

  ipcMain.handle(
    SETTINGS_WORKSPACE_SECRETS_LOAD_STATUSES_CHANNEL,
    async (_event, request?: SettingsWorkspaceSecretsLoadStatusesRequest): Promise<SettingsWorkspaceSecretsLoadStatusesResult> => {
      return await handlers.loadSettingsWorkspaceSecretStates(request)
    },
  )

  ipcMain.handle(
    SETTINGS_WORKSPACE_SECRETS_SAVE_PROVIDER_API_KEY_CHANNEL,
    async (
      _event,
      request: SettingsWorkspaceSaveProviderApiKeyRequest,
    ): Promise<SettingsWorkspaceProviderSecretMutationResult> => {
      return await handlers.saveSettingsWorkspaceProviderSecret(request)
    },
  )

  ipcMain.handle(
    SETTINGS_WORKSPACE_SECRETS_CLEAR_PROVIDER_API_KEY_CHANNEL,
    async (
      _event,
      request: SettingsWorkspaceClearProviderApiKeyRequest,
    ): Promise<SettingsWorkspaceProviderSecretMutationResult> => {
      return await handlers.clearSettingsWorkspaceProviderSecret(request)
    },
  )

  ipcMain.handle(COPILOT_RUNTIME_LOAD_CHANNEL, async (): Promise<CopilotRuntimeLoadResult> => {
    return await handlers.loadCopilotRuntime()
  })

  ipcMain.handle(COPILOT_RUNTIME_RETRY_CHANNEL, async (): Promise<CopilotRuntimeLoadResult> => {
    return await handlers.retryCopilotRuntime()
  })

  ipcMain.handle(BOOTSTRAP_WINDOW_READY_CHANNEL, async (): Promise<void> => {
    await handlers.notifyBootstrapWindowReady()
  })
}

function writeRuntimeConsoleEntry(entry: RuntimeConsoleEntry, targetConsole: ConsoleLike): void {
  const method = getConsoleMethod(targetConsole, entry.level)

  if (entry.context === undefined) {
    method(`[${entry.source}]`, entry.message)
    return
  }

  method(`[${entry.source}]`, entry.message, entry.context)
}

function formatRuntimeConsoleEntryForTerminal(entry: RuntimeConsoleEntry): string {
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
