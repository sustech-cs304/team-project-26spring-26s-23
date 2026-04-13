import { describe, expect, it } from 'vitest'

import { BOOTSTRAP_WINDOW_READY_CHANNEL } from './bootstrap-window'
import { CONFIG_CENTER_PUBLIC_PATCH_CHANNEL } from './config-center/public-patch'
import { CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL } from './config-center/public-snapshot'
import {
  COPILOT_HISTORY_GET_RUN_REPLAY_CHANNEL,
  COPILOT_HISTORY_GET_THREAD_DETAIL_CHANNEL,
  COPILOT_HISTORY_LIST_THREADS_CHANNEL,
} from './copilot-history'
import { COPILOT_RUNTIME_LOAD_CHANNEL, COPILOT_RUNTIME_RETRY_CHANNEL } from './copilot-runtime'
import { createRendererIpcHandlers } from './renderer-ipc-handlers.test-support'
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
      COPILOT_HISTORY_LIST_THREADS_CHANNEL,
      COPILOT_HISTORY_GET_THREAD_DETAIL_CHANNEL,
      COPILOT_HISTORY_GET_RUN_REPLAY_CHANNEL,
      COPILOT_RUNTIME_LOAD_CHANNEL,
      COPILOT_RUNTIME_RETRY_CHANNEL,
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
      COPILOT_HISTORY_LIST_THREADS_CHANNEL,
      COPILOT_HISTORY_GET_THREAD_DETAIL_CHANNEL,
      COPILOT_HISTORY_GET_RUN_REPLAY_CHANNEL,
      COPILOT_RUNTIME_LOAD_CHANNEL,
      COPILOT_RUNTIME_RETRY_CHANNEL,
      BOOTSTRAP_WINDOW_READY_CHANNEL,
    ])
    expect(registeredHandlers.has('copilot-settings:load')).toBe(false)
    expect(registeredHandlers.has('copilot-settings:save')).toBe(false)

    const loadSnapshotHandler = getRegisteredHandler(registeredHandlers, CONFIG_CENTER_PUBLIC_SNAPSHOT_LOAD_CHANNEL)
    const applyPatchHandler = getRegisteredHandler(registeredHandlers, CONFIG_CENTER_PUBLIC_PATCH_CHANNEL)
    const listThreadsHandler = getRegisteredHandler(registeredHandlers, COPILOT_HISTORY_LIST_THREADS_CHANNEL)
    const getThreadDetailHandler = getRegisteredHandler(registeredHandlers, COPILOT_HISTORY_GET_THREAD_DETAIL_CHANNEL)
    const getRunReplayHandler = getRegisteredHandler(registeredHandlers, COPILOT_HISTORY_GET_RUN_REPLAY_CHANNEL)
    const loadRuntimeHandler = getRegisteredHandler(registeredHandlers, COPILOT_RUNTIME_LOAD_CHANNEL)
    const retryRuntimeHandler = getRegisteredHandler(registeredHandlers, COPILOT_RUNTIME_RETRY_CHANNEL)
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
    await expect(listThreadsHandler()).resolves.toEqual(await handlers.listCopilotHistoryThreads())
    await expect(getThreadDetailHandler(undefined, 'thread-1')).resolves.toEqual(
      await handlers.getCopilotHistoryThreadDetail('thread-1'),
    )
    await expect(getRunReplayHandler(undefined, 'run-1')).resolves.toEqual(
      await handlers.getCopilotHistoryRunReplay('run-1'),
    )
    await expect(loadRuntimeHandler()).resolves.toEqual(await handlers.loadCopilotRuntime())
    await expect(retryRuntimeHandler()).resolves.toEqual(await handlers.retryCopilotRuntime())
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
