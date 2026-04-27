import { useEffect, useState, type ComponentType } from 'react'

import type {
  ErrorDetailOverlayContentItem,
  ErrorDetailOverlayStructuredJsonValue,
} from './error-detail-overlay-view-model'

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

export function renderContentItem(item: ErrorDetailOverlayContentItem, key: string) {
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
            {item.values.map((value, index) => (
              <li key={`${key}:${index}:${value}`} className="error-detail-overlay__list-item">{value}</li>
            ))}
          </ul>
        </div>
      )
    case 'text':
      return <ErrorDetailOverlayTextBlock key={key} item={item} />
  }
}

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
