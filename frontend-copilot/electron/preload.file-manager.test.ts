import { describe, expect, it } from 'vitest'

import type { FileManagerApi } from './file-manager/ipc'
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
  FILE_MANAGER_WATCH_DIRECTORIES_CHANNEL,
  FILE_MANAGER_UNWATCH_DIRECTORIES_CHANNEL,
  FILE_MANAGER_LOAD_LAST_ROOT_DIRECTORY_CHANNEL,
  FILE_MANAGER_SAVE_LAST_ROOT_DIRECTORY_CHANNEL,
  FILE_MANAGER_CLEAR_LAST_ROOT_DIRECTORY_CHANNEL,
} from './file-manager/ipc'
import { getExposedApi, getInvokeMock, loadPreloadModule } from './preload.test-support'

const ROOT = '/test/root'
const SUB = `${ROOT}/sub`
const TARGET = `${ROOT}/target`
const DEFAULT_ROOT = '/test/default-root'
const FILE1 = `${ROOT}/file1.txt`
const FILE2 = `${ROOT}/file2.txt`
const OLD_NAME = `${ROOT}/old-name.txt`
const DELETE_ME = `${ROOT}/delete-me.txt`
const PERMANENT_DELETE = `${ROOT}/permanent-delete.txt`
const SAVED_ROOT = '/test/saved-root'
const ARBITRARY_FILE = '/test/file.txt'
const ARBITRARY_DIR = '/test/dir'
const COPIED_PATH = '/test/copied/path.txt'
const NEW_FOLDER = 'new-folder'
const NEW_NAME = 'new-name.txt'
const COPY_OP = 'copy'

function buildExpectedIpcCalls(): Array<[string, ...unknown[]]> {
  return [
    [FILE_MANAGER_SELECT_ROOT_DIRECTORY_CHANNEL, { initialPath: DEFAULT_ROOT }],
    [FILE_MANAGER_LIST_DIRECTORY_CHANNEL, { rootPath: ROOT, directoryPath: SUB }],
    [FILE_MANAGER_PROBE_DIRECTORY_CHANNEL, { rootPath: ROOT }],
    [FILE_MANAGER_CREATE_DIRECTORY_CHANNEL, { rootPath: ROOT, parentPath: SUB, name: NEW_FOLDER }],
    [
      FILE_MANAGER_COPY_ENTRIES_CHANNEL,
      { rootPath: ROOT, sourcePaths: [FILE1, FILE2], destinationDirectory: TARGET, operationType: COPY_OP },
    ],
    [FILE_MANAGER_MOVE_ENTRIES_CHANNEL, { rootPath: ROOT, sourcePaths: [FILE1], destinationDirectory: TARGET }],
    [FILE_MANAGER_RENAME_ENTRY_CHANNEL, { rootPath: ROOT, entryPath: OLD_NAME, newName: NEW_NAME }],
    [FILE_MANAGER_TRASH_ENTRIES_CHANNEL, { rootPath: ROOT, entryPaths: [DELETE_ME] }],
    [FILE_MANAGER_DELETE_ENTRIES_PERMANENTLY_CHANNEL, { rootPath: ROOT, entryPaths: [PERMANENT_DELETE] }],
    [FILE_MANAGER_WATCH_DIRECTORIES_CHANNEL, { paths: [ROOT, SUB] }],
    [FILE_MANAGER_UNWATCH_DIRECTORIES_CHANNEL, { paths: [SUB] }],
    [FILE_MANAGER_LOAD_LAST_ROOT_DIRECTORY_CHANNEL],
    [FILE_MANAGER_SAVE_LAST_ROOT_DIRECTORY_CHANNEL, { rootPath: SAVED_ROOT }],
    [FILE_MANAGER_CLEAR_LAST_ROOT_DIRECTORY_CHANNEL],
    [FILE_MANAGER_OPEN_ENTRY_WITH_SYSTEM_CHANNEL, { path: ARBITRARY_FILE }],
    [FILE_MANAGER_REVEAL_ENTRY_IN_FOLDER_CHANNEL, { path: ARBITRARY_DIR }],
    [FILE_MANAGER_COPY_TEXT_TO_CLIPBOARD_CHANNEL, { text: COPIED_PATH }],
  ]
}

describe('preload file-manager bridge', () => {
  it('routes file-manager bridge APIs through the expected IPC channels', async () => {
    const invokeMock = getInvokeMock()
    invokeMock.mockResolvedValue(undefined)

    await loadPreloadModule()

    const fileManagerApi = getExposedApi<FileManagerApi>('fileManager')

    await fileManagerApi.selectRootDirectory({ initialPath: DEFAULT_ROOT })
    await fileManagerApi.listDirectory({ rootPath: ROOT, directoryPath: SUB })
    await fileManagerApi.probeDirectory({ rootPath: ROOT })
    await fileManagerApi.createDirectory({ rootPath: ROOT, parentPath: SUB, name: NEW_FOLDER })
    await fileManagerApi.copyEntries({
      rootPath: ROOT, sourcePaths: [FILE1, FILE2], destinationDirectory: TARGET, operationType: COPY_OP,
    })
    await fileManagerApi.moveEntries({ rootPath: ROOT, sourcePaths: [FILE1], destinationDirectory: TARGET })
    await fileManagerApi.renameEntry({ rootPath: ROOT, entryPath: OLD_NAME, newName: NEW_NAME })
    await fileManagerApi.trashEntries({ rootPath: ROOT, entryPaths: [DELETE_ME] })
    await fileManagerApi.deleteEntriesPermanently({ rootPath: ROOT, entryPaths: [PERMANENT_DELETE] })
    await fileManagerApi.watchDirectories({ paths: [ROOT, SUB] })
    await fileManagerApi.unwatchDirectories({ paths: [SUB] })

    // onDirectoryChanged: verify listener registration
    const unsub = fileManagerApi.onDirectoryChanged(() => {})
    unsub()

    await fileManagerApi.loadLastRootDirectory()
    await fileManagerApi.saveLastRootDirectory({ rootPath: SAVED_ROOT })
    await fileManagerApi.clearLastRootDirectory()
    await fileManagerApi.openEntryWithSystem({ path: ARBITRARY_FILE })
    await fileManagerApi.revealEntryInFolder({ path: ARBITRARY_DIR })
    await fileManagerApi.copyTextToClipboard({ text: COPIED_PATH })

    expect(invokeMock.mock.calls).toEqual(buildExpectedIpcCalls())
  })
})
