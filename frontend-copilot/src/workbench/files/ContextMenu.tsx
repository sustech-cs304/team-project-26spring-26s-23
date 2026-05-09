import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Copy,
  ExternalLink,
  FolderPlus,
  FolderSearch,
  Pencil,
  Scissors,
  Clipboard,
  TextCursorInput,
  Trash2,
} from 'lucide-react'

export interface ContextMenuItem {
  label: string
  icon?: React.ReactNode
  disabled?: boolean
  danger?: boolean
  onClick: () => void
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    // 延迟注册，避免右键的 mouseup 立即触发关闭
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }, 0)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  // 调整菜单位置避免溢出视口
  const adjustedX = Math.max(0, Math.min(x, window.innerWidth - 200))
  const adjustedY = Math.max(0, Math.min(y, window.innerHeight - items.length * 36 - 12))

  const menu = (
    <div
      ref={menuRef}
      className="file-context-menu"
      role="menu"
      aria-label="右键菜单"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {items.map((item, idx) => (
        <button
          key={idx}
          type="button"
          className={`file-context-menu__item${item.danger ? ' file-context-menu__item--danger' : ''}`}
          role="menuitem"
          disabled={item.disabled}
          onClick={(e) => {
            e.stopPropagation()
            item.onClick()
            onClose()
          }}
        >
          {item.icon && (
            <span className="file-context-menu__icon" aria-hidden="true">
              {item.icon}
            </span>
          )}
          <span className="file-context-menu__label">{item.label}</span>
        </button>
        ))}
    </div>
  )

  if (typeof document === 'undefined' || document.body === null) {
    return menu
  }

  return createPortal(menu, document.body)
}

/** 根据上下文构建菜单项 */
export function buildContextMenuItems(params: {
  targetKind: 'file' | 'directory' | null
  targetPath: string | null
  isExpanded: boolean
  selectedPaths: Set<string>
  clipboard: { operation: 'copy' | 'cut'; sourcePaths: string[]; sourceRoot: string } | null
  busyOperation: string
  onToggleExpand?: () => void
  onOpenWithSystem?: () => void
  onRevealInFolder?: () => void
  onCopyPath?: () => void
  onCopyRelativePath?: () => void
  onCopy: () => void
  onCut: () => void
  onPaste: (targetDir?: string) => void
  onNewFolder: (targetDir?: string) => void
  onRename: () => void
  onDelete: () => void
  onRefresh: () => void
}): ContextMenuItem[] {
  const isBusy = params.busyOperation !== 'idle'
  const hasClipboard = params.clipboard !== null
  const hasSelection = params.selectedPaths.size > 0

  if (params.targetKind === 'directory') {
    // 文件夹节点菜单（系统操作放在顶部，编辑操作在后）
    return [
      {
        label: params.isExpanded ? '折叠' : '展开',
        icon: params.isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />,
        disabled: isBusy,
        onClick: params.onToggleExpand ?? (() => {}),
      },
      {
        label: '在文件资源管理器中显示',
        icon: <FolderSearch size={14} />,
        disabled: !params.targetPath || isBusy,
        onClick: params.onRevealInFolder ?? (() => {}),
      },
      {
        label: '复制路径',
        icon: <ClipboardCopy size={14} />,
        disabled: !params.targetPath || isBusy,
        onClick: params.onCopyPath ?? (() => {}),
      },
      {
        label: '复制相对路径',
        icon: <TextCursorInput size={14} />,
        disabled: !params.targetPath || isBusy,
        onClick: params.onCopyRelativePath ?? (() => {}),
      },
      {
        label: '复制',
        icon: <Copy size={14} />,
        disabled: !hasSelection || isBusy,
        onClick: params.onCopy,
      },
      {
        label: '剪切',
        icon: <Scissors size={14} />,
        disabled: !hasSelection || isBusy,
        onClick: params.onCut,
      },
      {
        label: '粘贴',
        icon: <Clipboard size={14} />,
        disabled: !hasClipboard || isBusy,
        onClick: () => params.onPaste(params.targetPath ?? undefined),
      },
      {
        label: '新建文件夹',
        icon: <FolderPlus size={14} />,
        disabled: isBusy,
        onClick: () => params.onNewFolder(params.targetPath ?? undefined),
      },
      {
        label: '重命名',
        icon: <Pencil size={14} />,
        disabled: params.selectedPaths.size !== 1 || isBusy,
        onClick: params.onRename,
      },
      {
        label: '删除',
        icon: <Trash2 size={14} />,
        danger: true,
        disabled: !hasSelection || isBusy,
        onClick: params.onDelete,
      },
    ]
  }

  if (params.targetKind === 'file') {
    // 文件节点菜单（系统操作放在顶部，编辑操作在后）
    return [
      {
        label: '通过系统方式打开',
        icon: <ExternalLink size={14} />,
        disabled: !params.targetPath || isBusy,
        onClick: params.onOpenWithSystem ?? (() => {}),
      },
      {
        label: '在文件资源管理器中显示',
        icon: <FolderSearch size={14} />,
        disabled: !params.targetPath || isBusy,
        onClick: params.onRevealInFolder ?? (() => {}),
      },
      {
        label: '复制路径',
        icon: <ClipboardCopy size={14} />,
        disabled: !params.targetPath || isBusy,
        onClick: params.onCopyPath ?? (() => {}),
      },
      {
        label: '复制相对路径',
        icon: <TextCursorInput size={14} />,
        disabled: !params.targetPath || isBusy,
        onClick: params.onCopyRelativePath ?? (() => {}),
      },
      {
        label: '复制',
        icon: <Copy size={14} />,
        disabled: !hasSelection || isBusy,
        onClick: params.onCopy,
      },
      {
        label: '剪切',
        icon: <Scissors size={14} />,
        disabled: !hasSelection || isBusy,
        onClick: params.onCut,
      },
      {
        label: '重命名',
        icon: <Pencil size={14} />,
        disabled: params.selectedPaths.size !== 1 || isBusy,
        onClick: params.onRename,
      },
      {
        label: '删除',
        icon: <Trash2 size={14} />,
        danger: true,
        disabled: !hasSelection || isBusy,
        onClick: params.onDelete,
      },
    ]
  }

  // 空白区域菜单
  return [
    {
      label: '新建文件夹',
      icon: <FolderPlus size={14} />,
      disabled: isBusy,
      onClick: () => params.onNewFolder(),
    },
    {
      label: '粘贴',
      icon: <Clipboard size={14} />,
      disabled: !hasClipboard || isBusy,
      onClick: () => params.onPaste(),
    },
  ]
}
