import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { DirectoryChangedEvent, FileManagerApi } from '../../../electron/file-manager/ipc'
import { ConfirmDialog } from './ConfirmDialog'
import { ContextMenu, buildContextMenuItems } from './ContextMenu'
import { FileToolbar } from './FileToolbar'
import { FileTree } from './FileTree'
import { useFileManagerState } from './useFileManagerState'

/** 获取 fileManager bridge（仅 Electron 环境可用） */
function getFileManager() {
  if (typeof window === 'undefined' || !window.fileManager) return null
  return window.fileManager
}

/** 计算当前需要监听的目录集合 */
function computeWatchedDirectories(
  rootPath: string | null,
  expandedPaths: Set<string>,
): string[] {
  if (!rootPath) return []
  const paths = [rootPath]
  for (const expandedPath of expandedPaths) {
    if (expandedPath !== rootPath) {
      paths.push(expandedPath)
    }
  }
  return paths
}

export function syncWatchedDirectories(
  fm: Pick<FileManagerApi, 'watchDirectories' | 'unwatchDirectories'>,
  previousPaths: string[],
  paths: string[],
): void {
  if (paths.length === 0) {
    if (previousPaths.length > 0) {
      void fm.unwatchDirectories({ paths: previousPaths }).catch(() => {
        // 静默处理监听清理失败
      })
    }
    return
  }

  void fm.watchDirectories({ paths }).catch(() => {
    // 静默处理监听注册失败
  })
}

