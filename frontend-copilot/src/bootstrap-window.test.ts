/** @vitest-environment jsdom */

import { describe, expect, it, vi } from 'vitest'

import { notifyBootstrapScreenReady, waitForNextPaint } from './bootstrap-window'

describe('bootstrap window renderer bridge', () => {
  it('delegates the bootstrap ready signal to the injected preload api when available', async () => {
    const signalBootstrapScreenReady = vi.fn().mockResolvedValue(undefined)

    Object.assign(window, {
      bootstrapWindow: {
        signalBootstrapScreenReady,
      },
    })

    await notifyBootstrapScreenReady()

    expect(signalBootstrapScreenReady).toHaveBeenCalledOnce()
  })

  it('waits for two animation frames before resolving the paint gate', async () => {
    const callbacks: FrameRequestCallback[] = []
    const originalRequestAnimationFrame = window.requestAnimationFrame

    window.requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback)
      return callbacks.length
    }) as typeof window.requestAnimationFrame

    try {
      const readyPromise = waitForNextPaint()

      expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1)

      callbacks.shift()?.(0)
      expect(window.requestAnimationFrame).toHaveBeenCalledTimes(2)

      callbacks.shift()?.(16)
      await expect(readyPromise).resolves.toBeUndefined()
    } finally {
      window.requestAnimationFrame = originalRequestAnimationFrame
    }
  })
})
