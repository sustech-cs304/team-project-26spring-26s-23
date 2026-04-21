import { describe, expect, it } from 'vitest'

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
import { COPILOT_RUNTIME_LOAD_CHANNEL, COPILOT_RUNTIME_RETRY_CHANNEL } from './copilot-runtime'
import {
  MCP_REGISTRY_DELETE_SERVER_CHANNEL,
  MCP_REGISTRY_LOAD_CHANNEL,
  MCP_REGISTRY_REFRESH_CATALOG_CHANNEL,
  MCP_REGISTRY_SAVE_SERVER_CHANNEL,
  MCP_REGISTRY_SET_SERVER_ENABLED_CHANNEL,
  MCP_REGISTRY_TEST_CONNECTION_CHANNEL,
} from './mcp-registry/ipc'
import { TOOL_CATALOG_LOAD_CHANNEL } from './tool-catalog/ipc'
import { DESKTOP_NOTIFICATION_SHOW_CHANNEL } from './desktop-notification'
import { createRendererIpcHandlers } from './renderer-ipc-handlers.test-support'
import { createMcpStdioStubServerFixture } from './renderer-ipc.test-support'
import { createFakeIpcMain } from './renderer-ipc-transport.test-support'
import { registerRendererIpcHandlers } from './renderer-ipc-registration'

