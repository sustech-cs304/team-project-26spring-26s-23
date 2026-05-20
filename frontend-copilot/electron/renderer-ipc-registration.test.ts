import { describe, expect, it, vi } from 'vitest'

import {
  ATTACHMENT_MANAGER_CLEANUP_TEMP_FILES_CHANNEL,
  ATTACHMENT_MANAGER_READ_CLIPBOARD_DATA_CHANNEL,
  ATTACHMENT_MANAGER_READ_PREVIEW_CHANNEL,
  ATTACHMENT_MANAGER_WRITE_TEMP_FILE_CHANNEL,
} from './attachment-service/ipc'
import { BOOTSTRAP_WINDOW_READY_CHANNEL } from './bootstrap-window'
import { CONFIG_CENTER_PUBLIC_PATCH_CHANNEL } from './config-center/public-patch'
import { CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL } from './config-center/public-snapshot'
import {
  COPILOT_HISTORY_BACKUP_DATABASE_CHANNEL,
  COPILOT_HISTORY_DELETE_THREAD_CHANNEL,
  COPILOT_HISTORY_DUPLICATE_THREAD_CHANNEL,
  COPILOT_HISTORY_GET_RUN_REPLAY_CHANNEL,
  COPILOT_HISTORY_GET_THREAD_DETAIL_CHANNEL,
  COPILOT_HISTORY_LIST_THREADS_CHANNEL,
  COPILOT_HISTORY_RENAME_THREAD_CHANNEL,
  COPILOT_HISTORY_RESTORE_DATABASE_CHANNEL,
} from './copilot-history'
import { COPILOT_RUNTIME_LOAD_CHANNEL, COPILOT_RUNTIME_LOCAL_TOKEN_CHANNEL, COPILOT_RUNTIME_RETRY_CHANNEL } from './copilot-runtime'
import {
  MANAGED_RUNTIME_INSTALL_OR_REPAIR_CHANNEL,
  MANAGED_RUNTIME_LOAD_CHANNEL,
} from './managed-runtime/ipc'
import {
  MCP_REGISTRY_DELETE_SERVER_CHANNEL,
  MCP_REGISTRY_LOAD_CHANNEL,
  MCP_REGISTRY_REFRESH_CATALOG_CHANNEL,
  MCP_REGISTRY_SAVE_SERVER_CHANNEL,
  MCP_REGISTRY_SET_SERVER_ENABLED_CHANNEL,
  MCP_REGISTRY_TEST_CONNECTION_CHANNEL,
} from './mcp-registry/ipc'
import {
  SKILL_REGISTRY_DELETE_SKILL_CHANNEL,
  SKILL_REGISTRY_IMPORT_SKILL_CHANNEL,
  SKILL_REGISTRY_LOAD_CHANNEL,
  SKILL_REGISTRY_REFRESH_SKILLS_CHANNEL,
  SKILL_REGISTRY_SELECT_AND_IMPORT_SKILL_CHANNEL,
  SKILL_REGISTRY_SET_SKILL_ENABLED_CHANNEL,
} from './skill-registry/ipc'
import { TOOL_CATALOG_LOAD_CHANNEL } from './tool-catalog/ipc'
import { DESKTOP_NOTIFICATION_SHOW_CHANNEL } from './desktop-notification'
import {
  DESKTOP_WINDOW_CLOSE_CHANNEL,
  DESKTOP_WINDOW_MINIMIZE_CHANNEL,
  DESKTOP_WINDOW_STATE_LOAD_CHANNEL,
  DESKTOP_WINDOW_TOGGLE_MAXIMIZE_CHANNEL,
} from './window-controls'
import {
  FILE_MANAGER_COPY_ENTRIES_CHANNEL,
  FILE_MANAGER_COPY_TEXT_TO_CLIPBOARD_CHANNEL,
  FILE_MANAGER_CREATE_DIRECTORY_CHANNEL,
  FILE_MANAGER_DELETE_ENTRIES_PERMANENTLY_CHANNEL,
  FILE_MANAGER_LIST_DIRECTORY_CHANNEL,
  FILE_MANAGER_MOVE_ENTRIES_CHANNEL,
  FILE_MANAGER_OPEN_ENTRY_WITH_SYSTEM_CHANNEL,
  FILE_MANAGER_PROBE_DIRECTORY_CHANNEL,
  FILE_MANAGER_RENAME_ENTRY_CHANNEL,
  FILE_MANAGER_REVEAL_ENTRY_IN_FOLDER_CHANNEL,
  FILE_MANAGER_SELECT_ROOT_DIRECTORY_CHANNEL,
  FILE_MANAGER_TRASH_ENTRIES_CHANNEL,
  FILE_MANAGER_WATCH_DIRECTORIES_CHANNEL,
  FILE_MANAGER_UNWATCH_DIRECTORIES_CHANNEL,
  FILE_MANAGER_LOAD_LAST_ROOT_DIRECTORY_CHANNEL,
  FILE_MANAGER_SAVE_LAST_ROOT_DIRECTORY_CHANNEL,
  FILE_MANAGER_CLEAR_LAST_ROOT_DIRECTORY_CHANNEL,
} from './file-manager/ipc'
import { registerMainProcessIpcHandlers } from './main-ipc'
import type { MainProcessServices } from './main-services'
import { createRendererIpcHandlers } from './renderer-ipc-handlers.test-support'
import { createMcpStdioStubServerFixture, createSkillRecordFixture } from './renderer-ipc.test-support'
import { createFakeIpcMain } from './renderer-ipc-transport.test-support'
import { registerRendererIpcHandlers } from './renderer-ipc-registration'

