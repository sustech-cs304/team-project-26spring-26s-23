import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'

import {
  copyErrorDetailOverlayGroup,
  copyErrorDetailOverlaySummary,
} from './error-detail-overlay-copy'
import type {
  ErrorDetailOverlayGroup,
  ErrorDetailOverlayViewModel,
} from './error-detail-overlay-view-model'

import { getFocusableElements } from './error-detail-focus-trap'
import { renderContentItem } from './ErrorDetailOverlayContentSections'

const copyFeedbackResetMs = 2000

type CopyStatus = 'idle' | 'success' | 'error'

export interface ErrorDetailOverlayProps {
  viewModel: ErrorDetailOverlayViewModel | null
  onClose: () => void
}

export function ErrorDetailOverlay({
  viewModel,
  onClose,
}: ErrorDetailOverlayProps) {
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLElement | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useErrorDetailFocusManagement(viewModel, dialogRef, closeButtonRef)
  useErrorDetailEscapeKey(viewModel, onClose)
  const { summaryCopyStatus, groupCopyStatus, handleSummaryCopy, handleGroupCopy } = useErrorDetailCopy(viewModel)

  if (viewModel === null) {
    return null
  }

  const summaryCopyLabel = summaryCopyStatus === 'success'
    ? '已复制'
    : summaryCopyStatus === 'error'
      ? '复制失败'
      : '复制全部'

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab') {
      return
    }

    const dialog = dialogRef.current

    if (!dialog) {
      return
    }

    const focusableElements = getFocusableElements(dialog)

    if (focusableElements.length === 0) {
      event.preventDefault()
      dialog.focus()
      return
    }

    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const activeIndex = activeElement ? focusableElements.indexOf(activeElement) : -1
    const firstElement = focusableElements[0]
    const lastElement = focusableElements[focusableElements.length - 1]

    if (event.shiftKey) {
      if (activeIndex <= 0) {
        event.preventDefault()
        lastElement.focus()
      }

      return
    }

    if (activeIndex === -1 || activeIndex === focusableElements.length - 1) {
      event.preventDefault()
      firstElement.focus()
    }
  }

  return (
    <div
      className="error-detail-overlay"
      data-testid="error-detail-overlay"
      onClick={() => {
        onClose()
      }}
    >
      <section
        ref={dialogRef}
        className="error-detail-overlay__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-testid="error-detail-overlay-dialog"
        tabIndex={-1}
        onClick={(event) => {
          event.stopPropagation()
        }}
        onKeyDown={handleDialogKeyDown}
      >
        <ErrorDetailHeader
          titleId={titleId}
          descriptionId={descriptionId}
          viewModel={viewModel}
          summaryCopyLabel={summaryCopyLabel}
          closeButtonRef={closeButtonRef}
          onSummaryCopy={handleSummaryCopy}
          onClose={onClose}
        />
        <div className="error-detail-overlay__body">
          {viewModel.groups.map((group) => (
            <ErrorDetailGroupItem
              key={group.key}
              group={group}
              copyStatus={groupCopyStatus[group.key] ?? 'idle'}
              onGroupCopy={handleGroupCopy}
            />
          ))}
          {viewModel.emptyStateMessage !== null && (
            <p
              className="error-detail-overlay__empty-state"
              data-testid="error-detail-overlay-empty-state"
            >
              {viewModel.emptyStateMessage}
            </p>
          )}
        </div>
      </section>
    </div>
  )
}

function useErrorDetailCopy(viewModel: ErrorDetailOverlayViewModel | null) {
  const summaryCopyResetTimerRef = useRef<number | null>(null)
  const groupCopyResetTimerRefs = useRef<Record<string, number>>({})
  const [summaryCopyStatus, setSummaryCopyStatus] = useState<CopyStatus>('idle')
  const [groupCopyStatus, setGroupCopyStatus] = useState<Record<string, CopyStatus>>({})

  const clearSummaryCopyResetTimer = useCallback(() => {
    if (summaryCopyResetTimerRef.current !== null) {
      window.clearTimeout(summaryCopyResetTimerRef.current)
      summaryCopyResetTimerRef.current = null
    }
  }, [])

  const clearGroupCopyResetTimer = useCallback((groupKey: string) => {
    const timerId = groupCopyResetTimerRefs.current[groupKey]

    if (timerId !== undefined) {
      window.clearTimeout(timerId)
      delete groupCopyResetTimerRefs.current[groupKey]
    }
  }, [])

  const clearAllCopyResetTimers = useCallback(() => {
    clearSummaryCopyResetTimer()
    Object.keys(groupCopyResetTimerRefs.current).forEach((groupKey) => {
      clearGroupCopyResetTimer(groupKey)
    })
  }, [clearGroupCopyResetTimer, clearSummaryCopyResetTimer])

  useEffect(() => {
    clearAllCopyResetTimers()
    setSummaryCopyStatus('idle')
    setGroupCopyStatus({})
  }, [clearAllCopyResetTimers, viewModel])

  useEffect(() => {
    return () => {
      clearAllCopyResetTimers()
    }
  }, [clearAllCopyResetTimers])

  const handleSummaryCopy = useCallback(async () => {
    if (viewModel === null) {
      return
    }
    const copied = await copyErrorDetailOverlaySummary(viewModel)
    clearSummaryCopyResetTimer()
    setSummaryCopyStatus(copied ? 'success' : 'error')
    summaryCopyResetTimerRef.current = window.setTimeout(() => {
      setSummaryCopyStatus('idle')
      summaryCopyResetTimerRef.current = null
    }, copyFeedbackResetMs)
  }, [clearSummaryCopyResetTimer, viewModel])

  const handleGroupCopy = useCallback(async (group: ErrorDetailOverlayGroup) => {
    const copied = await copyErrorDetailOverlayGroup(group)
    clearGroupCopyResetTimer(group.key)
    setGroupCopyStatus((current) => ({
      ...current,
      [group.key]: copied ? 'success' : 'error',
    }))
    groupCopyResetTimerRefs.current[group.key] = window.setTimeout(() => {
      setGroupCopyStatus((current) => ({
        ...current,
        [group.key]: 'idle',
      }))
      delete groupCopyResetTimerRefs.current[group.key]
    }, copyFeedbackResetMs)
  }, [clearGroupCopyResetTimer])

  return { summaryCopyStatus, groupCopyStatus, handleSummaryCopy, handleGroupCopy }
}

