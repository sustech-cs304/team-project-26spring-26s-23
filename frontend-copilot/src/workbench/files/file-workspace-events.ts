import type { FileTreeEntry } from '../../../electron/file-manager/ipc'

// ── Types ──────────────────────────────────────────────────────────────

export interface FileWorkspaceObservedChange {
  id: string
  rootPath: string
  directoryPath: string
  source: 'filesystem-watch' | 'user-action' | 'agent-action'
  operation?:
    | 'create-directory'
    | 'copy'
    | 'cut'
    | 'paste'
    | 'rename'
    | 'delete'
    | 'permanent-delete'
    | 'drag-move'
    | 'watch-refresh'
  rawEventType?: 'rename' | 'change' | 'unknown'
  changedFilename?: string
  observedAt: string
  entriesBefore: FileTreeEntry[]
  entriesAfter: FileTreeEntry[]
  addedPaths: string[]
  removedPaths: string[]
  modifiedPaths: string[]
  affectedPaths: string[]
}

export interface FileWorkspaceSemanticChange {
  id: string
  observedChangeId: string
  kind:
    | 'created'
    | 'deleted'
    | 'modified'
    | 'renamed'
    | 'batch-updated'
    | 'unknown-change'
  rootPath: string
  scopePath: string
  source: 'filesystem-watch' | 'user-action' | 'agent-action'
  confidence: 'high' | 'medium' | 'low'
  primaryPath?: string
  secondaryPath?: string
  affectedPaths: string[]
  occurredAt: string
}

export interface FileWorkspacePostChangeHookPayload {
  observedChange: FileWorkspaceObservedChange
  semanticChanges: FileWorkspaceSemanticChange[]
}

// ── Diff ───────────────────────────────────────────────────────────────

export interface DiffResult {
  addedPaths: string[]
  removedPaths: string[]
  modifiedPaths: string[]
  affectedPaths: string[]
}

/**
 * Compare two FileTreeEntry arrays and produce a directory-level diff.
 * - addedPaths: paths present in `after` but not in `before` (by path).
 * - removedPaths: paths present in `before` but not in `after` (by path).
 * - modifiedPaths: paths present in both but size or modifiedAt differs.
 */
export function diffFileTreeEntries(
  before: FileTreeEntry[],
  after: FileTreeEntry[],
): DiffResult {
  const beforeMap = new Map<string, FileTreeEntry>()
  for (const entry of before) {
    beforeMap.set(entry.path, entry)
  }

  const afterMap = new Map<string, FileTreeEntry>()
  for (const entry of after) {
    afterMap.set(entry.path, entry)
  }

  const addedPaths: string[] = []
  const removedPaths: string[] = []
  const modifiedPaths: string[] = []

  for (const entry of after) {
    if (!beforeMap.has(entry.path)) {
      addedPaths.push(entry.path)
    }
  }

  for (const entry of before) {
    if (!afterMap.has(entry.path)) {
      removedPaths.push(entry.path)
    }
  }

  // A path is "modified" if it exists in both snapshots but size or modifiedAt changed.
  for (const entry of after) {
    const beforeEntry = beforeMap.get(entry.path)
    if (beforeEntry) {
      if (
        beforeEntry.size !== entry.size ||
        beforeEntry.modifiedAt !== entry.modifiedAt
      ) {
        modifiedPaths.push(entry.path)
      }
    }
  }

  const affectedSet = new Set([
    ...addedPaths,
    ...removedPaths,
    ...modifiedPaths,
  ])
  const affectedPaths = [...affectedSet]

  return { addedPaths, removedPaths, modifiedPaths, affectedPaths }
}

// ── Build Observed Change ──────────────────────────────────────────────

let _nextChangeId = 0

function generateChangeId(): string {
  _nextChangeId += 1
  return `foc-${_nextChangeId}-${Date.now()}`
}

function generateSemanticId(): string {
  _nextChangeId += 1
  return `fsc-${_nextChangeId}-${Date.now()}`
}

export interface BuildObservedChangeInput {
  rootPath: string
  directoryPath: string
  source: FileWorkspaceObservedChange['source']
  operation?: FileWorkspaceObservedChange['operation']
  rawEventType?: FileWorkspaceObservedChange['rawEventType']
  changedFilename?: string
  entriesBefore: FileTreeEntry[]
  entriesAfter: FileTreeEntry[]
}

export function buildObservedChange(
  input: BuildObservedChangeInput,
): FileWorkspaceObservedChange {
  const diff = diffFileTreeEntries(input.entriesBefore, input.entriesAfter)

  return {
    id: generateChangeId(),
    rootPath: input.rootPath,
    directoryPath: input.directoryPath,
    source: input.source,
    operation: input.operation,
    rawEventType: input.rawEventType,
    changedFilename: input.changedFilename,
    observedAt: new Date().toISOString(),
    entriesBefore: input.entriesBefore,
    entriesAfter: input.entriesAfter,
    addedPaths: diff.addedPaths,
    removedPaths: diff.removedPaths,
    modifiedPaths: diff.modifiedPaths,
    affectedPaths: diff.affectedPaths,
  }
}

