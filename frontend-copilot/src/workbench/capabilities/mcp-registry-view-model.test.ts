import { describe, expect, it } from 'vitest'

import { formatMcpTestConnectionMessage } from './mcp-registry-view-model'

describe('formatMcpTestConnectionMessage', () => {
  it('uses the phase-aware backend error instead of collapsing failures into a generic timeout', () => {
    expect(formatMcpTestConnectionMessage({
      ok: true,
      success: false,
      transportKind: 'stdio',
      toolCount: 0,
      durationMs: 101,
      phase: 'initialize',
      diagnosticSummary: 'phase=initialize; command=uvx mcp-server-fetch',
      error: {
        code: 'timeout',
        message: 'Timed out while waiting for the MCP stdio server response during initialize.',
        retryable: true,
        observedAt: '2026-04-21T12:00:00.000Z',
        details: {
          phase: 'initialize',
        },
      },
      warnings: [],
    })).toBe('测试连接失败：Timed out while waiting for the MCP stdio server response during initialize.')
  })

  it('falls back to diagnostic summaries when the backend has no explicit error payload', () => {
    expect(formatMcpTestConnectionMessage({
      ok: true,
      success: false,
      transportKind: 'stdio',
      toolCount: 0,
      durationMs: 33,
      phase: 'spawn',
      diagnosticSummary: 'phase=spawn; command=uvx mcp-server-fetch; cwd=C:/work',
      error: null,
      warnings: [],
    })).toBe('测试连接失败：phase=spawn; command=uvx mcp-server-fetch; cwd=C:/work')
  })
})