export function FilesWorkspace() {
  const state = useFileManagerState()
  const latestStateRef = useRef(state)
  latestStateRef.current = state

  // ── 持久化恢复：挂载时自动加载上次根目录 ──────────────
  const hasAttemptedRestore = useRef(false)

  useEffect(() => {
    if (hasAttemptedRestore.current) return
    hasAttemptedRestore.current = true
    void state.loadRootDirectory()
  }, [state.loadRootDirectory])

  // ── Watcher 目录集合同步 ──────────────────────────────
  const watchedPathsRef = useRef<string[]>([])

  useEffect(() => {
    const fm = getFileManager()
    if (!fm) return

    const paths = computeWatchedDirectories(state.rootPath, state.expandedPaths)

    // 仅在路径集合变化时同步
    const prevSet = new Set(watchedPathsRef.current)
    const nextSet = new Set(paths)
    const hasChanged =
      prevSet.size !== nextSet.size ||
      [...prevSet].some((p) => !nextSet.has(p))

    if (!hasChanged) return

    const previousPaths = watchedPathsRef.current
    watchedPathsRef.current = paths
    syncWatchedDirectories(fm, previousPaths, paths)
  }, [state.rootPath, state.expandedPaths])

  // ── 目录变化事件订阅 + debounce 刷新 ────────────────
  const debounceTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const flushDebounceTimers = useCallback(() => {
    for (const timer of debounceTimersRef.current.values()) {
      clearTimeout(timer)
    }
    debounceTimersRef.current.clear()
  }, [])

  useEffect(() => {
    const fm = getFileManager()
    if (!fm) return

    const unsubscribe = fm.onDirectoryChanged((event: DirectoryChangedEvent) => {
      const dirPath = event.directoryPath

      // 清除该目录已有的 debounce 定时器
      const existing = debounceTimersRef.current.get(dirPath)
      if (existing) {
        clearTimeout(existing)
      }

      // 设置新的 debounce（300ms）
      const timer = setTimeout(() => {
        debounceTimersRef.current.delete(dirPath)

        // 刷新受影响的分支
        void (async () => {
          try {
            // Snapshot entriesBefore from latest state without recreating the subscription.
            const latestState = latestStateRef.current
            const entriesBefore =
              dirPath === latestState.rootPath
                ? [...latestState.rootEntries]
                : [...(latestState.entriesCache.get(dirPath) ?? [])]

            await latestState.refreshDirectoryPath(dirPath, entriesBefore, {
              eventType: event.eventType,
              filename: event.filename,
            })
          } catch {
            // 静默处理
          }
        })()
      }, 300)

      debounceTimersRef.current.set(dirPath, timer)
    })

    return () => {
      unsubscribe()
      flushDebounceTimers()

      // 清理 watcher
      if (watchedPathsRef.current.length > 0) {
        void fm.unwatchDirectories({ paths: watchedPathsRef.current }).catch(() => {})
      }
    }
  }, [flushDebounceTimers])

  // ── 组件卸载时清理 debounce 定时器 ────────────────────
  useEffect(() => {
    return () => {
      flushDebounceTimers()
    }
  }, [flushDebounceTimers])

  // ── 切根时清理 watcher 订阅（在 rootPath 变化时由上述 effect 自动处理） ──

  // 用于判断剪贴板中的哪些路径在当前视图中可见（用于剪切样式提示）
  const clipboardPathSet = useMemo(() => {
    if (!state.clipboard || state.clipboard.operation !== 'cut') {
      return new Set<string>()
    }
    return new Set(state.clipboard.sourcePaths)
  }, [state.clipboard])

  // 右键菜单项
  const contextMenuItems = useMemo(() => {
    if (!state.contextMenu) return []

    const isExpanded =
      state.contextMenu.targetPath !== null
        ? state.expandedPaths.has(state.contextMenu.targetPath)
        : false

    return buildContextMenuItems({
      targetKind: state.contextMenu.targetKind,
      targetPath: state.contextMenu.targetPath,
      isExpanded,
      selectedPaths: state.selectedPaths,
      clipboard: state.clipboard,
      busyOperation: state.busyOperation,
      onToggleExpand: state.contextMenu.targetPath
        ? () => {
            void state.toggleExpand(state.contextMenu!.targetPath!)
          }
        : undefined,
      onOpenWithSystem: () => {
        void state.openEntryWithSystem()
      },
      onRevealInFolder: () => {
        void state.revealEntryInFolder()
      },
      onCopyPath: () => {
        void state.copyPathToClipboard()
      },
      onCopyRelativePath: () => {
        void state.copyRelativePathToClipboard()
      },
      onCopy: state.copySelected,
      onCut: state.cutSelected,
      onPaste: (targetDir?: string) => {
        void state.pasteEntries(targetDir)
      },
      onNewFolder: (targetDir?: string) => {
        void state.createDirectory(targetDir)
      },
      onRename: () => {
        const targetPath =
          state.contextMenu?.targetPath ?? [...state.selectedPaths][0]
        if (targetPath) {
          state.startRename(targetPath)
        }
      },
      onDelete: () => {
        void state.deleteSelected()
      },
      onRefresh: () => {
        void state.refreshCurrent()
      },
    })
  }, [state])

  return (
    <>
      <section className="workspace-stage file-workspace" aria-label="文件工作区">
        <FileToolbar
          rootPath={state.rootPath}
          busyOperation={state.busyOperation}
          onSelectRootDirectory={state.selectRootDirectory}
        />

        <div className="file-workspace__body">
          <aside className="workspace-panel file-panel" aria-label="文件树面板">
            <FileTree
              visibleTree={state.visibleTree}
              selectedPaths={state.selectedPaths}
              expandedPaths={state.expandedPaths}
              focusedPath={state.focusedPath}
              clipboardPaths={clipboardPathSet}
              renameTarget={state.renameTarget}
              renameValue={state.renameValue}
              dragOverPath={state.dragOverPath}
              onToggleExpand={state.toggleExpand}
              onClick={state.handleClick}
              onDoubleClick={state.handleDoubleClick}
              onRenameValueChange={state.setRenameValue}
              onCommitRename={state.commitRename}
              onCancelRename={state.cancelRename}
              onClearSelection={state.clearSelection}
              onContextMenu={state.handleContextMenu}
              onDragStart={state.handleDragStart}
              onDragOver={state.handleDragOver}
              onDragLeave={state.handleDragLeave}
              onDrop={state.handleDrop}
              onDragEnd={state.handleDragEnd}
              onTreeKeyDown={state.handleTreeKeyDown}
            />
          </aside>

          <main className="workspace-main file-main" aria-label="文件主区域">
            <header className="workspace-main__header file-main__header">
              <div>
                <p className="workspace-main__eyebrow">文件管理</p>
                <h2 className="workspace-main__title">
                  {state.rootPath
                    ? state.rootPath.split(/[/\\]/).pop() || state.rootPath
                    : '文件工作区'}
                </h2>
              </div>
            </header>

            <section className="workspace-main__content file-main__content">
              <div className="file-main__placeholder">
                <p className="file-main__placeholder-text">
                  {state.rootPath
                    ? '选择左侧文件或文件夹进行管理'
                    : '点击「选择文件夹」开始浏览本地文件'}
                </p>
              </div>
            </section>
          </main>
        </div>

        {/* 消息提示 */}
        {state.errorMessage && (
          <div className="file-toast file-toast--error" role="alert">
            <span>{state.errorMessage}</span>
            <button
              type="button"
              className="file-toast__dismiss"
              onClick={state.dismissMessages}
              aria-label="关闭"
            >
              ×
            </button>
          </div>
        )}

        {state.successMessage && !state.errorMessage && (
          <div className="file-toast file-toast--success" role="status">
            <span>{state.successMessage}</span>
            <button
              type="button"
              className="file-toast__dismiss"
              onClick={state.dismissMessages}
              aria-label="关闭"
            >
              ×
            </button>
          </div>
        )}

        {state.largeDirectoryWarning && (
          <div className="file-toast file-toast--warning" role="alert">
            <span>{state.warningMessage ?? '当前目录较大，可能影响浏览性能。建议选择更具体的工作目录。'}</span>
            <button
              type="button"
              className="file-toast__dismiss"
              onClick={state.dismissMessages}
              aria-label="关闭"
            >
              ×
            </button>
          </div>
        )}

        {/* 右键菜单 */}
        {state.contextMenu && (
          <ContextMenu
            x={state.contextMenu.x}
            y={state.contextMenu.y}
            items={contextMenuItems}
            onClose={state.hideContextMenu}
          />
        )}
      </section>

      <ConfirmDialog
        open={state.confirmDeletePaths.length > 0}
        title="永久删除确认"
        message={`回收站不可用，将永久删除 ${state.confirmDeletePaths.length} 个项目。此操作不可撤销，确定继续？`}
        confirmLabel="永久删除"
        cancelLabel="取消"
        danger
        onConfirm={state.confirmPermanentDelete}
        onCancel={state.cancelPermanentDelete}
      />
    </>
  )
}
