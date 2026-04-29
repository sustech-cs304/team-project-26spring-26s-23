/** @vitest-environment node */

import { describe, expect, it } from 'vitest'
import type { FileTreeEntry } from '../../../electron/file-manager/ipc'
import {
  buildObservedChange,
  diffFileTreeEntries,
  inferSemanticChanges,
  runFileWorkspacePostChangeHooks,
  setPostChangeHookListener,
} from './file-workspace-events'
import type {
  FileWorkspaceObservedChange,
  FileWorkspacePostChangeHookPayload,
} from './file-workspace-events'

// ── Helpers ────────────────────────────────────────────────────────────

function entry(
  overrides: Partial<FileTreeEntry> & { path: string; name: string },
): FileTreeEntry {
  return {
    id: overrides.id ?? overrides.path,
    path: overrides.path,
    name: overrides.name,
    kind: overrides.kind ?? 'file',
    parentPath: overrides.parentPath ?? '/test',
    size: overrides.size ?? 1024,
    modifiedAt: overrides.modifiedAt ?? '2026-04-27T00:00:00.000Z',
    hasChildren: overrides.hasChildren ?? null,
  }
}

function dirEntry(
  overrides: Partial<FileTreeEntry> & { path: string; name: string },
): FileTreeEntry {
  return entry({ kind: 'directory', size: null, ...overrides })
}

function makeObservedChange(
  overrides: Partial<FileWorkspaceObservedChange> = {},
): FileWorkspaceObservedChange {
  return {
    id: 'test-oc-1',
    rootPath: '/test',
    directoryPath: '/test',
    source: 'filesystem-watch',
    operation: 'watch-refresh',
    observedAt: '2026-04-28T00:00:00.000Z',
    entriesBefore: [],
    entriesAfter: [],
    addedPaths: overrides.addedPaths ?? [],
    removedPaths: overrides.removedPaths ?? [],
    modifiedPaths: overrides.modifiedPaths ?? [],
    affectedPaths: overrides.affectedPaths ?? [],
    ...overrides,
  }
}

// ── diffFileTreeEntries ────────────────────────────────────────────────

