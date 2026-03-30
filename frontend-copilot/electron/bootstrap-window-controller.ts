export interface BootstrapWindowLike {
  readonly id: number
  isDestroyed(): boolean
  isVisible(): boolean
  show(): void
}

type BootstrapWindowLogger = (stage: string, context?: Record<string, unknown>) => void

export function showWindowWhenBootstrapScreenIsReady(
  targetWindow: BootstrapWindowLike | null,
  log: BootstrapWindowLogger,
): void {
  if (targetWindow === null) {
    log('window-show:bootstrap-ready:ignored', {
      reason: 'missing-window',
    })
    return
  }

  if (targetWindow.isDestroyed()) {
    log('window-show:bootstrap-ready:ignored', {
      reason: 'destroyed-window',
      windowId: targetWindow.id,
    })
    return
  }

  if (targetWindow.isVisible()) {
    log('window-show:bootstrap-ready:ignored', {
      reason: 'already-visible',
      windowId: targetWindow.id,
    })
    return
  }

  log('window-show:bootstrap-ready', {
    windowId: targetWindow.id,
  })
  targetWindow.show()
}
