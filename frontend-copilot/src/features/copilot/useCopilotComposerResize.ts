import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'

import {
  DEFAULT_COPILOT_COMPOSER_HEIGHT,
  clampComposerHeight,
} from './copilot-chat-helpers'

export function useCopilotComposerResize() {
  const [composerHeight, setComposerHeight] = useState(DEFAULT_COPILOT_COMPOSER_HEIGHT)
  const composerHeightRef = useRef(DEFAULT_COPILOT_COMPOSER_HEIGHT)
  const composerResizeCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    composerHeightRef.current = composerHeight
  }, [composerHeight])

  useEffect(() => {
    return () => {
      composerResizeCleanupRef.current?.()
    }
  }, [])

  const handleComposerResizeStart = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    composerResizeCleanupRef.current?.()

    const startY = event.clientY
    const startHeight = composerHeightRef.current
    const previousUserSelect = document.body.style.userSelect

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const nextHeight = clampComposerHeight(startHeight + (startY - moveEvent.clientY))
      composerHeightRef.current = nextHeight
      setComposerHeight(nextHeight)
    }

    const stopResize = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', stopResize)
      document.body.style.userSelect = previousUserSelect
      composerResizeCleanupRef.current = null
    }

    composerResizeCleanupRef.current = stopResize
    document.body.style.userSelect = 'none'
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', stopResize)
  }

  return {
    composerHeight,
    onComposerResizeStart: handleComposerResizeStart,
  }
}
