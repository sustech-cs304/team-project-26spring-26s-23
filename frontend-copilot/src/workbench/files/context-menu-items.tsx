import type { ReactNode } from 'react'
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
  icon?: ReactNode
  disabled?: boolean
  danger?: boolean
  onClick: () => void
}

interface BuildContextMenuItemsParams {
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
}

const ICON_SIZE = 14

function buildDirectoryMenuItems(params: BuildContextMenuItemsParams): ContextMenuItem[] {
  const isBusy = params.busyOperation !== 'idle'
  const hasClipboard = params.clipboard !== null
  const hasSelection = params.selectedPaths.size > 0

  return [
    {
      label: params.isExpanded ? '折叠' : '展开',
      icon: params.isExpanded ? <ChevronDown size={ICON_SIZE} /> : <ChevronRight size={ICON_SIZE} />,
      disabled: isBusy,
      onClick: params.onToggleExpand ?? (() => {}),
    },
    {
      label: '在文件资源管理器中显示',
      icon: <FolderSearch size={ICON_SIZE} />,
      disabled: !params.targetPath || isBusy,
      onClick: params.onRevealInFolder ?? (() => {}),
    },
    {
      label: '复制路径',
      icon: <ClipboardCopy size={ICON_SIZE} />,
      disabled: !params.targetPath || isBusy,
      onClick: params.onCopyPath ?? (() => {}),
    },
    {
      label: '复制相对路径',
      icon: <TextCursorInput size={ICON_SIZE} />,
      disabled: !params.targetPath || isBusy,
      onClick: params.onCopyRelativePath ?? (() => {}),
    },
    {
      label: '复制',
      icon: <Copy size={ICON_SIZE} />,
      disabled: !hasSelection || isBusy,
      onClick: params.onCopy,
    },
    {
      label: '剪切',
      icon: <Scissors size={ICON_SIZE} />,
      disabled: !hasSelection || isBusy,
      onClick: params.onCut,
    },
    {
      label: '粘贴',
      icon: <Clipboard size={ICON_SIZE} />,
      disabled: !hasClipboard || isBusy,
      onClick: () => params.onPaste(params.targetPath ?? undefined),
    },
    {
      label: '新建文件夹',
      icon: <FolderPlus size={ICON_SIZE} />,
      disabled: isBusy,
      onClick: () => params.onNewFolder(params.targetPath ?? undefined),
    },
    {
      label: '重命名',
      icon: <Pencil size={ICON_SIZE} />,
      disabled: params.selectedPaths.size !== 1 || isBusy,
      onClick: params.onRename,
    },
    {
      label: '删除',
      icon: <Trash2 size={ICON_SIZE} />,
      danger: true,
      disabled: !hasSelection || isBusy,
      onClick: params.onDelete,
    },
  ]
}

function buildFileMenuItems(params: BuildContextMenuItemsParams): ContextMenuItem[] {
  const isBusy = params.busyOperation !== 'idle'
  const hasSelection = params.selectedPaths.size > 0

  return [
    {
      label: '通过系统方式打开',
      icon: <ExternalLink size={ICON_SIZE} />,
      disabled: !params.targetPath || isBusy,
      onClick: params.onOpenWithSystem ?? (() => {}),
    },
    {
      label: '在文件资源管理器中显示',
      icon: <FolderSearch size={ICON_SIZE} />,
      disabled: !params.targetPath || isBusy,
      onClick: params.onRevealInFolder ?? (() => {}),
    },
    {
      label: '复制路径',
      icon: <ClipboardCopy size={ICON_SIZE} />,
      disabled: !params.targetPath || isBusy,
      onClick: params.onCopyPath ?? (() => {}),
    },
    {
      label: '复制相对路径',
      icon: <TextCursorInput size={ICON_SIZE} />,
      disabled: !params.targetPath || isBusy,
      onClick: params.onCopyRelativePath ?? (() => {}),
    },
    {
      label: '复制',
      icon: <Copy size={ICON_SIZE} />,
      disabled: !hasSelection || isBusy,
      onClick: params.onCopy,
    },
    {
      label: '剪切',
      icon: <Scissors size={ICON_SIZE} />,
      disabled: !hasSelection || isBusy,
      onClick: params.onCut,
    },
    {
      label: '重命名',
      icon: <Pencil size={ICON_SIZE} />,
      disabled: params.selectedPaths.size !== 1 || isBusy,
      onClick: params.onRename,
    },
    {
      label: '删除',
      icon: <Trash2 size={ICON_SIZE} />,
      danger: true,
      disabled: !hasSelection || isBusy,
      onClick: params.onDelete,
    },
  ]
}

function buildBlankMenuItems(params: BuildContextMenuItemsParams): ContextMenuItem[] {
  const isBusy = params.busyOperation !== 'idle'
  const hasClipboard = params.clipboard !== null

  return [
    {
      label: '新建文件夹',
      icon: <FolderPlus size={ICON_SIZE} />,
      disabled: isBusy,
      onClick: () => params.onNewFolder(),
    },
    {
      label: '粘贴',
      icon: <Clipboard size={ICON_SIZE} />,
      disabled: !hasClipboard || isBusy,
      onClick: () => params.onPaste(),
    },
  ]
}

/** 根据上下文构建菜单项 */
export function buildContextMenuItems(params: BuildContextMenuItemsParams): ContextMenuItem[] {
  if (params.targetKind === 'directory') {
    return buildDirectoryMenuItems(params)
  }

  if (params.targetKind === 'file') {
    return buildFileMenuItems(params)
  }

  return buildBlankMenuItems(params)
}
