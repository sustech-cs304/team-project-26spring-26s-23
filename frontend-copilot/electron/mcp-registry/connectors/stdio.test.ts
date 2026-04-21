import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createMcpStdioStubServerFixture } from '../test-support'
import { createStdioMcpServerConnector } from './stdio'

const activeTempRoots: string[] = []

afterEach(async () => {
  await Promise.all(activeTempRoots.splice(0).map(async (tempRoot) => {
    await rm(tempRoot, { recursive: true, force: true })
  }))
})

describe('createStdioMcpServerConnector', () => {
  it('starts a stdio server, performs newline MCP handshake, and lists tools', async () => {
    const fixture = await createStdioServerFixture('success', 'success')
    const server = createMcpStdioStubServerFixture({
      transportConfig: {
        kind: 'stdio',
        command: process.execPath,
        args: [fixture.scriptFile],
        cwd: fixture.tempRoot,
      },
    })
    const states: string[] = []
    const connector = createStdioMcpServerConnector({
      server,
      context: {
        now: () => '2026-04-21T12:00:00.000Z',
        timeoutMs: 1_000,
        onStateChange(state) {
          states.push(state.connectionState)
        },
      },
    })

    const result = await connector.start()

    expect(result.ok).toBe(true)
    expect(result.tools).toHaveLength(1)
    expect(result.state.connectionState).toBe('connected')
    expect(result.state.lastPhase).toBeNull()
    expect(result.state.transportState).toMatchObject({ kind: 'stdio', processStatus: 'running' })
    expect(states).toContain('connecting')
    expect(states).toContain('connected')

    await connector.stop()
  })

  it('calls MCP tools over stdio once the session is ready', async () => {
    const fixture = await createStdioServerFixture('call-tool', 'success')
    const server = createMcpStdioStubServerFixture({
      transportConfig: {
        kind: 'stdio',
        command: process.execPath,
        args: [fixture.scriptFile],
        cwd: fixture.tempRoot,
      },
    })
    const connector = createStdioMcpServerConnector({
      server,
      context: {
        now: () => '2026-04-21T12:00:00.000Z',
        timeoutMs: 1_000,
      },
    })

    await connector.start()
    const result = await connector.callTool({
      toolId: 'mcp.test.search-campus',
      serverId: server.serverId,
      remoteToolName: 'search-campus',
      arguments: { keyword: 'calendar' },
      snapshotRevision: 10,
    })

    expect(result).toEqual({
      ok: true,
      toolId: 'mcp.test.search-campus',
      serverId: server.serverId,
      remoteToolName: 'search-campus',
      content: [{ type: 'text', text: 'search-campus completed' }],
      structuredContent: { echoedArguments: { keyword: 'calendar' } },
      snapshotRevision: 10,
      isError: false,
    })

    await connector.stop()
  })

  it('reassembles fragmented stdout lines before parsing MCP responses', async () => {
    const fixture = await createStdioServerFixture('fragmented-stdout', 'fragmented-stdout')
    const server = createMcpStdioStubServerFixture({
      transportConfig: {
        kind: 'stdio',
        command: process.execPath,
        args: [fixture.scriptFile],
        cwd: fixture.tempRoot,
      },
    })
    const connector = createStdioMcpServerConnector({
      server,
      context: {
        now: () => '2026-04-21T12:00:00.000Z',
        timeoutMs: 1_000,
      },
    })

    const result = await connector.start()

    expect(result.ok).toBe(true)
    expect(result.tools).toEqual([
      expect.objectContaining({ name: 'search-campus' }),
    ])

    await connector.stop()
  })

  it('preserves stderr as warning output while accepting valid stdout responses', async () => {
    const fixture = await createStdioServerFixture('stderr-noise', 'stderr-noise')
    const server = createMcpStdioStubServerFixture({
      transportConfig: {
        kind: 'stdio',
        command: process.execPath,
        args: [fixture.scriptFile],
        cwd: fixture.tempRoot,
      },
    })
    const connector = createStdioMcpServerConnector({
      server,
      context: {
        now: () => '2026-04-21T12:00:00.000Z',
        timeoutMs: 1_000,
      },
    })

    const result = await connector.start()

    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual(['booting stdio fixture | additional stderr context'])

    await connector.stop()
  })

  it('returns non-retryable command errors without leaving tools behind', async () => {
    const server = createMcpStdioStubServerFixture({
      transportConfig: {
        kind: 'stdio',
        command: 'definitely-missing-mcp-command-for-tests',
        args: [],
      },
    })
    const connector = createStdioMcpServerConnector({
      server,
      context: {
        now: () => '2026-04-21T12:00:00.000Z',
        timeoutMs: 200,
      },
    })

    const result = await connector.start()

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error('Expected failure result.')
    }
    expect(result.error).toMatchObject({
      code: 'command_not_found',
      retryable: false,
    })
    expect(result.state.connectionState).toBe('error')
    expect(result.tools).toEqual([])
  })

  it('keeps the last successful catalog snapshot when refresh fails', async () => {
    const fixture = await createStdioServerFixture('refresh-fails', 'fail-list-after-first')
    const server = createMcpStdioStubServerFixture({
      transportConfig: {
        kind: 'stdio',
        command: process.execPath,
        args: [fixture.scriptFile],
        cwd: fixture.tempRoot,
      },
    })
    const connector = createStdioMcpServerConnector({
      server,
      context: {
        now: () => '2026-04-21T12:00:00.000Z',
        timeoutMs: 1_000,
      },
    })

    await connector.start()
    const refreshed = await connector.refreshCatalog()

    expect(refreshed.ok).toBe(false)
    if (refreshed.ok) {
      throw new Error('Expected refresh failure result.')
    }
    expect(refreshed.state.connectionState).toBe('degraded')
    expect(refreshed.tools).toHaveLength(1)
    expect(refreshed.error).toMatchObject({
      code: 'mcp_remote_error',
      retryable: true,
      details: expect.objectContaining({ phase: 'tools/list' }),
    })

    await connector.stop()
  })

  it('rejects duplicate tool names from stdio servers as protocol failures', async () => {
    const fixture = await createStdioServerFixture('duplicate-tools', 'duplicate-tools')
    const server = createMcpStdioStubServerFixture({
      transportConfig: {
        kind: 'stdio',
        command: process.execPath,
        args: [fixture.scriptFile],
        cwd: fixture.tempRoot,
      },
    })
    const connector = createStdioMcpServerConnector({
      server,
      context: {
        now: () => '2026-04-21T12:00:00.000Z',
        timeoutMs: 1_000,
      },
    })

    const result = await connector.start()

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error('Expected duplicate tool metadata failure result.')
    }
    expect(result.error).toMatchObject({
      code: 'protocol_parse_failed',
      retryable: false,
      details: { remoteToolName: 'search-campus' },
    })
    expect(result.state.connectionState).toBe('error')
    expect(result.tools).toEqual([])
    expect(connector.getTools()).toEqual([])
  })

  it('reports initialize-stage timeouts with phase-aware diagnostics', async () => {
    const fixture = await createStdioServerFixture('initialize-timeout', 'initialize-timeout')
    const server = createMcpStdioStubServerFixture({
      transportConfig: {
        kind: 'stdio',
        command: process.execPath,
        args: [fixture.scriptFile],
        cwd: fixture.tempRoot,
      },
    })
    const connector = createStdioMcpServerConnector({
      server,
      context: {
        now: () => '2026-04-21T12:00:00.000Z',
        timeoutMs: 100,
      },
    })

    const result = await connector.start()

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error('Expected initialize timeout failure result.')
    }
    expect(result.error).toMatchObject({
      code: 'timeout',
      message: 'Timed out while waiting for the MCP stdio server response during initialize.',
      retryable: true,
      details: expect.objectContaining({
        phase: 'initialize',
      }),
    })
    expect(result.state.lastPhase).toBe('initialize')
  })

  it('maps invalid stdout JSON lines to protocol failures with initialize diagnostics', async () => {
    const fixture = await createStdioServerFixture('invalid-json', 'invalid-json')
    const server = createMcpStdioStubServerFixture({
      transportConfig: {
        kind: 'stdio',
        command: process.execPath,
        args: [fixture.scriptFile],
        cwd: fixture.tempRoot,
      },
    })
    const connector = createStdioMcpServerConnector({
      server,
      context: {
        now: () => '2026-04-21T12:00:00.000Z',
        timeoutMs: 1_000,
      },
    })

    const result = await connector.start()

    expect(result.ok).toBe(false)
    if (result.ok) {
      throw new Error('Expected invalid JSON failure result.')
    }
    expect(result.error).toMatchObject({
      code: 'protocol_parse_failed',
      message: 'The MCP stdio server returned unrecognized stdout output during initialize.',
      retryable: false,
      details: expect.objectContaining({
        phase: 'initialize',
      }),
    })
  })
})

