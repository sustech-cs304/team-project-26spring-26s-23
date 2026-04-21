import { describe, expect, it } from 'vitest'

import {
  buildMcpToolId,
  collectMcpSnapshotRedactionViolations,
  isMcpCapabilitySnapshotRedacted,
} from './snapshot'
import { createMcpCapabilitySnapshotFixture } from './test-support'

describe('mcp snapshot contracts', () => {
  it('builds deterministic tool identifiers with normalized path segments and a stable hash suffix', () => {
    const toolId = buildMcpToolId('Campus HTTP', 'Search Tool')

    expect(toolId).toMatch(/^mcp\.campus-http\.search-tool\.[0-9a-f]{8}$/)
    expect(toolId).toBe(buildMcpToolId('Campus HTTP', 'Search Tool'))
    expect(toolId).not.toBe(buildMcpToolId('Campus HTTP', 'Search-Tool'))
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
