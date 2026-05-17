import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DesktopCapabilityBridgeRequest } from '../protocol'
import type { CreateDesktopCapabilityBridgeServiceOptions } from '../types'
import { createDesktopCapabilityBrowserService } from '../services/DesktopCapabilityBrowserService'

vi.mock('electron', () => {
  const mockWebContents = {
    getURL: vi.fn(() => 'https://example.com'),
    getTitle: vi.fn(() => 'Example Domain'),
    isDestroyed: vi.fn(() => false),
    executeJavaScript: vi.fn(async (script: string) => {
      if (script.includes('throw')) {
        throw new Error('Script execution failed')
      }
      if (script.includes('readText()') || script.includes('selectedNode ?? document.body')) {
        return {
          ok: true,
          content: '<html><body>Extracted Content</body></html>',
        }
      }
      if (script.includes('getRef') && script.includes('INTERACTIVE_SELECTOR')) {
        return {
          ok: true,
          snapshot: '- [heading] Page Title\n- [link] Click me [ref=@1]',
          elementCount: 10,
          interactiveCount: 3,
        }
      }
      return 'executed-result'
    }),
    capturePage: vi.fn(async () => ({
      toPNG: vi.fn(() => Buffer.from('fake-png-data')),
    })),
    loadURL: vi.fn(async () => undefined),
  }

  function MockBrowserWindow(this: Record<string, unknown>) {
    this.webContents = { ...mockWebContents }
    this._isDestroyed = false
    this._isVisible = false
  }

  MockBrowserWindow.prototype.isDestroyed = function (this: { _isDestroyed: boolean }) {
    return this._isDestroyed
  }
  MockBrowserWindow.prototype.isVisible = function (this: { _isVisible: boolean }) {
    return this._isVisible
  }
  MockBrowserWindow.prototype.show = function (this: { _isVisible: boolean }) {
    this._isVisible = true
  }
  MockBrowserWindow.prototype.hide = function (this: { _isVisible: boolean }) {
    this._isVisible = false
  }
  MockBrowserWindow.prototype.close = function (this: { _isDestroyed: boolean }) {
    this._isDestroyed = true
  }
  MockBrowserWindow.prototype.getTitle = function () {
    return 'Example Domain'
  }
  MockBrowserWindow.prototype.loadURL = function (this: Record<string, unknown>, _url: string) {
    const wc = this.webContents as Record<string, unknown>
    return (wc.loadURL as (url: string) => Promise<void>)(_url)
  }
  MockBrowserWindow.prototype.once = vi.fn()

  return { BrowserWindow: MockBrowserWindow as unknown as typeof import('electron').BrowserWindow }
})

function createStubOptions(): CreateDesktopCapabilityBridgeServiceOptions {
  return {
    prepareRuntimePaths: vi.fn(async () => ({
      userDataDir: '/tmp/candue-test',
      runtimeRootDir: '/tmp/candue-test',
      configDir: '/tmp/candue-test/config',
      logsDir: '/tmp/candue-test/logs',
      databaseDir: '/tmp/candue-test/database',
      stateDir: '/tmp/candue-test/state',
      copilotSettingsFile: '/tmp/candue-test/config/copilot-settings.json',
      legacyCopilotSettingsFile: '/tmp/candue-test/config/legacy.json',
      hostLogFile: '/tmp/candue-test/logs/host.log',
      backendStdoutLogFile: '/tmp/candue-test/logs/backend-stdout.log',
      backendStderrLogFile: '/tmp/candue-test/logs/backend-stderr.log',
      runtimeSnapshotFile: '/tmp/candue-test/state/runtime-snapshot.json',
      lastFailureFile: '/tmp/candue-test/state/last-failure.json',
    })),
    appendLog: vi.fn(),
  }
}

function createRequest(operation: string, payload: Record<string, unknown> = {}): DesktopCapabilityBridgeRequest {
  return {
    requestId: 'req-1',
    capability: 'browser' as const,
    operation: operation as DesktopCapabilityBridgeRequest['operation'],
    toolId: 'browser.test',
    runId: 'run-1',
    toolCallId: 'call-1',
    payload,
  }
}