// ── Infer Semantic Changes ─────────────────────────────────────────────

/**
 * Infer semantic-level changes from the fact-level observed change.
 * Rules (single-directory, first version):
 * 1. Single added   → created (high)
 * 2. Single deleted → deleted (high)
 * 3. Single modified → modified (high)
 * 4. One added + one removed + same kind + same size (or close) → renamed (medium)
 * 5. Multiple affected paths → batch-updated (medium)
 * 6. Fallback → unknown-change (low)
 */
export function inferSemanticChanges(
  observedChange: FileWorkspaceObservedChange,
): FileWorkspaceSemanticChange[] {
  const { addedPaths, removedPaths, modifiedPaths, affectedPaths } =
    observedChange

  // Rule 1: single created
  if (
    addedPaths.length === 1 &&
    removedPaths.length === 0 &&
    modifiedPaths.length === 0
  ) {
    return [
      makeSemanticChange(observedChange, 'created', 'high', {
        primaryPath: addedPaths[0],
      }),
    ]
  }

  // Rule 2: single deleted
  if (
    removedPaths.length === 1 &&
    addedPaths.length === 0 &&
    modifiedPaths.length === 0
  ) {
    return [
      makeSemanticChange(observedChange, 'deleted', 'high', {
        primaryPath: removedPaths[0],
      }),
    ]
  }

  // Rule 3: single modified
  if (
    modifiedPaths.length === 1 &&
    addedPaths.length === 0 &&
    removedPaths.length === 0
  ) {
    return [
      makeSemanticChange(observedChange, 'modified', 'high', {
        primaryPath: modifiedPaths[0],
      }),
    ]
  }

  // Rule 4: same-directory rename (1 added + 1 removed, same kind, same size)
  if (
    addedPaths.length === 1 &&
    removedPaths.length === 1 &&
    modifiedPaths.length === 0
  ) {
    const addedEntry = observedChange.entriesAfter.find(
      (e) => e.path === addedPaths[0],
    )
    const removedEntry = observedChange.entriesBefore.find(
      (e) => e.path === removedPaths[0],
    )
    if (
      addedEntry &&
      removedEntry &&
      addedEntry.kind === removedEntry.kind
    ) {
      const sizeClose =
        addedEntry.size === null ||
        removedEntry.size === null ||
        addedEntry.size === removedEntry.size
      if (sizeClose) {
        return [
          makeSemanticChange(observedChange, 'renamed', 'medium', {
            primaryPath: addedPaths[0],
            secondaryPath: removedPaths[0],
          }),
        ]
      }
    }
  }

  // Rule 5: multiple affected paths → batch-updated
  if (affectedPaths.length > 1) {
    return [
      makeSemanticChange(observedChange, 'batch-updated', 'medium', {}),
    ]
  }

  // Rule 6: fallback → unknown-change
  return [
    makeSemanticChange(observedChange, 'unknown-change', 'low', {}),
  ]
}

function makeSemanticChange(
  observedChange: FileWorkspaceObservedChange,
  kind: FileWorkspaceSemanticChange['kind'],
  confidence: FileWorkspaceSemanticChange['confidence'],
  paths: {
    primaryPath?: string
    secondaryPath?: string
  },
): FileWorkspaceSemanticChange {
  return {
    id: generateSemanticId(),
    observedChangeId: observedChange.id,
    kind,
    rootPath: observedChange.rootPath,
    scopePath: observedChange.directoryPath,
    source: observedChange.source,
    confidence,
    primaryPath: paths.primaryPath,
    secondaryPath: paths.secondaryPath,
    affectedPaths: observedChange.affectedPaths,
    occurredAt: observedChange.observedAt,
  }
}

// ── Hook Runner ────────────────────────────────────────────────────────

type PostChangeHookListener = (
  payload: FileWorkspacePostChangeHookPayload,
) => void

let __postChangeHookListener: PostChangeHookListener | null = null

/**
 * Inject a listener for post-change hook events.
 * Used in tests to spy on emitted events.
 * Pass `null` to clear.
 */
export function setPostChangeHookListener(
  listener: PostChangeHookListener | null,
): void {
  __postChangeHookListener = listener
}

/**
 * Run post-change hooks with the given observedChange and semanticChanges.
 * First version is a no-op unless a listener has been injected via
 * `setPostChangeHookListener`.
 */
export function runFileWorkspacePostChangeHooks(
  payload: FileWorkspacePostChangeHookPayload,
): void {
  if (__postChangeHookListener) {
    __postChangeHookListener(payload)
  }
}
