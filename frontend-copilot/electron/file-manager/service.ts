import * as fs from 'node:fs'
import * as path from 'node:path'
import type { IpcMain } from 'electron'
import { clipboard, dialog, shell } from 'electron'

import type {
  CopyEntriesRequest,
  CopyTextToClipboardRequest,
  CreateDirectoryRequest,
  DeleteEntriesRequest,
  DirectoryChangedEvent,
  FileManagerError,
  FileManagerApi,
  FileTreeEntry,
  ListDirectoryRequest,
  LoadLastRootDirectoryResult,
  MoveEntriesRequest,
  OpenEntryWithSystemRequest,
  ProbeDirectoryRequest,
  RenameEntryRequest,
  RevealEntryInFolderRequest,
  SaveLastRootDirectoryRequest,
  SelectRootDirectoryRequest,
  SelectDirectorySuccess,
  TrashEntriesRequest,
  UnwatchDirectoriesRequest,
  WatchDirectoriesRequest,
} from './ipc'
import {
  FILE_MANAGER_COPY_ENTRIES_CHANNEL,
  FILE_MANAGER_COPY_TEXT_TO_CLIPBOARD_CHANNEL,
  FILE_MANAGER_CREATE_DIRECTORY_CHANNEL,
  FILE_MANAGER_DELETE_ENTRIES_PERMANENTLY_CHANNEL,
  FILE_MANAGER_LIST_DIRECTORY_CHANNEL,
  FILE_MANAGER_MOVE_ENTRIES_CHANNEL,
  FILE_MANAGER_OPEN_ENTRY_WITH_SYSTEM_CHANNEL,
  FILE_MANAGER_PROBE_DIRECTORY_CHANNEL,
  FILE_MANAGER_RENAME_ENTRY_CHANNEL,
  FILE_MANAGER_REVEAL_ENTRY_IN_FOLDER_CHANNEL,
  FILE_MANAGER_SELECT_ROOT_DIRECTORY_CHANNEL,
  FILE_MANAGER_TRASH_ENTRIES_CHANNEL,
  FILE_MANAGER_DIRECTORY_CHANGED_CHANNEL,
  FILE_MANAGER_WATCH_DIRECTORIES_CHANNEL,
  FILE_MANAGER_UNWATCH_DIRECTORIES_CHANNEL,
  FILE_MANAGER_LOAD_LAST_ROOT_DIRECTORY_CHANNEL,
  FILE_MANAGER_SAVE_LAST_ROOT_DIRECTORY_CHANNEL,
  FILE_MANAGER_CLEAR_LAST_ROOT_DIRECTORY_CHANNEL,
  createFileManagerError,
} from './ipc'

const PROBE_MAX_ITEMS = 10_000
const PROBE_MAX_DEPTH = 2
const COPY_SUFFIX = ' - 副本'

type IpcMainLike = Pick<IpcMain, 'handle' | 'removeHandler'>

export interface ElectronFileManagerServiceOptions {
  appendLog?: (
    level: 'info' | 'warn' | 'error',
    message: string,
    context?: Record<string, unknown>,
  ) => void | Promise<void>
  getMainWindow?: () => Electron.BrowserWindow | null
  userDataPath?: string
}

export interface ElectronFileManagerService extends FileManagerApi {
  registerIpcHandlers(ipcMain: IpcMainLike): void
  removeIpcHandlers(ipcMain: IpcMainLike): void
}

function normalizePath(input: string): string {
  return path.normalize(input)
}

function toEntryId(entryPath: string): string {
  return Buffer.from(entryPath).toString('base64')
}

function statToFileTreeEntry(entryPath: string, parentPath: string | null): FileTreeEntry | null {
  let stats: fs.Stats
  try {
    stats = fs.statSync(entryPath)
  } catch {
    return null
  }

  const name = path.basename(entryPath)
  const kind: 'file' | 'directory' = stats.isDirectory() ? 'directory' : 'file'
  const hasChildren: boolean | null = null

  return {
    id: toEntryId(entryPath),
    path: entryPath,
    name,
    kind,
    parentPath,
    size: stats.isFile() ? stats.size : null,
    modifiedAt: stats.mtime.toISOString(),
    hasChildren,
  }
}

function listDirectoryEntries(directoryPath: string): FileTreeEntry[] {
  const resolved = normalizePath(directoryPath)
  let names: string[]
  try {
    names = fs.readdirSync(resolved)
  } catch {
    return []
  }

  const entries: FileTreeEntry[] = []
  for (const name of names) {
    const fullPath = path.join(resolved, name)
    const entry = statToFileTreeEntry(fullPath, resolved)
    if (entry !== null) {
      entries.push(entry)
    }
  }

  entries.sort((a, b) => {
    if (a.kind === b.kind) {
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    }
    return a.kind === 'directory' ? -1 : 1
  })

  return entries
}