const BACKUP_PATH = 'backups/history.db'
const IMAGE_PNG = 'image/png' as const
const PASTED_IMAGE = 'pasted-image.png'
const README_PATH = '/tmp/readme.txt'
const TEMP_ATTACHMENT_PATH = '/tmp/candue-attachments/pasted-image.png'
const TEST_ROOT = '/test/root'
const TEST_FILE = '/test/file.txt'
const COPIED_TEXT = 'copied text'
const BASE64_DATA = 'cG5nLWRhdGE='

const EXPECTED_REMOVE_CHANNELS = [
  CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL,
  CONFIG_CENTER_PUBLIC_PATCH_CHANNEL,
  'settings-workspace-state:load',
  'settings-workspace-state:save',
  'settings-workspace-secrets:load-statuses',
  'settings-workspace-secrets:load-sustech-cas',
  'settings-workspace-secrets:save-provider-api-key',
  'settings-workspace-secrets:clear-provider-api-key',
  'settings-workspace-secrets:save-sustech-cas',
  'settings-workspace-secrets:clear-sustech-cas',
  MANAGED_RUNTIME_INSTALL_OR_REPAIR_CHANNEL,
  MANAGED_RUNTIME_LOAD_CHANNEL,
  MCP_REGISTRY_LOAD_CHANNEL,
  MCP_REGISTRY_SAVE_SERVER_CHANNEL,
  MCP_REGISTRY_DELETE_SERVER_CHANNEL,
  MCP_REGISTRY_SET_SERVER_ENABLED_CHANNEL,
  MCP_REGISTRY_TEST_CONNECTION_CHANNEL,
  MCP_REGISTRY_REFRESH_CATALOG_CHANNEL,
  SKILL_REGISTRY_LOAD_CHANNEL,
  SKILL_REGISTRY_IMPORT_SKILL_CHANNEL,
  SKILL_REGISTRY_SELECT_AND_IMPORT_SKILL_CHANNEL,
  SKILL_REGISTRY_DELETE_SKILL_CHANNEL,
  SKILL_REGISTRY_SET_SKILL_ENABLED_CHANNEL,
  SKILL_REGISTRY_REFRESH_SKILLS_CHANNEL,
  COPILOT_HISTORY_LIST_THREADS_CHANNEL,
  COPILOT_HISTORY_GET_THREAD_DETAIL_CHANNEL,
  COPILOT_HISTORY_GET_RUN_REPLAY_CHANNEL,
  COPILOT_HISTORY_RENAME_THREAD_CHANNEL,
  COPILOT_HISTORY_DUPLICATE_THREAD_CHANNEL,
  COPILOT_HISTORY_DELETE_THREAD_CHANNEL,
  COPILOT_HISTORY_BACKUP_DATABASE_CHANNEL,
  COPILOT_HISTORY_RESTORE_DATABASE_CHANNEL,
  TOOL_CATALOG_LOAD_CHANNEL,
  COPILOT_RUNTIME_LOAD_CHANNEL,
  COPILOT_RUNTIME_RETRY_CHANNEL,
  COPILOT_RUNTIME_LOCAL_TOKEN_CHANNEL,
  ATTACHMENT_MANAGER_READ_CLIPBOARD_DATA_CHANNEL,
  ATTACHMENT_MANAGER_WRITE_TEMP_FILE_CHANNEL,
  ATTACHMENT_MANAGER_READ_PREVIEW_CHANNEL,
  ATTACHMENT_MANAGER_CLEANUP_TEMP_FILES_CHANNEL,
  DESKTOP_NOTIFICATION_SHOW_CHANNEL,
  BOOTSTRAP_WINDOW_READY_CHANNEL,
  DESKTOP_WINDOW_STATE_LOAD_CHANNEL,
  DESKTOP_WINDOW_MINIMIZE_CHANNEL,
  DESKTOP_WINDOW_TOGGLE_MAXIMIZE_CHANNEL,
  DESKTOP_WINDOW_CLOSE_CHANNEL,
  FILE_MANAGER_SELECT_ROOT_DIRECTORY_CHANNEL,
  FILE_MANAGER_LIST_DIRECTORY_CHANNEL,
  FILE_MANAGER_PROBE_DIRECTORY_CHANNEL,
  FILE_MANAGER_CREATE_DIRECTORY_CHANNEL,
  FILE_MANAGER_COPY_ENTRIES_CHANNEL,
  FILE_MANAGER_MOVE_ENTRIES_CHANNEL,
  FILE_MANAGER_RENAME_ENTRY_CHANNEL,
  FILE_MANAGER_TRASH_ENTRIES_CHANNEL,
  FILE_MANAGER_DELETE_ENTRIES_PERMANENTLY_CHANNEL,
  FILE_MANAGER_WATCH_DIRECTORIES_CHANNEL,
  FILE_MANAGER_UNWATCH_DIRECTORIES_CHANNEL,
  FILE_MANAGER_LOAD_LAST_ROOT_DIRECTORY_CHANNEL,
  FILE_MANAGER_SAVE_LAST_ROOT_DIRECTORY_CHANNEL,
  FILE_MANAGER_CLEAR_LAST_ROOT_DIRECTORY_CHANNEL,
  FILE_MANAGER_OPEN_ENTRY_WITH_SYSTEM_CHANNEL,
  FILE_MANAGER_REVEAL_ENTRY_IN_FOLDER_CHANNEL,
  FILE_MANAGER_COPY_TEXT_TO_CLIPBOARD_CHANNEL,
]

