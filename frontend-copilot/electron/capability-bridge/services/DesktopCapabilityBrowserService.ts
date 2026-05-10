import { BrowserWindow } from 'electron'
import type { DesktopCapabilityBridgeRequest } from '../protocol'
import { DesktopCapabilityBridgeError } from '../errors'
import { createDesktopCapabilityArtifactService } from './DesktopCapabilityArtifactService'
import type { CreateDesktopCapabilityBridgeServiceOptions } from '../types'

const DEFAULT_SCREENSHOT_NAME = 'browser-screenshot.png'
const SUPPORTED_PAGE_CONTENT_FORMATS = new Set(['text', 'html', 'markdown'])

type BrowserPageContentFormat = 'text' | 'html' | 'markdown'

interface BrowserTabRecord {
  tabId: string
  targetWindow: BrowserWindow
}

interface BrowserTabRegistry {
  tabs: Map<string, BrowserWindow>
  activeTabId: string | null
  nextTabSequence: number
}

interface BrowserOpenRequestPayload {
  url: string
  showWindow: boolean
  newTab: boolean
  selector: string | null
  format: BrowserPageContentFormat | null
}

export interface DesktopCapabilityBrowserService {
  handle(request: DesktopCapabilityBridgeRequest): Promise<Record<string, unknown>>
}

export function createDesktopCapabilityBrowserService(
  options: CreateDesktopCapabilityBridgeServiceOptions,
): DesktopCapabilityBrowserService {
  const artifactService = createDesktopCapabilityArtifactService(options)
  const registry: BrowserTabRegistry = {
    tabs: new Map(),
    activeTabId: null,
    nextTabSequence: 0,
  }

  return {
    async handle(request) {
      switch (request.operation) {
        case 'open':
          return await openBrowserPage(registry, options, request)
        case 'screenshot':
          return await captureBrowserScreenshot(registry, artifactService, options, request)
        default:
          throw new DesktopCapabilityBridgeError(
            'unsupported_operation',
            `Browser capability does not support operation '${request.operation}'.`,
            {
              details: {
                capability: request.capability,
                operation: request.operation,
              },
            },
          )
      }
    },
  }
}

