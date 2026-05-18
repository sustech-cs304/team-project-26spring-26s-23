import { useCallback, useMemo, type ReactNode } from 'react'
import {
  ChevronRight,
  File,
  Folder,
  FolderOpen,
} from 'lucide-react'
import type { VisibleTreeNode } from './types'

interface FileTreeProps {
  visibleTree: VisibleTreeNode[]
  selectedPaths: Set<string>
  expandedPaths: Set<string>
  focusedPath: string | null
  clipboardPaths: Set<string>
  renameTarget: string | null
  renameValue: string
  dragOverPath: string | null
  onToggleExpand: (path: string) => Promise<void>
  onClick: (path: string, kind: 'file' | 'directory', event: { ctrlKey: boolean; shiftKey: boolean; metaKey: boolean }) => void
  onDoubleClick: (path: string, kind: 'file' | 'directory') => Promise<void>
  onRenameValueChange: (value: string) => void
  onCommitRename: () => Promise<void>
  onCancelRename: () => void
  onClearSelection: () => void
  onContextMenu: (e: React.MouseEvent, path: string | null, kind: 'file' | 'directory' | null) => void
  onDragStart: (e: React.DragEvent, path: string) => void
  onDragOver: (e: React.DragEvent, path: string) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent, path: string) => void
  onDragEnd: () => void
  onTreeKeyDown: (e: React.KeyboardEvent) => void
}

interface TreeGroup {
  node: VisibleTreeNode
  children: TreeGroup[]
}

/** 将平面 visibleTree 按层级分组，以便为每个目录节点包裹独立动画容器 */
function groupTree(visibleTree: VisibleTreeNode[]): TreeGroup[] {
  function buildGroups(startIndex: number, depth: number): { groups: TreeGroup[]; nextIndex: number } {
    const groups: TreeGroup[] = []
    let i = startIndex

    while (i < visibleTree.length) {
      const node = visibleTree[i]
      if (node.depth < depth) break
      if (node.depth > depth) break

      i++
      let children: TreeGroup[] = []
      if (node.entry.kind === 'directory') {
        const result = buildGroups(i, depth + 1)
        children = result.groups
        i = result.nextIndex
      }

      groups.push({ node, children })
    }

    return { groups, nextIndex: i }
  }

  return buildGroups(0, 0).groups
}

interface FileTreeRowProps {
  node: VisibleTreeNode
  expandedPaths: Set<string>
  selectedPaths: Set<string>
  focusedPath: string | null
  clipboardPaths: Set<string>
  renameTarget: string | null
  renameValue: string
  dragOverPath: string | null
  onToggleExpand: (path: string) => Promise<void>
  onClick: (path: string, kind: 'file' | 'directory', event: { ctrlKey: boolean; shiftKey: boolean; metaKey: boolean }) => void
  onDoubleClick: (path: string, kind: 'file' | 'directory') => Promise<void>
  onRenameValueChange: (value: string) => void
  onCommitRename: () => Promise<void>
  onCancelRename: () => void
  onContextMenu: (e: React.MouseEvent, path: string | null, kind: 'file' | 'directory' | null) => void
  onDragStart: (e: React.DragEvent, path: string) => void
  onDragOver: (e: React.DragEvent, path: string) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent, path: string) => void
  onDragEnd: () => void
}