describe('diffFileTreeEntries', () => {
  it('detects added paths', () => {
    const before: FileTreeEntry[] = [
      entry({ path: '/test/a.txt', name: 'a.txt' }),
    ]
    const after: FileTreeEntry[] = [
      entry({ path: '/test/a.txt', name: 'a.txt' }),
      entry({ path: '/test/b.txt', name: 'b.txt' }),
    ]

    const diff = diffFileTreeEntries(before, after)
    expect(diff.addedPaths).toEqual(['/test/b.txt'])
    expect(diff.removedPaths).toEqual([])
    expect(diff.modifiedPaths).toEqual([])
    expect(diff.affectedPaths).toEqual(['/test/b.txt'])
  })

  it('detects removed paths', () => {
    const before: FileTreeEntry[] = [
      entry({ path: '/test/a.txt', name: 'a.txt' }),
      entry({ path: '/test/b.txt', name: 'b.txt' }),
    ]
    const after: FileTreeEntry[] = [
      entry({ path: '/test/a.txt', name: 'a.txt' }),
    ]

    const diff = diffFileTreeEntries(before, after)
    expect(diff.addedPaths).toEqual([])
    expect(diff.removedPaths).toEqual(['/test/b.txt'])
    expect(diff.modifiedPaths).toEqual([])
    expect(diff.affectedPaths).toEqual(['/test/b.txt'])
  })

  it('detects modified paths (size change)', () => {
    const before: FileTreeEntry[] = [
      entry({ path: '/test/a.txt', name: 'a.txt', size: 100 }),
    ]
    const after: FileTreeEntry[] = [
      entry({ path: '/test/a.txt', name: 'a.txt', size: 200 }),
    ]

    const diff = diffFileTreeEntries(before, after)
    expect(diff.addedPaths).toEqual([])
    expect(diff.removedPaths).toEqual([])
    expect(diff.modifiedPaths).toEqual(['/test/a.txt'])
  })

  it('detects modified paths (modifiedAt change)', () => {
    const before: FileTreeEntry[] = [
      entry({
        path: '/test/a.txt',
        name: 'a.txt',
        modifiedAt: '2026-04-27T00:00:00.000Z',
      }),
    ]
    const after: FileTreeEntry[] = [
      entry({
        path: '/test/a.txt',
        name: 'a.txt',
        modifiedAt: '2026-04-28T00:00:00.000Z',
      }),
    ]

    const diff = diffFileTreeEntries(before, after)
    expect(diff.modifiedPaths).toEqual(['/test/a.txt'])
  })

  it('handles empty before and after', () => {
    const diff = diffFileTreeEntries([], [])
    expect(diff.addedPaths).toEqual([])
    expect(diff.removedPaths).toEqual([])
    expect(diff.modifiedPaths).toEqual([])
    expect(diff.affectedPaths).toEqual([])
  })

  it('handles one added + one removed (rename scenario)', () => {
    const before: FileTreeEntry[] = [
      entry({ path: '/test/old.txt', name: 'old.txt' }),
    ]
    const after: FileTreeEntry[] = [
      entry({ path: '/test/new.txt', name: 'new.txt' }),
    ]

    const diff = diffFileTreeEntries(before, after)
    expect(diff.addedPaths).toEqual(['/test/new.txt'])
    expect(diff.removedPaths).toEqual(['/test/old.txt'])
    expect(diff.modifiedPaths).toEqual([])
    expect(diff.affectedPaths).toHaveLength(2)
  })

  it('handles unchanged entries', () => {
    const before: FileTreeEntry[] = [
      entry({ path: '/test/a.txt', name: 'a.txt', size: 100 }),
    ]
    const after: FileTreeEntry[] = [
      entry({ path: '/test/a.txt', name: 'a.txt', size: 100 }),
    ]

    const diff = diffFileTreeEntries(before, after)
    expect(diff.addedPaths).toEqual([])
    expect(diff.removedPaths).toEqual([])
    expect(diff.modifiedPaths).toEqual([])
    expect(diff.affectedPaths).toEqual([])
  })
})

// ── buildObservedChange ────────────────────────────────────────────────

describe('buildObservedChange', () => {
  it('builds an observed change with computed diff', () => {
    const before: FileTreeEntry[] = [
      entry({ path: '/test/a.txt', name: 'a.txt' }),
    ]
    const after: FileTreeEntry[] = [
      entry({ path: '/test/a.txt', name: 'a.txt' }),
      entry({ path: '/test/b.txt', name: 'b.txt' }),
    ]

    const oc = buildObservedChange({
      rootPath: '/test',
      directoryPath: '/test',
      source: 'filesystem-watch',
      operation: 'watch-refresh',
      entriesBefore: before,
      entriesAfter: after,
    })

    expect(oc.id).toMatch(/^foc-/)
    expect(oc.rootPath).toBe('/test')
    expect(oc.directoryPath).toBe('/test')
    expect(oc.source).toBe('filesystem-watch')
    expect(oc.operation).toBe('watch-refresh')
    expect(oc.entriesBefore).toEqual(before)
    expect(oc.entriesAfter).toEqual(after)
    expect(oc.addedPaths).toEqual(['/test/b.txt'])
    expect(oc.removedPaths).toEqual([])
    expect(oc.modifiedPaths).toEqual([])
    expect(oc.affectedPaths).toEqual(['/test/b.txt'])
  })

  it('builds an observed change with rawEventType and changedFilename', () => {
    const oc = buildObservedChange({
      rootPath: '/test',
      directoryPath: '/test/sub',
      source: 'filesystem-watch',
      operation: 'watch-refresh',
      rawEventType: 'change',
      changedFilename: 'newfile.txt',
      entriesBefore: [],
      entriesAfter: [],
    })

    expect(oc.rawEventType).toBe('change')
    expect(oc.changedFilename).toBe('newfile.txt')
  })

  it('builds an observed change with user-action source', () => {
    const oc = buildObservedChange({
      rootPath: '/test',
      directoryPath: '/test',
      source: 'user-action',
      operation: 'create-directory',
      entriesBefore: [],
      entriesAfter: [
        dirEntry({ path: '/test/newdir', name: 'newdir' }),
      ],
    })

    expect(oc.source).toBe('user-action')
    expect(oc.operation).toBe('create-directory')
  })
})

