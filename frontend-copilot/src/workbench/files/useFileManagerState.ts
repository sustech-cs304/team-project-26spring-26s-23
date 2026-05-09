import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  FileManagerApi,
  FileManagerError,
  FileTreeEntry,
} from '../../../electron/file-manager/ipc'
import type {
  ClipboardIntent,
  FileOperationStatus,
  VisibleTreeNode,
} from './types'
import {
  buildObservedChange,
  inferSemanticChanges,
  runFileWorkspacePostChangeHooks,
} from './file-workspace-events'
import type { FileWorkspaceObservedChange } from './file-workspace-events'

function getFileManager(): FileManagerApi | null {
  if (typeof window === 'undefined' || !window.fileManager) {
    return null
  }
  return window.fileManager
}

function sortEntries(entries: FileTreeEntry[]): FileTreeEntry[] {
  return [...entries].sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === 'directory' ? -1 : 1
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

function buildVisibleTree(
  rootEntries: FileTreeEntry[],
  entriesCache: Map<string, FileTreeEntry[]>,
  expandedPaths: Set<string>,
): VisibleTreeNode[] {
  const result: VisibleTreeNode[] = []

  function walk(entries: FileTreeEntry[], depth: number) {
    for (const entry of entries) {
      result.push({
        entry,
        depth,
        parentPath: entry.parentPath,
      })

      if (entry.kind === 'directory' && expandedPaths.has(entry.path)) {
        const children = entriesCache.get(entry.path)
        if (children) {
          walk(sortEntries(children), depth + 1)
        }
      }
    }
  }

  walk(sortEntries(rootEntries), 0)
  return result
}

export interface FileManagerState {
  rootPath: string | null
  rootEntries: FileTreeEntry[]
  visibleTree: VisibleTreeNode[]
  selectedPaths: Set<string>
  lastClickedPath: string | null
  focusedPath: string | null
  selectionAnchorPath: string | null
  clipboard: ClipboardIntent | null
  busyOperation: FileOperationStatus
  errorMessage: string | null
  successMessage: string | null
  renameTarget: string | null
  renameValue: string
  confirmDeletePaths: string[]
  largeDirectoryWarning: boolean
  warningMessage: string | null
  expandedPaths: Set<string>
  entriesCache: Map<string, FileTreeEntry[]>
  // Drag-and-drop
  dragOverPath: string | null
  // Context menu
  contextMenu: { x: number; y: number; targetPath: string | null; targetKind: 'file' | 'directory' | null } | null
  selectRootDirectory: () => Promise<void>
  toggleExpand: (directoryPath: string) => Promise<void>
  handleClick: (path: string, kind: 'file' | 'directory', event: { ctrlKey: boolean; shiftKey: boolean; metaKey: boolean }) => void
  handleDoubleClick: (path: string, kind: 'file' | 'directory') => Promise<void>
  clearSelection: () => void
  copySelected: () => void
  cutSelected: () => void
  pasteEntries: (targetDir?: string) => Promise<void>
  moveSelected: () => Promise<void>
  startRename: (path: string) => void
  commitRename: () => Promise<void>
  cancelRename: () => void
  setRenameValue: (value: string) => void
  deleteSelected: () => Promise<void>
  confirmPermanentDelete: () => Promise<void>
  cancelPermanentDelete: () => void
  createDirectory: (targetDir?: string) => Promise<void>
  refreshCurrent: () => Promise<void>
  dismissMessages: () => void
  // System action handlers
  openEntryWithSystem: () => Promise<void>
  revealEntryInFolder: () => Promise<void>
  copyPathToClipboard: () => Promise<void>
  copyRelativePathToClipboard: () => Promise<void>
  // Context menu handlers
  handleContextMenu: (e: React.MouseEvent, path: string | null, kind: 'file' | 'directory' | null) => void
  hideContextMenu: () => void
  // Drag-and-drop handlers
  handleDragStart: (e: React.DragEvent, path: string) => void
  handleDragOver: (e: React.DragEvent, path: string) => void
  handleDragLeave: (e: React.DragEvent) => void
  handleDrop: (e: React.DragEvent, targetPath: string) => Promise<void>
  handleDragEnd: () => void
  // Persistence + watcher helpers
  loadRootDirectory: () => Promise<void>
  refreshDirectoryPath: (
    directoryPath: string,
    entriesBefore?: FileTreeEntry[],
    rawEvent?: { eventType?: 'rename' | 'change' | 'unknown'; filename?: string },
  ) => Promise<void>
  // Keyboard navigation
  handleTreeKeyDown: (e: React.KeyboardEvent) => void
}

function computeTargetDirectory(
  selectedPaths: Set<string>,
  focusedPath: string | null,
  entriesCache: Map<string, FileTreeEntry[]>,
  rootEntries: FileTreeEntry[],
): string | null {
  // 如果只选中了一个文件夹，目标就是该文件夹
  if (selectedPaths.size === 1) {
    const [singlePath] = selectedPaths
    const entry = findEntryByPath(singlePath, rootEntries, entriesCache)
    if (entry && entry.kind === 'directory') {
      return singlePath
    }
  }

  // 如果有聚焦目录，使用该目录的父目录
  if (focusedPath) {
    const entry = findEntryByPath(focusedPath, rootEntries, entriesCache)
    if (entry) {
      return entry.kind === 'directory' ? focusedPath : entry.parentPath
    }
  }

  return null
}

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

function collectAllVisiblePaths(visibleTree: VisibleTreeNode[]): string[] {
  return visibleTree.map((node) => node.entry.path)
}

function isPathNestedUnder(path: string, parentPath: string): boolean {
  return path.startsWith(`${parentPath}/`) || path.startsWith(`${parentPath}\\`)
}

function getParentPathForRefresh(entryPath: string, rootPath: string): string {
  const lastSep = Math.max(entryPath.lastIndexOf('/'), entryPath.lastIndexOf('\\'))
  if (lastSep <= 0) return rootPath

  const parent = entryPath.substring(0, lastSep)
  const normalizedParent = parent.replace(/[\\/]+$/, '').toLowerCase()
  const normalizedRoot = rootPath.replace(/[\\/]+$/, '').toLowerCase()
  return normalizedParent === normalizedRoot ? rootPath : parent
}

function readDragSourcePaths(dataTransfer: DataTransfer): string[] | null {
  try {
    const rawData = dataTransfer.getData('text/plain')
    if (!rawData) return null
    const parsed = JSON.parse(rawData)
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')
      ? parsed
      : null
  } catch {
    return null
  }
}

function canDropOnDirectory(
  sourcePaths: string[],
  targetPath: string,
  rootEntries: FileTreeEntry[],
  entriesCache: Map<string, FileTreeEntry[]>,
): boolean {
  const targetEntry = findEntryByPath(targetPath, rootEntries, entriesCache)
  if (!targetEntry || targetEntry.kind !== 'directory') return false

  for (const sourcePath of sourcePaths) {
    if (sourcePath === targetPath || isPathNestedUnder(targetPath, sourcePath)) {
      return false
    }
  }

  return true
}

/** Given a path, find the nearest visible ancestor path that exists in the visible tree */
function findNearestVisibleAncestor(
  path: string,
  visiblePaths: string[],
  rootEntries: FileTreeEntry[],
  entriesCache: Map<string, FileTreeEntry[]>,
): string | null {
  const entry = findEntryByPath(path, rootEntries, entriesCache)
  if (!entry || !entry.parentPath) return null

  // Walk up the parent chain
  let current: string | null = entry.parentPath
  while (current) {
    if (visiblePaths.includes(current)) return current
    const parentEntry = findEntryByPath(current, rootEntries, entriesCache)
    current = parentEntry?.parentPath ?? null
  }
  return null
}

export function useFileManagerState(): FileManagerState {
  const [rootPath, setRootPath] = useState<string | null>(null)
  const [rootEntries, setRootEntries] = useState<FileTreeEntry[]>([])
  const [entriesCache, setEntriesCache] = useState<Map<string, FileTreeEntry[]>>(new Map())
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [lastClickedPath, setLastClickedPath] = useState<string | null>(null)
  const [focusedPath, setFocusedPath] = useState<string | null>(null)
  const [selectionAnchorPath, setSelectionAnchorPath] = useState<string | null>(null)
  const [clipboard, setClipboard] = useState<ClipboardIntent | null>(null)
  const [busyOperation, setBusyOperation] = useState<FileOperationStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [renameTarget, setRenameTarget] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDeletePaths, setConfirmDeletePaths] = useState<string[]>([])
  const [largeDirectoryWarning, setLargeDirectoryWarning] = useState(false)
  const [warningMessage, setWarningMessage] = useState<string | null>(null)
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)
  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    targetPath: string | null
    targetKind: 'file' | 'directory' | null
  } | null>(null)

  const visibleTree = useMemo(
    () => buildVisibleTree(rootEntries, entriesCache, expandedPaths),
    [rootEntries, entriesCache, expandedPaths],
  )

  const visiblePaths = useMemo(
    () => collectAllVisiblePaths(visibleTree),
    [visibleTree],
  )

  // ── Ref to track previous state for focus retention ──────
  const prevFocusedPathRef = useRef<string | null>(null)
  const prevVisiblePathsRef = useRef<string[]>([])

  // ── Focus retention after tree refresh ───────────────────
  useEffect(() => {
    const prevFocused = prevFocusedPathRef.current

    prevFocusedPathRef.current = focusedPath
    prevVisiblePathsRef.current = visiblePaths

    // Only attempt retention if there was a previously focused path
    // and it disappeared from the new visible tree
    if (!prevFocused) return
    if (visiblePaths.includes(prevFocused)) {
      // Focused path still exists, ensure it's still set
      if (focusedPath !== prevFocused) {
        setFocusedPath(prevFocused)
      }
      return
    }

    // Focused path disappeared – fall back to nearest visible ancestor or first item
    const ancestor = findNearestVisibleAncestor(
      prevFocused,
      visiblePaths,
      rootEntries,
      entriesCache,
    )
    if (ancestor) {
      setFocusedPath(ancestor)
    } else if (visiblePaths.length > 0) {
      setFocusedPath(visiblePaths[0])
    } else {
      setFocusedPath(null)
    }
  }, [visiblePaths, rootEntries, entriesCache])

  const dismissMessages = useCallback(() => {
    setErrorMessage(null)
    setSuccessMessage(null)
    setLargeDirectoryWarning(false)
    setWarningMessage(null)
  }, [])

  const selectRootDirectory = useCallback(async () => {
    const fm = getFileManager()
    if (!fm) {
      setErrorMessage('文件管理器不可用（非 Electron 环境）')
      return
    }

    setBusyOperation('selecting-root')
    setErrorMessage(null)
    setSuccessMessage(null)
    setLargeDirectoryWarning(false)
    setWarningMessage(null)

    try {
      const result = await fm.selectRootDirectory()
      if (!result.ok) {
        setErrorMessage(`选择目录失败：${result.message}`)
        return
      }

      setRootPath(result.rootPath)
      setRootEntries(sortEntries(result.entries))
      setEntriesCache(new Map())
      setExpandedPaths(new Set())
      setSelectedPaths(new Set())
      setLastClickedPath(null)
      setFocusedPath(null)
      setSelectionAnchorPath(null)
      setClipboard(null)
      setLargeDirectoryWarning(false)
      setWarningMessage(null)

      // 持久化保存根目录路径
      const saveResult = await fm.saveLastRootDirectory({ rootPath: result.rootPath })
      if (!saveResult.ok) {
        setErrorMessage(`保存根目录失败：${saveResult.message}`)
      }

      // 两层规模探测
      setBusyOperation('probing')
      const probeResult = await fm.probeDirectory({ rootPath: result.rootPath })
      if (!probeResult.ok) {
        setErrorMessage(`目录探测失败：${probeResult.message}`)
        return
      }

      if (probeResult.isLarge) {
        const itemCount = probeResult.totalItems
        setLargeDirectoryWarning(true)
        setWarningMessage(
          `该目录包含超过 ${itemCount} 个项目（前 ${probeResult.maxDepth} 层），可能影响浏览性能。建议选择更具体的工作目录。`,
        )
      }
    } catch (err) {
      setErrorMessage(`操作异常：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusyOperation('idle')
    }
  }, [])

  const loadChildren = useCallback(async (directoryPath: string): Promise<boolean> => {
    const fm = getFileManager()
    if (!fm || !rootPath) return false

    // 已缓存则跳过
    if (entriesCache.has(directoryPath)) return true

    try {
      const result = await fm.listDirectory({
        rootPath,
        directoryPath,
      })

      if (!result.ok) {
        setErrorMessage(`读取目录失败：${result.message}`)
        return false
      }

      setEntriesCache((prev) => {
        const next = new Map(prev)
        next.set(directoryPath, sortEntries(result.entries))
        return next
      })
      return true
    } catch (err) {
      setErrorMessage(`读取目录异常：${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }, [rootPath, entriesCache])

  const toggleExpand = useCallback(async (directoryPath: string) => {
    const wasExpanded = expandedPaths.has(directoryPath)

    if (wasExpanded) {
      // 收起：从展开集合中移除
      setExpandedPaths((prev) => {
        const next = new Set(prev)
        next.delete(directoryPath)
        return next
      })
      return
    }

    // 展开：先加入展开集合
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      next.add(directoryPath)
      return next
    })

    // 如果尚未缓存，则懒加载子节点
    if (!entriesCache.has(directoryPath)) {
      setBusyOperation('loading-children')
      try {
        const loaded = await loadChildren(directoryPath)
        if (!loaded) {
          // 加载失败时回退展开状态，保证下一次点击可以直接重试展开
          setExpandedPaths((prev) => {
            const next = new Set(prev)
            next.delete(directoryPath)
            return next
          })
        }
      } finally {
        setBusyOperation('idle')
      }
    }
  }, [expandedPaths, entriesCache, loadChildren])

  const handleClick = useCallback(
    (path: string, kind: 'file' | 'directory', event: { ctrlKey: boolean; shiftKey: boolean; metaKey: boolean }) => {
      dismissMessages()

      const hasModifier = event.ctrlKey || event.shiftKey || event.metaKey

      if (event.ctrlKey || event.metaKey) {
        // Ctrl/Meta+点击：切换选中（不展开）
        setSelectedPaths((prev) => {
          const next = new Set(prev)
          if (next.has(path)) {
            next.delete(path)
          } else {
            next.add(path)
          }
          return next
        })
        setLastClickedPath(path)
        setFocusedPath(path)
        setSelectionAnchorPath(path)
        return
      }

      if (event.shiftKey && lastClickedPath) {
        // Shift+点击：区间选择（不展开）
        const allPaths = collectAllVisiblePaths(visibleTree)
        const startIdx = allPaths.indexOf(lastClickedPath)
        const endIdx = allPaths.indexOf(path)

        if (startIdx !== -1 && endIdx !== -1) {
          const rangeStart = Math.min(startIdx, endIdx)
          const rangeEnd = Math.max(startIdx, endIdx)
          const rangePaths = allPaths.slice(rangeStart, rangeEnd + 1)
          setSelectedPaths(new Set(rangePaths))
        }
        setFocusedPath(path)
        return
      }

      // 普通点击：单选
      setSelectedPaths(new Set([path]))
      setLastClickedPath(path)
      setFocusedPath(path)
      setSelectionAnchorPath(path)

      // 目录节点无修饰键点击 → 切换展开/收起
      if (kind === 'directory' && !hasModifier) {
        void toggleExpand(path)
      }
    },
    [visibleTree, lastClickedPath, dismissMessages, toggleExpand],
  )

  const handleDoubleClick = useCallback(
    async (path: string, kind: 'file' | 'directory') => {
      if (kind === 'directory') {
        await toggleExpand(path)
      }
      // 文件双击第一版不处理
    },
    [toggleExpand],
  )

  const clearSelection = useCallback(() => {
    setSelectedPaths(new Set())
    setLastClickedPath(null)
    setSelectionAnchorPath(null)
  }, [])

  const copySelected = useCallback(() => {
    if (!rootPath) return

    let sourcePaths: string[]
    if (selectedPaths.size > 0) {
      sourcePaths = [...selectedPaths]
    } else if (focusedPath) {
      sourcePaths = [focusedPath]
    } else {
      return
    }

    setClipboard({
      operation: 'copy',
      sourcePaths,
      sourceRoot: rootPath,
    })
    setSuccessMessage(`已复制 ${sourcePaths.length} 个项目`)
  }, [rootPath, selectedPaths, focusedPath])

  const cutSelected = useCallback(() => {
    if (!rootPath) return

    let sourcePaths: string[]
    if (selectedPaths.size > 0) {
      sourcePaths = [...selectedPaths]
    } else if (focusedPath) {
      sourcePaths = [focusedPath]
    } else {
      return
    }

    setClipboard({
      operation: 'cut',
      sourcePaths,
      sourceRoot: rootPath,
    })
    setSuccessMessage(`已剪切 ${sourcePaths.length} 个项目`)
  }, [rootPath, selectedPaths, focusedPath])

  /** Metadata passed by user-action handlers for post-hook emission. */
  interface PostOperationHookMeta {
    operation: NonNullable<FileWorkspaceObservedChange['operation']>
    entriesBeforeByDir: Map<string, FileTreeEntry[]>
  }

  const pasteEntries = useCallback(async (targetDirOverride?: string) => {
    const fm = getFileManager()
    if (!fm || !rootPath || !clipboard) return

    const targetDir = targetDirOverride ?? computeTargetDirectory(selectedPaths, focusedPath, entriesCache, rootEntries) ?? rootPath
    if (!targetDir) {
      setErrorMessage('请先选择目标目录')
      return
    }

    // Snapshot entriesBefore for target directory and (for cut) source parent directories
    const entriesBeforeByDir = new Map<string, FileTreeEntry[]>()
    entriesBeforeByDir.set(
      targetDir,
      targetDir === rootPath
        ? [...rootEntries]
        : [...(entriesCache.get(targetDir) ?? [])],
    )
    if (clipboard.operation === 'cut') {
      for (const srcPath of clipboard.sourcePaths) {
        const srcParent = getParentPathForRefresh(srcPath, rootPath)
        if (!entriesBeforeByDir.has(srcParent)) {
          entriesBeforeByDir.set(
            srcParent,
            srcParent === rootPath
              ? [...rootEntries]
              : [...(entriesCache.get(srcParent) ?? [])],
          )
        }
      }
    }

    const operationLabel = clipboard.operation === 'copy' ? 'copying' : 'moving'
    setBusyOperation(operationLabel)
    setErrorMessage(null)

    try {
      if (clipboard.operation === 'copy') {
        const result = await fm.copyEntries({
          rootPath,
          sourcePaths: clipboard.sourcePaths,
          destinationDirectory: targetDir,
          operationType: 'copy',
        })

        if (!result.ok) {
          setErrorMessage(`粘贴失败：${result.message}`)
          return
        }

        const hookMeta: PostOperationHookMeta = {
          operation: 'paste',
          entriesBeforeByDir,
        }
        handlePostOperationResult(result, hookMeta)
      } else {
        const result = await fm.moveEntries({
          rootPath,
          sourcePaths: clipboard.sourcePaths,
          destinationDirectory: targetDir,
        })

        if (!result.ok) {
          setErrorMessage(`移动失败：${result.message}`)
          return
        }

        const hookMeta: PostOperationHookMeta = {
          operation: 'paste',
          entriesBeforeByDir,
        }
        handlePostOperationResult(result, hookMeta)
        setClipboard(null)
      }
    } catch (err) {
      setErrorMessage(`粘贴异常：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusyOperation('idle')
    }
  }, [rootPath, clipboard, selectedPaths, focusedPath, entriesCache, rootEntries])

  const moveSelected = useCallback(async () => {
    const fm = getFileManager()
    if (!fm || !rootPath || selectedPaths.size === 0) return

    setBusyOperation('moving')
    setErrorMessage(null)

    try {
      const dirResult = await fm.selectRootDirectory()
      if (!dirResult.ok) {
        return
      }

      const targetDir = dirResult.rootPath
      const result = await fm.moveEntries({
        rootPath,
        sourcePaths: [...selectedPaths],
        destinationDirectory: targetDir,
      })

      if (!result.ok) {
        setErrorMessage(`移动失败：${result.message}`)
        return
      }

      handlePostOperationResult(result)
    } catch (err) {
      setErrorMessage(`移动异常：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusyOperation('idle')
    }
  }, [rootPath, selectedPaths])

  const startRename = useCallback((path: string) => {
    const entry = findEntryByPath(path, rootEntries, entriesCache)
    if (!entry) return
    setRenameTarget(path)
    setRenameValue(entry.name)
  }, [rootEntries, entriesCache])

  const commitRename = useCallback(async () => {
    const fm = getFileManager()
    if (!fm || !rootPath || !renameTarget || !renameValue.trim()) {
      setErrorMessage('名称不能为空')
      return
    }

    // Snapshot entriesBefore for the parent directory
    const parentPath = getParentPathForRefresh(renameTarget, rootPath)
    const entriesBefore =
      parentPath === rootPath
        ? [...rootEntries]
        : [...(entriesCache.get(parentPath) ?? [])]

    setBusyOperation('renaming')
    setErrorMessage(null)

    try {
      const result = await fm.renameEntry({
        rootPath,
        entryPath: renameTarget,
        newName: renameValue.trim(),
      })

      if (!result.ok) {
        setErrorMessage(`重命名失败：${result.message}`)
        return
      }

      const hookMeta: PostOperationHookMeta = {
        operation: 'rename',
        entriesBeforeByDir: new Map([[parentPath, entriesBefore]]),
      }
      handlePostOperationResult(result, hookMeta)
      setRenameTarget(null)
      setRenameValue('')
      setSuccessMessage('重命名成功')
    } catch (err) {
      setErrorMessage(`重命名异常：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusyOperation('idle')
    }
  }, [rootPath, renameTarget, renameValue, rootEntries, entriesCache])

  const cancelRename = useCallback(() => {
    setRenameTarget(null)
    setRenameValue('')
  }, [])

  const deleteSelected = useCallback(async () => {
    const fm = getFileManager()
    if (!fm || !rootPath) return

    // 优先使用选中集合，若无选中但有焦点项则删除焦点项
    let entryPaths: string[]
    if (selectedPaths.size > 0) {
      entryPaths = [...selectedPaths]
    } else if (focusedPath) {
      entryPaths = [focusedPath]
    } else {
      return
    }

    // Snapshot entriesBefore for each affected parent directory
    const affectedParents = new Set<string>()
    for (const p of entryPaths) {
      affectedParents.add(getParentPathForRefresh(p, rootPath))
    }
    const entriesBeforeByDir = new Map<string, FileTreeEntry[]>()
    for (const dirPath of affectedParents) {
      entriesBeforeByDir.set(
        dirPath,
        dirPath === rootPath
          ? [...rootEntries]
          : [...(entriesCache.get(dirPath) ?? [])],
      )
    }

    setBusyOperation('deleting')
    setErrorMessage(null)

    try {
      const result = await fm.trashEntries({
        rootPath,
        entryPaths,
      })

      if (result.ok) {
        const trashFallbackPaths = result.failedItems
          ?.filter((item) => item.reason.includes('回收站'))
          .map((item) => item.path) ?? []

        const hookMeta: PostOperationHookMeta = {
          operation: 'delete',
          entriesBeforeByDir,
        }
        handlePostOperationResult(result, hookMeta)

        if (trashFallbackPaths.length > 0) {
          setConfirmDeletePaths(trashFallbackPaths)
          if (result.affectedPaths.length > 0) {
            setSuccessMessage(
              `已将 ${result.affectedPaths.length} 个项目移入回收站，${trashFallbackPaths.length} 个项目需要确认永久删除`,
            )
          }
          return
        }

        if (result.failedItems && result.failedItems.length > 0) {
          setErrorMessage(
            `已将 ${result.affectedPaths.length} 个项目移入回收站，${result.failedItems.length} 个项目删除失败`,
          )
          return
        }

        setSuccessMessage(`已将 ${result.affectedPaths.length} 个项目移入回收站`)
        return
      }

      // 回收站不可用，触发二次确认永久删除
      if ((result as FileManagerError).code === 'trash_unavailable') {
        setConfirmDeletePaths(entryPaths)
        return
      }

      setErrorMessage(`删除失败：${result.message}`)
    } catch (err) {
      setErrorMessage(`删除异常：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusyOperation('idle')
    }
  }, [rootPath, selectedPaths, focusedPath, rootEntries, entriesCache])

  const confirmPermanentDelete = useCallback(async () => {
    const fm = getFileManager()
    if (!fm || !rootPath || confirmDeletePaths.length === 0) return

    setBusyOperation('deleting')
    setErrorMessage(null)
    const pathsToDelete = [...confirmDeletePaths]
    setConfirmDeletePaths([])

    // Snapshot entriesBefore for each affected parent directory
    const affectedParents = new Set<string>()
    for (const p of pathsToDelete) {
      affectedParents.add(getParentPathForRefresh(p, rootPath))
    }
    const entriesBeforeByDir = new Map<string, FileTreeEntry[]>()
    for (const dirPath of affectedParents) {
      entriesBeforeByDir.set(
        dirPath,
        dirPath === rootPath
          ? [...rootEntries]
          : [...(entriesCache.get(dirPath) ?? [])],
      )
    }

    try {
      const result = await fm.deleteEntriesPermanently({
        rootPath,
        entryPaths: pathsToDelete,
      })

      if (!result.ok) {
        setErrorMessage(`永久删除失败：${result.message}`)
        return
      }

      const hookMeta: PostOperationHookMeta = {
        operation: 'permanent-delete',
        entriesBeforeByDir,
      }
      handlePostOperationResult(result, hookMeta)
      setSuccessMessage(`已永久删除 ${pathsToDelete.length} 个项目`)
    } catch (err) {
      setErrorMessage(`永久删除异常：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusyOperation('idle')
    }
  }, [rootPath, confirmDeletePaths, rootEntries, entriesCache])

  const cancelPermanentDelete = useCallback(() => {
    setConfirmDeletePaths([])
  }, [])

  const createDirectory = useCallback(async (targetDirOverride?: string) => {
    const fm = getFileManager()
    if (!fm || !rootPath) return

    const parentPath = targetDirOverride ?? computeTargetDirectory(selectedPaths, focusedPath, entriesCache, rootEntries) ?? rootPath

    // Snapshot entriesBefore for post-hook
    const entriesBefore =
      parentPath === rootPath
        ? [...rootEntries]
        : [...(entriesCache.get(parentPath) ?? [])]

    setBusyOperation('creating-directory')
    setErrorMessage(null)

    try {
      const result = await fm.createDirectory({
        rootPath,
        parentPath,
        name: '新建文件夹',
      })

      if (!result.ok) {
        setErrorMessage(`新建文件夹失败：${result.message}`)
        return
      }

      const hookMeta: PostOperationHookMeta = {
        operation: 'create-directory',
        entriesBeforeByDir: new Map([[parentPath, entriesBefore]]),
      }
      handlePostOperationResult(result, hookMeta)
      setSuccessMessage('已创建新文件夹')

      // 如果父目录在展开列表中，刷新其子节点；刷新失败不应形成未处理的 Promise rejection。
      void refreshParentDirectory(parentPath).catch(() => {})
    } catch (err) {
      setErrorMessage(`新建文件夹异常：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusyOperation('idle')
    }
  }, [rootPath, selectedPaths, focusedPath, entriesCache, rootEntries])

  const refreshCurrent = useCallback(async () => {
    if (!rootPath) return

    setBusyOperation('refreshing')
    setErrorMessage(null)

    try {
      const fm = getFileManager()
      if (!fm) return

      // 刷新根目录
      const result = await fm.listDirectory({
        rootPath,
        directoryPath: rootPath,
      })

      if (!result.ok) {
        setErrorMessage(`刷新失败：${result.message}`)
        return
      }

      setRootEntries(sortEntries(result.entries))

      // 刷新所有已展开的目录
      const refreshedCache = new Map(entriesCache)
      for (const expandedPath of expandedPaths) {
        const childResult = await fm.listDirectory({
          rootPath,
          directoryPath: expandedPath,
        })
        if (childResult.ok) {
          refreshedCache.set(expandedPath, sortEntries(childResult.entries))
        }
      }
      setEntriesCache(refreshedCache)
      setSuccessMessage('已刷新')
    } catch (err) {
      setErrorMessage(`刷新异常：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusyOperation('idle')
    }
  }, [rootPath, expandedPaths, entriesCache])

  // 操作后刷新受影响的父目录
  const handlePostOperationResult = useCallback(
    (
      result: { ok: true; affectedPaths: string[] },
      hookMeta?: PostOperationHookMeta,
    ) => {
      if (!rootPath) return

      // 收集受影响的父目录
      const affectedParents = new Set<string>()
      for (const path of result.affectedPaths) {
        affectedParents.add(getParentPathForRefresh(path, rootPath))
      }

      // 清空选中
      setSelectedPaths(new Set())

      // 异步刷新受影响的父目录
      void (async () => {
        try {
          const fm = getFileManager()
          if (!fm) return

          const entriesAfterByDir = new Map<string, FileTreeEntry[]>()

          // 刷新根目录
          if (affectedParents.has(rootPath)) {
            const rootResult = await fm.listDirectory({ rootPath, directoryPath: rootPath })
            if (rootResult?.ok) {
              setRootEntries(sortEntries(rootResult.entries))
              entriesAfterByDir.set(rootPath, sortEntries(rootResult.entries))
            }
          }

          // 刷新其他受影响的目录
          const refreshedEntriesByDir = new Map<string, FileTreeEntry[]>()
          for (const parentPath of affectedParents) {
            if (parentPath === rootPath) continue
            const childResult = await fm.listDirectory({ rootPath, directoryPath: parentPath })
            if (childResult?.ok) {
              const sorted = sortEntries(childResult.entries)
              refreshedEntriesByDir.set(parentPath, sorted)
              entriesAfterByDir.set(parentPath, sorted)
            }
          }
          if (refreshedEntriesByDir.size > 0) {
            setEntriesCache((prev) => {
              const nextCache = new Map(prev)
              for (const [parentPath, entries] of refreshedEntriesByDir) {
                nextCache.set(parentPath, entries)
              }
              return nextCache
            })
          }

          // Emit post-hook events for each refreshed directory
          if (hookMeta) {
            for (const dirPath of affectedParents) {
              const entriesBefore =
                hookMeta.entriesBeforeByDir.get(dirPath) ?? []
              const entriesAfter = entriesAfterByDir.get(dirPath)
              if (entriesAfter === undefined) continue

              const observedChange = buildObservedChange({
                rootPath,
                directoryPath: dirPath,
                source: 'user-action',
                operation: hookMeta.operation,
                entriesBefore,
                entriesAfter,
              })
              const semanticChanges = inferSemanticChanges(observedChange)
              runFileWorkspacePostChangeHooks({
                observedChange,
                semanticChanges,
              })
            }
          }
        } catch {
          // 静默处理刷新失败
        }
      })()
    },
    [rootPath],
  )

  const refreshParentDirectory = useCallback(
    async (parentPath: string) => {
      const fm = getFileManager()
      if (!fm || !rootPath) return

      try {
        const result = await fm.listDirectory({ rootPath, directoryPath: parentPath })
        if (!result.ok) return

        if (parentPath === rootPath) {
          setRootEntries(sortEntries(result.entries))
        } else {
          setEntriesCache((prev) => {
            const next = new Map(prev)
            next.set(parentPath, sortEntries(result.entries))
            return next
          })
        }
      } catch {
        // 静默处理操作后的辅助刷新失败，避免 fire-and-forget 调用产生未处理 rejection。
      }
    },
    [rootPath],
  )

  // ── 系统操作 ──────────────────────────────────────────────

  /** 获取当前操作目标路径（contextMenu > focusedPath > 单选） */
  const resolveActionTargetPath = useCallback((): string | null => {
    if (contextMenu?.targetPath) return contextMenu.targetPath
    if (focusedPath) return focusedPath
    if (selectedPaths.size === 1) {
      const [single] = selectedPaths
      return single
    }
    return null
  }, [contextMenu, focusedPath, selectedPaths])

  const openEntryWithSystem = useCallback(async () => {
    const fm = getFileManager()
    const targetPath = resolveActionTargetPath()
    if (!fm || !targetPath) return

    setErrorMessage(null)
    try {
      const result = await fm.openEntryWithSystem({ path: targetPath })
      if (!result.ok) {
        setErrorMessage(`系统打开失败：${result.message}`)
        return
      }
      setSuccessMessage('已通过系统方式打开')
    } catch (err) {
      setErrorMessage(`系统打开异常：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [resolveActionTargetPath])

  const revealEntryInFolder = useCallback(async () => {
    const fm = getFileManager()
    const targetPath = resolveActionTargetPath()
    if (!fm || !targetPath) return

    setErrorMessage(null)
    try {
      const result = await fm.revealEntryInFolder({ path: targetPath })
      if (!result.ok) {
        setErrorMessage(`在资源管理器中显示失败：${result.message}`)
        return
      }
      setSuccessMessage('已在文件资源管理器中显示')
    } catch (err) {
      setErrorMessage(`在资源管理器中显示异常：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [resolveActionTargetPath])

  const copyPathToClipboard = useCallback(async () => {
    const fm = getFileManager()
    const targetPath = resolveActionTargetPath()
    if (!fm || !targetPath) return

    setErrorMessage(null)
    try {
      const result = await fm.copyTextToClipboard({ text: targetPath })
      if (!result.ok) {
        setErrorMessage(`复制路径失败：${result.message}`)
        return
      }
      setSuccessMessage('已复制路径')
    } catch (err) {
      setErrorMessage(`复制路径异常：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [resolveActionTargetPath])

  const copyRelativePathToClipboard = useCallback(async () => {
    const fm = getFileManager()
    const targetPath = resolveActionTargetPath()
    if (!fm || !rootPath || !targetPath) return

    setErrorMessage(null)

    // 计算相对路径
    let relativePath: string
    if (targetPath === rootPath) {
      relativePath = '.'
    } else {
      // 确保 targetPath 在 rootPath 下
      const normalizedRoot = rootPath.replace(/\\/g, '/').replace(/\/+$/, '')
      const normalizedTarget = targetPath.replace(/\\/g, '/')
      if (!normalizedTarget.startsWith(normalizedRoot + '/') && normalizedTarget !== normalizedRoot) {
        setErrorMessage('无法计算相对路径：目标不在当前工作目录下')
        return
      }
      relativePath = normalizedTarget.slice(normalizedRoot.length + 1)
    }

    try {
      const result = await fm.copyTextToClipboard({ text: relativePath })
      if (!result.ok) {
        setErrorMessage(`复制相对路径失败：${result.message}`)
        return
      }
      setSuccessMessage(`已复制相对路径：${relativePath}`)
    } catch (err) {
      setErrorMessage(`复制相对路径异常：${err instanceof Error ? err.message : String(err)}`)
    }
  }, [resolveActionTargetPath, rootPath])

  // ── 右键菜单 ──────────────────────────────────────────────
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, path: string | null, kind: 'file' | 'directory' | null) => {
      e.preventDefault()
      e.stopPropagation()

      // Windows 风格右键选择规则
      if (path !== null) {
        if (!selectedPaths.has(path)) {
          // 右键未选中节点 → 切换为单选
          setSelectedPaths(new Set([path]))
          setLastClickedPath(path)
          setFocusedPath(path)
          setSelectionAnchorPath(path)
        }
        // 右键已选中节点 → 保留当前多选集合不变
      }

      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        targetPath: path,
        targetKind: kind,
      })
    },
    [selectedPaths],
  )

  const hideContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  // ── 拖拽移动 ──────────────────────────────────────────────
  const handleDragStart = useCallback(
    (e: React.DragEvent, path: string) => {
      // 如果拖拽节点不在选中集合中，先单选
      if (!selectedPaths.has(path)) {
        setSelectedPaths(new Set([path]))
        setLastClickedPath(path)
        setFocusedPath(path)
        setSelectionAnchorPath(path)
      }

      // 设置拖拽数据
      const sourcePaths = selectedPaths.has(path) ? [...selectedPaths] : [path]
      e.dataTransfer.setData('text/plain', JSON.stringify(sourcePaths))
      e.dataTransfer.effectAllowed = 'move'
    },
    [selectedPaths],
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent, path: string) => {
      e.preventDefault()
      e.stopPropagation()

      const rejectDrop = () => {
        e.dataTransfer.dropEffect = 'none'
        setDragOverPath(null)
      }

      // 只允许拖放到文件夹节点
      const entry = findEntryByPath(path, rootEntries, entriesCache)
      if (!entry || entry.kind !== 'directory') {
        rejectDrop()
        return
      }

      // 不允许拖放到自身或子目录（最终仍由主进程兜底校验）
      const sourcePaths = readDragSourcePaths(e.dataTransfer)
      if (sourcePaths !== null && !canDropOnDirectory(sourcePaths, path, rootEntries, entriesCache)) {
        rejectDrop()
        return
      }

      e.dataTransfer.dropEffect = 'move'
      setDragOverPath(path)
    },
    [rootEntries, entriesCache],
  )

  const handleDragLeave = useCallback((_e: React.DragEvent) => {
    setDragOverPath(null)
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent, targetPath: string) => {
      e.preventDefault()
      e.stopPropagation()
      setDragOverPath(null)

      const fm = getFileManager()
      if (!fm || !rootPath) return

      let sourcePaths: string[] = []
      try {
        sourcePaths = JSON.parse(e.dataTransfer.getData('text/plain'))
      } catch {
        return
      }

      if (sourcePaths.length === 0) return

      if (!canDropOnDirectory(sourcePaths, targetPath, rootEntries, entriesCache)) {
        setErrorMessage('不能将项目移动到自身或其子目录中')
        return
      }

      // Snapshot entriesBefore for target directory and all source parent directories
      const entriesBeforeByDir = new Map<string, FileTreeEntry[]>()
      entriesBeforeByDir.set(
        targetPath,
        targetPath === rootPath
          ? [...rootEntries]
          : [...(entriesCache.get(targetPath) ?? [])],
      )
      for (const srcPath of sourcePaths) {
        const srcParent = getParentPathForRefresh(srcPath, rootPath)
        if (!entriesBeforeByDir.has(srcParent)) {
          entriesBeforeByDir.set(
            srcParent,
            srcParent === rootPath
              ? [...rootEntries]
              : [...(entriesCache.get(srcParent) ?? [])],
          )
        }
      }

      setBusyOperation('moving')
      setErrorMessage(null)

      try {
        const result = await fm.moveEntries({
          rootPath,
          sourcePaths,
          destinationDirectory: targetPath,
        })

        if (!result.ok) {
          setErrorMessage(`移动失败：${result.message}`)
          return
        }

        const hookMeta: PostOperationHookMeta = {
          operation: 'drag-move',
          entriesBeforeByDir,
        }
        handlePostOperationResult(result, hookMeta)
        setSuccessMessage(`已移动 ${sourcePaths.length} 个项目`)
      } catch (err) {
        setErrorMessage(`移动异常：${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setBusyOperation('idle')
      }
    },
    [rootPath, rootEntries, entriesCache, handlePostOperationResult],
  )

  const handleDragEnd = useCallback(() => {
    setDragOverPath(null)
  }, [])

  // ── 持久化根目录恢复 ────────────────────────────────────
  const loadRootDirectory = useCallback(async () => {
    const fm = getFileManager()
    if (!fm) return

    try {
      const result = await fm.loadLastRootDirectory()
      if (!result.ok || !result.rootPath) {
        // 无持久化路径或读取失败，保持空状态
        return
      }

      // 尝试探测持久化路径是否仍然可读
      setBusyOperation('probing')
      const probeResult = await fm.probeDirectory({ rootPath: result.rootPath })
      if (!probeResult.ok) {
        // 路径不存在或不可读，清理持久化
        void fm.clearLastRootDirectory().catch(() => {})
        setErrorMessage(`上次工作目录不可用：${probeResult.message}`)
        return
      }

      // 路径可用，加载根目录直接子项
      const listResult = await fm.listDirectory({
        rootPath: result.rootPath,
        directoryPath: result.rootPath,
      })

      if (!listResult.ok) {
        void fm.clearLastRootDirectory().catch(() => {})
        setErrorMessage(`无法读取上次工作目录：${listResult.message}`)
        return
      }

      setRootPath(result.rootPath)
      setRootEntries(sortEntries(listResult.entries))
      setEntriesCache(new Map())
      setExpandedPaths(new Set())
      setSelectedPaths(new Set())
      setLastClickedPath(null)
      setFocusedPath(null)
      setSelectionAnchorPath(null)
      setClipboard(null)
      setLargeDirectoryWarning(false)
      setSuccessMessage(null)
      setWarningMessage(null)

      if (probeResult.isLarge) {
        setLargeDirectoryWarning(true)
        setWarningMessage(
          `该目录包含超过 ${probeResult.totalItems} 个项目（前 ${probeResult.maxDepth} 层），可能影响浏览性能。`,
        )
      }
    } catch (err) {
      setErrorMessage(`恢复工作目录异常：${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setBusyOperation('idle')
    }
  }, [])

  // ── 目录刷新辅助（供 watcher 调用） ────────────────────
  const refreshDirectoryPath = useCallback(
    async (
      directoryPath: string,
      entriesBefore?: FileTreeEntry[],
      rawEvent?: { eventType?: 'rename' | 'change' | 'unknown'; filename?: string },
    ) => {
      const fm = getFileManager()
      if (!fm || !rootPath) return

      try {
        const result = await fm.listDirectory({ rootPath, directoryPath })
        if (!result.ok) return

        const entriesAfter = sortEntries(result.entries)

        if (directoryPath === rootPath) {
          setRootEntries(entriesAfter)
        } else {
          setEntriesCache((prev) => {
            const next = new Map(prev)
            next.set(directoryPath, entriesAfter)
            return next
          })
        }

        // Emit watcher post-hook event
        if (entriesBefore) {
          const observedChange = buildObservedChange({
            rootPath,
            directoryPath,
            source: 'filesystem-watch',
            operation: 'watch-refresh',
            rawEventType: rawEvent?.eventType,
            changedFilename: rawEvent?.filename,
            entriesBefore,
            entriesAfter,
          })
          const semanticChanges = inferSemanticChanges(observedChange)
          runFileWorkspacePostChangeHooks({
            observedChange,
            semanticChanges,
          })
        }
      } catch {
        // 静默处理刷新失败
      }
    },
    [rootPath],
  )

  // ═══════════════════════════════════════════════════════════
  // ── 键盘导航 ──────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════

  /**
   * 判断键盘事件是否应被文件树拦截处理。
   * 排除：重命名输入框、确认对话框、右键菜单打开中、繁忙操作中。
   */
  const shouldHandleTreeKeyboard = useCallback((): boolean => {
    if (renameTarget !== null) return false
    if (confirmDeletePaths.length > 0) return false
    if (contextMenu !== null) return false
    if (busyOperation !== 'idle') return false
    if (visiblePaths.length === 0) return false
    return true
  }, [renameTarget, confirmDeletePaths, contextMenu, busyOperation, visiblePaths])

  /** 移动焦点：方向 + 是否扩展选择 + 是否只移动焦点 (Ctrl) */
  const moveFocusVertical = useCallback(
    (direction: 'up' | 'down', extendSelection: boolean, focusOnly: boolean) => {
      if (visiblePaths.length === 0) return

      const currentIdx = focusedPath ? visiblePaths.indexOf(focusedPath) : -1
      let newIdx: number

      if (currentIdx === -1) {
        // 无焦点：从首个可见项开始
        newIdx = 0
      } else if (direction === 'up') {
        newIdx = Math.max(0, currentIdx - 1)
      } else {
        newIdx = Math.min(visiblePaths.length - 1, currentIdx + 1)
      }

      const newPath = visiblePaths[newIdx]
      setFocusedPath(newPath)

      if (focusOnly) {
        // Ctrl+方向键：只移动焦点，不改变选中集合
        return
      }

      if (extendSelection) {
        // Shift+方向键：从锚点扩展到新焦点
        const anchor = selectionAnchorPath ?? focusedPath ?? newPath
        const anchorIdx = visiblePaths.indexOf(anchor)
        if (anchorIdx !== -1) {
          const rangeStart = Math.min(anchorIdx, newIdx)
          const rangeEnd = Math.max(anchorIdx, newIdx)
          setSelectedPaths(new Set(visiblePaths.slice(rangeStart, rangeEnd + 1)))
        }
      } else {
        // 普通方向键：单选新焦点项
        setSelectedPaths(new Set([newPath]))
        setLastClickedPath(newPath)
        setSelectionAnchorPath(newPath)
      }
    },
    [visiblePaths, focusedPath, selectionAnchorPath],
  )

  /** ArrowRight: Windows 风格展开/进入 */
  const handleArrowRight = useCallback(() => {
    if (!focusedPath || visiblePaths.length === 0) return

    const node = visibleTree.find((n) => n.entry.path === focusedPath)
    if (!node) return

    if (node.entry.kind === 'directory') {
      const isExpanded = expandedPaths.has(focusedPath)
      if (!isExpanded) {
        // 未展开 → 展开
        void toggleExpand(focusedPath)
      } else {
        // 已展开且有可见子项 → 焦点移到第一个子项
        const currentIdx = visiblePaths.indexOf(focusedPath)
        if (currentIdx < visiblePaths.length - 1) {
          const nextPath = visiblePaths[currentIdx + 1]
          // 确保下一项确实是子节点（深度更大）
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
    // 文件：无动作
  }, [focusedPath, visiblePaths, visibleTree, expandedPaths, toggleExpand])

  /** ArrowLeft: Windows 风格收起/回父级 */
  const handleArrowLeft = useCallback(() => {
    if (!focusedPath || visiblePaths.length === 0) return

    const node = visibleTree.find((n) => n.entry.path === focusedPath)
    if (!node) return

    if (node.entry.kind === 'directory' && expandedPaths.has(focusedPath)) {
      // 已展开文件夹 → 收起
      void toggleExpand(focusedPath)
      return
    }

    // 收起文件夹或文件 → 移动到父节点
    if (node.entry.parentPath && visiblePaths.includes(node.entry.parentPath)) {
      setFocusedPath(node.entry.parentPath)
      setSelectedPaths(new Set([node.entry.parentPath]))
      setLastClickedPath(node.entry.parentPath)
      setSelectionAnchorPath(node.entry.parentPath)
    }
    // 根层无动作
  }, [focusedPath, visiblePaths, visibleTree, expandedPaths, toggleExpand])

  /** Enter: 文件夹展开/收起，文件不打开 */
  const handleEnter = useCallback(() => {
    if (!focusedPath) return

    const entry = findEntryByPath(focusedPath, rootEntries, entriesCache)
    if (entry && entry.kind === 'directory') {
      void toggleExpand(focusedPath)
    }
    // 文件不打开
  }, [focusedPath, rootEntries, entriesCache, toggleExpand])

  /** Space: 切换焦点项选中状态 */
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
    // Space 不移动焦点，但更新锚点
    setSelectionAnchorPath(focusedPath)
  }, [focusedPath])

  /** 主体键盘事件处理 */
  const handleTreeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!shouldHandleTreeKeyboard()) return

      const ctrl = e.ctrlKey || e.metaKey

      switch (e.key) {
        case 'ArrowUp': {
          e.preventDefault()
          e.stopPropagation()
          if (e.shiftKey) {
            moveFocusVertical('up', true, false)
          } else if (ctrl) {
            moveFocusVertical('up', false, true)
          } else {
            moveFocusVertical('up', false, false)
          }
          break
        }

        case 'ArrowDown': {
          e.preventDefault()
          e.stopPropagation()
          if (e.shiftKey) {
            moveFocusVertical('down', true, false)
          } else if (ctrl) {
            moveFocusVertical('down', false, true)
          } else {
            moveFocusVertical('down', false, false)
          }
          break
        }

        case 'ArrowRight': {
          e.preventDefault()
          e.stopPropagation()
          handleArrowRight()
          break
        }

        case 'ArrowLeft': {
          e.preventDefault()
          e.stopPropagation()
          handleArrowLeft()
          break
        }

        case 'Enter': {
          e.preventDefault()
          e.stopPropagation()
          handleEnter()
          break
        }

        case ' ': {
          e.preventDefault()
          e.stopPropagation()
          toggleFocusedSelection()
          break
        }

        case 'Delete': {
          e.preventDefault()
          e.stopPropagation()
          void deleteSelected()
          break
        }

        case 'F2': {
          e.preventDefault()
          e.stopPropagation()
          if (focusedPath) {
            startRename(focusedPath)
          } else if (selectedPaths.size === 1) {
            const [single] = selectedPaths
            startRename(single)
          }
          break
        }

        case 'c':
        case 'C': {
          if (ctrl) {
            e.preventDefault()
            e.stopPropagation()
            copySelected()
          }
          break
        }

        case 'x':
        case 'X': {
          if (ctrl) {
            e.preventDefault()
            e.stopPropagation()
            cutSelected()
          }
          break
        }

        case 'v':
        case 'V': {
          if (ctrl) {
            e.preventDefault()
            e.stopPropagation()
            void pasteEntries()
          }
          break
        }

        default:
          break
      }
    },
    [
      shouldHandleTreeKeyboard,
      moveFocusVertical,
      handleArrowRight,
      handleArrowLeft,
      handleEnter,
      toggleFocusedSelection,
      deleteSelected,
      focusedPath,
      selectedPaths,
      startRename,
      copySelected,
      cutSelected,
      pasteEntries,
    ],
  )

  return {
    rootPath,
    rootEntries,
    visibleTree,
    selectedPaths,
    lastClickedPath,
    focusedPath,
    selectionAnchorPath,
    clipboard,
    busyOperation,
    errorMessage,
    successMessage,
    warningMessage,
    renameTarget,
    renameValue,
    confirmDeletePaths,
    largeDirectoryWarning,
    expandedPaths,
    entriesCache,
    dragOverPath,
    contextMenu,
    selectRootDirectory,
    toggleExpand,
    handleClick,
    handleDoubleClick,
    clearSelection,
    copySelected,
    cutSelected,
    pasteEntries,
    moveSelected,
    startRename,
    commitRename,
    cancelRename,
    setRenameValue,
    deleteSelected,
    confirmPermanentDelete,
    cancelPermanentDelete,
    createDirectory,
    refreshCurrent,
    dismissMessages,
    openEntryWithSystem,
    revealEntryInFolder,
    copyPathToClipboard,
    copyRelativePathToClipboard,
    handleContextMenu,
    hideContextMenu,
    handleDragStart,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleDragEnd,
    loadRootDirectory,
    refreshDirectoryPath,
    handleTreeKeyDown,
  }
}