const EXPECTED_HANDLE_CHANNELS = [
  CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL,
  CONFIG_CENTER_PUBLIC_PATCH_CHANNEL,
  'settings-workspace-state:load',
  'settings-workspace-state:save',
  'settings-workspace-secrets:load-statuses',
  'settings-workspace-secrets:load-sustech-cas',
  'settings-workspace-secrets:save-provider-api-key',
  'settings-workspace-secrets:clear-provider-api-key',
  'settings-workspace-secrets:save-sustech-cas',
  'settings-workspace-secrets:clear-sustech-cas',
  MANAGED_RUNTIME_LOAD_CHANNEL,
  MANAGED_RUNTIME_INSTALL_OR_REPAIR_CHANNEL,
  MCP_REGISTRY_LOAD_CHANNEL,
  MCP_REGISTRY_SAVE_SERVER_CHANNEL,
  MCP_REGISTRY_DELETE_SERVER_CHANNEL,
  MCP_REGISTRY_SET_SERVER_ENABLED_CHANNEL,
  MCP_REGISTRY_TEST_CONNECTION_CHANNEL,
  MCP_REGISTRY_REFRESH_CATALOG_CHANNEL,
  SKILL_REGISTRY_LOAD_CHANNEL,
  SKILL_REGISTRY_IMPORT_SKILL_CHANNEL,
  SKILL_REGISTRY_SELECT_AND_IMPORT_SKILL_CHANNEL,
  SKILL_REGISTRY_DELETE_SKILL_CHANNEL,
  SKILL_REGISTRY_SET_SKILL_ENABLED_CHANNEL,
  SKILL_REGISTRY_REFRESH_SKILLS_CHANNEL,
  COPILOT_HISTORY_LIST_THREADS_CHANNEL,
  COPILOT_HISTORY_GET_THREAD_DETAIL_CHANNEL,
  COPILOT_HISTORY_GET_RUN_REPLAY_CHANNEL,
  COPILOT_HISTORY_RENAME_THREAD_CHANNEL,
  COPILOT_HISTORY_DUPLICATE_THREAD_CHANNEL,
  COPILOT_HISTORY_DELETE_THREAD_CHANNEL,
  COPILOT_HISTORY_BACKUP_DATABASE_CHANNEL,
  COPILOT_HISTORY_RESTORE_DATABASE_CHANNEL,
  TOOL_CATALOG_LOAD_CHANNEL,
  COPILOT_RUNTIME_LOAD_CHANNEL,
  COPILOT_RUNTIME_RETRY_CHANNEL,
  COPILOT_RUNTIME_LOCAL_TOKEN_CHANNEL,
  ATTACHMENT_MANAGER_READ_CLIPBOARD_DATA_CHANNEL,
  ATTACHMENT_MANAGER_WRITE_TEMP_FILE_CHANNEL,
  ATTACHMENT_MANAGER_READ_PREVIEW_CHANNEL,
  ATTACHMENT_MANAGER_CLEANUP_TEMP_FILES_CHANNEL,
  DESKTOP_NOTIFICATION_SHOW_CHANNEL,
  BOOTSTRAP_WINDOW_READY_CHANNEL,
  DESKTOP_WINDOW_STATE_LOAD_CHANNEL,
  DESKTOP_WINDOW_MINIMIZE_CHANNEL,
  DESKTOP_WINDOW_TOGGLE_MAXIMIZE_CHANNEL,
  DESKTOP_WINDOW_CLOSE_CHANNEL,
  FILE_MANAGER_SELECT_ROOT_DIRECTORY_CHANNEL,
  FILE_MANAGER_LIST_DIRECTORY_CHANNEL,
  FILE_MANAGER_PROBE_DIRECTORY_CHANNEL,
  FILE_MANAGER_CREATE_DIRECTORY_CHANNEL,
  FILE_MANAGER_COPY_ENTRIES_CHANNEL,
  FILE_MANAGER_MOVE_ENTRIES_CHANNEL,
  FILE_MANAGER_RENAME_ENTRY_CHANNEL,
  FILE_MANAGER_TRASH_ENTRIES_CHANNEL,
  FILE_MANAGER_DELETE_ENTRIES_PERMANENTLY_CHANNEL,
  FILE_MANAGER_WATCH_DIRECTORIES_CHANNEL,
  FILE_MANAGER_UNWATCH_DIRECTORIES_CHANNEL,
  FILE_MANAGER_LOAD_LAST_ROOT_DIRECTORY_CHANNEL,
  FILE_MANAGER_SAVE_LAST_ROOT_DIRECTORY_CHANNEL,
  FILE_MANAGER_CLEAR_LAST_ROOT_DIRECTORY_CHANNEL,
  FILE_MANAGER_OPEN_ENTRY_WITH_SYSTEM_CHANNEL,
  FILE_MANAGER_REVEAL_ENTRY_IN_FOLDER_CHANNEL,
  FILE_MANAGER_COPY_TEXT_TO_CLIPBOARD_CHANNEL,
]

