/** @vitest-environment jsdom */

import React, { useEffect, type ReactElement } from 'react'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type {
  McpDeleteServerResult,
  McpRegistryLoadResult,
  McpRefreshCatalogResult,
  McpSaveServerResult,
  McpSetServerEnabledResult,
  McpTestConnectionResult,
} from '../../../electron/mcp-registry/ipc'
import type {
  McpRegistrySubscriptionEvent,
  McpServerRecord,
  McpServerStateSummary,
} from '../../../electron/mcp-registry/types'
import type { McpRegistryClient } from './mcp-registry-client'
import { renderWithRoot, flushAsyncEffects, clickElement } from '../settings/test-support/SettingsWorkspaceTestSupport'
import { useMcpRegistry, type UseMcpRegistryResult } from './use-mcp-registry'

const SERVER_1: McpServerRecord = {
  serverId: 'server-1',
  displayName: 'Alpha Server',
  enabled: true,
  transportKind: 'stdio',
  description: 'First test server',
  transportConfig: { kind: 'stdio', command: 'node', args: ['alpha.js'], cwd: null },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
}

const SERVER_2: McpServerRecord = {
  serverId: 'server-2',
  displayName: 'Beta Server',
  enabled: false,
  transportKind: 'http-sse',
  description: 'Second test server',
  transportConfig: { kind: 'http-sse', baseUrl: 'http://localhost:8080', ssePathOverride: null },
  createdAt: '2026-01-15T00:00:00.000Z',
  updatedAt: '2026-02-15T00:00:00.000Z',
}

const STATE_1: McpServerStateSummary = {
  serverId: 'server-1',
  enabled: true,
  connectionState: 'connected',
  toolCount: 3,
  lastHandshakeAt: '2026-03-01T00:00:00.000Z',
  lastCatalogSyncAt: '2026-03-01T01:00:00.000Z',
  lastError: null,
  transportState: { kind: 'stdio', processStatus: 'running', pid: 1234, lastExitCode: null, lastExitSignal: null },
  reconnectAttempt: 0,
}

const STATE_2: McpServerStateSummary = {
  serverId: 'server-2',
  enabled: false,
  connectionState: 'disabled',
  toolCount: 0,
  lastHandshakeAt: null,
  lastCatalogSyncAt: null,
  lastError: null,
  transportState: null,
  reconnectAttempt: 0,
}

function buildLoadSuccess(overrides: Partial<McpRegistryLoadResult> = {}): McpRegistryLoadResult {
  return {
    ok: true,
    registryRevision: 1,
    snapshotRevision: 1,
    servers: [SERVER_1, SERVER_2],
    states: [STATE_1, STATE_2],
    ...overrides,
  } as McpRegistryLoadResult
}

function buildLoadError(error: string): McpRegistryLoadResult {
  return { ok: false, error, code: 'load_failed' }
}

interface MockClientResult {
  client: McpRegistryClient
  fireEvent: (event: McpRegistrySubscriptionEvent) => void
}

