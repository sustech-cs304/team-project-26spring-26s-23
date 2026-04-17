import { describe, expect, it } from 'vitest'

import { BOOTSTRAP_WINDOW_READY_CHANNEL, type BootstrapWindowApi } from './bootstrap-window'
import {
  DESKTOP_NOTIFICATION_SHOW_CHANNEL,
  type DesktopNotificationApi,
} from './desktop-notification'
import { getExposedApi, getInvokeMock, loadPreloadModule } from './preload.test-support'

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
})
