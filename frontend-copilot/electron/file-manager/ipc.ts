export const FILE_MANAGER_SELECT_ROOT_DIRECTORY_CHANNEL = 'file-manager:select-root-directory'
export const FILE_MANAGER_LIST_DIRECTORY_CHANNEL = 'file-manager:list-directory'
export const FILE_MANAGER_PROBE_DIRECTORY_CHANNEL = 'file-manager:probe-directory'
export const FILE_MANAGER_CREATE_DIRECTORY_CHANNEL = 'file-manager:create-directory'
export const FILE_MANAGER_COPY_ENTRIES_CHANNEL = 'file-manager:copy-entries'
export const FILE_MANAGER_MOVE_ENTRIES_CHANNEL = 'file-manager:move-entries'
export const FILE_MANAGER_RENAME_ENTRY_CHANNEL = 'file-manager:rename-entry'
export const FILE_MANAGER_TRASH_ENTRIES_CHANNEL = 'file-manager:trash-entries'
export const FILE_MANAGER_DELETE_ENTRIES_PERMANENTLY_CHANNEL = 'file-manager:delete-entries-permanently'
export const FILE_MANAGER_WATCH_DIRECTORIES_CHANNEL = 'file-manager:watch-directories'
export const FILE_MANAGER_UNWATCH_DIRECTORIES_CHANNEL = 'file-manager:unwatch-directories'
export const FILE_MANAGER_DIRECTORY_CHANGED_CHANNEL = 'file-manager:directory-changed'
export const FILE_MANAGER_LOAD_LAST_ROOT_DIRECTORY_CHANNEL = 'file-manager:load-last-root-directory'
export const FILE_MANAGER_SAVE_LAST_ROOT_DIRECTORY_CHANNEL = 'file-manager:save-last-root-directory'
export const FILE_MANAGER_CLEAR_LAST_ROOT_DIRECTORY_CHANNEL = 'file-manager:clear-last-root-directory'
export const FILE_MANAGER_OPEN_ENTRY_WITH_SYSTEM_CHANNEL = 'file-manager:open-entry-with-system'
export const FILE_MANAGER_REVEAL_ENTRY_IN_FOLDER_CHANNEL = 'file-manager:reveal-entry-in-folder'
export const FILE_MANAGER_COPY_TEXT_TO_CLIPBOARD_CHANNEL = 'file-manager:copy-text-to-clipboard'
export const FILE_MANAGER_SAVE_PASTED_FILE_CHANNEL = 'file-manager:save-pasted-file'

export interface FileTreeEntry {
  id: string
  path: string
  name: string
  kind: 'file' | 'directory'
  parentPath: string | null
  size: number | null
  modifiedAt: string | null
  hasChildren: boolean | null
}

export type FileManagerErrorCode =
  | 'not_found'
  | 'permission_denied'
  | 'invalid_operation'
  | 'trash_unavailable'
  | 'io_error'
  | 'unknown'

export interface FileManagerError {
  ok: false
  code: FileManagerErrorCode
  message: string
  details?: string
}

export function createFileManagerError(
  code: FileManagerErrorCode,
  message: string,
  details?: string,
): FileManagerError {
  return { ok: false, code, message, ...(details !== undefined ? { details } : {}) }
}

export interface SelectDirectorySuccess {
  ok: true
  rootPath: string
  entries: FileTreeEntry[]
}

export type SelectDirectoryResult = SelectDirectorySuccess | FileManagerError

export interface ListDirectoryRequest {
  rootPath: string
  directoryPath: string
}

export interface ListDirectorySuccess {
  ok: true
  entries: FileTreeEntry[]
}

export type ListDirectoryResult = ListDirectorySuccess | FileManagerError

export interface ProbeDirectoryRequest {
  rootPath: string
}

export interface ProbeDirectorySuccess {
  ok: true
  totalItems: number
  isLarge: boolean
  maxDepth: number
}

export type ProbeDirectoryResult = ProbeDirectorySuccess | FileManagerError

export interface CreateDirectoryRequest {
  rootPath: string
  parentPath: string
  name: string
}

export interface FileOperationSuccess {
  ok: true
  affectedPaths: string[]
  failedItems?: { path: string; reason: string }[]
}

export type FileOperationResult = FileOperationSuccess | FileManagerError

export interface CopyEntriesRequest {
  rootPath: string
  sourcePaths: string[]
  destinationDirectory: string
  operationType: 'copy' | 'cut'
}

export interface MoveEntriesRequest {
  rootPath: string
  sourcePaths: string[]
  destinationDirectory: string
}

export interface RenameEntryRequest {
  rootPath: string
  entryPath: string
  newName: string
}

export interface TrashEntriesRequest {
  rootPath: string
  entryPaths: string[]
}

export interface DeleteEntriesRequest {
  rootPath: string
  entryPaths: string[]
}

export interface WatchDirectoriesRequest {
  paths: string[]
}

export interface UnwatchDirectoriesRequest {
  paths: string[]
}

export interface DirectoryChangedEvent {
  directoryPath: string
  eventType: 'rename' | 'change' | 'unknown'
  filename?: string
  observedAt: string
}

export interface SaveLastRootDirectoryRequest {
  rootPath: string
}

export interface SelectRootDirectoryRequest {
  initialPath?: string
}

export interface LoadLastRootDirectorySuccess {
  ok: true
  rootPath: string | null
}

export type LoadLastRootDirectoryResult = LoadLastRootDirectorySuccess | FileManagerError

export interface OpenEntryWithSystemRequest {
  path: string
}

export interface RevealEntryInFolderRequest {
  path: string
}

export interface CopyTextToClipboardRequest {
  text: string
}

export interface SavePastedFileRequest {
  name: string
  content: ArrayBuffer | Uint8Array
}

export interface SavePastedFileSuccess {
  ok: true
  filePath: string
}

export type SavePastedFileResult = SavePastedFileSuccess | FileManagerError

export interface FileManagerApi {
  selectRootDirectory(request?: SelectRootDirectoryRequest): Promise<SelectDirectoryResult>
  listDirectory(request: ListDirectoryRequest): Promise<ListDirectoryResult>
  probeDirectory(request: ProbeDirectoryRequest): Promise<ProbeDirectoryResult>
  createDirectory(request: CreateDirectoryRequest): Promise<FileOperationResult>
  copyEntries(request: CopyEntriesRequest): Promise<FileOperationResult>
  moveEntries(request: MoveEntriesRequest): Promise<FileOperationResult>
  renameEntry(request: RenameEntryRequest): Promise<FileOperationResult>
  trashEntries(request: TrashEntriesRequest): Promise<FileOperationResult>
  deleteEntriesPermanently(request: DeleteEntriesRequest): Promise<FileOperationResult>
  watchDirectories(request: WatchDirectoriesRequest): Promise<FileOperationResult>
  unwatchDirectories(request: UnwatchDirectoriesRequest): Promise<FileOperationResult>
  onDirectoryChanged(listener: (event: DirectoryChangedEvent) => void): () => void
  loadLastRootDirectory(): Promise<LoadLastRootDirectoryResult>
  saveLastRootDirectory(request: SaveLastRootDirectoryRequest): Promise<FileOperationResult>
  clearLastRootDirectory(): Promise<FileOperationResult>
  openEntryWithSystem(request: OpenEntryWithSystemRequest): Promise<FileOperationResult>
  revealEntryInFolder(request: RevealEntryInFolderRequest): Promise<FileOperationResult>
  copyTextToClipboard(request: CopyTextToClipboardRequest): Promise<FileOperationResult>
  savePastedFile(request: SavePastedFileRequest): Promise<SavePastedFileResult>
}
