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
        case 'list_tabs':
          return await listBrowserTabs(registry, options, request)
        case 'close_tab':
          return await closeBrowserTab(registry, options, request)
        case 'switch_tab':
          return await switchBrowserTab(registry, options, request)
        case 'execute':
          return await executeBrowserScript(registry, options, request)
        case 'reset':
          return await resetBrowser(registry, options, request)
        case 'snapshot':
          return await captureBrowserSnapshot(registry, options, request)
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
    throw new DesktopCapabilityBridgeError('temporarily_unavailable', `Failed to open the requested URL: ${error instanceof Error ? error.message : String(error)}`, {
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
    throw new DesktopCapabilityBridgeError('temporarily_unavailable', `Failed to capture a browser screenshot: ${error instanceof Error ? error.message : String(error)}`, {
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

function findAnyAvailableTabId(registry: BrowserTabRegistry): string | null {
  for (const [tabId, targetWindow] of registry.tabs.entries()) {
    if (isUsableBrowserWindow(targetWindow)) {
      return tabId
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

        const markupTarget = selectedNode ?? document.body ?? document.documentElement
        const textTarget = selectedNode ?? document.body ?? document.documentElement
        const readText = () => {
          const raw = textTarget instanceof HTMLElement
            ? (textTarget.innerText || textTarget.textContent || '')
            : (textTarget.textContent || '')
          return raw.trim()
        }

        switch (format) {
          case 'html':
          case 'markdown':
            return {
              ok: true,
              content: markupTarget instanceof Element ? markupTarget.outerHTML : '',
            }
          case 'text':
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
    throw new DesktopCapabilityBridgeError('temporarily_unavailable', `Failed to extract browser page content: ${error instanceof Error ? error.message : String(error)}`, {
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

  if (input.format === 'markdown') {
    return convertHtmlToMarkdown(record.content)
  }

  return record.content
}

function convertHtmlToMarkdown(value: string): string {
  const html = value.trim()
  if (html === '') {
    return ''
  }

  const codeBlocks: string[] = []
  let markdown = html.replace(/<pre\b[^>]*>\s*<code\b[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/gi, (_, code: string) => {
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`
    const normalized_code = decodeHtmlEntities(stripHtmlTags(code)).trim()
    codeBlocks.push(`\n\n\`\`\`\n${normalized_code}\n\`\`\`\n\n`)
    return placeholder
  })

  markdown = markdown
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, content: string) => {
      return `\n\n${'#'.repeat(Number(level))} ${convertInlineHtmlToMarkdown(content)}\n\n`
    })
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content: string) => {
      const rendered = convertInlineHtmlToMarkdown(content)
      const lines = rendered.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '')
      return lines.length === 0 ? '' : `\n\n${lines.map((line) => `> ${line}`).join('\n')}\n\n`
    })
    .replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_, content: string) => {
      return `\n\n${convertListHtmlToMarkdown(content, true)}\n\n`
    })
    .replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (_, content: string) => {
      return `\n\n${convertListHtmlToMarkdown(content, false)}\n\n`
    })
    .replace(/<(p|div|section|article|header|footer|aside|nav|figure)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _tag: string, content: string) => {
      const rendered = convertInlineHtmlToMarkdown(content)
      return rendered === '' ? '' : `\n\n${rendered}\n\n`
    })
    .replace(/<br\s*\/?>/gi, '\n')

  markdown = convertInlineHtmlToMarkdown(markdown)
  for (let index = 0; index < codeBlocks.length; index += 1) {
    markdown = markdown.replace(`__CODE_BLOCK_${index}__`, codeBlocks[index])
  }

  return normalizeMarkdownWhitespace(markdown)
}

function convertListHtmlToMarkdown(value: string, ordered: boolean): string {
  const items = Array.from(value.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi))
    .map((match) => convertInlineHtmlToMarkdown(match[1] ?? ''))
    .filter((item) => item !== '')
  return items
    .map((item, index) => `${ordered ? `${index + 1}.` : '-'} ${item}`)
    .join('\n')
}