function generateCopyName(
  targetDir: string,
  originalName: string,
  isDirectory: boolean,
): string {
  const ext = isDirectory ? '' : path.extname(originalName)
  const baseName = isDirectory ? originalName : path.basename(originalName, ext)

  let candidate = `${baseName}${COPY_SUFFIX}${ext}`
  let counter = 2
  while (fs.existsSync(path.join(targetDir, candidate))) {
    candidate = `${baseName}${COPY_SUFFIX} ${counter}${ext}`
    counter++
  }
  return candidate
}

function copyEntryRecursive(
  srcPath: string,
  destDir: string,
): { success: boolean; destPath?: string; reason?: string } {
  try {
    const name = path.basename(srcPath)
    const stats = fs.statSync(srcPath)
    let destPath = path.join(destDir, name)

    if (fs.existsSync(destPath)) {
      const newName = generateCopyName(destDir, name, stats.isDirectory())
      destPath = path.join(destDir, newName)
    }

    if (stats.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true })
      const children = fs.readdirSync(srcPath)
      for (const child of children) {
        const childSrc = path.join(srcPath, child)
        const result = copyEntryRecursive(childSrc, destPath)
        if (!result.success) {
          return { success: false, reason: result.reason }
        }
      }
    } else {
      fs.copyFileSync(srcPath, destPath)
    }

    return { success: true, destPath }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, reason: message }
  }
}

function moveEntry(srcPath: string, destDir: string): { success: boolean; destPath?: string; reason?: string } {
  try {
    const name = path.basename(srcPath)
    const stats = fs.statSync(srcPath)
    const destPath = path.join(destDir, name)

    if (normalizePath(srcPath) === normalizePath(destPath)) {
      return { success: true, destPath }
    }

    if (fs.existsSync(destPath)) {
      return { success: false, reason: `目标位置已存在同名条目: ${name}` }
    }

    if (stats.isDirectory() && isSubdirectory(destDir, srcPath)) {
      return { success: false, reason: '不能将目录移动到自身或其子目录中' }
    }

    fs.renameSync(srcPath, destPath)
    return { success: true, destPath }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, reason: message }
  }
}

function normalizePathForSubdirectoryCheck(input: string): string {
  return path.posix.normalize(input.replace(/\\/g, '/'))
}

function ensureTrailingPosixSeparator(input: string): string {
  return input.endsWith('/') ? input : `${input}/`
}

function isSubdirectory(childPath: string, parentPath: string): boolean {
  const child = ensureTrailingPosixSeparator(normalizePathForSubdirectoryCheck(childPath))
  const parent = ensureTrailingPosixSeparator(normalizePathForSubdirectoryCheck(parentPath))
  return child.startsWith(parent)
}

function safeDeletePermanently(entryPath: string): { success: boolean; reason?: string } {
  try {
    const stats = fs.statSync(entryPath)
    if (stats.isDirectory()) {
      fs.rmSync(entryPath, { recursive: true, force: true })
    } else {
      fs.unlinkSync(entryPath)
    }
    if (fs.existsSync(entryPath)) {
      return { success: false, reason: '永久删除后条目仍然存在' }
    }
    return { success: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { success: false, reason: message }
  }
}

function pushAffectedPath(affectedPaths: string[], entryPath: string | undefined): void {
  if (entryPath !== undefined && !affectedPaths.includes(entryPath)) {
    affectedPaths.push(entryPath)
  }
}

function validateEntryExists(entryPath: string, label: string): FileManagerError | null {
  const resolved = normalizePath(entryPath)
  if (!fs.existsSync(resolved)) {
    return createFileManagerError('not_found', `${label}不存在: ${entryPath}`)
  }
  return null
}

function getFsErrorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code
    return typeof code === 'string' ? code : undefined
  }
  return undefined
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function createDirectoryStatError(dirPath: string, label: string, err: unknown): FileManagerError {
  const code = getFsErrorCode(err)
  const details = getErrorMessage(err)

  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return createFileManagerError('not_found', `${label}不存在: ${dirPath}`, details)
  }

  if (code === 'EACCES' || code === 'EPERM') {
    return createFileManagerError('permission_denied', `无法访问${label}: ${dirPath}`, details)
  }

  return createFileManagerError('io_error', `检查${label}失败: ${dirPath}`, details)
}

function validateDirectoryExists(dirPath: string, label: string): FileManagerError | null {
  const resolved = normalizePath(dirPath)
  let stats: fs.Stats

  try {
    stats = fs.statSync(resolved)
  } catch (err) {
    return createDirectoryStatError(dirPath, label, err)
  }

  if (!stats.isDirectory()) {
    return createFileManagerError('invalid_operation', `${label}不是目录: ${dirPath}`)
  }
  return null
}

