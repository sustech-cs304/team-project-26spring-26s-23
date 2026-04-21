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
  it('starts a stdio server, performs MCP handshake, and lists tools', async () => {
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
    expect(result.state.transportState).toMatchObject({ kind: 'stdio', processStatus: 'running' })
    expect(states).toContain('connecting')
    expect(states).toContain('connected')

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
    })

    await connector.stop()
  })
})

async function createStdioServerFixture(name: string, mode: 'success' | 'fail-list-after-first') {
  const tempRoot = await mkdtemp(path.join(tmpdir(), `candue-mcp-stdio-${name}-`))
  activeTempRoots.push(tempRoot)
  const scriptFile = path.join(tempRoot, 'stdio-mcp-server.mjs')
  await writeFile(scriptFile, createStdioServerScript(mode), 'utf8')
  return { tempRoot, scriptFile }
}

function createStdioServerScript(mode: 'success' | 'fail-list-after-first'): string {
  return `
let buffer = Buffer.alloc(0);
let listCalls = 0;
process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf('\\r\\n\\r\\n');
    if (headerEnd === -1) break;
    const header = buffer.subarray(0, headerEnd).toString('utf8');
    const match = /Content-Length:\\s*(\\d+)/i.exec(header);
    if (!match) process.exit(2);
    const bodyStart = headerEnd + 4;
    const length = Number(match[1]);
    if (buffer.byteLength < bodyStart + length) break;
    const payload = JSON.parse(buffer.subarray(bodyStart, bodyStart + length).toString('utf8'));
    buffer = buffer.subarray(bodyStart + length);
    handle(payload);
  }
});
function send(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  process.stdout.write('Content-Length: ' + body.byteLength + '\\r\\n\\r\\n');
  process.stdout.write(body);
}
function handle(payload) {
  if (payload.method === 'initialize') {
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
    send({ jsonrpc: '2.0', id: payload.id, result: { tools: [{ name: 'search-campus', title: 'Search Campus', description: 'Search the campus knowledge base.', inputSchema: { type: 'object' } }] } });
  }
}
`
}