// eslint-disable-next-line max-lines-per-function
function FileTreeRow({
  node,
  expandedPaths,
  selectedPaths,
  focusedPath,
  clipboardPaths,
  renameTarget,
  renameValue,
  dragOverPath,
  onToggleExpand,
  onClick,
  onDoubleClick,
  onRenameValueChange,
  onCommitRename,
  onCancelRename,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: FileTreeRowProps) {
  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void onCommitRename()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onCancelRename()
      }
      e.stopPropagation()
    },
    [onCommitRename, onCancelRename],
  )

  const { entry, depth } = node
  const isExpanded = expandedPaths.has(entry.path)
  const isSelected = selectedPaths.has(entry.path)
  const isFocused = focusedPath === entry.path
  const isCut = clipboardPaths.has(entry.path)
  const isRenaming = renameTarget === entry.path
  const isDragOver = dragOverPath === entry.path
  const paddingLeft = 12 + depth * 20

  return (
    <div
      key={entry.path}
      className={[
        'file-tree__row',
        isSelected && 'file-tree__row--selected',
        isFocused && 'file-tree__row--focused',
        isCut && 'file-tree__row--cut',
        isDragOver && 'file-tree__row--drag-over',
      ]
        .filter(Boolean)
        .join(' ')}
      role="treeitem"
      aria-selected={isSelected}
      aria-expanded={entry.kind === 'directory' ? isExpanded : undefined}
      aria-level={depth + 1}
      tabIndex={isFocused ? 0 : -1}
      draggable
      style={{ paddingLeft: `${paddingLeft}px` }}
      onClick={(e) => {
        e.stopPropagation()
        onClick(entry.path, entry.kind, { ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, metaKey: e.metaKey })
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        void onDoubleClick(entry.path, entry.kind)
      }}
      onContextMenu={(e) => {
        e.stopPropagation()
        onContextMenu(e, entry.path, entry.kind)
      }}
      onDragStart={(e) => onDragStart(e, entry.path)}
      onDragEnd={onDragEnd}
      onDragOver={(e) => {
        if (entry.kind === 'directory') {
          onDragOver(e, entry.path)
        }
      }}
      onDragLeave={(e) => onDragLeave(e)}
      onDrop={(e) => {
        if (entry.kind === 'directory') {
          void onDrop(e, entry.path)
        }
      }}
    >
      {entry.kind === 'directory' ? (
        <button
          type="button"
          className={`file-tree__expand${isExpanded ? ' file-tree__expand--expanded' : ''}`}
          tabIndex={-1}
          aria-hidden="true"
          onClick={(e) => {
            e.stopPropagation()
            void onToggleExpand(entry.path)
          }}
        >
          <ChevronRight size={14} className="file-tree__expand-icon" />
        </button>
      ) : (
        <span className="file-tree__expand file-tree__expand--spacer" />
      )}

      <span className="file-tree__icon" aria-hidden="true">
        {entry.kind === 'directory' ? (
          isExpanded ? (
            <FolderOpen size={16} />
          ) : (
            <Folder size={16} />
          )
        ) : (
          <File size={16} />
        )}
      </span>

      {isRenaming ? (
        <input
          type="text"
          className="file-tree__rename-input"
          value={renameValue}
          onChange={(e) => onRenameValueChange(e.target.value)}
          onKeyDown={handleRenameKeyDown}
          onBlur={() => void onCommitRename()}
          autoFocus
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className={`file-tree__name${isCut ? ' file-tree__name--cut' : ''}`}>
          {entry.name}
        </span>
      )}
    </div>
  )
}

export function FileTree({
  visibleTree,
  selectedPaths,
  expandedPaths,
  focusedPath,
  clipboardPaths,
  renameTarget,
  renameValue,
  dragOverPath,
  onToggleExpand,
  onClick,
  onDoubleClick,
  onRenameValueChange,
  onCommitRename,
  onCancelRename,
  onClearSelection,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onTreeKeyDown,
}: FileTreeProps) {
  const groups = useMemo(() => groupTree(visibleTree), [visibleTree])

  const handleContainerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (renameTarget !== null) return
      onTreeKeyDown(e)
    },
    [onTreeKeyDown, renameTarget],
  )

  const rowProps = {
    expandedPaths, selectedPaths, focusedPath, clipboardPaths,
    renameTarget, renameValue, dragOverPath,
    onToggleExpand, onClick, onDoubleClick,
    onRenameValueChange, onCommitRename, onCancelRename,
    onContextMenu, onDragStart, onDragOver, onDragLeave, onDrop, onDragEnd,
  } as const

  function renderRow(node: VisibleTreeNode): ReactNode {
    return <FileTreeRow key={node.entry.path} node={node} {...rowProps} />
  }

  function renderGroup(group: TreeGroup): ReactNode {
    const { node } = group
    const isExpanded = expandedPaths.has(node.entry.path)

    if (node.entry.kind === 'directory') {
      return (
        <div key={node.entry.path}>
          {renderRow(node)}
          <div
            className={`file-tree__children${isExpanded ? ' file-tree__children--expanded' : ''}`}
          >
            {group.children.map((child) => renderGroup(child))}
          </div>
        </div>
      )
    }

    return renderRow(node)
  }

  return (
    <div
      className="file-tree"
      role="tree"
      aria-label="文件树"
      tabIndex={0}
      onKeyDown={handleContainerKeyDown}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClearSelection()
        }
      }}
      onContextMenu={(e) => {
        if (e.target === e.currentTarget) {
          onContextMenu(e, null, null)
        }
      }}
    >
      {visibleTree.length === 0 && (
        <div className="file-tree__empty">
          <File size={28} className="file-tree__empty-icon" aria-hidden="true" />
          <p className="file-tree__empty-text">选择文件夹以浏览文件</p>
        </div>
      )}

      {groups.map((group) => renderGroup(group))}
    </div>
  )
}
