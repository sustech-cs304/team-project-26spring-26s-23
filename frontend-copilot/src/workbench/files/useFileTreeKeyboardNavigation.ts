import { useCallback, useMemo } from 'react'
import type { FileTreeEntry } from '../../../electron/file-manager/ipc'
import type { VisibleTreeNode } from './types'

interface UseFileTreeKeyboardNavigationParams {
  visiblePaths: string[]
  visibleTree: VisibleTreeNode[]
  focusedPath: string | null
  expandedPaths: Set<string>
  selectionAnchorPath: string | null
  renameTarget: string | null
  confirmDeletePaths: string[]
  contextMenu: { x: number; y: number; targetPath: string | null; targetKind: 'file' | 'directory' | null } | null
  busyOperation: string
  rootEntries: FileTreeEntry[]
  entriesCache: Map<string, FileTreeEntry[]>
  selectedPaths: Set<string>
  setFocusedPath: (value: React.SetStateAction<string | null>) => void
  setSelectedPaths: (value: React.SetStateAction<Set<string>>) => void
  setLastClickedPath: (value: React.SetStateAction<string | null>) => void
  setSelectionAnchorPath: (value: React.SetStateAction<string | null>) => void
  toggleExpand: (path: string) => Promise<void>
  deleteSelected: () => Promise<void>
  startRename: (path: string) => void
  copySelected: () => void
  cutSelected: () => void
  pasteEntries: (targetDir?: string) => Promise<void>
}

type KeyHandler = (e: React.KeyboardEvent, ctrl: boolean, shift: boolean) => boolean

function findEntryByPath(
  targetPath: string,
  rootEntries: FileTreeEntry[],
  entriesCache: Map<string, FileTreeEntry[]>,
): FileTreeEntry | undefined {
  for (const entry of rootEntries) {
    if (entry.path === targetPath) return entry
  }
  for (const [, children] of entriesCache) {
    for (const entry of children) {
      if (entry.path === targetPath) return entry
    }
  }
  return undefined
}