async function createStdioServerFixture(
  name: string,
  mode: 'success' | 'fail-list-after-first' | 'duplicate-tools' | 'fragmented-stdout' | 'stderr-noise' | 'initialize-timeout' | 'invalid-json',
) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), `candue-mcp-stdio-${name}-`))
  activeTempRoots.push(tempRoot)
  const scriptFile = path.join(tempRoot, 'stdio-mcp-server.mjs')
  await writeFile(scriptFile, createStdioServerScript(mode), 'utf8')
  return { tempRoot, scriptFile }
}

function createStdioServerScript(
  mode: 'success' | 'fail-list-after-first' | 'duplicate-tools' | 'fragmented-stdout' | 'stderr-noise' | 'initialize-timeout' | 'invalid-json',
): string {
  return `
let buffer = '';
let listCalls = 0;
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  while (true) {
    const newlineIndex = buffer.indexOf('\\n');
    if (newlineIndex === -1) break;
    const line = buffer.slice(0, newlineIndex).replace(/\\r$/, '');
    buffer = buffer.slice(newlineIndex + 1);
    if (!line.trim()) continue;
    const payload = JSON.parse(line);
    handle(payload);
  }
});
function send(payload) {
  const body = JSON.stringify(payload) + '\\n';
  if (${JSON.stringify(mode)} === 'fragmented-stdout') {
    const midpoint = Math.max(1, Math.floor(body.length / 2));
    process.stdout.write(body.slice(0, midpoint));
    setTimeout(() => process.stdout.write(body.slice(midpoint)), 5);
    return;
  }
  process.stdout.write(body);
}
function handle(payload) {
  if (payload.method === 'initialize') {
    if (${JSON.stringify(mode)} === 'initialize-timeout') {
      return;
    }
    if (${JSON.stringify(mode)} === 'invalid-json') {
      process.stdout.write('{not-json}\\n');
      return;
    }
    if (${JSON.stringify(mode)} === 'stderr-noise') {
      process.stderr.write('booting stdio fixture\\n');
      process.stderr.write('additional stderr context\\n');
    }
    send({ jsonrpc: '2.0', id: payload.id, result: { serverInfo: { name: 'stdio-fixture' } } });
    return;
  }
  if (payload.method === 'notifications/initialized') {
    return;
  }
  if (payload.method === 'tools/list') {
    listCalls += 1;
    if (${JSON.stringify(mode)} === 'fail-list-after-first' && listCalls > 1) {
      send({ jsonrpc: '2.0', id: payload.id, error: { code: -32000, message: 'temporary list failure' } });
      return;
    }
    if (${JSON.stringify(mode)} === 'duplicate-tools') {
      send({ jsonrpc: '2.0', id: payload.id, result: { tools: [
        { name: 'search-campus', title: 'Search Campus', description: 'Search the campus knowledge base.', inputSchema: { type: 'object' } },
        { name: 'search-campus', title: 'Search Campus Duplicate', description: 'Duplicate metadata.', inputSchema: { type: 'object' } }
      ] } });
      return;
    }
    send({ jsonrpc: '2.0', id: payload.id, result: { tools: [{ name: 'search-campus', title: 'Search Campus', description: 'Search the campus knowledge base.', inputSchema: { type: 'object' } }] } });
    return;
  }
  if (payload.method === 'tools/call') {
    send({
      jsonrpc: '2.0',
      id: payload.id,
      result: {
        content: [{ type: 'text', text: 'search-campus completed' }],
        structuredContent: { echoedArguments: payload.params?.arguments ?? {} },
        isError: false,
      },
    });
  }
}
`
}