async function openBrowserPage(
  registry: BrowserTabRegistry,
  options: CreateDesktopCapabilityBridgeServiceOptions,
  request: DesktopCapabilityBridgeRequest,
): Promise<Record<string, unknown>> {
  const payload = normalizeOpenRequestPayload(request.payload)
  const tab = payload.newTab
    ? createBrowserTab(registry, options, payload.showWindow)
    : getOrCreateBrowserTab(registry, options, payload.showWindow)

  try {
    await tab.targetWindow.loadURL(payload.url)
  } catch (error) {
    throw new DesktopCapabilityBridgeError('temporarily_unavailable', 'Failed to open the requested URL.', {
      retryable: true,
      details: {
        url: payload.url,
        tabId: tab.tabId,
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }

  applyWindowVisibility(tab.targetWindow, payload.showWindow)
  registry.activeTabId = tab.tabId

  const summary = describeBrowserWindow(tab.tabId, tab.targetWindow)
  const result = payload.format === null
    ? summary
    : {
        tabId: tab.tabId,
        content: await extractPageContent(tab.targetWindow, {
          selector: payload.selector,
          format: payload.format,
        }),
      }

  await options.appendLog?.('info', '[capability-bridge] Browser page opened.', {
    capability: request.capability,
    operation: request.operation,
    toolId: request.toolId,
    runId: request.runId,
    toolCallId: request.toolCallId,
    tabId: tab.tabId,
    currentUrl: summary.currentUrl,
    title: summary.title,
    windowVisible: summary.windowVisible,
    newTab: payload.newTab,
    selector: payload.selector,
    format: payload.format,
  }, {
    relayToRenderer: false,
  })

  return result
}

async function captureBrowserScreenshot(
  registry: BrowserTabRegistry,
  artifactService: ReturnType<typeof createDesktopCapabilityArtifactService>,
  options: CreateDesktopCapabilityBridgeServiceOptions,
  request: DesktopCapabilityBridgeRequest,
): Promise<Record<string, unknown>> {
  const tab = requireActiveBrowserTab(registry)

  let pngBuffer: Buffer
  try {
    const image = await tab.targetWindow.webContents.capturePage()
    pngBuffer = image.toPNG()
  } catch (error) {
    throw new DesktopCapabilityBridgeError('temporarily_unavailable', 'Failed to capture a browser screenshot.', {
      retryable: true,
      details: {
        tabId: tab.tabId,
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }

  const summary = describeBrowserWindow(tab.tabId, tab.targetWindow)
  const name = normalizeScreenshotName(request.payload.name)
  const artifactResult = await artifactService.handle({
    ...request,
    capability: 'artifact',
    operation: 'save_bytes',
    payload: {
      name,
      contentBase64: pngBuffer.toString('base64'),
      contentType: 'image/png',
      metadata: {
        sourceOperation: 'browser.screenshot',
        browser: {
          tabId: tab.tabId,
          currentUrl: summary.currentUrl,
          title: summary.title,
        },
      },
    },
  })

  await options.appendLog?.('info', '[capability-bridge] Browser screenshot captured.', {
    capability: request.capability,
    operation: request.operation,
    toolId: request.toolId,
    runId: request.runId,
    toolCallId: request.toolCallId,
    tabId: tab.tabId,
    currentUrl: summary.currentUrl,
    title: summary.title,
    name,
    byteLength: pngBuffer.byteLength,
  }, {
    relayToRenderer: false,
  })

  return {
    ...summary,
    ...artifactResult,
  }
}

function createBrowserTab(
  registry: BrowserTabRegistry,
  options: CreateDesktopCapabilityBridgeServiceOptions,
  showWindow: boolean,
): BrowserTabRecord {
  const targetWindow = options.createBrowserWindow?.({ showWindow }) ?? new BrowserWindow({
    title: 'CanDue Browser',
    show: showWindow,
    width: 1280,
    height: 960,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  const tabId = `browser-tab-${registry.nextTabSequence + 1}`
  registry.nextTabSequence += 1
  registry.tabs.set(tabId, targetWindow)
  targetWindow.once('closed', () => {
    registry.tabs.delete(tabId)
    if (registry.activeTabId === tabId) {
      registry.activeTabId = null
    }
  })
  return {
    tabId,
    targetWindow,
  }
}

function getOrCreateBrowserTab(
  registry: BrowserTabRegistry,
  options: CreateDesktopCapabilityBridgeServiceOptions,
  showWindow: boolean,
): BrowserTabRecord {
  const existingTab = findActiveBrowserTab(registry)
  if (existingTab !== null) {
    applyWindowVisibility(existingTab.targetWindow, showWindow)
    return existingTab
  }

  return createBrowserTab(registry, options, showWindow)
}

function requireActiveBrowserTab(registry: BrowserTabRegistry): BrowserTabRecord {
  const tab = findActiveBrowserTab(registry)
  if (tab === null) {
    throw new DesktopCapabilityBridgeError('temporarily_unavailable', 'Browser page is not available.', {
      retryable: true,
    })
  }

  return tab
}

function findActiveBrowserTab(registry: BrowserTabRegistry): BrowserTabRecord | null {
  const activeTabId = registry.activeTabId
  if (activeTabId !== null) {
    const activeWindow = registry.tabs.get(activeTabId)
    if (isUsableBrowserWindow(activeWindow)) {
      return {
        tabId: activeTabId,
        targetWindow: activeWindow,
      }
    }
    registry.tabs.delete(activeTabId)
    registry.activeTabId = null
  }

  for (const [tabId, targetWindow] of registry.tabs.entries()) {
    if (!isUsableBrowserWindow(targetWindow)) {
      registry.tabs.delete(tabId)
      continue
    }
    registry.activeTabId = tabId
    return {
      tabId,
      targetWindow,
    }
  }

  return null
}

function isUsableBrowserWindow(targetWindow: BrowserWindow | undefined): targetWindow is BrowserWindow {
  if (targetWindow === undefined || targetWindow.isDestroyed()) {
    return false
  }

  return !targetWindow.webContents.isDestroyed()
}

function applyWindowVisibility(targetWindow: BrowserWindow, showWindow: boolean): void {
  if (showWindow) {
    targetWindow.show()
    return
  }

  if (targetWindow.isVisible()) {
    targetWindow.hide()
  }
}

function describeBrowserWindow(tabId: string, targetWindow: BrowserWindow): Record<string, unknown> {
  const currentUrl = normalizeOptionalString(targetWindow.webContents.getURL()) ?? ''
  const webContentsTitle = normalizeOptionalString(targetWindow.webContents.getTitle?.())
  const windowTitle = normalizeOptionalString(targetWindow.getTitle())

  return {
    tabId,
    currentUrl,
    title: webContentsTitle ?? windowTitle ?? '',
    windowVisible: targetWindow.isVisible(),
  }
}

async function extractPageContent(
  targetWindow: BrowserWindow,
  input: {
    selector: string | null
    format: BrowserPageContentFormat
  },
): Promise<string> {
  let result: unknown
  try {
    result = await targetWindow.webContents.executeJavaScript(
      `(() => {
        const selector = ${JSON.stringify(input.selector)}
        const format = ${JSON.stringify(input.format)}
        const selectedNode = selector ? document.querySelector(selector) : null
        if (selector && selectedNode === null) {
          return {
            ok: false,
            errorCode: 'not_found',
            message: 'No page element matched selector ' + selector + '.',
          }
        }

        const htmlTarget = selectedNode ?? document.documentElement
        const textTarget = selectedNode ?? document.body ?? document.documentElement
        const readText = () => {
          const raw = textTarget instanceof HTMLElement
            ? (textTarget.innerText || textTarget.textContent || '')
            : (textTarget.textContent || '')
          return raw.trim()
        }

        switch (format) {
          case 'html':
            return {
              ok: true,
              content: htmlTarget instanceof Element ? htmlTarget.outerHTML : '',
            }
          case 'text':
          case 'markdown':
            return {
              ok: true,
              content: readText(),
            }
          default:
            return {
              ok: false,
              errorCode: 'invalid_request',
              message: 'Unsupported browser content format ' + format + '.',
            }
        }
      })()`,
      true,
    )
  } catch (error) {
    throw new DesktopCapabilityBridgeError('temporarily_unavailable', 'Failed to extract browser page content.', {
      retryable: true,
      details: {
        selector: input.selector,
        format: input.format,
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }

  const record = normalizeResultRecord(result)
  if (record.ok !== true) {
    const message = typeof record.message === 'string' && record.message.trim() !== ''
      ? record.message
      : 'Failed to extract browser page content.'
    const errorCode = record.errorCode === 'not_found' ? 'not_found' : 'invalid_request'
    throw new DesktopCapabilityBridgeError(errorCode, message, {
      details: {
        selector: input.selector,
        format: input.format,
      },
    })
  }

  if (typeof record.content !== 'string') {
    throw new DesktopCapabilityBridgeError('temporarily_unavailable', 'Browser page content extraction returned an invalid result.', {
      retryable: true,
      details: {
        selector: input.selector,
        format: input.format,
      },
    })
  }

  return record.content
}

function normalizeOpenRequestPayload(payload: Record<string, unknown>): BrowserOpenRequestPayload {
  const format = normalizeOptionalString(payload.format)
  const normalizedFormat = format === null ? null : normalizeContentFormat(format)

  return {
    url: requireNonEmptyString(payload.url, 'url must be a non-empty string.'),
    showWindow: payload.showWindow === true,
    newTab: payload.newTab === true,
    selector: normalizeOptionalString(payload.selector),
    format: normalizedFormat,
  }
}

function normalizeContentFormat(value: string): BrowserPageContentFormat {
  const normalized = value.trim().toLowerCase()
  if (!SUPPORTED_PAGE_CONTENT_FORMATS.has(normalized)) {
    throw new DesktopCapabilityBridgeError(
      'invalid_request',
      `format must be one of: ${Array.from(SUPPORTED_PAGE_CONTENT_FORMATS).join(', ')}.`,
      {
        details: {
          format: value,
        },
      },
    )
  }

  return normalized as BrowserPageContentFormat
}

function normalizeResultRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new DesktopCapabilityBridgeError(
      'temporarily_unavailable',
      'Browser page content extraction returned an invalid result.',
      {
        retryable: true,
      },
    )
  }

  return value as Record<string, unknown>
}

function normalizeScreenshotName(value: unknown): string {
  const name = normalizeOptionalString(value)
  if (name === null) {
    return DEFAULT_SCREENSHOT_NAME
  }

  return /\.png$/i.test(name) ? name : `${name}.png`
}

function requireNonEmptyString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DesktopCapabilityBridgeError('invalid_request', message)
  }

  return value.trim()
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized === '' ? null : normalized
}
