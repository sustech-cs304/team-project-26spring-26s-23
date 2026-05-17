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

interface BrowserSnapshotRequestPayload {
  tabId: string | null
  selector: string | null
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

async function captureBrowserSnapshot(
  registry: BrowserTabRegistry,
  options: CreateDesktopCapabilityBridgeServiceOptions,
  request: DesktopCapabilityBridgeRequest,
): Promise<Record<string, unknown>> {
  const payload = normalizeSnapshotRequestPayload(request.payload)
  const tab = requireBrowserTab(registry, payload.tabId)
  const summary = describeBrowserWindow(tab.tabId, tab.targetWindow)
  const content = await extractPageSnapshot(tab.targetWindow, {
    selector: payload.selector,
  })

  await options.appendLog?.('info', '[capability-bridge] Browser snapshot captured.', {
    capability: request.capability,
    operation: request.operation,
    toolId: request.toolId,
    runId: request.runId,
    toolCallId: request.toolCallId,
    requestedTabId: payload.tabId,
    tabId: tab.tabId,
    currentUrl: summary.currentUrl,
    title: summary.title,
    selector: payload.selector,
    contentLength: content.length,
  }, {
    relayToRenderer: false,
  })

  return {
    ...summary,
    content,
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

function requireBrowserTab(registry: BrowserTabRegistry, tabId: string | null): BrowserTabRecord {
  if (tabId === null) {
    return requireActiveBrowserTab(registry)
  }

  const tab = findBrowserTabById(registry, tabId)
  if (tab === null) {
    throw new DesktopCapabilityBridgeError('not_found', `Browser tab '${tabId}' is not available.`, {
      details: {
        tabId,
      },
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

function findBrowserTabById(registry: BrowserTabRegistry, tabId: string): BrowserTabRecord | null {
  const targetWindow = registry.tabs.get(tabId)
  if (!isUsableBrowserWindow(targetWindow)) {
    registry.tabs.delete(tabId)
    if (registry.activeTabId === tabId) {
      registry.activeTabId = null
    }
    return null
  }

  return {
    tabId,
    targetWindow,
  }
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

  if (input.format === 'markdown') {
    return convertHtmlToMarkdown(record.content)
  }

  return record.content
}

async function extractPageSnapshot(
  targetWindow: BrowserWindow,
  input: {
    selector: string | null
  },
): Promise<string> {
  let result: unknown
  try {
    result = await targetWindow.webContents.executeJavaScript(
      `(() => {
        const selector = ${JSON.stringify(input.selector)}
        const selectedNode = selector ? document.querySelector(selector) : null
        if (selector && selectedNode === null) {
          return {
            ok: false,
            errorCode: 'not_found',
            message: 'No page element matched selector ' + selector + '.',
          }
        }

        const root = selectedNode ?? document.body ?? document.documentElement
        const normalizeText = (value) => value.replace(/\s+/g, ' ').trim()
        const visibleText = (element) => normalizeText(element instanceof HTMLElement
          ? (element.innerText || element.textContent || '')
          : (element.textContent || ''))
        const isVisible = (element) => {
          if (!(element instanceof Element)) {
            return false
          }
          const style = window.getComputedStyle(element)
          if (style.display === 'none' || style.visibility === 'hidden') {
            return false
          }
          const rect = element.getBoundingClientRect()
          return rect.width > 0 || rect.height > 0 || visibleText(element) !== ''
        }
        const inferKind = (element) => {
          const tagName = element.tagName.toLowerCase()
          if (tagName === 'a') return 'link'
          if (tagName === 'button') return 'button'
          if (tagName === 'select') return 'select'
          if (tagName === 'textarea') return 'text area'
          if (tagName === 'summary') return 'summary'
          if (tagName === 'input') {
            const type = normalizeText(element.getAttribute('type') || 'text').toLowerCase()
            return type === 'text' ? 'text input' : type + ' input'
          }
          const role = normalizeText(element.getAttribute('role') || '').toLowerCase()
          return role || 'interactive element'
        }
        const readLabel = (element) => {
          const candidates = [
            element.getAttribute('aria-label'),
            element.getAttribute('title'),
            element.getAttribute('placeholder'),
            element.getAttribute('name'),
            element.getAttribute('alt'),
            'value' in element ? element.value : null,
            visibleText(element),
          ]
          for (const candidate of candidates) {
            const normalized = typeof candidate === 'string' ? normalizeText(candidate) : ''
            if (normalized !== '') {
              return normalized
            }
          }
          return ''
        }
        const isInteractive = (element) => {
          if (!(element instanceof Element) || !isVisible(element)) {
            return false
          }
          const tagName = element.tagName.toLowerCase()
          if (tagName === 'a' || tagName === 'button' || tagName === 'select' || tagName === 'textarea' || tagName === 'summary') {
            return true
          }
          if (tagName === 'input') {
            return normalizeText(element.getAttribute('type') || '').toLowerCase() !== 'hidden'
          }
          const role = normalizeText(element.getAttribute('role') || '').toLowerCase()
          if (['button', 'link', 'checkbox', 'radio', 'switch', 'tab', 'option', 'menuitem', 'textbox', 'combobox'].includes(role)) {
            return true
          }
          return element.hasAttribute('contenteditable') || (element.hasAttribute('tabindex') && element.getAttribute('tabindex') !== '-1')
        }

        const rootElements = root instanceof Element ? [root, ...Array.from(root.querySelectorAll('*'))] : []
        const interactiveDescriptions = []
        for (const element of rootElements) {
          if (!isInteractive(element)) {
            continue
          }
          const kind = inferKind(element)
          const label = readLabel(element)
          const details = []
          const href = normalizeText(element.getAttribute('href') || '')
          if (href !== '') {
            details.push('href=' + href)
          }
          if ('checked' in element && element.checked === true) {
            details.push('checked')
          }
          if ('disabled' in element && element.disabled === true) {
            details.push('disabled')
          }
          const description = label === '' ? kind : kind + ' "' + label + '"'
          interactiveDescriptions.push(details.length === 0 ? description : description + ' (' + details.join(', ') + ')')
        }

        const textContent = visibleText(root)
        const sections = []
        if (textContent !== '') {
          sections.push('Text:\n' + textContent)
        }
        if (interactiveDescriptions.length > 0) {
          sections.push('Interactive elements:\n' + interactiveDescriptions.map((description, index) => '[' + String(index + 1) + '] ' + description).join('\n'))
        }
        const content = sections.join('\n\n').trim()
        if (content === '') {
          return {
            ok: false,
            errorCode: 'not_found',
            message: 'No readable page content was available.',
          }
        }

        return {
          ok: true,
          content,
        }
      })()`,
      true,
    )
  } catch (error) {
    throw new DesktopCapabilityBridgeError('temporarily_unavailable', 'Failed to extract browser page snapshot.', {
      retryable: true,
      details: {
        selector: input.selector,
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }

  const record = normalizeResultRecord(result)
  if (record.ok !== true) {
    const message = typeof record.message === 'string' && record.message.trim() !== ''
      ? record.message
      : 'Failed to extract browser page snapshot.'
    const errorCode = record.errorCode === 'not_found' ? 'not_found' : 'invalid_request'
    throw new DesktopCapabilityBridgeError(errorCode, message, {
      details: {
        selector: input.selector,
      },
    })
  }

  if (typeof record.content !== 'string' || record.content.trim() === '') {
    throw new DesktopCapabilityBridgeError('temporarily_unavailable', 'Browser page snapshot extraction returned an invalid result.', {
      retryable: true,
      details: {
        selector: input.selector,
      },
    })
  }

  return record.content.trim()
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

function normalizeSnapshotRequestPayload(payload: Record<string, unknown>): BrowserSnapshotRequestPayload {
  return {
    tabId: normalizeOptionalString(payload.tabId),
    selector: normalizeOptionalString(payload.selector),
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