function convertInlineHtmlToMarkdown(value: string): string {
  return decodeHtmlEntities(value)
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, text: string) => {
      const rendered_text = convertInlineHtmlToMarkdown(text)
      return `[${rendered_text || href}](${href})`
    })
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _tag: string, text: string) => {
      const rendered_text = convertInlineHtmlToMarkdown(text)
      return rendered_text === '' ? '' : `**${rendered_text}**`
    })
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _tag: string, text: string) => {
      const rendered_text = convertInlineHtmlToMarkdown(text)
      return rendered_text === '' ? '' : `*${rendered_text}*`
    })
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, text: string) => {
      const rendered_text = decodeHtmlEntities(stripHtmlTags(text)).trim()
      return rendered_text === '' ? '' : `\`${rendered_text}\``
    })
    .replace(/<img\b[^>]*alt=["']([^"']*)["'][^>]*src=["']([^"']+)["'][^>]*>/gi, (_, alt: string, src: string) => {
      return `![${alt}](${src})`
    })
    .replace(/<img\b[^>]*src=["']([^"']+)["'][^>]*alt=["']([^"']*)["'][^>]*>/gi, (_, src: string, alt: string) => {
      return `![${alt}](${src})`
    })
    .replace(/<hr\s*\/?>/gi, '\n---\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ')
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&/gi, '&')
    .replace(/</gi, '<')
    .replace(/>/gi, '>')
    .replace(/"/gi, '"')
    .replace(/'/gi, "'")
}

function normalizeMarkdownWhitespace(value: string): string {
  return value
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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

async function listBrowserTabs(
  registry: BrowserTabRegistry,
  options: CreateDesktopCapabilityBridgeServiceOptions,
  request: DesktopCapabilityBridgeRequest,
): Promise<Record<string, unknown>> {
  const tabList: Record<string, unknown>[] = []
  for (const [tabId, targetWindow] of registry.tabs.entries()) {
    if (isUsableBrowserWindow(targetWindow)) {
      tabList.push(describeBrowserWindow(tabId, targetWindow))
    }
  }

  await options.appendLog?.('info', '[capability-bridge] Browser tabs listed.', {
    capability: request.capability,
    operation: request.operation,
    toolId: request.toolId,
    runId: request.runId,
    toolCallId: request.toolCallId,
    tabCount: tabList.length,
    activeTabId: registry.activeTabId,
  }, { relayToRenderer: false })

  return { tabs: tabList }
}

async function closeBrowserTab(
  registry: BrowserTabRegistry,
  options: CreateDesktopCapabilityBridgeServiceOptions,
  request: DesktopCapabilityBridgeRequest,
): Promise<Record<string, unknown>> {
  const tabId = normalizeOptionalString(request.payload.tabId) ?? registry.activeTabId
  if (tabId === null || !registry.tabs.has(tabId)) {
    throw new DesktopCapabilityBridgeError('not_found', `Tab '${tabId ?? 'undefined'}' not found.`, {
      details: { tabId },
    })
  }

  const targetWindow = registry.tabs.get(tabId)!
  if (!isUsableBrowserWindow(targetWindow)) {
    registry.tabs.delete(tabId)
    if (registry.activeTabId === tabId) {
      registry.activeTabId = null
    }
    throw new DesktopCapabilityBridgeError('not_found', `Tab '${tabId}' has been destroyed.`, {
      details: { tabId },
    })
  }

  const summary = describeBrowserWindow(tabId, targetWindow)
  targetWindow.close()

  registry.tabs.delete(tabId)
  if (registry.activeTabId === tabId) {
    registry.activeTabId = findAnyAvailableTabId(registry)
  }

  await options.appendLog?.('info', '[capability-bridge] Browser tab closed.', {
    capability: request.capability,
    operation: request.operation,
    toolId: request.toolId,
    runId: request.runId,
    toolCallId: request.toolCallId,
    tabId,
    currentUrl: summary.currentUrl,
    title: summary.title,
  }, { relayToRenderer: false })

  return summary
}

async function switchBrowserTab(
  registry: BrowserTabRegistry,
  options: CreateDesktopCapabilityBridgeServiceOptions,
  request: DesktopCapabilityBridgeRequest,
): Promise<Record<string, unknown>> {
  const tabId = requireNonEmptyString(request.payload.tabId, 'tabId must be a non-empty string.')
  const targetWindow = registry.tabs.get(tabId)
  if (!targetWindow || !isUsableBrowserWindow(targetWindow)) {
    throw new DesktopCapabilityBridgeError('not_found', `Tab '${tabId}' not found or has been destroyed.`, {
      details: { tabId },
    })
  }

  registry.activeTabId = tabId
  const summary = describeBrowserWindow(tabId, targetWindow)

  await options.appendLog?.('info', '[capability-bridge] Browser tab switched.', {
    capability: request.capability,
    operation: request.operation,
    toolId: request.toolId,
    runId: request.runId,
    toolCallId: request.toolCallId,
    tabId,
    currentUrl: summary.currentUrl,
    title: summary.title,
  }, { relayToRenderer: false })

  return summary
}

async function executeBrowserScript(
  registry: BrowserTabRegistry,
  options: CreateDesktopCapabilityBridgeServiceOptions,
  request: DesktopCapabilityBridgeRequest,
): Promise<Record<string, unknown>> {
  const script = requireNonEmptyString(request.payload.script, 'script is required.')
  const tabId = normalizeOptionalString(request.payload.tabId) ?? registry.activeTabId
  const tab = tabId !== null && registry.tabs.has(tabId)
    ? { tabId, targetWindow: registry.tabs.get(tabId)! }
    : requireActiveBrowserTab(registry)

  if (!isUsableBrowserWindow(tab.targetWindow)) {
    throw new DesktopCapabilityBridgeError('not_found', `Tab '${tab.tabId}' has been destroyed.`, {
      details: { tabId: tab.tabId },
    })
  }

  let rawResult: unknown
  try {
    rawResult = await tab.targetWindow.webContents.executeJavaScript(script, true)
  } catch (error) {
    throw new DesktopCapabilityBridgeError('temporarily_unavailable', `Failed to execute script in browser: ${error instanceof Error ? error.message : String(error)}`, {
      retryable: true,
      details: {
        tabId: tab.tabId,
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }

  const result = serializeJavaScriptResult(rawResult)

  await options.appendLog?.('info', '[capability-bridge] Browser script executed.', {
    capability: request.capability,
    operation: request.operation,
    toolId: request.toolId,
    runId: request.runId,
    toolCallId: request.toolCallId,
    tabId: tab.tabId,
    scriptLength: script.length,
    resultType: typeof rawResult,
  }, { relayToRenderer: false })

  return { result, tabId: tab.tabId }
}

function serializeJavaScriptResult(value: unknown): unknown {
  return _safeSerialize(value, new WeakSet(), 0)
}

const MAX_SERIALIZE_DEPTH = 10

function _safeSerialize(value: unknown, visited: WeakSet<object>, depth: number): unknown {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value !== 'object') return String(value)
  if (depth >= MAX_SERIALIZE_DEPTH) return '[max depth]'
  if (visited.has(value as object)) return '[circular]'
  visited.add(value as object)

  if (Array.isArray(value)) {
    return value.map((item) => _safeSerialize(item, visited, depth + 1))
  }

  const record: Record<string, unknown> = {}
  try {
    const keys = Object.keys(value as Record<string, unknown>)
    for (const key of keys) {
      try {
        record[key] = _safeSerialize((value as Record<string, unknown>)[key], visited, depth + 1)
      } catch {
        record[key] = '[unserializable]'
      }
    }
  } catch {
    return '[unserializable]'
  }
  return record
}

async function resetBrowser(
  registry: BrowserTabRegistry,
  options: CreateDesktopCapabilityBridgeServiceOptions,
  request: DesktopCapabilityBridgeRequest,
): Promise<Record<string, unknown>> {
  let closedCount = 0
  for (const [, targetWindow] of registry.tabs.entries()) {
    if (!targetWindow.isDestroyed()) {
      targetWindow.close()
      closedCount++
    }
  }
  registry.tabs.clear()
  registry.activeTabId = null

  await options.appendLog?.('info', '[capability-bridge] Browser reset.', {
    capability: request.capability,
    operation: request.operation,
    toolId: request.toolId,
    runId: request.runId,
    toolCallId: request.toolCallId,
    closedCount,
  }, { relayToRenderer: false })

  return { closedCount }
}

const BROWSER_SNAPSHOT_SCRIPT = `
(() => {
  const INTERACTIVE_SELECTOR = 'a,button,input,select,textarea,[onclick],[role="button"],[role="link"],[role="textbox"],[role="combobox"],[role="checkbox"],[role="radio"],[tabindex]:not([tabindex="-1"]),[contenteditable="true"],[contenteditable=""],details,summary';
  const SKIP_TAGS = new Set(['SCRIPT','STYLE','NOSCRIPT','SVG','META','LINK','HEAD','TITLE','TEMPLATE']);
  let refCounter = 0;
  const refMap = new Map();
  const lines = [];

  function getRef(el) {
    if (!refMap.has(el)) {
      refCounter++;
      refMap.set(el, '@' + refCounter);
    }
    return refMap.get(el);
  }

  function getRole(el) {
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute('type');
    const explicitRole = el.getAttribute('role');
    if (explicitRole) return explicitRole;
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'input') {
      if (type === 'submit' || type === 'reset') return 'button';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      return 'textbox';
    }
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (/^h[1-6]$/.test(tag)) return 'heading';
    if (tag === 'img') return 'img';
    if (tag === 'details') return 'group';
    return null;
  }

  function getDisplayText(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' && (el.type === 'submit' || el.type === 'button' || el.type === 'reset')) {
      return el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
    }
    if (tag === 'input') {
      return el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name || '';
    }
    if (tag === 'img') {
      return el.getAttribute('alt') || '';
    }
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;
    if (el.childNodes.length === 1 && el.childNodes[0].nodeType === Node.TEXT_NODE) {
      return (el.childNodes[0].textContent || '').trim().slice(0, 200);
    }
    return (el.textContent || '').trim().slice(0, 200);
  }

  const selector = __SELECTOR__;
  const root = selector ? document.querySelector(selector) : document.body;
  if (!root) return { ok: false, error: 'Root element not found for selector: ' + selector };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const elements = [];
  let node;
  while ((node = walker.nextNode())) {
    elements.push(node);
    if (elements.length > 5000) break;
  }

  for (const el of elements) {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(el.tagName)) continue;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

    const role = getRole(el);
    const text = getDisplayText(el);
    const isInteractive = el.matches(INTERACTIVE_SELECTOR);
    const isBlock = style.display !== 'inline';

    let line = (isBlock ? '' : '  ') + '-';
    if (role) line += ' [' + role + ']';
    if (el.id) line += ' #' + el.id;
    if (text) line += ' "' + text + '"';
    if (isInteractive) line += ' [ref=' + getRef(el) + ']';
    if (tag === 'a' && el.href) line += ' -> ' + el.href;
    if (tag === 'input') {
      if (el.name) line += ' name=' + el.name;
      if (el.value && el.type !== 'password') line += ' value=' + el.value.slice(0, 50);
      if (el.placeholder) line += ' placeholder=' + el.placeholder.slice(0, 50);
    }
    if (tag === 'select') {
      const selected = el.options[el.selectedIndex];
      if (selected) line += ' selected=' + (selected.text || '').slice(0, 50);
    }

    if (line !== ' -' && line !== '  -') {
      lines.push(line);
    }
  }

  const interactiveEls = Array.from(refMap.keys()).filter(function(el) {
    try { return el.matches(INTERACTIVE_SELECTOR); } catch(e) { return false; }
  });
    return {
      ok: true,
      snapshot: lines.join('\\n'),
      elementCount: lines.length,
      interactiveCount: interactiveEls.length,
    };
})()
`

async function captureBrowserSnapshot(
  registry: BrowserTabRegistry,
  options: CreateDesktopCapabilityBridgeServiceOptions,
  request: DesktopCapabilityBridgeRequest,
): Promise<Record<string, unknown>> {
  const selector = normalizeOptionalString(request.payload.selector)
  const tabId = normalizeOptionalString(request.payload.tabId) ?? registry.activeTabId
  const tab = tabId !== null && registry.tabs.has(tabId)
    ? { tabId, targetWindow: registry.tabs.get(tabId)! }
    : requireActiveBrowserTab(registry)

  if (!isUsableBrowserWindow(tab.targetWindow)) {
    throw new DesktopCapabilityBridgeError('not_found', `Tab '${tab.tabId}' has been destroyed.`, {
      details: { tabId: tab.tabId },
    })
  }

  const script = BROWSER_SNAPSHOT_SCRIPT.replace(
    '__SELECTOR__',
    JSON.stringify(selector),
  )

  let rawResult: unknown
  try {
    rawResult = await tab.targetWindow.webContents.executeJavaScript(script, true)
  } catch (error) {
    throw new DesktopCapabilityBridgeError('temporarily_unavailable', `Failed to capture browser snapshot: ${error instanceof Error ? error.message : String(error)}`, {
      retryable: true,
      details: {
        tabId: tab.tabId,
        selector,
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }

  const record = normalizeResultRecord(rawResult)
  if (record.ok !== true) {
    const message = typeof record.error === 'string' && record.error.trim() !== ''
      ? record.error
      : typeof record.message === 'string' && record.message.trim() !== ''
        ? record.message
        : 'Failed to capture browser snapshot.'
    throw new DesktopCapabilityBridgeError('invalid_request', message, {
      details: { selector, tabId: tab.tabId },
    })
  }

  await options.appendLog?.('info', '[capability-bridge] Browser snapshot captured.', {
    capability: request.capability,
    operation: request.operation,
    toolId: request.toolId,
    runId: request.runId,
    toolCallId: request.toolCallId,
    tabId: tab.tabId,
    selector,
    elementCount: record.elementCount,
    interactiveCount: record.interactiveCount,
  }, { relayToRenderer: false })

  return {
    snapshot: String(record.snapshot ?? ''),
    tabId: tab.tabId,
    elementCount: typeof record.elementCount === 'number' ? record.elementCount : 0,
    interactiveCount: typeof record.interactiveCount === 'number' ? record.interactiveCount : 0,
  }
}
