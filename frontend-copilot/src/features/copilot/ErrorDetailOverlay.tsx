import { useEffect, useId, useRef, useState } from 'react'

import {
  copyErrorDetailOverlayGroup,
  copyErrorDetailOverlaySummary,
} from './error-detail-overlay-copy'
import type {
  ErrorDetailOverlayContentItem,
  ErrorDetailOverlayViewModel,
} from './error-detail-overlay-view-model'

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
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [summaryCopyStatus, setSummaryCopyStatus] = useState<CopyStatus>('idle')
  const [groupCopyStatus, setGroupCopyStatus] = useState<Record<string, CopyStatus>>({})

  useEffect(() => {
    setSummaryCopyStatus('idle')
    setGroupCopyStatus({})
  }, [viewModel])

  useEffect(() => {
    if (viewModel === null) {
      return
    }

    closeButtonRef.current?.focus()
  }, [viewModel])

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

  if (viewModel === null) {
    return null
  }

  const summaryCopyLabel = summaryCopyStatus === 'success'
    ? '已复制'
    : summaryCopyStatus === 'error'
      ? '复制失败'
      : '复制全部'

  return (
    <div
      className="error-detail-overlay"
      data-testid="error-detail-overlay"
      onClick={() => {
        onClose()
      }}
    >
      <section
        className="error-detail-overlay__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-testid="error-detail-overlay-dialog"
        onClick={(event) => {
          event.stopPropagation()
        }}
      >
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
              onClick={async () => {
                const copied = await copyErrorDetailOverlaySummary(viewModel)
                setSummaryCopyStatus(copied ? 'success' : 'error')
                window.setTimeout(() => {
                  setSummaryCopyStatus('idle')
                }, copyFeedbackResetMs)
              }}
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
        <div className="error-detail-overlay__body">
          {viewModel.groups.map((group) => {
            const copyStatus = groupCopyStatus[group.key] ?? 'idle'
            const copyLabel = copyStatus === 'success'
              ? '已复制'
              : copyStatus === 'error'
                ? '复制失败'
                : '复制'

            return (
              <section
                key={group.key}
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
                      const copied = await copyErrorDetailOverlayGroup(group)
                      setGroupCopyStatus((current) => ({
                        ...current,
                        [group.key]: copied ? 'success' : 'error',
                      }))
                      window.setTimeout(() => {
                        setGroupCopyStatus((current) => ({
                          ...current,
                          [group.key]: 'idle',
                        }))
                      }, copyFeedbackResetMs)
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
          })}
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

function renderContentItem(item: ErrorDetailOverlayContentItem, key: string) {
  switch (item.kind) {
    case 'key-value':
      return (
        <dl key={key} className="error-detail-overlay__kv-row">
          <dt className="error-detail-overlay__kv-label">{item.label}</dt>
          <dd className="error-detail-overlay__kv-value">{item.value}</dd>
        </dl>
      )
    case 'list':
      return (
        <div key={key} className="error-detail-overlay__list-block">
          <p className="error-detail-overlay__list-label">{item.label}</p>
          <ul className="error-detail-overlay__list-values">
            {item.values.map((value) => (
              <li key={`${key}:${value}`} className="error-detail-overlay__list-item">{value}</li>
            ))}
          </ul>
        </div>
      )
    case 'text':
      return (
        <div key={key} className="error-detail-overlay__text-block">
          {item.label !== null && (
            <p className="error-detail-overlay__text-label">{item.label}</p>
          )}
          <pre className="error-detail-overlay__text-value">{item.text}</pre>
        </div>
      )
  }
}
