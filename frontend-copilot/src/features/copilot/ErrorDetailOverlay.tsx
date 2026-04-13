import { useEffect, useId, useRef, useState, type ComponentType } from 'react'

import {
  copyErrorDetailOverlayGroup,
  copyErrorDetailOverlaySummary,
} from './error-detail-overlay-copy'
import type {
  ErrorDetailOverlayContentItem,
  ErrorDetailOverlayStructuredJsonValue,
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
      return <ErrorDetailOverlayTextBlock key={key} item={item} />
  }
}

interface JsonViewComponentProps {
  src: unknown
  collapsed?: boolean | number
  displaySize?: boolean | number | 'collapsed' | 'expanded'
  enableClipboard?: boolean
  theme?: 'default' | 'a11y' | 'github' | 'vscode' | 'atom' | 'winter-is-coming' | 'vitesse'
}

type JsonViewComponent = ComponentType<JsonViewComponentProps>

let cachedJsonViewComponent: JsonViewComponent | null = null
let jsonViewComponentPromise: Promise<JsonViewComponent> | null = null

function ErrorDetailOverlayTextBlock({ item }: {
  item: Extract<ErrorDetailOverlayContentItem, { kind: 'text' }>
}) {
  const structuredValue = item.structuredValue ?? null
  const shouldRenderStructuredJson = item.presentation === 'json' && structuredValue !== null
  const [jsonViewComponent, setJsonViewComponent] = useState<JsonViewComponent | null>(() => cachedJsonViewComponent)

  useEffect(() => {
    if (!shouldRenderStructuredJson || typeof document === 'undefined' || jsonViewComponent !== null) {
      return
    }

    let active = true

    void loadJsonViewComponent()
      .then((component) => {
        if (!active) {
          return
        }

        setJsonViewComponent(() => component)
      })
      .catch(() => {
        if (!active) {
          return
        }

        setJsonViewComponent(null)
      })

    return () => {
      active = false
    }
  }, [jsonViewComponent, shouldRenderStructuredJson])

  return (
    <div className="error-detail-overlay__text-block">
      {item.label !== null && (
        <p className="error-detail-overlay__text-label">{item.label}</p>
      )}
      {shouldRenderStructuredJson
        ? (
            <ErrorDetailOverlayStructuredJson
              label={item.label}
              value={structuredValue!}
              jsonViewComponent={jsonViewComponent}
            />
          )
        : (
            <pre
              className="error-detail-overlay__text-value"
              data-testid={item.label === '原始 details' ? 'error-detail-overlay-raw-details-text' : undefined}
            >
              {item.text}
            </pre>
          )}
    </div>
  )
}

function ErrorDetailOverlayStructuredJson({
  label,
  value,
  jsonViewComponent,
}: {
  label: string | null
  value: ErrorDetailOverlayStructuredJsonValue
  jsonViewComponent: JsonViewComponent | null
}) {
  const JsonViewComponent = jsonViewComponent

  return (
    <div
      className="error-detail-overlay__json-viewer"
      data-testid={label === '原始 details' ? 'error-detail-overlay-raw-details-json' : undefined}
      data-json-viewer={JsonViewComponent === null ? 'fallback' : 'react18-json-view'}
    >
      {JsonViewComponent === null
        ? (
            <pre className="error-detail-overlay__json-fallback">
              {JSON.stringify(value, null, 2)}
            </pre>
          )
        : (
            <JsonViewComponent
              src={value}
              collapsed={2}
              displaySize="collapsed"
              enableClipboard={false}
              theme="vscode"
            />
          )}
    </div>
  )
}

function loadJsonViewComponent(): Promise<JsonViewComponent> {
  if (cachedJsonViewComponent !== null) {
    return Promise.resolve(cachedJsonViewComponent)
  }

  if (jsonViewComponentPromise !== null) {
    return jsonViewComponentPromise
  }

  jsonViewComponentPromise = import('react18-json-view')
    .then((module) => {
      const component = resolveJsonViewComponent(module)
      cachedJsonViewComponent = component
      return component
    })
    .catch((error: unknown) => {
      jsonViewComponentPromise = null
      throw error
    })

  return jsonViewComponentPromise
}

function resolveJsonViewComponent(module: unknown): JsonViewComponent {
  if (typeof module === 'function') {
    return module as JsonViewComponent
  }

  if (typeof module === 'object' && module !== null && 'default' in module) {
    const defaultExport = (module as { default?: unknown }).default
    if (typeof defaultExport === 'function') {
      return defaultExport as JsonViewComponent
    }

    if (typeof defaultExport === 'object' && defaultExport !== null && 'default' in defaultExport) {
      const nestedDefaultExport = (defaultExport as { default?: unknown }).default
      if (typeof nestedDefaultExport === 'function') {
        return nestedDefaultExport as JsonViewComponent
      }
    }
  }

  throw new TypeError('Unsupported react18-json-view export shape.')
}