describe('DesktopCapabilityBrowserService', () => {
  let service: ReturnType<typeof createDesktopCapabilityBrowserService>

  beforeEach(() => {
    vi.clearAllMocks()
    service = createDesktopCapabilityBrowserService(createStubOptions())
  })

  // -----------------------------------------------------------------------
  // browser.open
  // -----------------------------------------------------------------------
  describe('open', () => {
    it('opens a URL and returns page summary', async () => {
      const result = await service.handle(createRequest('open', { url: 'https://example.com' }))

      expect(result.tabId).toMatch(/^browser-tab-/)
      expect(result.currentUrl).toBe('https://example.com')
      expect(result.title).toBe('Example Domain')
      expect(result.windowVisible).toBe(false)
    })

    it('shows window when showWindow is true', async () => {
      const result = await service.handle(createRequest('open', { url: 'https://example.com', showWindow: true }))

      expect(result.windowVisible).toBe(true)
    })

    it('opens in new tab when newTab is true', async () => {
      const result1 = await service.handle(createRequest('open', { url: 'https://example.com', newTab: true }))
      const result2 = await service.handle(createRequest('open', { url: 'https://other.com', newTab: true }))

      expect(result1.tabId).not.toBe(result2.tabId)
    })

    it('extracts page content when format is provided', async () => {
      const result = await service.handle(createRequest('open', {
        url: 'https://example.com',
        format: 'text',
      }))

      expect(result.tabId).toMatch(/^browser-tab-/)
      expect(typeof result.content).toBe('string')
    })

    it('passes selector and format through to content extraction', async () => {
      const result = await service.handle(createRequest('open', {
        url: 'https://example.com',
        selector: '.main',
        format: 'html',
      }))

      expect(result.tabId).toMatch(/^browser-tab-/)
      expect(typeof result.content).toBe('string')
      expect(result.content).toBeTruthy()
    })

    it('rejects empty url', async () => {
      await expect(
        service.handle(createRequest('open', { url: '' }))
      ).rejects.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // browser.screenshot
  // -----------------------------------------------------------------------
  describe('screenshot', () => {
    it('captures a screenshot of the active tab', async () => {
      // First open a page to have an active tab
      await service.handle(createRequest('open', { url: 'https://example.com' }))

      const result = await service.handle(createRequest('screenshot', { name: 'test-capture' }))

      expect(result.tabId).toMatch(/^browser-tab-/)
      expect(result.currentUrl).toBe('https://example.com')
      expect(result.artifactId).toBeTruthy()
    })

    it('fails when no tab is open', async () => {
      await expect(
        service.handle(createRequest('screenshot', {}))
      ).rejects.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // browser.list_tabs
  // -----------------------------------------------------------------------
  describe('list_tabs', () => {
    it('lists all open tabs', async () => {
      await service.handle(createRequest('open', { url: 'https://example.com', newTab: true }))
      await service.handle(createRequest('open', { url: 'https://other.com', newTab: true }))

      const result = await service.handle(createRequest('list_tabs', {}))

      expect(result.tabs).toBeInstanceOf(Array)
      const tabs = result.tabs as Record<string, unknown>[]
      expect(tabs.length).toBe(2)
      expect(tabs[0].tabId).toMatch(/^browser-tab-/)
      expect(tabs[1].tabId).toMatch(/^browser-tab-/)
    })

    it('returns empty list when no tabs are open', async () => {
      const result = await service.handle(createRequest('list_tabs', {}))

      const tabs = result.tabs as unknown[]
      expect(tabs).toHaveLength(0)
    })
  })

  // -----------------------------------------------------------------------
  // browser.close_tab
  // -----------------------------------------------------------------------
  describe('close_tab', () => {
    it('closes a tab by its ID', async () => {
      const openResult = await service.handle(createRequest('open', {
        url: 'https://example.com',
        newTab: true,
      }))
      const tabId = openResult.tabId as string

      const result = await service.handle(createRequest('close_tab', { tabId }))

      expect(result.tabId).toBe(tabId)
    })

    it('closes active tab when no tabId provided', async () => {
      const openResult = await service.handle(createRequest('open', { url: 'https://example.com' }))

      const result = await service.handle(createRequest('close_tab', {}))

      expect(result.tabId).toBe(openResult.tabId)
    })

    it('throws error for non-existent tab', async () => {
      await expect(
        service.handle(createRequest('close_tab', { tabId: 'nonexistent' }))
      ).rejects.toThrow()
    })

    it('removes tab from registry after close', async () => {
      const tab = await service.handle(createRequest('open', { url: 'https://example.com', newTab: true }))
      await service.handle(createRequest('close_tab', { tabId: tab.tabId }))

      const tabsAfter = await service.handle(createRequest('list_tabs', {}))
      const tabIds = (tabsAfter.tabs as Record<string, unknown>[]).map((t: Record<string, unknown>) => t.tabId)
      expect(tabIds).not.toContain(tab.tabId)
    })

    it('falls back to another available tab when closing the active tab', async () => {
      const tab1 = await service.handle(createRequest('open', { url: 'https://example.com', newTab: true }))
      const tab2 = await service.handle(createRequest('open', { url: 'https://other.com', newTab: true }))

      await service.handle(createRequest('close_tab', { tabId: tab1.tabId }))

      const result = await service.handle(createRequest('screenshot', { name: 'after-close' }))
      expect(result.tabId).toBe(tab2.tabId)
      expect(result.tabId).not.toBe(tab1.tabId)
    })

    it('clears activeTabId when closing the only tab', async () => {
      await service.handle(createRequest('open', { url: 'https://example.com' }))
      await service.handle(createRequest('close_tab', {}))

      await expect(
        service.handle(createRequest('screenshot', {}))
      ).rejects.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // browser.switch_tab
  // -----------------------------------------------------------------------
  describe('switch_tab', () => {
    it('switches to a specific tab', async () => {
      const tab1 = await service.handle(createRequest('open', { url: 'https://example.com', newTab: true }))
      await service.handle(createRequest('open', { url: 'https://other.com', newTab: true }))

      const result = await service.handle(createRequest('switch_tab', { tabId: tab1.tabId }))

      expect(result.tabId).toBe(tab1.tabId)
    })

    it('throws error for invalid tabId', async () => {
      await expect(
        service.handle(createRequest('switch_tab', { tabId: 'invalid' }))
      ).rejects.toThrow()
    })

    it('throws error for empty tabId', async () => {
      await expect(
        service.handle(createRequest('switch_tab', { tabId: '' }))
      ).rejects.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // browser.execute
  // -----------------------------------------------------------------------
  describe('execute', () => {
    it('executes JavaScript and returns result', async () => {
      await service.handle(createRequest('open', { url: 'https://example.com' }))

      const result = await service.handle(createRequest('execute', { script: 'document.title' }))

      expect(result.result).toBe('executed-result')
      expect(result.tabId).toMatch(/^browser-tab-/)
    })

    it('executes script in specific tab', async () => {
      const tab = await service.handle(createRequest('open', { url: 'https://example.com', newTab: true }))

      const result = await service.handle(createRequest('execute', {
        script: 'document.querySelector("button")',
        tabId: tab.tabId,
      }))

      expect(result.result).toBe('executed-result')
    })

    it('throws error when script fails', async () => {
      await service.handle(createRequest('open', { url: 'https://example.com' }))

      await expect(
        service.handle(createRequest('execute', { script: 'throw new Error("fail")' }))
      ).rejects.toThrow()
    })

    it('throws error for empty script', async () => {
      await service.handle(createRequest('open', { url: 'https://example.com' }))

      await expect(
        service.handle(createRequest('execute', { script: '' }))
      ).rejects.toThrow()
    })

    it('throws error when no tab is open', async () => {
      await expect(
        service.handle(createRequest('execute', { script: 'document.title' }))
      ).rejects.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // browser.reset
  // -----------------------------------------------------------------------
  describe('reset', () => {
    it('closes all open tabs and resets state', async () => {
      await service.handle(createRequest('open', { url: 'https://example.com', newTab: true }))
      await service.handle(createRequest('open', { url: 'https://other.com', newTab: true }))

      const tabsBefore = await service.handle(createRequest('list_tabs', {}))
      expect((tabsBefore.tabs as unknown[]).length).toBe(2)

      const result = await service.handle(createRequest('reset', {}))
      expect(result.closedCount).toBe(2)

      const tabsAfter = await service.handle(createRequest('list_tabs', {}))
      expect((tabsAfter.tabs as unknown[]).length).toBe(0)
    })

    it('returns zero when no tabs are open', async () => {
      const result = await service.handle(createRequest('reset', {}))
      expect(result.closedCount).toBe(0)
    })
  })

  // -----------------------------------------------------------------------
  // browser.snapshot
  // -----------------------------------------------------------------------
  describe('snapshot', () => {
    it('returns accessibility snapshot of current page', async () => {
      await service.handle(createRequest('open', { url: 'https://example.com' }))

      const result = await service.handle(createRequest('snapshot', {}))

      expect(result.snapshot).toContain('[ref=@1]')
      expect(result.snapshot).toContain('Page Title')
      expect(result.tabId).toMatch(/^browser-tab-/)
      expect(result.elementCount).toBe(10)
      expect(result.interactiveCount).toBe(3)
    })

    it('snapshots a specific tab', async () => {
      const tab = await service.handle(createRequest('open', { url: 'https://example.com', newTab: true }))

      const result = await service.handle(createRequest('snapshot', { tabId: tab.tabId }))

      expect(result.tabId).toBe(tab.tabId)
    })

    it('throws error when no tab is open', async () => {
      await expect(
        service.handle(createRequest('snapshot', {}))
      ).rejects.toThrow()
    })
  })

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------
  describe('error handling', () => {
    it('throws for unsupported operation', async () => {
      await expect(
        service.handle(createRequest('unknown_op' as string))
      ).rejects.toThrow()
    })
  })
})