function createMockClient(): MockClientResult {
  let subListener: ((event: McpRegistrySubscriptionEvent) => void) | null = null

  return {
    client: {
      loadRegistry: vi.fn<() => Promise<McpRegistryLoadResult>>().mockResolvedValue(buildLoadSuccess()),
      saveServer: vi.fn<() => Promise<McpSaveServerResult>>().mockResolvedValue({
        ok: true,
        registryRevision: 2,
        snapshotRevision: 2,
        server: SERVER_1,
        state: STATE_1,
        validationErrors: [],
      }),
      deleteServer: vi.fn<() => Promise<McpDeleteServerResult>>().mockResolvedValue({
        ok: true,
        serverId: 'server-1',
        deleted: true,
        registryRevision: 2,
        snapshotRevision: 2,
      }),
      setServerEnabled: vi.fn<() => Promise<McpSetServerEnabledResult>>().mockResolvedValue({
        ok: true,
        registryRevision: 2,
        snapshotRevision: 2,
        server: { ...SERVER_1, enabled: false },
        state: STATE_1,
      }),
      testConnection: vi.fn<() => Promise<McpTestConnectionResult>>().mockResolvedValue({
        ok: true,
        success: true,
        transportKind: 'stdio',
        toolCount: 5,
        durationMs: 42,
        phase: null,
        diagnosticSummary: null,
        error: null,
        warnings: [],
      }),
      refreshCatalog: vi.fn<() => Promise<McpRefreshCatalogResult>>().mockResolvedValue({
        ok: true,
        registryRevision: 2,
        snapshotRevision: 2,
        refreshedServerIds: ['server-1'],
        results: [{ serverId: 'server-1', toolCount: 7, connectionState: 'connected', error: null }],
      }),
      subscribe: vi.fn((listener: (event: McpRegistrySubscriptionEvent) => void) => {
        subListener = listener
        return () => { subListener = null }
      }),
    },
    fireEvent(event: McpRegistrySubscriptionEvent) {
      subListener?.(event)
    },
  }
}

interface ProbeProps {
  client: McpRegistryClient
  stateRef: React.MutableRefObject<UseMcpRegistryResult | null>
  saveResultRef: React.MutableRefObject<string>
  toggleTarget?: string
  deleteTarget?: string
  testTarget?: string
  refreshTarget?: string
}

function McpRegistryProbe({
  client,
  stateRef,
  saveResultRef,
  toggleTarget,
  deleteTarget,
  testTarget,
  refreshTarget,
}: ProbeProps): ReactElement {
  const state = useMcpRegistry(client)

  useEffect(() => {
    stateRef.current = state
  })

  return React.createElement('div', null,
    React.createElement('span', { 'data-testid': 'load-status' }, state.loadStatus),
    React.createElement('span', { 'data-testid': 'status-message' }, state.statusMessage ?? ''),
    React.createElement('span', { 'data-testid': 'snapshot-revision' }, String(state.snapshotRevision)),
    React.createElement('span', { 'data-testid': 'server-count' }, String(state.servers.length)),
    React.createElement('span', { 'data-testid': 'raw-server-count' }, String(state.rawServers.length)),
    ...state.servers.map((server) =>
      React.createElement('div', { key: server.serverId, 'data-testid': `vm-${server.serverId}` },
        React.createElement('span', { 'data-testid': `vm-${server.serverId}-message` }, server.message ?? ''),
        React.createElement('span', { 'data-testid': `vm-${server.serverId}-busy` }, String(server.busy)),
        React.createElement('span', { 'data-testid': `vm-${server.serverId}-enabled` }, String(server.enabled)),
        React.createElement('span', { 'data-testid': `vm-${server.serverId}-busy-op` }, server.busyOperation ?? ''),
      ),
    ),
    toggleTarget !== undefined
      ? React.createElement('button', {
        'data-testid': 'btn-toggle',
        onClick: () => { void state.toggleServerEnabled(toggleTarget) },
      }, 'toggle')
      : null,
    deleteTarget !== undefined
      ? React.createElement('button', {
        'data-testid': 'btn-delete',
        onClick: () => { void state.deleteServer(deleteTarget) },
      }, 'delete')
      : null,
    testTarget !== undefined
      ? React.createElement('button', {
        'data-testid': 'btn-test',
        onClick: () => { void state.testServerConnection(testTarget) },
      }, 'test')
      : null,
    refreshTarget !== undefined
      ? React.createElement('button', {
        'data-testid': 'btn-refresh',
        onClick: () => { void state.refreshServerCatalog(refreshTarget) },
      }, 'refresh')
      : null,
    React.createElement('button', {
      'data-testid': 'btn-save-add',
      onClick: async () => {
        const result = await state.saveEditorDraft('add', JSON.stringify({
          serverId: 'new-server',
          displayName: 'New Server',
          enabled: true,
          transportKind: 'stdio',
          transportConfig: { kind: 'stdio', command: 'uvx', args: ['test'] },
        }))
        saveResultRef.current = JSON.stringify(result.ok ? { ok: true } : { ok: false, errorMessage: result.errorMessage, validationErrors: result.validationErrors })
      },
    }, 'save-add'),
    React.createElement('button', {
      'data-testid': 'btn-save-edit',
      onClick: async () => {
        const result = await state.saveEditorDraft('edit', JSON.stringify({
          mcpServers: {
            'server-1': {
              serverId: 'server-1',
              displayName: 'Alpha Updated',
              enabled: true,
              transportKind: 'stdio',
              transportConfig: { kind: 'stdio', command: 'node', args: ['alpha-v2.js'] },
            },
          },
        }))
        saveResultRef.current = JSON.stringify(result.ok ? { ok: true } : { ok: false, errorMessage: result.errorMessage, validationErrors: result.validationErrors })
      },
    }, 'save-edit'),
    React.createElement('button', {
      'data-testid': 'btn-save-bad-json',
      onClick: async () => {
        const result = await state.saveEditorDraft('add', 'not valid json')
        saveResultRef.current = JSON.stringify(result.ok ? { ok: true } : { ok: false, errorMessage: result.errorMessage, validationErrors: result.validationErrors })
      },
    }, 'save-bad-json'),
    React.createElement('span', { 'data-testid': 'save-result' }, saveResultRef.current),
    React.createElement('button', {
      'data-testid': 'btn-save-multi-edit',
      onClick: async () => {
        const result = await state.saveEditorDraft('edit', JSON.stringify({
          mcpServers: {
            'server-1': {
              serverId: 'server-1',
              displayName: 'Alpha Updated',
              enabled: true,
              transportKind: 'stdio',
              transportConfig: { kind: 'stdio', command: 'node', args: ['alpha-v2.js'] },
            },
            'server-3': {
              serverId: 'server-3',
              displayName: 'Gamma Server',
              enabled: true,
              transportKind: 'http-sse',
              transportConfig: { kind: 'http-sse', baseUrl: 'https://example.com/mcp' },
            },
          },
        }))
        saveResultRef.current = JSON.stringify(result.ok ? { ok: true } : { ok: false, errorMessage: result.errorMessage, validationErrors: result.validationErrors })
      },
    }, 'save-multi-edit'),
  )
}