const LAST_ROOT_DIRECTORY_FILE_NAME = 'last-root-directory.json'

function getLastRootDirectoryFilePath(userDataPath: string | undefined): string | null {
  if (userDataPath === undefined || userDataPath.length === 0) return null
  return path.join(userDataPath, 'file-manager', LAST_ROOT_DIRECTORY_FILE_NAME)
}

function readLastRootDirectoryFromDisk(filePath: string): string | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed === 'string' && parsed.length > 0) {
      const normalized = normalizePath(parsed)
      if (fs.existsSync(normalized) && fs.statSync(normalized).isDirectory()) {
        return normalized
      }
    }
    return null
  } catch {
    return null
  }
}

function writeLastRootDirectoryToDisk(filePath: string, rootPath: string): void {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(rootPath), 'utf-8')
}

function clearLastRootDirectoryFromDisk(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  } catch {
    // best-effort; ignore removal failures
  }
}

// ===== IPC channel list for batch deregistration =====

const FILE_MANAGER_IPC_CHANNELS: readonly string[] = [
  FILE_MANAGER_SELECT_ROOT_DIRECTORY_CHANNEL,
  FILE_MANAGER_LIST_DIRECTORY_CHANNEL,
  FILE_MANAGER_PROBE_DIRECTORY_CHANNEL,
  FILE_MANAGER_CREATE_DIRECTORY_CHANNEL,
  FILE_MANAGER_COPY_ENTRIES_CHANNEL,
  FILE_MANAGER_MOVE_ENTRIES_CHANNEL,
  FILE_MANAGER_RENAME_ENTRY_CHANNEL,
  FILE_MANAGER_TRASH_ENTRIES_CHANNEL,
  FILE_MANAGER_DELETE_ENTRIES_PERMANENTLY_CHANNEL,
  FILE_MANAGER_WATCH_DIRECTORIES_CHANNEL,
  FILE_MANAGER_UNWATCH_DIRECTORIES_CHANNEL,
  FILE_MANAGER_LOAD_LAST_ROOT_DIRECTORY_CHANNEL,
  FILE_MANAGER_SAVE_LAST_ROOT_DIRECTORY_CHANNEL,
  FILE_MANAGER_CLEAR_LAST_ROOT_DIRECTORY_CHANNEL,
  FILE_MANAGER_OPEN_ENTRY_WITH_SYSTEM_CHANNEL,
  FILE_MANAGER_REVEAL_ENTRY_IN_FOLDER_CHANNEL,
  FILE_MANAGER_COPY_TEXT_TO_CLIPBOARD_CHANNEL,
]

// ===== Service deps shared across builder functions =====

interface FileManagerServiceDeps {
  log: (level: 'info' | 'warn' | 'error', message: string, context?: Record<string, unknown>) => void
  getMainWindow: (() => Electron.BrowserWindow | null) | undefined
  userDataPath: string | undefined
  startWatching: (directoryPath: string) => void
  stopWatching: (directoryPath: string) => void
  watchers: Map<string, fs.FSWatcher>
  directoryChangedListeners: Set<(event: DirectoryChangedEvent) => void>
}

// ===== Builder functions for service API methods =====