function setupRegistration() {
  const { registeredHandlers, ipcMain } = createFakeIpcMain()
  const handlers = createRendererIpcHandlers()
  registerRendererIpcHandlers(ipcMain as never, handlers)
  return { registeredHandlers, ipcMain, handlers }
}

function getRegisteredHandler(
  registeredHandlers: Map<string, (...args: unknown[]) => Promise<unknown> | unknown>,
  channel: string,
): (...args: unknown[]) => Promise<unknown> {
  const handler = registeredHandlers.get(channel)
  if (handler === undefined) throw new Error(`Expected IPC handler for channel "${channel}".`)
  return handler as (...args: unknown[]) => Promise<unknown>
}

// eslint-disable-next-line max-lines-per-function
describe('registerRendererIpcHandlers', () => {
  it('registers only the expected renderer IPC channels', () => {
    const { registeredHandlers, ipcMain } = setupRegistration()

    expect(ipcMain.removeHandler.mock.calls.map(([channel]) => channel)).toEqual(EXPECTED_REMOVE_CHANNELS)
    expect([...registeredHandlers.keys()]).toEqual(EXPECTED_HANDLE_CHANNELS)
    expect(registeredHandlers.has('copilot-settings:load')).toBe(false)
    expect(registeredHandlers.has('copilot-settings:save')).toBe(false)
  })

  it('wires config center and settings workspace handlers', async () => {
    const { registeredHandlers, handlers } = setupRegistration()

    const loadSnapshot = getRegisteredHandler(registeredHandlers, CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL)
    const applyPatch = getRegisteredHandler(registeredHandlers, CONFIG_CENTER_PUBLIC_PATCH_CHANNEL)

    await expect(loadSnapshot()).resolves.toEqual(await handlers.loadConfigCenterPublicSnapshot())
    await expect(applyPatch(undefined, { domains: { frontendPreferences: { theme: 'dark' } } })).resolves.toEqual(
      await handlers.applyConfigCenterPublicPatch({ domains: { frontendPreferences: { theme: 'dark' } } }),
    )
  })

  it('wires MCP registry and managed runtime handlers', async () => {
    const { registeredHandlers, handlers } = setupRegistration()
    const mcpServerDraft = createMcpStdioStubServerFixture()

    await expect(getRegisteredHandler(registeredHandlers, MANAGED_RUNTIME_LOAD_CHANNEL)()).resolves.toEqual(await handlers.loadManagedRuntime())
    await expect(getRegisteredHandler(registeredHandlers, MCP_REGISTRY_LOAD_CHANNEL)(undefined, { language: 'zh-CN', includeDisabled: true })).resolves.toEqual(
      await handlers.loadMcpRegistry({ language: 'zh-CN', includeDisabled: true }),
    )
    await expect(getRegisteredHandler(registeredHandlers, MCP_REGISTRY_SAVE_SERVER_CHANNEL)(undefined, mcpServerDraft)).resolves.toEqual(
      await handlers.saveMcpServer(mcpServerDraft),
    )
    await expect(getRegisteredHandler(registeredHandlers, MCP_REGISTRY_DELETE_SERVER_CHANNEL)(undefined, mcpServerDraft.serverId)).resolves.toEqual(
      await handlers.deleteMcpServer(mcpServerDraft.serverId),
    )
    await expect(getRegisteredHandler(registeredHandlers, MCP_REGISTRY_SET_SERVER_ENABLED_CHANNEL)(undefined, { serverId: mcpServerDraft.serverId, enabled: false })).resolves.toEqual(
      await handlers.setMcpServerEnabled({ serverId: mcpServerDraft.serverId, enabled: false }),
    )
    await expect(getRegisteredHandler(registeredHandlers, MCP_REGISTRY_TEST_CONNECTION_CHANNEL)(undefined, { draft: mcpServerDraft })).resolves.toEqual(
      await handlers.testMcpConnection({ draft: mcpServerDraft }),
    )
    await expect(getRegisteredHandler(registeredHandlers, MCP_REGISTRY_REFRESH_CATALOG_CHANNEL)(undefined, { serverId: mcpServerDraft.serverId })).resolves.toEqual(
      await handlers.refreshMcpCatalog({ serverId: mcpServerDraft.serverId }),
    )
  })

  it('wires skill registry handlers', async () => {
    const { registeredHandlers, handlers } = setupRegistration()
    const skillRecord = createSkillRecordFixture()

    await expect(getRegisteredHandler(registeredHandlers, SKILL_REGISTRY_LOAD_CHANNEL)(undefined, { includeDisabled: true })).resolves.toEqual(
      await handlers.loadSkillRegistry({ includeDisabled: true }),
    )
    await expect(getRegisteredHandler(registeredHandlers, SKILL_REGISTRY_IMPORT_SKILL_CHANNEL)(undefined, { sourceDirectory: 'D:/skills/writing-clear-docs' })).resolves.toEqual(
      await handlers.importSkill({ sourceDirectory: 'D:/skills/writing-clear-docs' }),
    )
    await expect(getRegisteredHandler(registeredHandlers, SKILL_REGISTRY_SELECT_AND_IMPORT_SKILL_CHANNEL)()).resolves.toEqual(await handlers.selectAndImportSkill())
    await expect(getRegisteredHandler(registeredHandlers, SKILL_REGISTRY_DELETE_SKILL_CHANNEL)(undefined, skillRecord.skillId)).resolves.toEqual(
      await handlers.deleteSkill(skillRecord.skillId),
    )
    await expect(getRegisteredHandler(registeredHandlers, SKILL_REGISTRY_SET_SKILL_ENABLED_CHANNEL)(undefined, { skillId: skillRecord.skillId, enabled: false })).resolves.toEqual(
      await handlers.setSkillEnabled({ skillId: skillRecord.skillId, enabled: false }),
    )
    await expect(getRegisteredHandler(registeredHandlers, SKILL_REGISTRY_REFRESH_SKILLS_CHANNEL)(undefined, { skillId: skillRecord.skillId })).resolves.toEqual(
      await handlers.refreshSkills({ skillId: skillRecord.skillId }),
    )
  })

  it('wires copilot history handlers', async () => {
    const { registeredHandlers, handlers } = setupRegistration()

    await expect(getRegisteredHandler(registeredHandlers, COPILOT_HISTORY_LIST_THREADS_CHANNEL)()).resolves.toEqual(await handlers.listCopilotHistoryThreads())
    await expect(getRegisteredHandler(registeredHandlers, COPILOT_HISTORY_GET_THREAD_DETAIL_CHANNEL)(undefined, 'thread-1')).resolves.toEqual(
      await handlers.getCopilotHistoryThreadDetail('thread-1'),
    )
    await expect(getRegisteredHandler(registeredHandlers, COPILOT_HISTORY_GET_RUN_REPLAY_CHANNEL)(undefined, 'run-1')).resolves.toEqual(
      await handlers.getCopilotHistoryRunReplay('run-1'),
    )
    await expect(getRegisteredHandler(registeredHandlers, COPILOT_HISTORY_RENAME_THREAD_CHANNEL)(undefined, 'thread-1', { title: '已重命名线程' })).resolves.toEqual(
      await handlers.renameCopilotHistoryThread('thread-1', { title: '已重命名线程' }),
    )
    await expect(getRegisteredHandler(registeredHandlers, COPILOT_HISTORY_DUPLICATE_THREAD_CHANNEL)(undefined, 'thread-1', { title: '历史线程（副本）' })).resolves.toEqual(
      await handlers.duplicateCopilotHistoryThread('thread-1', { title: '历史线程（副本）' }),
    )
    await expect(getRegisteredHandler(registeredHandlers, COPILOT_HISTORY_DELETE_THREAD_CHANNEL)(undefined, 'thread-1')).resolves.toEqual(
      await handlers.deleteCopilotHistoryThread('thread-1'),
    )
    await expect(getRegisteredHandler(registeredHandlers, COPILOT_HISTORY_BACKUP_DATABASE_CHANNEL)(undefined, { targetPath: BACKUP_PATH })).resolves.toEqual(
      await handlers.backupCopilotHistoryDatabase({ targetPath: BACKUP_PATH }),
    )
    await expect(getRegisteredHandler(registeredHandlers, COPILOT_HISTORY_RESTORE_DATABASE_CHANNEL)(undefined, { sourcePath: BACKUP_PATH })).resolves.toEqual(
      await handlers.restoreCopilotHistoryDatabase({ sourcePath: BACKUP_PATH }),
    )
  })

  it('wires runtime and tool catalog handlers', async () => {
    const { registeredHandlers, handlers } = setupRegistration()

    await expect(getRegisteredHandler(registeredHandlers, TOOL_CATALOG_LOAD_CHANNEL)(undefined, { language: 'en-US' })).resolves.toEqual(
      await handlers.loadToolCatalog({ language: 'en-US' }),
    )
    await expect(getRegisteredHandler(registeredHandlers, COPILOT_RUNTIME_LOAD_CHANNEL)()).resolves.toEqual(await handlers.loadCopilotRuntime())
    await expect(getRegisteredHandler(registeredHandlers, COPILOT_RUNTIME_RETRY_CHANNEL)()).resolves.toEqual(await handlers.retryCopilotRuntime())
    await expect(getRegisteredHandler(registeredHandlers, COPILOT_RUNTIME_LOCAL_TOKEN_CHANNEL)()).resolves.toEqual(await handlers.getCopilotRuntimeLocalToken())
  })

  it('wires attachment manager handlers', async () => {
    const { registeredHandlers, handlers } = setupRegistration()
    const attachmentData = { mimeType: IMAGE_PNG, base64Data: BASE64_DATA, byteLength: 8, width: 320, height: 180, suggestedName: PASTED_IMAGE }

    await expect(getRegisteredHandler(registeredHandlers, ATTACHMENT_MANAGER_READ_CLIPBOARD_DATA_CHANNEL)()).resolves.toEqual(await handlers.readClipboardAttachmentData())
    await expect(getRegisteredHandler(registeredHandlers, ATTACHMENT_MANAGER_WRITE_TEMP_FILE_CHANNEL)(undefined, { data: attachmentData })).resolves.toEqual(
      await handlers.writeAttachmentTempFile({ data: attachmentData }),
    )
    await expect(getRegisteredHandler(registeredHandlers, ATTACHMENT_MANAGER_READ_PREVIEW_CHANNEL)(undefined, { path: README_PATH, maxTextBytes: 1024 })).resolves.toEqual(
      await handlers.readAttachmentPreview({ path: README_PATH, maxTextBytes: 1024 }),
    )
    await expect(getRegisteredHandler(registeredHandlers, ATTACHMENT_MANAGER_CLEANUP_TEMP_FILES_CHANNEL)(undefined, { paths: [TEMP_ATTACHMENT_PATH] })).resolves.toEqual(
      await handlers.cleanupAttachmentTempFiles({ paths: [TEMP_ATTACHMENT_PATH] }),
    )
  })

  it('wires desktop notification and window handlers', async () => {
    const { registeredHandlers, handlers } = setupRegistration()

    await expect(getRegisteredHandler(registeredHandlers, DESKTOP_NOTIFICATION_SHOW_CHANNEL)(undefined, {
      title: '助手消息已完成', body: '这是助手回显', tag: 'run-1:completed',
    })).resolves.toBeUndefined()
    expect(handlers.notifyDesktopNotification).toHaveBeenCalledWith({
      title: '助手消息已完成', body: '这是助手回显', tag: 'run-1:completed',
    })
    await expect(getRegisteredHandler(registeredHandlers, BOOTSTRAP_WINDOW_READY_CHANNEL)()).resolves.toBeUndefined()
    expect(handlers.notifyBootstrapWindowReady).toHaveBeenCalledOnce()
    await expect(getRegisteredHandler(registeredHandlers, DESKTOP_WINDOW_STATE_LOAD_CHANNEL)()).resolves.toEqual(await handlers.loadDesktopWindowState())
    await expect(getRegisteredHandler(registeredHandlers, DESKTOP_WINDOW_MINIMIZE_CHANNEL)()).resolves.toBeUndefined()
    expect(handlers.minimizeDesktopWindow).toHaveBeenCalledOnce()
    await expect(getRegisteredHandler(registeredHandlers, DESKTOP_WINDOW_TOGGLE_MAXIMIZE_CHANNEL)()).resolves.toEqual(await handlers.toggleMaximizeDesktopWindow())
    await expect(getRegisteredHandler(registeredHandlers, DESKTOP_WINDOW_CLOSE_CHANNEL)()).resolves.toBeUndefined()
    expect(handlers.closeDesktopWindow).toHaveBeenCalledOnce()
  })

  it('wires file manager handlers', async () => {
    const { registeredHandlers, handlers } = setupRegistration()

    const watchDirs = getRegisteredHandler(registeredHandlers, FILE_MANAGER_WATCH_DIRECTORIES_CHANNEL)
    const unwatchDirs = getRegisteredHandler(registeredHandlers, FILE_MANAGER_UNWATCH_DIRECTORIES_CHANNEL)
    const loadLastRoot = getRegisteredHandler(registeredHandlers, FILE_MANAGER_LOAD_LAST_ROOT_DIRECTORY_CHANNEL)
    const saveLastRoot = getRegisteredHandler(registeredHandlers, FILE_MANAGER_SAVE_LAST_ROOT_DIRECTORY_CHANNEL)
    const clearLastRoot = getRegisteredHandler(registeredHandlers, FILE_MANAGER_CLEAR_LAST_ROOT_DIRECTORY_CHANNEL)
    const openEntry = getRegisteredHandler(registeredHandlers, FILE_MANAGER_OPEN_ENTRY_WITH_SYSTEM_CHANNEL)
    const revealEntry = getRegisteredHandler(registeredHandlers, FILE_MANAGER_REVEAL_ENTRY_IN_FOLDER_CHANNEL)
    const copyText = getRegisteredHandler(registeredHandlers, FILE_MANAGER_COPY_TEXT_TO_CLIPBOARD_CHANNEL)

    await expect(watchDirs(undefined, { paths: [TEST_ROOT] })).resolves.toEqual(await handlers.watchDirectories({ paths: [TEST_ROOT] }))
    await expect(unwatchDirs(undefined, { paths: [TEST_ROOT] })).resolves.toEqual(await handlers.unwatchDirectories({ paths: [TEST_ROOT] }))
    await expect(loadLastRoot()).resolves.toEqual(await handlers.loadLastRootDirectory())
    await expect(saveLastRoot(undefined, { rootPath: '/test/saved-root' })).resolves.toEqual(
      await handlers.saveLastRootDirectory({ rootPath: '/test/saved-root' }),
    )
    await expect(clearLastRoot()).resolves.toEqual(await handlers.clearLastRootDirectory())
    await expect(openEntry(undefined, { path: TEST_FILE })).resolves.toEqual(await handlers.openEntryWithSystem({ path: TEST_FILE }))
    await expect(revealEntry(undefined, { path: '/test/dir' })).resolves.toEqual(await handlers.revealEntryInFolder({ path: '/test/dir' }))
    await expect(copyText(undefined, { text: COPIED_TEXT })).resolves.toEqual(await handlers.copyTextToClipboard({ text: COPIED_TEXT }))
  })

  it('wires main-process file manager system action services into renderer IPC handlers', async () => {
    const { registeredHandlers, ipcMain } = createFakeIpcMain()
    const rendererHandlers = createRendererIpcHandlers()
    const readClipboardResult = await rendererHandlers.readClipboardAttachmentData()
    const writeTempResult = await rendererHandlers.writeAttachmentTempFile({
      data: { mimeType: IMAGE_PNG, base64Data: BASE64_DATA, byteLength: 8, width: 320, height: 180, suggestedName: PASTED_IMAGE },
    })
    const readPreviewResult = await rendererHandlers.readAttachmentPreview({ path: README_PATH, maxTextBytes: 1024 })
    const cleanupResult = await rendererHandlers.cleanupAttachmentTempFiles({ paths: [TEMP_ATTACHMENT_PATH] })
    const openEntryResult = { ok: true as const, affectedPaths: ['/test/opened-file.txt'] }
    const revealEntryResult = { ok: true as const, affectedPaths: ['/test/revealed-entry'] }
    const copyTextResult = { ok: true as const, affectedPaths: [] }
    const services: MainProcessServices = {
      ...rendererHandlers,
      readClipboardAttachmentData: vi.fn(async () => readClipboardResult),
      writeAttachmentTempFile: vi.fn(async () => writeTempResult),
      readAttachmentPreview: vi.fn(async () => readPreviewResult),
      cleanupAttachmentTempFiles: vi.fn(async () => cleanupResult),
      openEntryWithSystem: vi.fn(async () => openEntryResult),
      revealEntryInFolder: vi.fn(async () => revealEntryResult),
      copyTextToClipboard: vi.fn(async () => copyTextResult),
      warmupEnabledMcpServersOnStartup: vi.fn(async () => undefined),
      resolveSettingsWorkspaceProviderRoute: vi.fn(async () => { throw new Error('Unexpected provider route resolution during IPC wiring test.') }),
      handleDesktopCapabilityBridgeRequest: vi.fn(async () => { throw new Error('Unexpected desktop capability bridge request during IPC wiring test.') }),
    }

    registerMainProcessIpcHandlers(ipcMain as never, {
      services,
      loadCopilotRuntime: rendererHandlers.loadCopilotRuntime,
      retryCopilotRuntime: rendererHandlers.retryCopilotRuntime,
      getCopilotRuntimeLocalToken: rendererHandlers.getCopilotRuntimeLocalToken,
      notifyDesktopNotification: rendererHandlers.notifyDesktopNotification,
      loadDesktopWindowState: rendererHandlers.loadDesktopWindowState,
      minimizeDesktopWindow: rendererHandlers.minimizeDesktopWindow,
      toggleMaximizeDesktopWindow: rendererHandlers.toggleMaximizeDesktopWindow,
      closeDesktopWindow: rendererHandlers.closeDesktopWindow,
      notifyBootstrapWindowReady: rendererHandlers.notifyBootstrapWindowReady,
    })

    const openEntryHandler = getRegisteredHandler(registeredHandlers, FILE_MANAGER_OPEN_ENTRY_WITH_SYSTEM_CHANNEL)
    const revealEntryHandler = getRegisteredHandler(registeredHandlers, FILE_MANAGER_REVEAL_ENTRY_IN_FOLDER_CHANNEL)
    const copyTextHandler = getRegisteredHandler(registeredHandlers, FILE_MANAGER_COPY_TEXT_TO_CLIPBOARD_CHANNEL)
    const readClipboardHandler = getRegisteredHandler(registeredHandlers, ATTACHMENT_MANAGER_READ_CLIPBOARD_DATA_CHANNEL)
    const writeTempHandler = getRegisteredHandler(registeredHandlers, ATTACHMENT_MANAGER_WRITE_TEMP_FILE_CHANNEL)
    const readPreviewHandler = getRegisteredHandler(registeredHandlers, ATTACHMENT_MANAGER_READ_PREVIEW_CHANNEL)
    const cleanupHandler = getRegisteredHandler(registeredHandlers, ATTACHMENT_MANAGER_CLEANUP_TEMP_FILES_CHANNEL)

    await expect(openEntryHandler(undefined, { path: TEST_FILE })).resolves.toEqual(openEntryResult)
    await expect(revealEntryHandler(undefined, { path: '/test/dir' })).resolves.toEqual(revealEntryResult)
    await expect(copyTextHandler(undefined, { text: COPIED_TEXT })).resolves.toEqual(copyTextResult)
    await expect(readClipboardHandler()).resolves.toEqual(readClipboardResult)
    await expect(writeTempHandler(undefined, { data: { mimeType: IMAGE_PNG, base64Data: BASE64_DATA, byteLength: 8, width: 320, height: 180, suggestedName: PASTED_IMAGE } })).resolves.toEqual(writeTempResult)
    await expect(readPreviewHandler(undefined, { path: README_PATH, maxTextBytes: 1024 })).resolves.toEqual(readPreviewResult)
    await expect(cleanupHandler(undefined, { paths: [TEMP_ATTACHMENT_PATH] })).resolves.toEqual(cleanupResult)
    expect(services.openEntryWithSystem).toHaveBeenCalledWith({ path: TEST_FILE })
    expect(services.revealEntryInFolder).toHaveBeenCalledWith({ path: '/test/dir' })
    expect(services.copyTextToClipboard).toHaveBeenCalledWith({ text: COPIED_TEXT })
    expect(services.readClipboardAttachmentData).toHaveBeenCalledOnce()
    expect(services.writeAttachmentTempFile).toHaveBeenCalledWith({ data: { mimeType: IMAGE_PNG, base64Data: BASE64_DATA, byteLength: 8, width: 320, height: 180, suggestedName: PASTED_IMAGE } })
    expect(services.readAttachmentPreview).toHaveBeenCalledWith({ path: README_PATH, maxTextBytes: 1024 })
    expect(services.cleanupAttachmentTempFiles).toHaveBeenCalledWith({ paths: [TEMP_ATTACHMENT_PATH] })
  })
})