// ── inferSemanticChanges ───────────────────────────────────────────────

describe('inferSemanticChanges', () => {
  it('returns created for single added', () => {
    const oc = makeObservedChange({
      addedPaths: ['/test/b.txt'],
      removedPaths: [],
      modifiedPaths: [],
      affectedPaths: ['/test/b.txt'],
    })

    const semantic = inferSemanticChanges(oc)
    expect(semantic).toHaveLength(1)
    expect(semantic[0].kind).toBe('created')
    expect(semantic[0].confidence).toBe('high')
    expect(semantic[0].primaryPath).toBe('/test/b.txt')
    expect(semantic[0].secondaryPath).toBeUndefined()
  })

  it('returns deleted for single removed', () => {
    const oc = makeObservedChange({
      addedPaths: [],
      removedPaths: ['/test/b.txt'],
      modifiedPaths: [],
      affectedPaths: ['/test/b.txt'],
    })

    const semantic = inferSemanticChanges(oc)
    expect(semantic).toHaveLength(1)
    expect(semantic[0].kind).toBe('deleted')
    expect(semantic[0].confidence).toBe('high')
    expect(semantic[0].primaryPath).toBe('/test/b.txt')
  })

  it('returns modified for single modified', () => {
    const oc = makeObservedChange({
      addedPaths: [],
      removedPaths: [],
      modifiedPaths: ['/test/a.txt'],
      affectedPaths: ['/test/a.txt'],
    })

    const semantic = inferSemanticChanges(oc)
    expect(semantic).toHaveLength(1)
    expect(semantic[0].kind).toBe('modified')
    expect(semantic[0].confidence).toBe('high')
    expect(semantic[0].primaryPath).toBe('/test/a.txt')
  })

  it('returns renamed for one added + one removed with same kind', () => {
    const oc = makeObservedChange({
      entriesBefore: [
        entry({ path: '/test/old.txt', name: 'old.txt' }),
      ],
      entriesAfter: [
        entry({ path: '/test/new.txt', name: 'new.txt' }),
      ],
      addedPaths: ['/test/new.txt'],
      removedPaths: ['/test/old.txt'],
      modifiedPaths: [],
      affectedPaths: ['/test/new.txt', '/test/old.txt'],
    })

    const semantic = inferSemanticChanges(oc)
    expect(semantic).toHaveLength(1)
    expect(semantic[0].kind).toBe('renamed')
    expect(semantic[0].confidence).toBe('medium')
    expect(semantic[0].primaryPath).toBe('/test/new.txt')
    expect(semantic[0].secondaryPath).toBe('/test/old.txt')
  })

  it('returns renamed for one added dir + one removed dir with same kind', () => {
    const oc = makeObservedChange({
      entriesBefore: [
        dirEntry({ path: '/test/olddir', name: 'olddir' }),
      ],
      entriesAfter: [
        dirEntry({ path: '/test/newdir', name: 'newdir' }),
      ],
      addedPaths: ['/test/newdir'],
      removedPaths: ['/test/olddir'],
      modifiedPaths: [],
      affectedPaths: ['/test/newdir', '/test/olddir'],
    })

    const semantic = inferSemanticChanges(oc)
    expect(semantic).toHaveLength(1)
    expect(semantic[0].kind).toBe('renamed')
  })

  it('returns batch-updated when add+remove have different kinds (not rename)', () => {
    const oc = makeObservedChange({
      entriesBefore: [
        dirEntry({ path: '/test/olddir', name: 'olddir' }),
      ],
      entriesAfter: [
        entry({ path: '/test/newfile.txt', name: 'newfile.txt' }),
      ],
      addedPaths: ['/test/newfile.txt'],
      removedPaths: ['/test/olddir'],
      modifiedPaths: [],
      affectedPaths: ['/test/newfile.txt', '/test/olddir'],
    })

    const semantic = inferSemanticChanges(oc)
    expect(semantic).toHaveLength(1)
    expect(semantic[0].kind).toBe('batch-updated')
  })

  it('returns batch-updated for multiple changes', () => {
    const oc = makeObservedChange({
      addedPaths: ['/test/b.txt', '/test/c.txt'],
      removedPaths: [],
      modifiedPaths: [],
      affectedPaths: ['/test/b.txt', '/test/c.txt'],
    })

    const semantic = inferSemanticChanges(oc)
    expect(semantic).toHaveLength(1)
    expect(semantic[0].kind).toBe('batch-updated')
    expect(semantic[0].confidence).toBe('medium')
  })

  it('returns batch-updated for mixed add + modify', () => {
    const oc = makeObservedChange({
      addedPaths: ['/test/b.txt'],
      removedPaths: [],
      modifiedPaths: ['/test/a.txt'],
      affectedPaths: ['/test/a.txt', '/test/b.txt'],
    })

    const semantic = inferSemanticChanges(oc)
    expect(semantic).toHaveLength(1)
    expect(semantic[0].kind).toBe('batch-updated')
  })

  it('returns unknown-change for empty diff', () => {
    const oc = makeObservedChange({
      addedPaths: [],
      removedPaths: [],
      modifiedPaths: [],
      affectedPaths: [],
    })

    const semantic = inferSemanticChanges(oc)
    expect(semantic).toHaveLength(1)
    expect(semantic[0].kind).toBe('unknown-change')
    expect(semantic[0].confidence).toBe('low')
  })

  it('attaches observedChangeId to semantic change', () => {
    const oc = makeObservedChange({
      id: 'test-oc-123',
      addedPaths: ['/test/new.txt'],
      removedPaths: [],
      modifiedPaths: [],
      affectedPaths: ['/test/new.txt'],
    })

    const semantic = inferSemanticChanges(oc)
    expect(semantic[0].observedChangeId).toBe('test-oc-123')
  })
})

// ── runFileWorkspacePostChangeHooks ─────────────────────────────────────

describe('runFileWorkspacePostChangeHooks', () => {
  it('calls injected listener with payload', () => {
    const captured: FileWorkspacePostChangeHookPayload[] = []
    setPostChangeHookListener((payload) => {
      captured.push(payload)
    })

    const oc = makeObservedChange({
      addedPaths: ['/test/b.txt'],
      affectedPaths: ['/test/b.txt'],
    })
    const semanticChanges = inferSemanticChanges(oc)
    const payload: FileWorkspacePostChangeHookPayload = {
      observedChange: oc,
      semanticChanges,
    }

    runFileWorkspacePostChangeHooks(payload)

    expect(captured).toHaveLength(1)
    expect(captured[0].observedChange).toBe(oc)
    expect(captured[0].semanticChanges).toEqual(semanticChanges)

    // Clean up
    setPostChangeHookListener(null)
  })

  it('is no-op when no listener is set', () => {
    setPostChangeHookListener(null)
    // Should not throw
    const oc = makeObservedChange()
    expect(() => {
      runFileWorkspacePostChangeHooks({
        observedChange: oc,
        semanticChanges: [],
      })
    }).not.toThrow()
  })
})
