import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

interface StageState {
  key: string
  node: ReactNode
}

interface CrossFadeProps {
  children: ReactNode
  /** When this key changes, old content fades out and new content fades in simultaneously */
  transitionKey: string
  /** Duration in ms for each phase (default: 160) */
  duration?: number
  className?: string
}

/**
 * Cross-fades content when `transitionKey` changes.
 *
 * Important layout rule: when `className` is provided, the root wrapper owns the
 * layout contract for the wrapped area (for example flex height / overflow). The
 * stage wrappers must therefore preserve a flex column height chain so scrollable
 * descendants such as the chat stream can still receive bounded height.
 */
export function CrossFade({
  children,
  transitionKey,
  duration = 160,
  className,
}: CrossFadeProps) {
  const [exitingStage, setExitingStage] = useState<StageState | null>(null)
  const [enteringStage, setEnteringStage] = useState<StageState | null>(null)
  const previousKeyRef = useRef<string | null>(null)
  const activeNodeRef = useRef<ReactNode>(null)
  const latestChildrenRef = useRef<ReactNode>(children)
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isTransitioning = exitingStage !== null || enteringStage !== null
  latestChildrenRef.current = children

  if (previousKeyRef.current === transitionKey && !isTransitioning) {
    activeNodeRef.current = children
  }

  useEffect(() => {
    return () => {
      if (exitTimerRef.current !== null) {
        clearTimeout(exitTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const previousKey = previousKeyRef.current

    if (previousKey === null) {
      previousKeyRef.current = transitionKey
      activeNodeRef.current = latestChildrenRef.current
      return
    }

    if (previousKey === transitionKey) {
      return
    }

    if (exitTimerRef.current !== null) {
      clearTimeout(exitTimerRef.current)
    }

    const enteringNode = latestChildrenRef.current
    setExitingStage({
      key: previousKey,
      node: activeNodeRef.current,
    })
    setEnteringStage({
      key: transitionKey,
      node: enteringNode,
    })
    previousKeyRef.current = transitionKey
    activeNodeRef.current = enteringNode

    exitTimerRef.current = setTimeout(() => {
      activeNodeRef.current = latestChildrenRef.current
      setExitingStage(null)
      setEnteringStage(null)
      exitTimerRef.current = null
    }, duration)
  }, [transitionKey, duration])

  if (isTransitioning) {
    return (
      <div
        className={['cross-fade', className].filter(Boolean).join(' ')}
        style={{ position: 'relative' }}
      >
        {exitingStage && (
          <div
            key={`cross-fade-exit-${exitingStage.key}`}
            className="cross-fade__stage cross-fade__stage--exiting"
            style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
            }}
            aria-hidden="true"
          >
            {exitingStage.node}
          </div>
        )}
        {enteringStage && (
          <div
            key={`cross-fade-active-${enteringStage.key}`}
            className="cross-fade__stage cross-fade__stage--entering"
          >
            {enteringStage.node}
          </div>
        )}
      </div>
    )
  }

  if (className) {
    return <div className={['cross-fade', className].join(' ')}>{children}</div>
  }

  return <>{children}</>
}