// eslint-disable-next-line max-lines-per-function
export function useFileTreeKeyboardNavigation(params: UseFileTreeKeyboardNavigationParams) {
  const {
    visiblePaths,
    visibleTree,
    focusedPath,
    expandedPaths,
    selectionAnchorPath,
    renameTarget,
    confirmDeletePaths,
    contextMenu,
    busyOperation,
    rootEntries,
    entriesCache,
    selectedPaths,
    setFocusedPath,
    setSelectedPaths,
    setLastClickedPath,
    setSelectionAnchorPath,
    toggleExpand,
    deleteSelected,
    startRename,
    copySelected,
    cutSelected,
    pasteEntries,
  } = params

  const shouldHandleTreeKeyboard = useCallback((): boolean => {
    if (renameTarget !== null) return false
    if (confirmDeletePaths.length > 0) return false
    if (contextMenu !== null) return false
    if (busyOperation !== 'idle') return false
    if (visiblePaths.length === 0) return false
    return true
  }, [renameTarget, confirmDeletePaths, contextMenu, busyOperation, visiblePaths])

  const moveFocusVertical = useCallback(
    (direction: 'up' | 'down', extendSelection: boolean, focusOnly: boolean) => {
      if (visiblePaths.length === 0) return

      const currentIdx = focusedPath ? visiblePaths.indexOf(focusedPath) : -1
      let newIdx: number

      if (currentIdx === -1) {
        newIdx = 0
      } else if (direction === 'up') {
        newIdx = Math.max(0, currentIdx - 1)
      } else {
        newIdx = Math.min(visiblePaths.length - 1, currentIdx + 1)
      }

      const newPath = visiblePaths[newIdx]
      setFocusedPath(newPath)

      if (focusOnly) return

      if (extendSelection) {
        const anchor = selectionAnchorPath ?? focusedPath ?? newPath
        const anchorIdx = visiblePaths.indexOf(anchor)
        if (anchorIdx !== -1) {
          const rangeStart = Math.min(anchorIdx, newIdx)
          const rangeEnd = Math.max(anchorIdx, newIdx)
          setSelectedPaths(new Set(visiblePaths.slice(rangeStart, rangeEnd + 1)))
        }
      } else {
        setSelectedPaths(new Set([newPath]))
        setLastClickedPath(newPath)
        setSelectionAnchorPath(newPath)
      }
    },
    [visiblePaths, focusedPath, selectionAnchorPath, setFocusedPath, setSelectedPaths, setLastClickedPath, setSelectionAnchorPath],
  )

  const handleArrowRight = useCallback(() => {
    if (!focusedPath || visiblePaths.length === 0) return

    const node = visibleTree.find((n) => n.entry.path === focusedPath)
    if (!node) return

    if (node.entry.kind === 'directory') {
      const isExpanded = expandedPaths.has(focusedPath)
      if (!isExpanded) {
        void toggleExpand(focusedPath)
      } else {
        const currentIdx = visiblePaths.indexOf(focusedPath)
        if (currentIdx < visiblePaths.length - 1) {
          const nextPath = visiblePaths[currentIdx + 1]
          const nextNode = visibleTree.find((n) => n.entry.path === nextPath)
          if (nextNode && nextNode.depth > node.depth) {
            setFocusedPath(nextPath)
            setSelectedPaths(new Set([nextPath]))
            setLastClickedPath(nextPath)
            setSelectionAnchorPath(nextPath)
          }
        }
      }
    }
  }, [focusedPath, visiblePaths, visibleTree, expandedPaths, toggleExpand, setFocusedPath, setSelectedPaths, setLastClickedPath, setSelectionAnchorPath])

  const handleArrowLeft = useCallback(() => {
    if (!focusedPath || visiblePaths.length === 0) return

    const node = visibleTree.find((n) => n.entry.path === focusedPath)
    if (!node) return

    if (node.entry.kind === 'directory' && expandedPaths.has(focusedPath)) {
      void toggleExpand(focusedPath)
      return
    }

    if (node.entry.parentPath && visiblePaths.includes(node.entry.parentPath)) {
      setFocusedPath(node.entry.parentPath)
      setSelectedPaths(new Set([node.entry.parentPath]))
      setLastClickedPath(node.entry.parentPath)
      setSelectionAnchorPath(node.entry.parentPath)
    }
  }, [focusedPath, visiblePaths, visibleTree, expandedPaths, toggleExpand, setFocusedPath, setSelectedPaths, setLastClickedPath, setSelectionAnchorPath])

  const handleEnter = useCallback(() => {
    if (!focusedPath) return

    const entry = findEntryByPath(focusedPath, rootEntries, entriesCache)
    if (entry && entry.kind === 'directory') {
      void toggleExpand(focusedPath)
    }
  }, [focusedPath, rootEntries, entriesCache, toggleExpand])

  const toggleFocusedSelection = useCallback(() => {
    if (!focusedPath) return

    setSelectedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(focusedPath)) {
        next.delete(focusedPath)
      } else {
        next.add(focusedPath)
      }
      return next
    })
    setSelectionAnchorPath(focusedPath)
  }, [focusedPath, setSelectedPaths, setSelectionAnchorPath])

  // ── Key handler map ──────────────────────────────────────
  const keyHandlers = useMemo<Record<string, KeyHandler>>(() => ({
    ArrowUp: (e, ctrl, shift) => {
      e.preventDefault()
      e.stopPropagation()
      if (shift) moveFocusVertical('up', true, false)
      else if (ctrl) moveFocusVertical('up', false, true)
      else moveFocusVertical('up', false, false)
      return true
    },
    ArrowDown: (e, ctrl, shift) => {
      e.preventDefault()
      e.stopPropagation()
      if (shift) moveFocusVertical('down', true, false)
      else if (ctrl) moveFocusVertical('down', false, true)
      else moveFocusVertical('down', false, false)
      return true
    },
    ArrowRight: (e) => {
      e.preventDefault()
      e.stopPropagation()
      handleArrowRight()
      return true
    },
    ArrowLeft: (e) => {
      e.preventDefault()
      e.stopPropagation()
      handleArrowLeft()
      return true
    },
    Enter: (e) => {
      e.preventDefault()
      e.stopPropagation()
      handleEnter()
      return true
    },
    ' ': (e) => {
      e.preventDefault()
      e.stopPropagation()
      toggleFocusedSelection()
      return true
    },
    Delete: (e) => {
      e.preventDefault()
      e.stopPropagation()
      void deleteSelected()
      return true
    },
    F2: (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (focusedPath) {
        startRename(focusedPath)
      } else if (selectedPaths.size === 1) {
        const [single] = selectedPaths
        startRename(single)
      }
      return true
    },
  }), [
    moveFocusVertical,
    handleArrowRight,
    handleArrowLeft,
    handleEnter,
    toggleFocusedSelection,
    deleteSelected,
    focusedPath,
    selectedPaths,
    startRename,
  ])

  const ctrlKeyHandlers = useMemo<Record<string, KeyHandler>>(() => ({
    c: (e) => { e.preventDefault(); e.stopPropagation(); copySelected(); return true },
    C: (e) => { e.preventDefault(); e.stopPropagation(); copySelected(); return true },
    x: (e) => { e.preventDefault(); e.stopPropagation(); cutSelected(); return true },
    X: (e) => { e.preventDefault(); e.stopPropagation(); cutSelected(); return true },
    v: (e) => { e.preventDefault(); e.stopPropagation(); void pasteEntries(); return true },
    V: (e) => { e.preventDefault(); e.stopPropagation(); void pasteEntries(); return true },
  }), [copySelected, cutSelected, pasteEntries])

  const handleTreeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!shouldHandleTreeKeyboard()) return

      const ctrl = e.ctrlKey || e.metaKey

      // Try ctrl-key handlers first
      if (ctrl && ctrlKeyHandlers[e.key]) {
        ctrlKeyHandlers[e.key](e, ctrl, e.shiftKey)
        return
      }

      // Try regular key handlers
      const handler = keyHandlers[e.key]
      if (handler) {
        handler(e, ctrl, e.shiftKey)
      }
    },
    [
      shouldHandleTreeKeyboard,
      ctrlKeyHandlers,
      keyHandlers,
    ],
  )

  return { handleTreeKeyDown } as const
}