function buildDirectoryOps(deps: FileManagerServiceDeps) {
  const { log, getMainWindow } = deps

  return {
    async selectRootDirectory(request?: SelectRootDirectoryRequest): Promise<SelectDirectorySuccess | FileManagerError> {
      const win = getMainWindow?.() ?? null
      const dialogOptions: Electron.OpenDialogOptions = {
        properties: ['openDirectory'],
        title: '选择文件夹',
      }
      const initialPath = String(request?.initialPath ?? '').trim()
      if (initialPath) {
        dialogOptions.defaultPath = normalizePath(initialPath)
      }
      const result = win !== null
        ? await dialog.showOpenDialog(win, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)

      if (result.canceled || result.filePaths.length === 0) {
        return createFileManagerError('invalid_operation', '未选择任何目录')
      }

      const rootPath = normalizePath(result.filePaths[0]!)
      const error = validateDirectoryExists(rootPath, '根目录')
      if (error !== null) return error

      const entries = listDirectoryEntries(rootPath)
      log('info', '文件管理器: 已选择根目录', { rootPath, entryCount: entries.length })

      return {
        ok: true,
        rootPath,
        entries,
      }
    },

    async listDirectory(request: ListDirectoryRequest) {
      const dirPath = normalizePath(request.directoryPath)
      const rootError = validateDirectoryExists(dirPath, '目录')
      if (rootError !== null) return rootError

      const entries = listDirectoryEntries(dirPath)
      return { ok: true, entries }
    },

    async probeDirectory(request: ProbeDirectoryRequest) {
      const rootPath = normalizePath(request.rootPath)
      const rootError = validateDirectoryExists(rootPath, '根目录')
      if (rootError !== null) return rootError

      const result = performTwoLevelProbe(rootPath)
      if (result.totalItems >= PROBE_MAX_ITEMS) {
        log('warn', '文件管理器: 目录规模超过探测阈值', {
          rootPath,
          totalItems: result.totalItems,
          threshold: PROBE_MAX_ITEMS,
        })
      }
      return { ok: true, ...result }
    },

    async createDirectory(request: CreateDirectoryRequest) {
      const parentPath = normalizePath(request.parentPath)
      const parentError = validateDirectoryExists(parentPath, '父目录')
      if (parentError !== null) return parentError

      const name = request.name.trim()
      if (name.length === 0) {
        return createFileManagerError('invalid_operation', '文件夹名称不能为空')
      }

      // eslint-disable-next-line no-control-regex -- sanitizing filename control characters
      const invalidChars = /[<>:"/\\|?*\x00-\x1f]/
      if (invalidChars.test(name)) {
        return createFileManagerError('invalid_operation', '文件夹名称包含非法字符')
      }

      const newPath = path.join(parentPath, name)
      if (fs.existsSync(newPath)) {
        return createFileManagerError('invalid_operation', `已存在同名条目: ${name}`)
      }

      try {
        fs.mkdirSync(newPath)
        log('info', '文件管理器: 已创建文件夹', { path: newPath })
        return { ok: true, affectedPaths: [newPath] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log('error', '文件管理器: 创建文件夹失败', { path: newPath, error: message })
        return createFileManagerError('io_error', '创建文件夹失败', message)
      }
    },
  }
}

function buildCopyEntriesOp(deps: FileManagerServiceDeps) {
  const { log } = deps

  return {
    async copyEntries(request: CopyEntriesRequest) {
      const destDir = normalizePath(request.destinationDirectory)
      const destError = validateDirectoryExists(destDir, '目标目录')
      if (destError !== null) return destError

      const affectedPaths: string[] = []
      const failedItems: { path: string; reason: string }[] = []
      let successCount = 0

      for (const srcPath of request.sourcePaths) {
        const resolvedSrc = normalizePath(srcPath)
        const srcError = validateEntryExists(resolvedSrc, '源条目')
        if (srcError !== null) {
          failedItems.push({ path: resolvedSrc, reason: srcError.message })
          continue
        }

        if (isSubdirectory(destDir, resolvedSrc)) {
          failedItems.push({ path: resolvedSrc, reason: '不能将目录复制到自身或其子目录中' })
          continue
        }

        const result = copyEntryRecursive(resolvedSrc, destDir)
        if (!result.success) {
          failedItems.push({ path: resolvedSrc, reason: result.reason ?? '复制失败' })
          continue
        }

        if (request.operationType === 'cut') {
          const copiedPath = result.destPath
          const deleteResult = safeDeletePermanently(resolvedSrc)
          if (!deleteResult.success) {
            pushAffectedPath(affectedPaths, copiedPath)
            failedItems.push({
              path: resolvedSrc,
              reason: deleteResult.reason ?? '源条目删除失败',
            })
            continue
          }

          pushAffectedPath(affectedPaths, resolvedSrc)
          pushAffectedPath(affectedPaths, copiedPath)
          successCount++
          continue
        }

        pushAffectedPath(affectedPaths, resolvedSrc)
        pushAffectedPath(affectedPaths, result.destPath)
        successCount++
      }

      log('info', '文件管理器: 复制/剪切完成', {
        sourcePaths: request.sourcePaths,
        destination: destDir,
        operationType: request.operationType,
        successCount,
        failureCount: failedItems.length,
      })

      return {
        ok: true,
        affectedPaths,
        ...(failedItems.length > 0 ? { failedItems } : {}),
      }
    },
  }
}

function buildMoveAndRenameOps(deps: FileManagerServiceDeps) {
  const { log } = deps

  return {
    async moveEntries(request: MoveEntriesRequest) {
      const destDir = normalizePath(request.destinationDirectory)
      const destError = validateDirectoryExists(destDir, '目标目录')
      if (destError !== null) return destError

      for (const srcPath of request.sourcePaths) {
        const resolvedSrc = normalizePath(srcPath)
        if (normalizePath(resolvedSrc) === normalizePath(destDir)) {
          return createFileManagerError('invalid_operation', '不能将目录移动到自身')
        }
      }

      const affectedPaths: string[] = []
      const failedItems: { path: string; reason: string }[] = []
      let successCount = 0

      for (const srcPath of request.sourcePaths) {
        const resolvedSrc = normalizePath(srcPath)
        const srcError = validateEntryExists(resolvedSrc, '源条目')
        if (srcError !== null) {
          failedItems.push({ path: resolvedSrc, reason: srcError.message })
          continue
        }

        const result = moveEntry(resolvedSrc, destDir)
        if (result.success) {
          pushAffectedPath(affectedPaths, resolvedSrc)
          pushAffectedPath(affectedPaths, result.destPath)
          successCount++
        } else {
          failedItems.push({ path: resolvedSrc, reason: result.reason ?? '移动失败' })
        }
      }

      log('info', '文件管理器: 移动完成', {
        sourcePaths: request.sourcePaths,
        destination: destDir,
        successCount,
        failureCount: failedItems.length,
      })

      return {
        ok: true,
        affectedPaths,
        ...(failedItems.length > 0 ? { failedItems } : {}),
      }
    },

    async renameEntry(request: RenameEntryRequest) {
      const entryPath = normalizePath(request.entryPath)
      const entryError = validateEntryExists(entryPath, '目标条目')
      if (entryError !== null) return entryError

      const newName = request.newName.trim()
      if (newName.length === 0) {
        return createFileManagerError('invalid_operation', '名称不能为空')
      }

      // eslint-disable-next-line no-control-regex -- sanitizing filename control characters
      const invalidChars = /[<>:"/\\|?*\x00-\x1f]/
      if (invalidChars.test(newName)) {
        return createFileManagerError('invalid_operation', '名称包含非法字符')
      }

      const parentDir = path.dirname(entryPath)
      const newPath = path.join(parentDir, newName)

      if (normalizePath(entryPath) === normalizePath(newPath)) {
        return { ok: true, affectedPaths: [entryPath] }
      }

      if (fs.existsSync(newPath)) {
        return createFileManagerError('invalid_operation', `已存在同名条目: ${newName}`)
      }

      try {
        fs.renameSync(entryPath, newPath)
        log('info', '文件管理器: 已重命名', { from: entryPath, to: newPath })
        return { ok: true, affectedPaths: [entryPath, newPath] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log('error', '文件管理器: 重命名失败', { from: entryPath, to: newPath, error: message })
        return createFileManagerError('io_error', '重命名失败', message)
      }
    },
  }
}

function buildDeleteOps(deps: FileManagerServiceDeps) {
  const { log } = deps

  return {
    async trashEntries(request: TrashEntriesRequest) {
      const affectedPaths: string[] = []
      const failedItems: { path: string; reason: string }[] = []
      let trashUnavailable = false

      for (const entryPath of request.entryPaths) {
        const resolvedPath = normalizePath(entryPath)
        const entryError = validateEntryExists(resolvedPath, '目标条目')
        if (entryError !== null) {
          failedItems.push({ path: resolvedPath, reason: entryError.message })
          continue
        }

        try {
          await shell.trashItem(resolvedPath)
          affectedPaths.push(resolvedPath)
        } catch {
          trashUnavailable = true
          failedItems.push({
            path: resolvedPath,
            reason: '移入回收站失败，可尝试永久删除',
          })
        }
      }

      if (trashUnavailable && affectedPaths.length === 0) {
        return createFileManagerError(
          'trash_unavailable',
          '所有条目移入回收站失败，可尝试永久删除',
        )
      }

      log('info', '文件管理器: 删除到回收站完成', {
        entryPaths: request.entryPaths,
        successCount: affectedPaths.length,
        failureCount: failedItems.length,
      })

      return {
        ok: true,
        affectedPaths,
        ...(failedItems.length > 0 ? { failedItems } : {}),
      }
    },

    async deleteEntriesPermanently(request: DeleteEntriesRequest) {
      const affectedPaths: string[] = []
      const failedItems: { path: string; reason: string }[] = []

      for (const entryPath of request.entryPaths) {
        const resolvedPath = normalizePath(entryPath)
        const entryError = validateEntryExists(resolvedPath, '目标条目')
        if (entryError !== null) {
          failedItems.push({ path: resolvedPath, reason: entryError.message })
          continue
        }

        const result = safeDeletePermanently(resolvedPath)
        if (result.success) {
          affectedPaths.push(resolvedPath)
        } else {
          failedItems.push({ path: resolvedPath, reason: result.reason ?? '永久删除失败' })
        }
      }

      log('info', '文件管理器: 永久删除完成', {
        entryPaths: request.entryPaths,
        successCount: affectedPaths.length,
        failureCount: failedItems.length,
      })

      return {
        ok: true,
        affectedPaths,
        ...(failedItems.length > 0 ? { failedItems } : {}),
      }
    },
  }
}

function buildWatcherOps(deps: FileManagerServiceDeps) {
  const { log, startWatching, stopWatching, watchers, directoryChangedListeners } = deps

  return {
    async watchDirectories(request: WatchDirectoriesRequest) {
      const requested = new Set(request.paths.map((p) => normalizePath(p)))

      // stop watchers for directories no longer in the requested set
      for (const dirPath of watchers.keys()) {
        if (!requested.has(dirPath)) {
          stopWatching(dirPath)
        }
      }

      // start watchers for new directories
      for (const dirPath of requested) {
        startWatching(dirPath)
      }

      log('info', '文件管理器: 已同步监听目录集合', {
        watchedCount: watchers.size,
        requestedCount: requested.size,
      })

      return { ok: true as const, affectedPaths: [...watchers.keys()] }
    },

    async unwatchDirectories(request: UnwatchDirectoriesRequest) {
      const paths = new Set(request.paths.map((p) => normalizePath(p)))
      for (const dirPath of paths) {
        stopWatching(dirPath)
      }

      log('info', '文件管理器: 已取消监听指定目录', {
        unwatchedCount: paths.size,
        remainingWatchedCount: watchers.size,
      })

      return { ok: true as const, affectedPaths: [...paths] }
    },

    onDirectoryChanged(listener: (event: DirectoryChangedEvent) => void): () => void {
      directoryChangedListeners.add(listener)
      return () => {
        directoryChangedListeners.delete(listener)
      }
    },
  }
}

function buildPersistenceOps(deps: FileManagerServiceDeps) {
  const { log, userDataPath } = deps

  return {
    async loadLastRootDirectory(): Promise<LoadLastRootDirectoryResult> {
      const filePath = getLastRootDirectoryFilePath(userDataPath)
      if (filePath === null) {
        return createFileManagerError('invalid_operation', '未配置持久化路径')
      }

      const rootPath = readLastRootDirectoryFromDisk(filePath)
      if (rootPath === null) {
        return { ok: true, rootPath: null }
      }

      log('info', '文件管理器: 已加载上次根目录', { rootPath })
      return { ok: true, rootPath }
    },

    async saveLastRootDirectory(request: SaveLastRootDirectoryRequest) {
      const filePath = getLastRootDirectoryFilePath(userDataPath)
      if (filePath === null) {
        return createFileManagerError('invalid_operation', '未配置持久化路径')
      }

      const resolved = normalizePath(request.rootPath)
      try {
        writeLastRootDirectoryToDisk(filePath, resolved)
        log('info', '文件管理器: 已保存根目录', { rootPath: resolved })
        return { ok: true as const, affectedPaths: [resolved] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log('error', '文件管理器: 保存根目录失败', { rootPath: resolved, error: message })
        return createFileManagerError('io_error', '保存根目录失败', message)
      }
    },

    async clearLastRootDirectory() {
      const filePath = getLastRootDirectoryFilePath(userDataPath)
      if (filePath === null) {
        return createFileManagerError('invalid_operation', '未配置持久化路径')
      }

      clearLastRootDirectoryFromDisk(filePath)
      log('info', '文件管理器: 已清除已保存的根目录')
      return { ok: true as const, affectedPaths: [] }
    },
  }
}

function buildShellOps(deps: FileManagerServiceDeps) {
  const { log } = deps

  return {
    async openEntryWithSystem(request: OpenEntryWithSystemRequest) {
      const rawPath = String(request.path ?? '').trim()
      try {
        const parsedUrl = new URL(rawPath)
        if (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') {
          await shell.openExternal(parsedUrl.toString())
          log('info', '文件管理器: 已通过系统浏览器打开 URL', { url: parsedUrl.toString() })
          return { ok: true, affectedPaths: [parsedUrl.toString()] }
        }
      } catch {
        // fall through and treat as a filesystem path
      }

      const resolved = normalizePath(request.path)
      if (!fs.existsSync(resolved)) {
        return createFileManagerError('not_found', `路径不存在: ${request.path}`)
      }
      if (!fs.statSync(resolved).isFile()) {
        return createFileManagerError('invalid_operation', '只能通过系统方式打开文件')
      }
      try {
        const errorMessage = await shell.openPath(resolved)
        if (errorMessage) {
          log('error', '文件管理器: 系统打开失败', { path: resolved, error: errorMessage })
          return createFileManagerError('io_error', '系统打开失败', errorMessage)
        }
        log('info', '文件管理器: 已通过系统方式打开', { path: resolved })
        return { ok: true, affectedPaths: [resolved] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log('error', '文件管理器: 系统打开异常', { path: resolved, error: message })
        return createFileManagerError('io_error', '系统打开失败', message)
      }
    },

    async revealEntryInFolder(request: RevealEntryInFolderRequest) {
      const resolved = normalizePath(request.path)
      if (!fs.existsSync(resolved)) {
        return createFileManagerError('not_found', `路径不存在: ${request.path}`)
      }
      try {
        shell.showItemInFolder(resolved)
        log('info', '文件管理器: 已在文件资源管理器中显示', { path: resolved })
        return { ok: true, affectedPaths: [resolved] }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log('error', '文件管理器: 在资源管理器中显示失败', { path: resolved, error: message })
        return createFileManagerError('io_error', '在资源管理器中显示失败', message)
      }
    },

    async copyTextToClipboard(request: CopyTextToClipboardRequest) {
      clipboard.writeText(request.text)
      log('info', '文件管理器: 已复制到剪贴板', { textLength: request.text.length })
      return { ok: true, affectedPaths: [] }
    },
  }
}

function buildFileManagerApi(deps: FileManagerServiceDeps): FileManagerApi {
  return {
    ...buildDirectoryOps(deps),
    ...buildCopyEntriesOp(deps),
    ...buildMoveAndRenameOps(deps),
    ...buildDeleteOps(deps),
    ...buildWatcherOps(deps),
    ...buildPersistenceOps(deps),
    ...buildShellOps(deps),
  }
}

// ===== IPC handler registration / deregistration =====

function registerFileManagerIpcHandlers(ipcMain: IpcMainLike, api: FileManagerApi): void {
  ipcMain.handle(FILE_MANAGER_SELECT_ROOT_DIRECTORY_CHANNEL, async (_event, request?: SelectRootDirectoryRequest) => {
    return request === undefined ? await api.selectRootDirectory() : await api.selectRootDirectory(request)
  })

  ipcMain.handle(
    FILE_MANAGER_LIST_DIRECTORY_CHANNEL,
    async (_event, request: ListDirectoryRequest) => await api.listDirectory(request),
  )

  ipcMain.handle(
    FILE_MANAGER_PROBE_DIRECTORY_CHANNEL,
    async (_event, request: ProbeDirectoryRequest) => await api.probeDirectory(request),
  )

  ipcMain.handle(
    FILE_MANAGER_CREATE_DIRECTORY_CHANNEL,
    async (_event, request: CreateDirectoryRequest) => await api.createDirectory(request),
  )

  ipcMain.handle(
    FILE_MANAGER_COPY_ENTRIES_CHANNEL,
    async (_event, request: CopyEntriesRequest) => await api.copyEntries(request),
  )

  ipcMain.handle(
    FILE_MANAGER_MOVE_ENTRIES_CHANNEL,
    async (_event, request: MoveEntriesRequest) => await api.moveEntries(request),
  )

  ipcMain.handle(
    FILE_MANAGER_RENAME_ENTRY_CHANNEL,
    async (_event, request: RenameEntryRequest) => await api.renameEntry(request),
  )

  ipcMain.handle(
    FILE_MANAGER_TRASH_ENTRIES_CHANNEL,
    async (_event, request: TrashEntriesRequest) => await api.trashEntries(request),
  )

  ipcMain.handle(
    FILE_MANAGER_DELETE_ENTRIES_PERMANENTLY_CHANNEL,
    async (_event, request: DeleteEntriesRequest) => await api.deleteEntriesPermanently(request),
  )

  ipcMain.handle(
    FILE_MANAGER_WATCH_DIRECTORIES_CHANNEL,
    async (_event, request: WatchDirectoriesRequest) => await api.watchDirectories(request),
  )

  ipcMain.handle(
    FILE_MANAGER_UNWATCH_DIRECTORIES_CHANNEL,
    async (_event, request: UnwatchDirectoriesRequest) => await api.unwatchDirectories(request),
  )

  ipcMain.handle(FILE_MANAGER_LOAD_LAST_ROOT_DIRECTORY_CHANNEL, async () => await api.loadLastRootDirectory())

  ipcMain.handle(
    FILE_MANAGER_SAVE_LAST_ROOT_DIRECTORY_CHANNEL,
    async (_event, request: SaveLastRootDirectoryRequest) => await api.saveLastRootDirectory(request),
  )

  ipcMain.handle(FILE_MANAGER_CLEAR_LAST_ROOT_DIRECTORY_CHANNEL, async () => await api.clearLastRootDirectory())

  ipcMain.handle(
    FILE_MANAGER_OPEN_ENTRY_WITH_SYSTEM_CHANNEL,
    async (_event, request: OpenEntryWithSystemRequest) => await api.openEntryWithSystem(request),
  )

  ipcMain.handle(
    FILE_MANAGER_REVEAL_ENTRY_IN_FOLDER_CHANNEL,
    async (_event, request: RevealEntryInFolderRequest) => await api.revealEntryInFolder(request),
  )

  ipcMain.handle(
    FILE_MANAGER_COPY_TEXT_TO_CLIPBOARD_CHANNEL,
    async (_event, request: CopyTextToClipboardRequest) => await api.copyTextToClipboard(request),
  )
}

function unregisterFileManagerIpcHandlers(ipcMain: IpcMainLike, stopAllWatchers: () => void): void {
  for (const channel of FILE_MANAGER_IPC_CHANNELS) {
    ipcMain.removeHandler(channel)
  }
  stopAllWatchers()
}

// ===== Main factory function =====

export function createElectronFileManagerService(
  options: ElectronFileManagerServiceOptions = {},
): ElectronFileManagerService {
  const { appendLog, getMainWindow, userDataPath } = options

  function log(level: 'info' | 'warn' | 'error', message: string, context?: Record<string, unknown>): void {
    appendLog?.(level, message, context)
  }

  // ---- watcher state ----
  const watchers = new Map<string, fs.FSWatcher>()
  const directoryChangedListeners = new Set<(event: DirectoryChangedEvent) => void>()

  function normalizeWatchFilename(filename: string | Buffer | null | undefined): string | undefined {
    if (filename === null || filename === undefined) return undefined
    const normalized = Buffer.isBuffer(filename) ? filename.toString('utf-8') : filename
    return normalized.length > 0 ? normalized : undefined
  }

  function notifyDirectoryChanged(directoryPath: string, eventType: 'rename' | 'change', filename?: string): void {
    const event: DirectoryChangedEvent = {
      directoryPath: normalizePath(directoryPath),
      eventType,
      ...(filename !== undefined ? { filename } : {}),
      observedAt: new Date().toISOString(),
    }
    for (const listener of directoryChangedListeners) {
      try {
        listener(event)
      } catch {
        // swallow listener errors to avoid breaking other listeners
      }
    }

    // forward to renderer via IPC if a window is available
    try {
      const win = getMainWindow?.()
      if (win !== null && win !== undefined && !win.isDestroyed()) {
        win.webContents.send(FILE_MANAGER_DIRECTORY_CHANGED_CHANNEL, event)
      }
    } catch {
      // ignore forwarding errors (e.g. window closed)
    }
  }

  function startWatching(directoryPath: string): void {
    const resolved = normalizePath(directoryPath)
    if (watchers.has(resolved)) return

    try {
      const watcher = fs.watch(resolved, (eventType, filename) => {
        notifyDirectoryChanged(resolved, eventType, normalizeWatchFilename(filename))
      })
      watcher.on('error', () => {
        // silently tolerated; frontend cleans up stale watchers on next sync
      })
      watchers.set(resolved, watcher)
    } catch {
      // directory may not exist or be unwatchable; skip silently
    }
  }

  function stopWatching(directoryPath: string): void {
    const resolved = normalizePath(directoryPath)
    const watcher = watchers.get(resolved)
    if (watcher !== undefined) {
      try {
        watcher.close()
      } catch {
        // ignore close errors
      }
      watchers.delete(resolved)
    }
  }

  function stopAllWatchers(): void {
    for (const watcher of watchers.values()) {
      try {
        watcher.close()
      } catch {
        // ignore close errors
      }
    }
    watchers.clear()
  }

  const deps: FileManagerServiceDeps = {
    log,
    getMainWindow,
    userDataPath,
    startWatching,
    stopWatching,
    watchers,
    directoryChangedListeners,
  }

  const api = buildFileManagerApi(deps)

  return {
    ...api,
    registerIpcHandlers(ipcMain: IpcMainLike): void {
      registerFileManagerIpcHandlers(ipcMain, api)
    },
    removeIpcHandlers(ipcMain: IpcMainLike): void {
      unregisterFileManagerIpcHandlers(ipcMain, stopAllWatchers)
    },
  }
}

function performTwoLevelProbe(rootPath: string): {
  totalItems: number
  isLarge: boolean
  maxDepth: number
} {
  let totalItems = 0
  let isLarge = false
  let maxDepth = 0

  function walk(dir: string, depth: number): void {
    if (isLarge || depth > PROBE_MAX_DEPTH) return

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    if (depth > maxDepth) {
      maxDepth = depth
    }

    for (const entry of entries) {
      if (isLarge) return

      totalItems++
      if (totalItems >= PROBE_MAX_ITEMS) {
        isLarge = true
        return
      }

      if (entry.isDirectory() && depth < PROBE_MAX_DEPTH) {
        walk(path.join(dir, entry.name), depth + 1)
      }
    }
  }

  walk(rootPath, 0)
  return { totalItems, isLarge, maxDepth }
}

export { generateCopyName, isSubdirectory, listDirectoryEntries, performTwoLevelProbe }
