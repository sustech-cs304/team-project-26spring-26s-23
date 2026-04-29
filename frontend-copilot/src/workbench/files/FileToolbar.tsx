import { FolderOpen, LoaderCircle } from 'lucide-react'
import type { FileOperationStatus } from './types'

interface FileToolbarProps {
  rootPath: string | null
  busyOperation: FileOperationStatus
  onSelectRootDirectory: () => Promise<void>
}

export function FileToolbar({
  rootPath,
  busyOperation,
  onSelectRootDirectory,
}: FileToolbarProps) {
  const isBusy = busyOperation !== 'idle'

  return (
    <div className="file-toolbar" role="toolbar" aria-label="文件操作工具栏">
      <div className="file-toolbar__left">
        <button
          type="button"
          className="secondary-button secondary-button--subtle"
          disabled={isBusy}
          onClick={() => void onSelectRootDirectory()}
        >
          {busyOperation === 'selecting-root' ? (
            <LoaderCircle size={15} className="skill-activity__icon" aria-hidden="true" />
          ) : (
            <FolderOpen size={15} aria-hidden="true" />
          )}
          选择文件夹
        </button>

        {rootPath && (
          <span className="file-toolbar__root-path" title={rootPath}>
            {rootPath.split(/[/\\]/).pop() || rootPath}
          </span>
        )}
      </div>

      {(busyOperation === 'copying' ||
        busyOperation === 'moving' ||
        busyOperation === 'loading-children') && (
        <div className="file-toolbar__busy">
          <LoaderCircle size={14} className="skill-activity__icon" aria-hidden="true" />
          <span>
            {busyOperation === 'copying' && '正在复制…'}
            {busyOperation === 'moving' && '正在移动…'}
            {busyOperation === 'loading-children' && '正在加载…'}
          </span>
        </div>
      )}
    </div>
  )
}
