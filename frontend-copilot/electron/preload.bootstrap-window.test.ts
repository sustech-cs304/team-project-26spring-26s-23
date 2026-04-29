import { describe, expect, it, vi } from 'vitest'

import { BOOTSTRAP_WINDOW_READY_CHANNEL, type BootstrapWindowApi } from './bootstrap-window'
import {
  DESKTOP_NOTIFICATION_SHOW_CHANNEL,
  type DesktopNotificationApi,
} from './desktop-notification'
import { getExposedApi, getInvokeMock, getOffMock, getRegisteredOnListener, loadPreloadModule } from './preload.test-support'
import {
  DESKTOP_WINDOW_CLOSE_CHANNEL,
  DESKTOP_WINDOW_MINIMIZE_CHANNEL,
  DESKTOP_WINDOW_STATE_CHANGED_CHANNEL,
  DESKTOP_WINDOW_STATE_LOAD_CHANNEL,
  DESKTOP_WINDOW_TOGGLE_MAXIMIZE_CHANNEL,
  type DesktopWindowControlsApi,
  type DesktopWindowState,
} from './window-controls'

describe('preload bootstrap window bridge', () => {
  it('routes bootstrap ready notifications through the expected IPC channel', async () => {
    const invokeMock = getInvokeMock()
    invokeMock.mockResolvedValue(undefined)

    await loadPreloadModule()

    const bootstrapWindowApi = getExposedApi<BootstrapWindowApi>('bootstrapWindow')

    await bootstrapWindowApi.signalBootstrapScreenReady()

    expect(invokeMock.mock.calls).toEqual([
      [BOOTSTRAP_WINDOW_READY_CHANNEL],
    ])
  })

  it('routes desktop notifications through the expected IPC channel', async () => {
    const invokeMock = getInvokeMock()
    invokeMock.mockResolvedValue(undefined)

    await loadPreloadModule()

    const desktopNotificationApi = getExposedApi<DesktopNotificationApi>('desktopNotification')
    const request = {
      title: '助手消息已完成',
      body: '这是助手回显',
      tag: 'run-1:completed',
    }

    await desktopNotificationApi.show(request)

    expect(invokeMock.mock.calls).toEqual([
      [DESKTOP_NOTIFICATION_SHOW_CHANNEL, request],
    ])
  })

  it('routes desktop window controls through the expected IPC channels', async () => {
    const invokeMock = getInvokeMock()
    const restoredWindowState = {
      isMaximized: false,
      isFullScreen: false,
    }
    const maximizedWindowState = {
      isMaximized: true,
      isFullScreen: false,
    }
    invokeMock
      .mockResolvedValueOnce(restoredWindowState)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(maximizedWindowState)
      .mockResolvedValueOnce(undefined)

    await loadPreloadModule()

    const windowControlsApi = getExposedApi<DesktopWindowControlsApi>('windowControls')

    await expect(windowControlsApi.loadState()).resolves.toEqual(restoredWindowState)
    await expect(windowControlsApi.minimize()).resolves.toBeUndefined()
    await expect(windowControlsApi.toggleMaximize()).resolves.toEqual(maximizedWindowState)
    await expect(windowControlsApi.close()).resolves.toBeUndefined()

    expect(invokeMock.mock.calls).toEqual([
      [DESKTOP_WINDOW_STATE_LOAD_CHANNEL],
      [DESKTOP_WINDOW_MINIMIZE_CHANNEL],
      [DESKTOP_WINDOW_TOGGLE_MAXIMIZE_CHANNEL],
      [DESKTOP_WINDOW_CLOSE_CHANNEL],
    ])
  })

  it('subscribes to desktop window state changes through the expected IPC channel', async () => {
    await loadPreloadModule()

    const windowControlsApi = getExposedApi<DesktopWindowControlsApi>('windowControls')
    const listener = vi.fn<(state: DesktopWindowState) => void>()
    const unsubscribe = windowControlsApi.onStateChanged(listener)
    const emittedState = {
      isMaximized: true,
      isFullScreen: false,
    }

    getRegisteredOnListener(DESKTOP_WINDOW_STATE_CHANGED_CHANNEL)(undefined, emittedState)

    expect(listener).toHaveBeenCalledWith(emittedState)

    unsubscribe()

    expect(getOffMock()).toHaveBeenCalledOnce()
    expect(getOffMock().mock.calls[0]?.[0]).toBe(DESKTOP_WINDOW_STATE_CHANGED_CHANNEL)
  })
})