async function renderProbe(opts: {
  client?: McpRegistryClient
  fireEvent?: (event: McpRegistrySubscriptionEvent) => void
  toggleTarget?: string
  deleteTarget?: string
  testTarget?: string
  refreshTarget?: string
} = {}) {
  const mock = opts.client ? { client: opts.client, fireEvent: opts.fireEvent ?? (() => {}) } : createMockClient()
  const stateRef: React.MutableRefObject<UseMcpRegistryResult | null> = { current: null }
  const saveResultRef: React.MutableRefObject<string> = { current: '{}' }

  const rendered = renderWithRoot(
    React.createElement(McpRegistryProbe, {
      client: mock.client,
      stateRef,
      saveResultRef,
      toggleTarget: opts.toggleTarget,
      deleteTarget: opts.deleteTarget,
      testTarget: opts.testTarget,
      refreshTarget: opts.refreshTarget,
    }),
  )

  await flushAsyncEffects()
  await act(async () => {
    await new Promise<void>((resolve) => { setTimeout(resolve, 0) })
  })
  await flushAsyncEffects()

  return { rendered, mock, stateRef, saveResultRef }
}

describe('useMcpRegistry', () => {
  describe('initial load', () => {
    it('transitions from loading to ready when the registry loads successfully', async () => {
      const { rendered, stateRef } = await renderProbe()

      expect(rendered.getByTestId('load-status').textContent).toBe('ready')
      expect(rendered.getByTestId('server-count').textContent).toBe('2')
      expect(rendered.getByTestId('snapshot-revision').textContent).toBe('1')
      expect(stateRef.current?.loadStatus).toBe('ready')
      expect(stateRef.current?.rawServers).toHaveLength(2)

      rendered.unmount()
    })

    it('sets status message during loading', async () => {
      let resolveLoad: (value: McpRegistryLoadResult) => void = () => {}
      const client: McpRegistryClient = {
        ...createMockClient().client,
        loadRegistry: vi.fn(() => new Promise<McpRegistryLoadResult>((resolve) => { resolveLoad = resolve })),
      }

      const stateRef: React.MutableRefObject<UseMcpRegistryResult | null> = { current: null }
      const saveResultRef: React.MutableRefObject<string> = { current: '{}' }
      const rendered = renderWithRoot(
        React.createElement(McpRegistryProbe, { client, stateRef, saveResultRef }),
      )
      await flushAsyncEffects()

      expect(rendered.getByTestId('load-status').textContent).toBe('loading')
      expect(rendered.getByTestId('status-message').textContent).toBe('正在加载服务器列表…')

      await act(async () => {
        resolveLoad(buildLoadSuccess())
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(rendered.getByTestId('load-status').textContent).toBe('ready')

      rendered.unmount()
    })

    it('transitions from loading to error when the registry load fails', async () => {
      const mock = createMockClient()
      mock.client.loadRegistry = vi.fn<() => Promise<McpRegistryLoadResult>>().mockResolvedValue(buildLoadError('Network failure'))

      const { rendered, stateRef } = await renderProbe({ client: mock.client, fireEvent: mock.fireEvent })

      expect(rendered.getByTestId('load-status').textContent).toBe('error')
      expect(rendered.getByTestId('status-message').textContent).toBe('Network failure')
      expect(stateRef.current?.loadStatus).toBe('error')

      rendered.unmount()
    })
  })

  describe('toggleServerEnabled', () => {
    it('toggles server enabled state and calls IPC', async () => {
      const mock = createMockClient()

      const { rendered } = await renderProbe({
        client: mock.client,
        fireEvent: mock.fireEvent,
        toggleTarget: 'server-1',
      })

      await act(async () => {
        await clickElement(rendered.getByTestId('btn-toggle'))
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(mock.client.setServerEnabled).toHaveBeenCalledWith({ serverId: 'server-1', enabled: false })
      expect(rendered.getByTestId('vm-server-1-message').textContent).toContain('配置已保存')

      rendered.unmount()
    })

    it('does nothing when server is not found', async () => {
      const mock = createMockClient()

      const { rendered } = await renderProbe({
        client: mock.client,
        fireEvent: mock.fireEvent,
        toggleTarget: 'nonexistent',
      })

      await act(async () => {
        await clickElement(rendered.getByTestId('btn-toggle'))
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(mock.client.setServerEnabled).not.toHaveBeenCalled()

      rendered.unmount()
    })

    it('sets an error message when toggle fails', async () => {
      const mock = createMockClient()
      mock.client.setServerEnabled = vi.fn<() => Promise<McpSetServerEnabledResult>>().mockResolvedValue({
        ok: false,
        error: 'Toggle failed',
        code: 'toggle_error',
      })

      const { rendered } = await renderProbe({
        client: mock.client,
        fireEvent: mock.fireEvent,
        toggleTarget: 'server-1',
      })

      await act(async () => {
        await clickElement(rendered.getByTestId('btn-toggle'))
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(rendered.getByTestId('vm-server-1-message').textContent).toBe('Toggle failed')

      rendered.unmount()
    })
  })

  describe('deleteServer', () => {
    it('deletes a server from state and calls IPC', async () => {
      const mock = createMockClient()

      const { rendered } = await renderProbe({
        client: mock.client,
        fireEvent: mock.fireEvent,
        deleteTarget: 'server-1',
      })

      await act(async () => {
        await clickElement(rendered.getByTestId('btn-delete'))
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(mock.client.deleteServer).toHaveBeenCalledWith('server-1')
      expect(rendered.getByTestId('server-count').textContent).toBe('1')
      expect(rendered.getByTestId('snapshot-revision').textContent).toBe('2')

      rendered.unmount()
    })

    it('sets an error message when the delete fails', async () => {
      const mock = createMockClient()
      mock.client.deleteServer = vi.fn<() => Promise<McpDeleteServerResult>>().mockResolvedValue({
        ok: false,
        error: 'Delete denied',
        code: 'delete_error',
      })

      const { rendered } = await renderProbe({
        client: mock.client,
        fireEvent: mock.fireEvent,
        deleteTarget: 'server-2',
      })

      await act(async () => {
        await clickElement(rendered.getByTestId('btn-delete'))
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(rendered.getByTestId('vm-server-2-message').textContent).toBe('Delete denied')

      rendered.unmount()
    })
  })

  describe('testServerConnection', () => {
    it('updates the status message after testing a connection successfully', async () => {
      const mock = createMockClient()

      const { rendered } = await renderProbe({
        client: mock.client,
        fireEvent: mock.fireEvent,
        testTarget: 'server-1',
      })

      await act(async () => {
        await clickElement(rendered.getByTestId('btn-test'))
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(mock.client.testConnection).toHaveBeenCalledWith({ serverId: 'server-1' })
      expect(rendered.getByTestId('vm-server-1-message').textContent).toContain('测试连接成功')

      rendered.unmount()
    })

    it('sets an error message when the connection test fails', async () => {
      const mock = createMockClient()
      mock.client.testConnection = vi.fn<() => Promise<McpTestConnectionResult>>().mockResolvedValue({
        ok: false,
        error: 'Connection refused',
        code: 'conn_refused',
      })

      const { rendered } = await renderProbe({
        client: mock.client,
        fireEvent: mock.fireEvent,
        testTarget: 'server-1',
      })

      await act(async () => {
        await clickElement(rendered.getByTestId('btn-test'))
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(rendered.getByTestId('vm-server-1-message').textContent).toContain('Connection refused')

      rendered.unmount()
    })
  })

  describe('refreshServerCatalog', () => {
    it('refreshes the catalog for a single server', async () => {
      const mock = createMockClient()

      const { rendered } = await renderProbe({
        client: mock.client,
        fireEvent: mock.fireEvent,
        refreshTarget: 'server-1',
      })

      await act(async () => {
        await clickElement(rendered.getByTestId('btn-refresh'))
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(mock.client.refreshCatalog).toHaveBeenCalledWith({ serverId: 'server-1' })
      expect(rendered.getByTestId('vm-server-1-message').textContent).toContain('工具列表已刷新')

      rendered.unmount()
    })

    it('sets an error message when the catalog refresh fails', async () => {
      const mock = createMockClient()
      mock.client.refreshCatalog = vi.fn<() => Promise<McpRefreshCatalogResult>>().mockResolvedValue({
        ok: false,
        error: 'Catalog refresh failed',
        code: 'refresh_error',
      })

      const { rendered } = await renderProbe({
        client: mock.client,
        fireEvent: mock.fireEvent,
        refreshTarget: 'server-1',
      })

      await act(async () => {
        await clickElement(rendered.getByTestId('btn-refresh'))
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(rendered.getByTestId('vm-server-1-message').textContent).toContain('Catalog refresh failed')

      rendered.unmount()
    })
  })

  describe('saveEditorDraft', () => {
    it('saves a single draft successfully', async () => {
      const mock = createMockClient()
      mock.client.saveServer = vi.fn<() => Promise<McpSaveServerResult>>().mockResolvedValue({
        ok: true,
        registryRevision: 3,
        snapshotRevision: 3,
        server: {
          serverId: 'new-server',
          displayName: 'New Server',
          enabled: true,
          transportKind: 'stdio',
          transportConfig: { kind: 'stdio', command: 'uvx', args: ['test'] },
          createdAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-01T00:00:00.000Z',
        },
        state: null,
        validationErrors: [],
      })

      const { rendered, saveResultRef } = await renderProbe({
        client: mock.client,
        fireEvent: mock.fireEvent,
      })

      await act(async () => {
        await clickElement(rendered.getByTestId('btn-save-add'))
        await Promise.resolve()
        await Promise.resolve()
      })

      const parsed = JSON.parse(saveResultRef.current) as { ok: boolean }
      expect(parsed.ok).toBe(true)

      rendered.unmount()
    })

    it('returns validation errors when the draft JSON is invalid', async () => {
      const mock = createMockClient()

      const { rendered, saveResultRef } = await renderProbe({
        client: mock.client,
        fireEvent: mock.fireEvent,
      })

      await act(async () => {
        await clickElement(rendered.getByTestId('btn-save-bad-json'))
        await Promise.resolve()
        await Promise.resolve()
      })

      const parsed = JSON.parse(saveResultRef.current) as { ok: boolean; errorMessage: string }
      expect(parsed.ok).toBe(false)
      expect(parsed.errorMessage).toBeTruthy()

      rendered.unmount()
    })

    it('saves multiple drafts in edit mode and removes unmatched servers', async () => {
      const mock = createMockClient()
      mock.client.saveServer = vi.fn<() => Promise<McpSaveServerResult>>().mockResolvedValue({
        ok: true,
        registryRevision: 4,
        snapshotRevision: 4,
        server: { ...SERVER_1, displayName: 'Alpha Updated' },
        state: STATE_1,
        validationErrors: [],
      })

      const { rendered, saveResultRef } = await renderProbe({
        client: mock.client,
        fireEvent: mock.fireEvent,
      })

      await act(async () => {
        await clickElement(rendered.getByTestId('btn-save-multi-edit'))
        await Promise.resolve()
        await Promise.resolve()
      })

      const parsed = JSON.parse(saveResultRef.current) as { ok: boolean }
      expect(parsed.ok).toBe(true)
      expect(mock.client.saveServer).toHaveBeenCalledTimes(2)
      expect(mock.client.deleteServer).toHaveBeenCalledWith('server-2')

      rendered.unmount()
    })

    it('returns an error when the IPC save fails in edit mode', async () => {
      const mock = createMockClient()
      mock.client.saveServer = vi.fn<() => Promise<McpSaveServerResult>>().mockResolvedValue({
        ok: false,
        error: 'Save failed in IPC',
        code: 'save_error',
      })

      const { rendered, saveResultRef } = await renderProbe({
        client: mock.client,
        fireEvent: mock.fireEvent,
      })

      await act(async () => {
        await clickElement(rendered.getByTestId('btn-save-edit'))
        await Promise.resolve()
        await Promise.resolve()
      })

      const parsed = JSON.parse(saveResultRef.current) as { ok: boolean; errorMessage: string }
      expect(parsed.ok).toBe(false)
      expect(parsed.errorMessage).toBe('Save failed in IPC')

      rendered.unmount()
    })
  })

  describe('real-time subscription', () => {
    it('updates state when a server-state subscription event arrives', async () => {
      const mock = createMockClient()

      const { rendered, stateRef } = await renderProbe({
        client: mock.client,
        fireEvent: mock.fireEvent,
      })

      const newState: McpServerStateSummary = {
        ...STATE_1,
        connectionState: 'degraded',
        toolCount: 1,
      }

      await act(async () => {
        mock.fireEvent({
          kind: 'server-state',
          registryRevision: 5,
          snapshotRevision: 5,
          serverId: 'server-1',
          state: newState,
        })
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(stateRef.current?.servers.find((srv) => srv.serverId === 'server-1')?.connectionState).toBe('degraded')

      rendered.unmount()
    })

    it('removes a server when a server-removed subscription event arrives', async () => {
      const mock = createMockClient()

      const { rendered } = await renderProbe({
        client: mock.client,
        fireEvent: mock.fireEvent,
      })

      await act(async () => {
        mock.fireEvent({
          kind: 'server-removed',
          registryRevision: 6,
          snapshotRevision: 6,
          serverId: 'server-1',
        })
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(rendered.getByTestId('server-count').textContent).toBe('1')

      rendered.unmount()
    })

    it('replaces state with a full snapshot subscription event', async () => {
      const mock = createMockClient()
      mock.client.loadRegistry = vi.fn<() => Promise<McpRegistryLoadResult>>().mockResolvedValue(buildLoadSuccess())

      const { rendered } = await renderProbe({
        client: mock.client,
        fireEvent: mock.fireEvent,
      })

      const newServer: McpServerRecord = {
        serverId: 'server-3',
        displayName: 'Gamma Server',
        enabled: true,
        transportKind: 'stdio',
        description: 'Snapshot server',
        transportConfig: { kind: 'stdio', command: 'python', args: ['gamma.py'], cwd: null },
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-01T00:00:00.000Z',
      }

      await act(async () => {
        mock.fireEvent({
          kind: 'snapshot',
          registryRevision: 7,
          snapshotRevision: 7,
          servers: [newServer],
          states: [],
        })
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(rendered.getByTestId('server-count').textContent).toBe('1')
      expect(rendered.getByTestId('vm-server-3').textContent).toBeTruthy()

      rendered.unmount()
    })
  })

  describe('busy operation tracking', () => {
    it('busy operation is tracked via the view-model busy field', async () => {
      const { rendered, stateRef } = await renderProbe()

      const vm = stateRef.current?.servers.find((s) => s.serverId === 'server-1')
      expect(vm?.busy).toBe(false)

      rendered.unmount()
    })
  })

  describe('status message resolution', () => {
    it('resolves status message correctly during loading state', async () => {
      let resolveLoad: (value: McpRegistryLoadResult) => void = () => {}
      const client: McpRegistryClient = {
        ...createMockClient().client,
        loadRegistry: vi.fn(() => new Promise<McpRegistryLoadResult>((resolve) => { resolveLoad = resolve })),
      }

      const stateRef: React.MutableRefObject<UseMcpRegistryResult | null> = { current: null }
      const saveResultRef: React.MutableRefObject<string> = { current: '{}' }
      const rendered = renderWithRoot(
        React.createElement(McpRegistryProbe, { client, stateRef, saveResultRef }),
      )
      await flushAsyncEffects()

      expect(rendered.getByTestId('status-message').textContent).toBe('正在加载服务器列表…')

      await act(async () => {
        resolveLoad(buildLoadSuccess())
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(rendered.getByTestId('status-message').textContent).toBe('')

      rendered.unmount()
    })

    it('returns empty status message when load is ready', async () => {
      const { rendered } = await renderProbe()

      expect(rendered.getByTestId('status-message').textContent).toBe('')

      rendered.unmount()
    })
  })

  describe('getEditorSeed', () => {
    it('returns a JSON seed for add mode', async () => {
      const { stateRef, rendered } = await renderProbe()

      const seed = stateRef.current?.getEditorSeed('add')
      expect(typeof seed).toBe('string')
      expect(seed).toContain('"serverId"')
      expect(seed).toContain('new-server')

      rendered.unmount()
    })

    it('returns a JSON seed for edit mode', async () => {
      const { stateRef, rendered } = await renderProbe()

      const seed = stateRef.current?.getEditorSeed('edit')
      expect(typeof seed).toBe('string')
      expect(seed).toContain('"mcpServers"')
      expect(seed).toContain('server-1')

      rendered.unmount()
    })
  })
})
