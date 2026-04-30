import { useCallback, useEffect, useState, type MouseEvent } from 'react'

import type { DesktopWindowControlsApi, DesktopWindowState } from '../../electron/window-controls'

const fallbackWindowState: DesktopWindowState = {
  isMaximized: false,
  isFullScreen: false,
}

export function WindowTitlebar() {
  const [windowState, setWindowState] = useState<DesktopWindowState>(fallbackWindowState)

  useEffect(() => {
    const controls = getWindowControls()

    if (controls === null) {
      return undefined
    }

    let disposed = false

    void controls.loadState()
      .then((nextState) => {
        if (!disposed) {
          setWindowState(nextState)
        }
      })
      .catch(() => {
        // Keep the visual chrome interactive even if the bridge is temporarily unavailable.
      })

    const unsubscribe = controls.onStateChanged((nextState) => {
      if (!disposed) {
        setWindowState(nextState)
      }
    })

    return () => {
      disposed = true
      unsubscribe()
    }
  }, [])

  const runWindowAction = useCallback((action: keyof Pick<DesktopWindowControlsApi, 'minimize' | 'toggleMaximize' | 'close'>) => {
    const controls = getWindowControls()

    if (controls === null) {
      return
    }

    void controls[action]()
      .then((nextState) => {
        if (action === 'toggleMaximize' && nextState !== undefined) {
          setWindowState(nextState)
        }
      })
      .catch(() => {
        // The native window may already be closing; controls should stay fire-and-forget from the renderer.
      })
  }, [])

  const handleTitlebarDoubleClick = useCallback((event: MouseEvent<HTMLElement>) => {
    const target = event.target

    if (target instanceof Element && target.closest('.window-titlebar__control')) {
      return
    }

    runWindowAction('toggleMaximize')
  }, [runWindowAction])

  const maximizeLabel = windowState.isMaximized ? '还原窗口' : '最大化窗口'

  return (
    <header
      className="window-titlebar"
      data-window-maximized={windowState.isMaximized ? 'true' : 'false'}
      data-window-fullscreen={windowState.isFullScreen ? 'true' : 'false'}
      onDoubleClick={handleTitlebarDoubleClick}
    >
      <div className="window-titlebar__drag-region" aria-hidden="true" />

      <div className="window-titlebar__controls" aria-label="窗口控制">
        <button
          type="button"
          className="window-titlebar__control"
          data-window-control="minimize"
          aria-label="最小化窗口"
          title="最小化"
          onClick={() => runWindowAction('minimize')}
        >
          <svg className="window-titlebar__control-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <path d="M2.5 6.5h7" />
          </svg>
        </button>

        <button
          type="button"
          className="window-titlebar__control"
          data-window-control="toggle-maximize"
          aria-label={maximizeLabel}
          title={maximizeLabel}
          onClick={() => runWindowAction('toggleMaximize')}
        >
          {windowState.isMaximized ? (
            <svg className="window-titlebar__control-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
              <path d="M4 3.5h4.5v4.5" />
              <path d="M3 5h4v4H3z" />
            </svg>
          ) : (
            <svg className="window-titlebar__control-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
              <path d="M3 3h6v6H3z" />
            </svg>
          )}
        </button>

        <button
          type="button"
          className="window-titlebar__control window-titlebar__control--close"
          data-window-control="close"
          aria-label="关闭窗口"
          title="关闭"
          onClick={() => runWindowAction('close')}
        >
          <svg className="window-titlebar__control-icon" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
            <path d="m3 3 6 6" />
            <path d="m9 3-6 6" />
          </svg>
        </button>
      </div>
    </header>
  )
}

function getWindowControls(): DesktopWindowControlsApi | null {
  if (typeof window === 'undefined' || !window.windowControls) {
    return null
  }

  return window.windowControls
}