function useErrorDetailFocusManagement(
  viewModel: ErrorDetailOverlayViewModel | null,
  dialogRef: React.RefObject<HTMLElement | null>,
  closeButtonRef: React.RefObject<HTMLButtonElement | null>,
) {
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (viewModel === null) {
      const previousFocusedElement = previouslyFocusedElementRef.current
      previouslyFocusedElementRef.current = null

      if (previousFocusedElement?.isConnected) {
        previousFocusedElement.focus()
      }

      return
    }

    previouslyFocusedElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    const focusTimer = window.requestAnimationFrame(() => {
      const dialog = dialogRef.current

      if (!dialog) {
        return
      }

      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null

      if (activeElement && dialog.contains(activeElement) && activeElement !== dialog) {
        return
      }

      const focusTarget = closeButtonRef.current ?? getFocusableElements(dialog)[0] ?? dialog
      focusTarget.focus()
    })

    return () => {
      window.cancelAnimationFrame(focusTimer)
    }
  }, [viewModel, dialogRef, closeButtonRef])
}

function useErrorDetailEscapeKey(viewModel: ErrorDetailOverlayViewModel | null, onClose: () => void) {
  useEffect(() => {
    if (viewModel === null) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      onClose()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, viewModel])
}

function ErrorDetailHeader({
  titleId,
  descriptionId,
  viewModel,
  summaryCopyLabel,
  closeButtonRef,
  onSummaryCopy,
  onClose,
}: {
  titleId: string
  descriptionId: string
  viewModel: ErrorDetailOverlayViewModel
  summaryCopyLabel: string
  closeButtonRef: React.RefObject<HTMLButtonElement | null>
  onSummaryCopy: () => Promise<void>
  onClose: () => void
}) {
  return (
    <header className="error-detail-overlay__header">
      <div className="error-detail-overlay__header-copy">
        <p className="error-detail-overlay__eyebrow">错误详情</p>
        <h2 id={titleId} className="error-detail-overlay__title">{viewModel.title}</h2>
        <p id={descriptionId} className="error-detail-overlay__summary">{viewModel.summaryMessage}</p>
      </div>
      <div className="error-detail-overlay__header-actions">
        <button
          type="button"
          className="secondary-button secondary-button--subtle error-detail-overlay__copy-all"
          data-testid="error-detail-overlay-copy-all"
          onClick={onSummaryCopy}
        >
          {summaryCopyLabel}
        </button>
        <button
          ref={closeButtonRef}
          type="button"
          className="icon-button error-detail-overlay__close"
          aria-label="关闭错误详情"
          title="关闭错误详情"
          data-testid="error-detail-overlay-close"
          onClick={() => {
            onClose()
          }}
        >
          <span aria-hidden="true">✕</span>
        </button>
      </div>
    </header>
  )
}

function ErrorDetailGroupItem({
  group,
  copyStatus,
  onGroupCopy,
}: {
  group: ErrorDetailOverlayGroup
  copyStatus: CopyStatus
  onGroupCopy: (group: ErrorDetailOverlayGroup) => Promise<void>
}) {
  const copyLabel = copyStatus === 'success'
    ? '已复制'
    : copyStatus === 'error'
      ? '复制失败'
      : '复制'

  return (
    <section
      className="error-detail-overlay__group"
      data-testid={`error-detail-overlay-group-${group.key}`}
    >
      <div className="error-detail-overlay__group-header">
        <div className="error-detail-overlay__group-copy">
          <h3 className="error-detail-overlay__group-title">{group.title}</h3>
          <p className="error-detail-overlay__group-description">{group.description}</p>
        </div>
        <button
          type="button"
          className="ghost-button error-detail-overlay__group-action"
          data-testid={`error-detail-overlay-group-copy-${group.key}`}
          onClick={async () => {
            await onGroupCopy(group)
          }}
        >
          {copyLabel}
        </button>
      </div>
      <div className="error-detail-overlay__group-content">
        {group.items.map((item, index) => renderContentItem(item, `${group.key}:${index}`))}
      </div>
    </section>
  )
}
