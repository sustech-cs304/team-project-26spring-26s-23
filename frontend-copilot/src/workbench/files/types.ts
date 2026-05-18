import type { FileTreeEntry } from '../../../electron/file-manager/ipc'

export interface ClipboardIntent {
  operation: 'copy' | 'cut'
  sourcePaths: string[]
  sourceRoot: string
}

export interface VisibleTreeNode {
  entry: FileTreeEntry
  depth: number
  parentPath: string | null
}

export type FileOperationStatus =
  | 'idle'
  | 'selecting-root'
  | 'loading-children'
  | 'probing'
  | 'copying'
  | 'moving'
  | 'renaming'
  | 'deleting'
  | 'creating-directory'
  | 'refreshing'

export interface FileWorkspaceState {
  rootPath: string | null
  rootEntries: FileTreeEntry[]
  entriesCache: Map<string, FileTreeEntry[]>
  expandedPaths: Set<string>
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
}