describe('registerRendererIpcHandlers', () => {
  it('registers only the config center, history, settings workspace, and runtime channels needed by the renderer', async () => {
    const { registeredHandlers, ipcMain } = createFakeIpcMain()
    const handlers = createRendererIpcHandlers()

    registerRendererIpcHandlers(ipcMain as never, handlers)

    expect(ipcMain.removeHandler.mock.calls.map(([channel]) => channel)).toEqual([
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
      MCP_REGISTRY_LOAD_CHANNEL,
      MCP_REGISTRY_SAVE_SERVER_CHANNEL,
      MCP_REGISTRY_DELETE_SERVER_CHANNEL,
      MCP_REGISTRY_SET_SERVER_ENABLED_CHANNEL,
      MCP_REGISTRY_TEST_CONNECTION_CHANNEL,
      MCP_REGISTRY_REFRESH_CATALOG_CHANNEL,
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
      DESKTOP_NOTIFICATION_SHOW_CHANNEL,
      BOOTSTRAP_WINDOW_READY_CHANNEL,
    ])
    expect([...registeredHandlers.keys()]).toEqual([
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
      MCP_REGISTRY_LOAD_CHANNEL,
      MCP_REGISTRY_SAVE_SERVER_CHANNEL,
      MCP_REGISTRY_DELETE_SERVER_CHANNEL,
      MCP_REGISTRY_SET_SERVER_ENABLED_CHANNEL,
      MCP_REGISTRY_TEST_CONNECTION_CHANNEL,
      MCP_REGISTRY_REFRESH_CATALOG_CHANNEL,
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
      DESKTOP_NOTIFICATION_SHOW_CHANNEL,
      BOOTSTRAP_WINDOW_READY_CHANNEL,
    ])
    expect(registeredHandlers.has('copilot-settings:load')).toBe(false)
    expect(registeredHandlers.has('copilot-settings:save')).toBe(false)

    const loadSnapshotHandler = getRegisteredHandler(registeredHandlers, CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL)
    const applyPatchHandler = getRegisteredHandler(registeredHandlers, CONFIG_CENTER_PUBLIC_PATCH_CHANNEL)
    const loadMcpRegistryHandler = getRegisteredHandler(registeredHandlers, MCP_REGISTRY_LOAD_CHANNEL)
    const saveMcpServerHandler = getRegisteredHandler(registeredHandlers, MCP_REGISTRY_SAVE_SERVER_CHANNEL)
    const deleteMcpServerHandler = getRegisteredHandler(registeredHandlers, MCP_REGISTRY_DELETE_SERVER_CHANNEL)
    const setMcpServerEnabledHandler = getRegisteredHandler(registeredHandlers, MCP_REGISTRY_SET_SERVER_ENABLED_CHANNEL)
    const testMcpConnectionHandler = getRegisteredHandler(registeredHandlers, MCP_REGISTRY_TEST_CONNECTION_CHANNEL)
    const refreshMcpCatalogHandler = getRegisteredHandler(registeredHandlers, MCP_REGISTRY_REFRESH_CATALOG_CHANNEL)
    const listThreadsHandler = getRegisteredHandler(registeredHandlers, COPILOT_HISTORY_LIST_THREADS_CHANNEL)
    const getThreadDetailHandler = getRegisteredHandler(registeredHandlers, COPILOT_HISTORY_GET_THREAD_DETAIL_CHANNEL)
    const getRunReplayHandler = getRegisteredHandler(registeredHandlers, COPILOT_HISTORY_GET_RUN_REPLAY_CHANNEL)
    const renameThreadHandler = getRegisteredHandler(registeredHandlers, COPILOT_HISTORY_RENAME_THREAD_CHANNEL)
    const duplicateThreadHandler = getRegisteredHandler(registeredHandlers, COPILOT_HISTORY_DUPLICATE_THREAD_CHANNEL)
    const deleteThreadHandler = getRegisteredHandler(registeredHandlers, COPILOT_HISTORY_DELETE_THREAD_CHANNEL)
    const backupDatabaseHandler = getRegisteredHandler(registeredHandlers, COPILOT_HISTORY_BACKUP_DATABASE_CHANNEL)
    const restoreDatabaseHandler = getRegisteredHandler(registeredHandlers, COPILOT_HISTORY_RESTORE_DATABASE_CHANNEL)
    const loadToolCatalogHandler = getRegisteredHandler(registeredHandlers, TOOL_CATALOG_LOAD_CHANNEL)
    const loadRuntimeHandler = getRegisteredHandler(registeredHandlers, COPILOT_RUNTIME_LOAD_CHANNEL)
    const retryRuntimeHandler = getRegisteredHandler(registeredHandlers, COPILOT_RUNTIME_RETRY_CHANNEL)
    const notifyDesktopNotificationHandler = getRegisteredHandler(registeredHandlers, DESKTOP_NOTIFICATION_SHOW_CHANNEL)
    const notifyBootstrapWindowReadyHandler = getRegisteredHandler(registeredHandlers, BOOTSTRAP_WINDOW_READY_CHANNEL)

    await expect(loadSnapshotHandler()).resolves.toEqual(await handlers.loadConfigCenterPublicSnapshot())
    await expect(applyPatchHandler(undefined, {
      domains: {
        frontendPreferences: {
          theme: 'dark',
        },
      },
    })).resolves.toEqual(await handlers.applyConfigCenterPublicPatch({
      domains: {
        frontendPreferences: {
          theme: 'dark',
        },
      },
    }))
    const mcpServerDraft = createMcpStdioStubServerFixture()
    await expect(loadMcpRegistryHandler(undefined, { language: 'zh-CN', includeDisabled: true })).resolves.toEqual(
      await handlers.loadMcpRegistry({ language: 'zh-CN', includeDisabled: true }),
    )
    await expect(saveMcpServerHandler(undefined, mcpServerDraft)).resolves.toEqual(
      await handlers.saveMcpServer(mcpServerDraft),
    )
    await expect(deleteMcpServerHandler(undefined, mcpServerDraft.serverId)).resolves.toEqual(
      await handlers.deleteMcpServer(mcpServerDraft.serverId),
    )
    await expect(setMcpServerEnabledHandler(undefined, { serverId: mcpServerDraft.serverId, enabled: false })).resolves.toEqual(
      await handlers.setMcpServerEnabled({ serverId: mcpServerDraft.serverId, enabled: false }),
    )
    await expect(testMcpConnectionHandler(undefined, { draft: mcpServerDraft })).resolves.toEqual(
      await handlers.testMcpConnection({ draft: mcpServerDraft }),
    )
    await expect(refreshMcpCatalogHandler(undefined, { serverId: mcpServerDraft.serverId })).resolves.toEqual(
      await handlers.refreshMcpCatalog({ serverId: mcpServerDraft.serverId }),
    )
    await expect(listThreadsHandler()).resolves.toEqual(await handlers.listCopilotHistoryThreads())
    await expect(getThreadDetailHandler(undefined, 'thread-1')).resolves.toEqual(
      await handlers.getCopilotHistoryThreadDetail('thread-1'),
    )
    await expect(getRunReplayHandler(undefined, 'run-1')).resolves.toEqual(
      await handlers.getCopilotHistoryRunReplay('run-1'),
    )
    await expect(renameThreadHandler(undefined, 'thread-1', { title: '已重命名线程' })).resolves.toEqual(
      await handlers.renameCopilotHistoryThread('thread-1', { title: '已重命名线程' }),
    )
    await expect(duplicateThreadHandler(undefined, 'thread-1', { title: '历史线程（副本）' })).resolves.toEqual(
      await handlers.duplicateCopilotHistoryThread('thread-1', { title: '历史线程（副本）' }),
    )
    await expect(deleteThreadHandler(undefined, 'thread-1')).resolves.toEqual(
      await handlers.deleteCopilotHistoryThread('thread-1'),
    )
    await expect(backupDatabaseHandler(undefined, { targetPath: 'backups/history.db' })).resolves.toEqual(
      await handlers.backupCopilotHistoryDatabase({ targetPath: 'backups/history.db' }),
    )
    await expect(restoreDatabaseHandler(undefined, { sourcePath: 'backups/history.db' })).resolves.toEqual(
      await handlers.restoreCopilotHistoryDatabase({ sourcePath: 'backups/history.db' }),
    )
    await expect(loadToolCatalogHandler(undefined, { language: 'en-US' })).resolves.toEqual(
      await handlers.loadToolCatalog({ language: 'en-US' }),
    )
    await expect(loadRuntimeHandler()).resolves.toEqual(await handlers.loadCopilotRuntime())
    await expect(retryRuntimeHandler()).resolves.toEqual(await handlers.retryCopilotRuntime())
    await expect(notifyDesktopNotificationHandler(undefined, {
      title: '助手消息已完成',
      body: '这是助手回显',
      tag: 'run-1:completed',
    })).resolves.toBeUndefined()
    expect(handlers.notifyDesktopNotification).toHaveBeenCalledWith({
      title: '助手消息已完成',
      body: '这是助手回显',
      tag: 'run-1:completed',
    })
    await expect(notifyBootstrapWindowReadyHandler()).resolves.toBeUndefined()
    expect(handlers.notifyBootstrapWindowReady).toHaveBeenCalledOnce()
  })
})

function getRegisteredHandler(
  registeredHandlers: Map<string, (...args: unknown[]) => Promise<unknown> | unknown>,
  channel: string,
): (...args: unknown[]) => Promise<unknown> {
  const handler = registeredHandlers.get(channel)

  if (handler === undefined) {
    throw new Error(`Expected IPC handler for channel "${channel}".`)
  }

  return handler as (...args: unknown[]) => Promise<unknown>
}
