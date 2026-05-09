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

describe('preload file-manager bridge', () => {
  it('routes file-manager bridge APIs through the expected IPC channels', async () => {
    const invokeMock = getInvokeMock()
    invokeMock.mockResolvedValue(undefined)

    await loadPreloadModule()

    const fileManagerApi = getExposedApi<FileManagerApi>('fileManager')

    await fileManagerApi.selectRootDirectory({ initialPath: '/test/default-root' })

    await fileManagerApi.listDirectory({
      rootPath: '/test/root',
      directoryPath: '/test/root/sub',
    })

    await fileManagerApi.probeDirectory({
      rootPath: '/test/root',
    })

    await fileManagerApi.createDirectory({
      rootPath: '/test/root',
      parentPath: '/test/root/sub',
      name: 'new-folder',
    })

    await fileManagerApi.copyEntries({
      rootPath: '/test/root',
      sourcePaths: ['/test/root/file1.txt', '/test/root/file2.txt'],
      destinationDirectory: '/test/root/target',
      operationType: 'copy',
    })

    await fileManagerApi.moveEntries({
      rootPath: '/test/root',
      sourcePaths: ['/test/root/file1.txt'],
      destinationDirectory: '/test/root/target',
    })

    await fileManagerApi.renameEntry({
      rootPath: '/test/root',
      entryPath: '/test/root/old-name.txt',
      newName: 'new-name.txt',
    })

    await fileManagerApi.trashEntries({
      rootPath: '/test/root',
      entryPaths: ['/test/root/delete-me.txt'],
    })

    await fileManagerApi.deleteEntriesPermanently({
      rootPath: '/test/root',
      entryPaths: ['/test/root/permanent-delete.txt'],
    })

    await fileManagerApi.watchDirectories({
      paths: ['/test/root', '/test/root/sub'],
    })

    await fileManagerApi.unwatchDirectories({
      paths: ['/test/root/sub'],
    })

    // onDirectoryChanged: verify listener registration
    const unsub = fileManagerApi.onDirectoryChanged(() => {})
    unsub()

    await fileManagerApi.loadLastRootDirectory()

    await fileManagerApi.saveLastRootDirectory({
      rootPath: '/test/saved-root',
    })

    await fileManagerApi.clearLastRootDirectory()

    await fileManagerApi.openEntryWithSystem({ path: '/test/file.txt' })

    await fileManagerApi.revealEntryInFolder({ path: '/test/dir' })

    await fileManagerApi.copyTextToClipboard({ text: '/test/copied/path.txt' })

    expect(invokeMock.mock.calls).toEqual([
      [FILE_MANAGER_SELECT_ROOT_DIRECTORY_CHANNEL, { initialPath: '/test/default-root' }],
      [FILE_MANAGER_LIST_DIRECTORY_CHANNEL, { rootPath: '/test/root', directoryPath: '/test/root/sub' }],
      [FILE_MANAGER_PROBE_DIRECTORY_CHANNEL, { rootPath: '/test/root' }],
      [FILE_MANAGER_CREATE_DIRECTORY_CHANNEL, { rootPath: '/test/root', parentPath: '/test/root/sub', name: 'new-folder' }],
      [
        FILE_MANAGER_COPY_ENTRIES_CHANNEL,
        {
          rootPath: '/test/root',
          sourcePaths: ['/test/root/file1.txt', '/test/root/file2.txt'],
          destinationDirectory: '/test/root/target',
          operationType: 'copy',
        },
      ],
      [
        FILE_MANAGER_MOVE_ENTRIES_CHANNEL,
        {
          rootPath: '/test/root',
          sourcePaths: ['/test/root/file1.txt'],
          destinationDirectory: '/test/root/target',
        },
      ],
      [
        FILE_MANAGER_RENAME_ENTRY_CHANNEL,
        {
          rootPath: '/test/root',
          entryPath: '/test/root/old-name.txt',
          newName: 'new-name.txt',
        },
      ],
      [
        FILE_MANAGER_TRASH_ENTRIES_CHANNEL,
        {
          rootPath: '/test/root',
          entryPaths: ['/test/root/delete-me.txt'],
        },
      ],
      [
        FILE_MANAGER_DELETE_ENTRIES_PERMANENTLY_CHANNEL,
        {
          rootPath: '/test/root',
          entryPaths: ['/test/root/permanent-delete.txt'],
        },
      ],
      [
        FILE_MANAGER_WATCH_DIRECTORIES_CHANNEL,
        { paths: ['/test/root', '/test/root/sub'] },
      ],
      [
        FILE_MANAGER_UNWATCH_DIRECTORIES_CHANNEL,
        { paths: ['/test/root/sub'] },
      ],
      [FILE_MANAGER_LOAD_LAST_ROOT_DIRECTORY_CHANNEL],
      [
        FILE_MANAGER_SAVE_LAST_ROOT_DIRECTORY_CHANNEL,
        { rootPath: '/test/saved-root' },
      ],
      [FILE_MANAGER_CLEAR_LAST_ROOT_DIRECTORY_CHANNEL],
      [FILE_MANAGER_OPEN_ENTRY_WITH_SYSTEM_CHANNEL, { path: '/test/file.txt' }],
      [FILE_MANAGER_REVEAL_ENTRY_IN_FOLDER_CHANNEL, { path: '/test/dir' }],
      [FILE_MANAGER_COPY_TEXT_TO_CLIPBOARD_CHANNEL, { text: '/test/copied/path.txt' }],
    ])
  })
})
