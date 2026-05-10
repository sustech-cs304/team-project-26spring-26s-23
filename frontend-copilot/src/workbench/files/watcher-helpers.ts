import type { FileManagerApi } from '../../../electron/file-manager/ipc'

/** 获取 fileManager bridge（仅 Electron 环境可用） */
export function getFileManager() {
  if (typeof window === 'undefined' || !window.fileManager) return null
  return window.fileManager
}

/** 计算当前需要监听的目录集合 */
export function computeWatchedDirectories(
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
