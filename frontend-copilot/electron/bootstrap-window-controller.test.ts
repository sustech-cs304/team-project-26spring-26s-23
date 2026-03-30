import { describe, expect, it, vi } from 'vitest'

import { showWindowWhenBootstrapScreenIsReady } from './bootstrap-window-controller'

describe('showWindowWhenBootstrapScreenIsReady', () => {
  it('shows a hidden window when the bootstrap screen becomes ready', () => {
    const log = vi.fn()
    const targetWindow = {
      id: 7,
      isDestroyed: vi.fn().mockReturnValue(false),
      isVisible: vi.fn().mockReturnValue(false),
      show: vi.fn(),
    }

    showWindowWhenBootstrapScreenIsReady(targetWindow, log)

    expect(targetWindow.show).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledWith('window-show:bootstrap-ready', {
      windowId: 7,
    })
  })

  it('ignores the ready signal when no window is available', () => {
    const log = vi.fn()

    showWindowWhenBootstrapScreenIsReady(null, log)

    expect(log).toHaveBeenCalledWith('window-show:bootstrap-ready:ignored', {
      reason: 'missing-window',
    })
  })

  it('does not re-show a window that is already visible', () => {
    const log = vi.fn()
    const targetWindow = {
      id: 11,
      isDestroyed: vi.fn().mockReturnValue(false),
      isVisible: vi.fn().mockReturnValue(true),
      show: vi.fn(),
    }

    showWindowWhenBootstrapScreenIsReady(targetWindow, log)

    expect(targetWindow.show).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('window-show:bootstrap-ready:ignored', {
      reason: 'already-visible',
      windowId: 11,
    })
  })
})
