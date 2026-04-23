import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createHostedRuntimePaths, ensureHostedRuntimeDirectories } from '../runtime/runtime-paths'
import {
  buildMcpToolId,
  collectMcpSnapshotRedactionViolations,
  createMcpCapabilitySnapshot,
  createMcpCapabilitySnapshotFilePath,
  createMcpCapabilitySnapshotSink,
  isMcpCapabilitySnapshotRedacted,
} from './snapshot'
import {
  createMcpCapabilitySnapshotFixture,
  createMcpHttpSseStubServerFixture,
  createMcpServerStateFixture,
  createMcpStdioStubServerFixture,
} from './test-support'
import {
  MCP_CAPABILITY_SNAPSHOT_BRIDGE_KEY,
  MCP_CAPABILITY_SNAPSHOT_BRIDGE_TOOL_ID,
} from './types'
import type { McpRemoteToolSummary } from './connectors/protocol'

const activeTempRoots: string[] = []

afterEach(async () => {
  await Promise.all(activeTempRoots.splice(0).map(async (tempRoot) => {
    await rm(tempRoot, { recursive: true, force: true })
  }))
})

describe('mcp snapshot contracts', () => {
  it('builds deterministic tool identifiers with normalized path segments and a stable hash suffix', () => {
    const toolId = buildMcpToolId('Campus HTTP', 'Search Tool')

    expect(toolId).toMatch(/^mcp\.campus-http\.search-tool\.[0-9a-f]{8}$/)
    expect(toolId).toBe(buildMcpToolId('Campus HTTP', 'Search Tool'))
    expect(toolId).not.toBe(buildMcpToolId('Campus HTTP', 'Search-Tool'))
  })

  it('creates a redacted capability snapshot with stable server groups and last successful refresh metadata', () => {
    const stdioServer = createMcpStdioStubServerFixture()
    const httpServer = createMcpHttpSseStubServerFixture({ enabled: false })
    const expectedToolId = buildMcpToolId(stdioServer.serverId, 'search-campus')
    const snapshot = createMcpCapabilitySnapshot({
      registryRevision: 3,
      snapshotRevision: 8,
      generatedAt: '2026-04-21T08:15:00Z',
      servers: [stdioServer, httpServer],
      states: [
        createMcpServerStateFixture(stdioServer, {
          connectionState: 'connected',
          toolCount: 1,
          lastCatalogSyncAt: '2026-04-21T08:12:00Z',
        }),
        createMcpServerStateFixture(httpServer, {
          enabled: false,
          connectionState: 'disabled',
          toolCount: 0,
          lastCatalogSyncAt: null,
        }),
      ],
      toolsByServerId: new Map<string, readonly McpRemoteToolSummary[]>([
        [stdioServer.serverId, [{
          name: 'search-campus',
          displayName: 'Search Campus',
          description: 'Search the campus knowledge base.',
          inputSchema: {
            type: 'object',
            properties: {
              keyword: { type: 'string' },
            },
          },
        }]],
        [httpServer.serverId, [{
          name: 'fetch-calendar',
          displayName: 'Fetch Calendar',
          description: 'Fetch the current course calendar.',
          inputSchema: {},
        }]],
      ]),
    })

    expect(snapshot).toMatchObject({
      version: 1,
      registryRevision: 3,
      snapshotRevision: 8,
      generatedAt: '2026-04-21T08:15:00Z',
      tools: [{
        toolId: expectedToolId,
        serverId: 'mcp-stdio-stub',
        remoteToolName: 'search-campus',
        displayName: 'Search Campus',
        description: 'Search the campus knowledge base.',
        availability: 'available',
        groupId: 'mcp.server.mcp-stdio-stub',
        groupLabel: 'stdio stub server',
      }],
      groups: [{
        groupId: 'mcp.server.mcp-stdio-stub',
        displayName: 'stdio stub server',
        sourceKind: 'mcp',
        toolIds: [expectedToolId],
      }],
    })
    expect(snapshot.servers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        serverId: 'mcp-stdio-stub',
        toolCount: 1,
        lastSuccessfulCatalogRefresh: {
          refreshedAt: '2026-04-21T08:12:00Z',
          toolCount: 1,
        },
      }),
      expect.objectContaining({
        serverId: 'mcp-http-sse-stub',
        connectionState: 'disabled',
        toolCount: 0,
        lastSuccessfulCatalogRefresh: null,
      }),
    ]))
    expect(collectMcpSnapshotRedactionViolations(snapshot)).toEqual([])
  })

  it('persists snapshots to both the snapshot file and existing capability bridge state document', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-mcp-snapshot-sink-'))
    activeTempRoots.push(tempRoot)
    const runtimePaths = createHostedRuntimePaths(tempRoot)
    await ensureHostedRuntimeDirectories(runtimePaths)
    const snapshot = createMcpCapabilitySnapshotFixture()

    await createMcpCapabilitySnapshotSink({ runtimePaths }).write(snapshot)

    const snapshotFilePayload = JSON.parse(
      await readFile(createMcpCapabilitySnapshotFilePath(runtimePaths), 'utf8'),
    ) as unknown
    const bridgeStatePayload = JSON.parse(
      await readFile(path.join(runtimePaths.stateDir, 'capability-bridge-state.json'), 'utf8'),
    ) as {
      values: {
        tool: Record<string, Record<string, unknown>>
      }
    }

    expect(snapshotFilePayload).toEqual(snapshot)
    expect(
      bridgeStatePayload.values.tool[MCP_CAPABILITY_SNAPSHOT_BRIDGE_TOOL_ID]?.[MCP_CAPABILITY_SNAPSHOT_BRIDGE_KEY],
    ).toEqual(snapshot)
  })

  it('preserves existing capability bridge state buckets while writing the MCP snapshot', async () => {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'candue-mcp-snapshot-existing-'))
    activeTempRoots.push(tempRoot)
    const runtimePaths = createHostedRuntimePaths(tempRoot)
    await ensureHostedRuntimeDirectories(runtimePaths)
    const stateFile = path.join(runtimePaths.stateDir, 'capability-bridge-state.json')
    await writeFile(stateFile, `${JSON.stringify({
      version: 1,
      values: {
        tool: {
          'tool.fs.read': {
            cursor: { value: 1 },
          },
        },
        run: {},
      },
    })}\n`, 'utf8')

    await createMcpCapabilitySnapshotSink({ runtimePaths }).write(createMcpCapabilitySnapshotFixture())

    const bridgeStatePayload = JSON.parse(await readFile(stateFile, 'utf8')) as {
      values: {
        tool: Record<string, Record<string, unknown>>
      }
    }
    expect(bridgeStatePayload.values.tool['tool.fs.read']).toEqual({
      cursor: { value: 1 },
    })
    expect(bridgeStatePayload.values.tool[MCP_CAPABILITY_SNAPSHOT_BRIDGE_TOOL_ID]).toBeDefined()
  })

  it('flags snapshots that leak transport secrets or command details', () => {
    const snapshot = createMcpCapabilitySnapshotFixture()
    const leakedSnapshot = {
      ...snapshot,
      localToken: 'desktop-local-token',
      servers: [
        {
          ...snapshot.servers[0],
          headers: {
            Authorization: 'Bearer super-secret',
          },
        },
        ...snapshot.servers.slice(1),
      ],
    }

    expect(collectMcpSnapshotRedactionViolations(snapshot)).toEqual([])
    expect(isMcpCapabilitySnapshotRedacted(snapshot)).toBe(true)
    expect([...collectMcpSnapshotRedactionViolations(leakedSnapshot)].sort()).toEqual([
      'localToken',
      'servers[0].headers',
    ])
    expect(isMcpCapabilitySnapshotRedacted(leakedSnapshot as never)).toBe(false)
  })
})
