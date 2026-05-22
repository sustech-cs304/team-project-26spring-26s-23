/** @vitest-environment jsdom */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import type {
  DirectoryChangedEvent,
  FileManagerApi,
  FileTreeEntry,
  ListDirectoryResult,
  ProbeDirectoryResult,
  SelectDirectoryResult,
  FileOperationResult,
  LoadLastRootDirectoryResult,
} from '../../../electron/file-manager/ipc'

import { FilesWorkspace } from './FilesWorkspace'
import { syncWatchedDirectories } from './watcher-helpers'
import {
  setPostChangeHookListener,
} from './file-workspace-events'
import type { FileWorkspacePostChangeHookPayload } from './file-workspace-events'

function createFileEntry(overrides: Partial<FileTreeEntry> = {}): FileTreeEntry {
  return {
    id: overrides.id ?? overrides.path ?? '/test/file.txt',
    path: overrides.path ?? '/test/file.txt',
    name: overrides.name ?? 'file.txt',
    kind: overrides.kind ?? 'file',
    parentPath: overrides.parentPath ?? '/test',
    size: overrides.size ?? 1024,
    modifiedAt: overrides.modifiedAt ?? '2026-04-27T00:00:00.000Z',
    hasChildren: overrides.hasChildren ?? null,
  }
}

function createDirEntry(overrides: Partial<FileTreeEntry> = {}): FileTreeEntry {
  return createFileEntry({
    kind: 'directory',
    hasChildren: overrides.hasChildren ?? true,
    size: null,
    ...overrides,
  })
}

function createMockFileManagerApi(): FileManagerApi {
  return {
    selectRootDirectory: vi.fn<() => Promise<SelectDirectoryResult>>(),
    listDirectory: vi.fn<() => Promise<ListDirectoryResult>>(),
    probeDirectory: vi.fn<() => Promise<ProbeDirectoryResult>>(),
    createDirectory: vi.fn<() => Promise<FileOperationResult>>(),
    copyEntries: vi.fn<() => Promise<FileOperationResult>>(),
    moveEntries: vi.fn<() => Promise<FileOperationResult>>(),
    renameEntry: vi.fn<() => Promise<FileOperationResult>>(),
    trashEntries: vi.fn<() => Promise<FileOperationResult>>(),
    deleteEntriesPermanently: vi.fn<() => Promise<FileOperationResult>>(),
    watchDirectories: vi.fn<() => Promise<FileOperationResult>>(),
    unwatchDirectories: vi.fn<() => Promise<FileOperationResult>>(),
    onDirectoryChanged: vi.fn<() => () => void>(),
    loadLastRootDirectory: vi.fn<() => Promise<LoadLastRootDirectoryResult>>(),
    saveLastRootDirectory: vi.fn<() => Promise<FileOperationResult>>(),
    clearLastRootDirectory: vi.fn<() => Promise<FileOperationResult>>(),
    openEntryWithSystem: vi.fn<() => Promise<FileOperationResult>>(),
    revealEntryInFolder: vi.fn<() => Promise<FileOperationResult>>(),
    copyTextToClipboard: vi.fn<() => Promise<FileOperationResult>>(),
  }
}

interface RenderedTest {
  container: HTMLDivElement
  getByText: (text: string) => HTMLElement
  queryByText: (text: string) => HTMLElement | null
  unmount: () => void
}

const activeRenderedRoots: Array<{
  container: HTMLDivElement
  root: ReturnType<typeof createRoot>
}> = []

function renderFilesWorkspace(): RenderedTest {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  activeRenderedRoots.push({ container, root })

  act(() => {
    root.render(<FilesWorkspace />)
  })

  return {
    container,
    getByText(text: string) {
      const target = Array.from(container.querySelectorAll<HTMLElement>('*')).find((element) => {
        return element.textContent?.trim() === text
      })
      if (target === undefined) {
        throw new Error(`Missing element for text=${text}`)
      }
      return target
    },
    queryByText(text: string) {
      const target = Array.from(container.querySelectorAll<HTMLElement>('*')).find((element) => {
        return element.textContent?.trim() === text
      })
      return target ?? null
    },
    unmount() {
      const index = activeRenderedRoots.findIndex((entry) => entry.root === root)
      if (index >= 0) {
        activeRenderedRoots.splice(index, 1)
      }
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

async function selectRoot(container: HTMLElement, mockApi: FileManagerApi): Promise<void> {
  vi.mocked(mockApi.selectRootDirectory).mockResolvedValueOnce({
    ok: true,
    rootPath: '/test',
    entries: [
      createDirEntry({ path: '/test/folder1', name: 'folder1' }),
      createFileEntry({ path: '/test/file1.txt', name: 'file1.txt' }),
      createFileEntry({ path: '/test/file2.txt', name: 'file2.txt' }),
    ],
  })

  vi.mocked(mockApi.probeDirectory).mockResolvedValueOnce({
    ok: true,
    totalItems: 3,
    isLarge: false,
    maxDepth: 2,
  })

  const selectButton = Array.from(container.querySelectorAll('.file-toolbar button')).find(
    (btn) => btn.textContent?.includes('选择文件夹'),
  ) as HTMLButtonElement

  await act(async () => {
    selectButton.click()
  })
}

function findRowByName(container: HTMLElement, name: string): HTMLDivElement {
  const row = Array.from(container.querySelectorAll('.file-tree__row')).find((element) => {
    return element.querySelector('.file-tree__name')?.textContent?.trim() === name
  })

  if (!row) {
    throw new Error(`Missing file tree row for name=${name}`)
  }

  return row as HTMLDivElement
}

async function openContextMenu(row: HTMLElement): Promise<HTMLElement> {
  await act(async () => {
    const event = new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 })
    row.dispatchEvent(event)
  })

  const menu = document.querySelector('.file-context-menu')
  if (!menu) {
    throw new Error('Missing context menu')
  }

  return menu as HTMLElement
}

function findContextMenuItem(label: string): HTMLButtonElement {
  const item = Array.from(document.querySelectorAll('.file-context-menu__item')).find((element) => {
    return element.textContent?.trim() === label
  })

  if (!item) {
    throw new Error(`Missing context menu item for label=${label}`)
  }

  return item as HTMLButtonElement
}

// eslint-disable-next-line max-lines-per-function
describe('FilesWorkspace drag, delete & keyboard', () => {
  let mockApi: FileManagerApi

  beforeEach(() => {
    mockApi = createMockFileManagerApi()
    ;(window as unknown as Record<string, unknown>).fileManager = mockApi

    vi.mocked(mockApi.loadLastRootDirectory).mockResolvedValue({
      ok: true,
      rootPath: null,
    })

    vi.mocked(mockApi.watchDirectories).mockResolvedValue({ ok: true, affectedPaths: [] })
    vi.mocked(mockApi.unwatchDirectories).mockResolvedValue({ ok: true, affectedPaths: [] })
    vi.mocked(mockApi.saveLastRootDirectory).mockResolvedValue({ ok: true, affectedPaths: [] })
    vi.mocked(mockApi.clearLastRootDirectory).mockResolvedValue({ ok: true, affectedPaths: [] })

    vi.mocked(mockApi.onDirectoryChanged).mockReturnValue(() => {})
  })

  afterEach(() => {
    for (const { root, container } of activeRenderedRoots.splice(0)) {
      act(() => {
        root.unmount()
      })
      container.remove()
    }
    document.body.innerHTML = ''
  })

  // eslint-disable-next-line max-lines-per-function
  describe('drag-and-drop move (revised)', () => {
    beforeAll(() => {
      if (typeof DragEvent === 'undefined') {
        (window as unknown as Record<string, unknown>).DragEvent = class DragEvent extends MouseEvent {
          dataTransfer: DataTransfer | null = null
          constructor(type: string, eventInitDict?: DragEventInit) {
            super(type, eventInitDict)
            if (eventInitDict?.dataTransfer) {
              this.dataTransfer = eventInitDict.dataTransfer
            }
          }
        } as unknown as typeof DragEvent
      }
    })

    function createMockDataTransfer(data: string, dropEffect = 'move'): DataTransfer {
      return {
        getData: vi.fn().mockReturnValue(data),
        setData: vi.fn(),
        dropEffect,
        effectAllowed: 'move',
        items: [] as unknown as DataTransferItemList,
        types: [],
        files: {} as FileList,
        clearData: vi.fn(),
        setDragImage: vi.fn(),
      } as unknown as DataTransfer
    }

    async function selectRootWithFolders(container: HTMLElement): Promise<void> {
      vi.mocked(mockApi.selectRootDirectory).mockResolvedValueOnce({
        ok: true,
        rootPath: '/test',
        entries: [
          createDirEntry({ path: '/test/folder1', name: 'folder1' }),
          createDirEntry({ path: '/test/folder2', name: 'folder2' }),
          createFileEntry({ path: '/test/file1.txt', name: 'file1.txt' }),
        ],
      })
      vi.mocked(mockApi.probeDirectory).mockResolvedValueOnce({
        ok: true,
        totalItems: 3,
        isLarge: false,
        maxDepth: 2,
      })

      const selectButton = Array.from(container.querySelectorAll('.file-toolbar button')).find(
        (btn) => btn.textContent?.includes('选择文件夹'),
      ) as HTMLButtonElement

      await act(async () => {
        selectButton.click()
      })
    }

    it('calls moveEntries when dropping a file onto a folder', async () => {
      const { container } = renderFilesWorkspace()
      await selectRootWithFolders(container)

      const moveEntriesMock = vi.mocked(mockApi.moveEntries)
      moveEntriesMock.mockResolvedValueOnce({
        ok: true,
        affectedPaths: ['/test/file1.txt', '/test/folder2'],
      })

      vi.mocked(mockApi.listDirectory).mockResolvedValue({ ok: true, entries: [] })

      const allRows = Array.from(container.querySelectorAll('.file-tree__row'))
      const fileRow = allRows.find((r) => r.querySelector('.file-tree__name')?.textContent?.trim() === 'file1.txt') as HTMLDivElement
      const folderRow = allRows.find((r) => r.querySelector('.file-tree__name')?.textContent?.trim() === 'folder2') as HTMLDivElement
      expect(fileRow).toBeTruthy()
      expect(folderRow).toBeTruthy()

      await act(async () => {
        fileRow.click()
      })

      await act(async () => {
        const dt = createMockDataTransfer(JSON.stringify(['/test/file1.txt']))
        const dragStartEvent = new DragEvent('dragstart', { bubbles: true }) as MouseEvent
        Object.defineProperty(dragStartEvent, 'dataTransfer', { value: dt, writable: false })
        fileRow.dispatchEvent(dragStartEvent)
      })

      await act(async () => {
        const dt2 = createMockDataTransfer(JSON.stringify(['/test/file1.txt']))
        const dragOverEvent = new DragEvent('dragover', { bubbles: true, cancelable: true }) as MouseEvent
        Object.defineProperty(dragOverEvent, 'dataTransfer', { value: dt2, writable: false })
        folderRow.dispatchEvent(dragOverEvent)
      })

      expect(folderRow.classList.contains('file-tree__row--drag-over')).toBe(true)

      await act(async () => {
        const dt3 = createMockDataTransfer(JSON.stringify(['/test/file1.txt']))
        const dropEvent = new DragEvent('drop', { bubbles: true, cancelable: true }) as MouseEvent
        Object.defineProperty(dropEvent, 'dataTransfer', { value: dt3, writable: false })
        folderRow.dispatchEvent(dropEvent)
      })

      expect(moveEntriesMock).toHaveBeenCalledWith({
        rootPath: '/test',
        sourcePaths: ['/test/file1.txt'],
        destinationDirectory: '/test/folder2',
      })
    })

    it('clears drag-over state on drag end without dropping', async () => {
      const { container } = renderFilesWorkspace()
      await selectRootWithFolders(container)

      const allRows = Array.from(container.querySelectorAll('.file-tree__row'))
      const fileRow = allRows.find((r) => r.querySelector('.file-tree__name')?.textContent?.trim() === 'file1.txt') as HTMLDivElement
      const folderRow = allRows.find((r) => r.querySelector('.file-tree__name')?.textContent?.trim() === 'folder2') as HTMLDivElement

      await act(async () => {
        const dt = createMockDataTransfer(JSON.stringify(['/test/file1.txt']))
        const dragOverEvent = new DragEvent('dragover', { bubbles: true, cancelable: true }) as MouseEvent
        Object.defineProperty(dragOverEvent, 'dataTransfer', { value: dt, writable: false })
        folderRow.dispatchEvent(dragOverEvent)
      })

      expect(folderRow.classList.contains('file-tree__row--drag-over')).toBe(true)

      await act(async () => {
        const dragEndEvent = new DragEvent('dragend', { bubbles: true }) as MouseEvent
        Object.defineProperty(dragEndEvent, 'dataTransfer', { value: createMockDataTransfer('[]'), writable: false })
        fileRow.dispatchEvent(dragEndEvent)
      })

      expect(folderRow.classList.contains('file-tree__row--drag-over')).toBe(false)
    })

    it('does not call moveEntries when dropping a folder onto itself', async () => {
      const { container } = renderFilesWorkspace()
      await selectRootWithFolders(container)

      const moveEntriesMock = vi.mocked(mockApi.moveEntries)
      const folderRow = findRowByName(container, 'folder1')

      await act(async () => {
        const dt = createMockDataTransfer(JSON.stringify(['/test/folder1']))
        const dragOverEvent = new DragEvent('dragover', { bubbles: true, cancelable: true }) as MouseEvent
        Object.defineProperty(dragOverEvent, 'dataTransfer', { value: dt, writable: false })
        folderRow.dispatchEvent(dragOverEvent)
      })

      expect(folderRow.classList.contains('file-tree__row--drag-over')).toBe(false)

      await act(async () => {
        const dt = createMockDataTransfer(JSON.stringify(['/test/folder1']))
        const dropEvent = new DragEvent('drop', { bubbles: true, cancelable: true }) as MouseEvent
        Object.defineProperty(dropEvent, 'dataTransfer', { value: dt, writable: false })
        folderRow.dispatchEvent(dropEvent)
      })

      expect(moveEntriesMock).not.toHaveBeenCalled()
      expect(container.textContent).toContain('不能将项目移动到自身或其子目录中')
    })

    it('does NOT call moveEntries when dropping onto a file node', async () => {
      const { container } = renderFilesWorkspace()
      await selectRootWithFolders(container)

      const moveEntriesMock = vi.mocked(mockApi.moveEntries)

      const allRows = Array.from(container.querySelectorAll('.file-tree__row'))
      const folderRow = allRows.find((r) => r.querySelector('.file-tree__name')?.textContent?.trim() === 'folder1') as HTMLDivElement
      const fileRow = allRows.find((r) => r.querySelector('.file-tree__name')?.textContent?.trim() === 'file1.txt') as HTMLDivElement
      expect(folderRow).toBeTruthy()
      expect(fileRow).toBeTruthy()

      await act(async () => {
        const dt = createMockDataTransfer(JSON.stringify(['/test/folder1']))
        const dragStartEvent = new DragEvent('dragstart', { bubbles: true }) as MouseEvent
        Object.defineProperty(dragStartEvent, 'dataTransfer', { value: dt, writable: false })
        folderRow.dispatchEvent(dragStartEvent)
      })

      await act(async () => {
        const dt2 = createMockDataTransfer(JSON.stringify(['/test/folder1']), 'none')
        const dragOverEvent = new DragEvent('dragover', { bubbles: true, cancelable: true }) as MouseEvent
        Object.defineProperty(dragOverEvent, 'dataTransfer', { value: dt2, writable: false })
        fileRow.dispatchEvent(dragOverEvent)
      })

      expect(fileRow.classList.contains('file-tree__row--drag-over')).toBe(false)

      expect(moveEntriesMock).not.toHaveBeenCalled()
    })
  })

  describe('delete flow', () => {
    async function selectRootWithOneFile(container: HTMLElement): Promise<void> {
      vi.mocked(mockApi.selectRootDirectory).mockResolvedValueOnce({
        ok: true,
        rootPath: '/test',
        entries: [
          createFileEntry({ path: '/test/file1.txt', name: 'file1.txt' }),
        ],
      })
      vi.mocked(mockApi.probeDirectory).mockResolvedValueOnce({
        ok: true,
        totalItems: 1,
        isLarge: false,
        maxDepth: 2,
      })

      const selectButton = Array.from(container.querySelectorAll('.file-toolbar button')).find(
        (btn) => btn.textContent?.includes('选择文件夹'),
      ) as HTMLButtonElement

      await act(async () => {
        selectButton.click()
      })

      const rows = Array.from(container.querySelectorAll('.file-tree__row'))
      const fileRow = rows.find((r) => r.querySelector('.file-tree__name')?.textContent?.trim() === 'file1.txt')
      expect(fileRow).toBeTruthy()
      await act(async () => {
        (fileRow as HTMLDivElement).click()
      })
    }

    it('calls trashEntries and shows success when trash succeeds (via context menu)', async () => {
      const { container } = renderFilesWorkspace()
      await selectRootWithOneFile(container)

      const mockTrashEntries = vi.mocked(mockApi.trashEntries)
      mockTrashEntries.mockReset()
      mockTrashEntries.mockResolvedValue({
        ok: true,
        affectedPaths: ['/test/file1.txt'],
      })

      const rows = Array.from(container.querySelectorAll('.file-tree__row'))
      const row = rows.find((r) => r.querySelector('.file-tree__name')?.textContent?.trim() === 'file1.txt') as HTMLDivElement
      expect(row).toBeTruthy()
      await act(async () => {
        const event = new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 })
        row.dispatchEvent(event)
      })

      const deleteMenuItem = Array.from(
        document.querySelectorAll('.file-context-menu__item'),
      ).find((item) => item.textContent?.trim() === '删除') as HTMLButtonElement

      expect(deleteMenuItem).toBeTruthy()

      await act(async () => {
        deleteMenuItem.click()
      })

      expect(mockTrashEntries).toHaveBeenCalled()
      expect(mockTrashEntries.mock.calls[0][0]).toMatchObject({
        rootPath: '/test',
      })
    })

    it('opens permanent delete confirmation when trash is unavailable', async () => {
      const { container } = renderFilesWorkspace()
      await selectRootWithOneFile(container)

      vi.mocked(mockApi.trashEntries).mockResolvedValueOnce({
        ok: false,
        code: 'trash_unavailable',
        message: '所有条目移入回收站失败，可尝试永久删除',
      })
      vi.mocked(mockApi.deleteEntriesPermanently).mockResolvedValueOnce({
        ok: true,
        affectedPaths: ['/test/file1.txt'],
      })
      vi.mocked(mockApi.listDirectory).mockResolvedValue({ ok: true, entries: [] })

      const row = findRowByName(container, 'file1.txt')
      await openContextMenu(row)

      await act(async () => {
        findContextMenuItem('删除').click()
      })

      expect(container.querySelector('.confirm-dialog')).toBeTruthy()
      expect(container.textContent).toContain('永久删除 1 个项目')

      await act(async () => {
        const confirmButton = Array.from(container.querySelectorAll('.confirm-dialog__actions button')).find((button) => {
          return button.textContent?.includes('永久删除')
        }) as HTMLButtonElement
        confirmButton.click()
      })

      expect(mockApi.deleteEntriesPermanently).toHaveBeenCalledWith({
        rootPath: '/test',
        entryPaths: ['/test/file1.txt'],
      })
    })

    it('keeps a permanent-delete fallback for partial trash failures', async () => {
      const { container } = renderFilesWorkspace()
      await selectRootWithOneFile(container)

      vi.mocked(mockApi.trashEntries).mockResolvedValueOnce({
        ok: true,
        affectedPaths: [],
        failedItems: [{ path: '/test/file1.txt', reason: '移入回收站失败，可尝试永久删除' }],
      })

      const row = findRowByName(container, 'file1.txt')
      await openContextMenu(row)

      await act(async () => {
        findContextMenuItem('删除').click()
      })

      expect(container.querySelector('.confirm-dialog')).toBeTruthy()
      expect(container.textContent).toContain('永久删除 1 个项目')
    })
  })

  // eslint-disable-next-line max-lines-per-function
  describe('keyboard navigation', () => {
    async function setupTreeWithMixedEntries(
      container: HTMLElement,
      listDirMock = vi.mocked(mockApi.listDirectory),
    ): Promise<void> {
      vi.mocked(mockApi.selectRootDirectory).mockResolvedValueOnce({
        ok: true,
        rootPath: '/test',
        entries: [
          createDirEntry({ path: '/test/folder1', name: 'folder1' }),
          createFileEntry({ path: '/test/file1.txt', name: 'file1.txt' }),
          createFileEntry({ path: '/test/file2.txt', name: 'file2.txt' }),
          createDirEntry({ path: '/test/folder2', name: 'folder2' }),
        ],
      })
      vi.mocked(mockApi.probeDirectory).mockResolvedValueOnce({
        ok: true,
        totalItems: 4,
        isLarge: false,
        maxDepth: 2,
      })
      listDirMock.mockResolvedValue({
        ok: true,
        entries: [
          createFileEntry({
            path: '/test/folder1/nested.txt',
            name: 'nested.txt',
            parentPath: '/test/folder1',
          }),
        ],
      })

      const selectButton = Array.from(container.querySelectorAll('.file-toolbar button')).find(
        (btn) => btn.textContent?.includes('选择文件夹'),
      ) as HTMLButtonElement

      await act(async () => {
        selectButton.click()
      })
    }

    async function keyDown(
      key: string,
      modifiers: { ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean } = {},
    ): Promise<void> {
      const tree = document.querySelector('.file-tree') as HTMLDivElement
      if (!tree) throw new Error('Missing .file-tree element')
      await act(async () => {
        tree.dispatchEvent(
          new KeyboardEvent('keydown', {
            key,
            bubbles: true,
            cancelable: true,
            ctrlKey: modifiers.ctrlKey ?? false,
            shiftKey: modifiers.shiftKey ?? false,
            metaKey: modifiers.metaKey ?? false,
          }),
        )
        await Promise.resolve()
      })
    }

    function getRows(): HTMLDivElement[] {
      return Array.from(document.querySelectorAll('.file-tree__row')) as HTMLDivElement[]
    }

    function getFocusedRow(): HTMLDivElement | undefined {
      return getRows().find((r) => r.classList.contains('file-tree__row--focused'))
    }

    function getRowByName(name: string): HTMLDivElement {
      const row = getRows().find((candidate) => rowName(candidate) === name)
      if (!row) {
        throw new Error(`Missing visible row for name=${name}`)
      }
      return row
    }

    function rowName(row: HTMLDivElement): string {
      return row.querySelector('.file-tree__name')?.textContent?.trim()
        ?? (row.querySelector('.file-tree__rename-input') as HTMLInputElement | null)?.value
        ?? ''
    }

    async function clickRow(
      row: HTMLDivElement,
      modifiers: { ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean } = {},
    ): Promise<void> {
      await act(async () => {
        row.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            ctrlKey: modifiers.ctrlKey ?? false,
            shiftKey: modifiers.shiftKey ?? false,
            metaKey: modifiers.metaKey ?? false,
          }),
        )
      })
    }

    async function focusRowWithoutExpanding(row: HTMLDivElement): Promise<void> {
      await clickRow(row, { ctrlKey: true })
    }

    it('file-tree container is focusable (tabIndex=0)', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      const tree = container.querySelector('.file-tree') as HTMLDivElement
      expect(tree).toBeTruthy()
      expect(tree.tabIndex).toBe(0)
    })

    it('ArrowDown moves focus down in visible order and single-selects', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      const rows = getRows()
      await focusRowWithoutExpanding(rows[0])
      expect(rowName(rows[0])).toBe('folder1')
      expect(rows[0].classList.contains('file-tree__row--focused')).toBe(true)
      expect(rows[0].classList.contains('file-tree__row--selected')).toBe(true)

      await keyDown('ArrowDown')
      expect(rowName(getFocusedRow()!)).toBe('folder2')
      expect(getFocusedRow()!.classList.contains('file-tree__row--selected')).toBe(true)
      expect(rows[0].classList.contains('file-tree__row--selected')).toBe(false)
    })

    it('ArrowUp moves focus up in visible order', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      await clickRow(getRowByName('file2.txt'))
      expect(rowName(getFocusedRow()!)).toBe('file2.txt')

      await keyDown('ArrowUp')
      expect(rowName(getFocusedRow()!)).toBe('file1.txt')

      await keyDown('ArrowUp')
      expect(rowName(getFocusedRow()!)).toBe('folder2')
    })

    it('Ctrl+ArrowDown moves focus without changing selection', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      const rows = getRows()
      await focusRowWithoutExpanding(rows[0])
      expect(rows[0].classList.contains('file-tree__row--selected')).toBe(true)

      await keyDown('ArrowDown', { ctrlKey: true })
      expect(rowName(getFocusedRow()!)).toBe('folder2')
      expect(rows[0].classList.contains('file-tree__row--selected')).toBe(true)
      expect(rows[1].classList.contains('file-tree__row--selected')).toBe(false)
    })

    it('Shift+ArrowDown extends continuous selection', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      const rows = getRows()
      await focusRowWithoutExpanding(rows[0])

      await keyDown('ArrowDown', { shiftKey: true })
      expect(rowName(getFocusedRow()!)).toBe('folder2')
      expect(rows[0].classList.contains('file-tree__row--selected')).toBe(true)
      expect(rows[1].classList.contains('file-tree__row--selected')).toBe(true)

      await keyDown('ArrowDown', { shiftKey: true })
      expect(rowName(getFocusedRow()!)).toBe('file1.txt')
      expect(rows[0].classList.contains('file-tree__row--selected')).toBe(true)
      expect(rows[1].classList.contains('file-tree__row--selected')).toBe(true)
      expect(rows[2].classList.contains('file-tree__row--selected')).toBe(true)
    })

    it('ArrowRight expands an unexpanded folder', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      const rows = getRows()
      await focusRowWithoutExpanding(rows[0])

      await keyDown('ArrowRight')

      await act(async () => {
        await vi.waitFor(() => {
          const expandBtn = rows[0].querySelector('.file-tree__expand')
          return expandBtn?.classList.contains('file-tree__expand--expanded')
        }, { timeout: 2000 })
      })

      const nestedRow = getRows().find((r) => rowName(r) === 'nested.txt')
      expect(nestedRow).toBeTruthy()
    })

    it('ArrowRight on expanded folder moves focus to first child', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      const rows = getRows()
      await focusRowWithoutExpanding(rows[0])

      await keyDown('ArrowRight')
      await act(async () => {
        await vi.waitFor(() => {
          return getRows().some((r) => rowName(r) === 'nested.txt')
        }, { timeout: 2000 })
      })

      await keyDown('ArrowRight')
      expect(rowName(getFocusedRow()!)).toBe('nested.txt')
    })

    it('ArrowLeft collapses an expanded folder', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      const rows = getRows()
      await focusRowWithoutExpanding(rows[0])

      await keyDown('ArrowRight')
      await act(async () => {
        await vi.waitFor(() => {
          return getRows().some((r) => rowName(r) === 'nested.txt')
        }, { timeout: 2000 })
      })

      await keyDown('ArrowLeft')

      const expandBtn = rows[0].querySelector('.file-tree__expand')
      expect(expandBtn?.classList.contains('file-tree__expand--expanded')).toBe(false)
    })

    it('ArrowLeft on a file moves focus to parent', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      const rows = getRows()
      await focusRowWithoutExpanding(rows[0])

      await keyDown('ArrowRight')
      await act(async () => {
        await vi.waitFor(() => {
          return getRows().some((r) => rowName(r) === 'nested.txt')
        }, { timeout: 2000 })
      })

      await keyDown('ArrowDown')
      expect(rowName(getFocusedRow()!)).toBe('nested.txt')

      await keyDown('ArrowLeft')
      expect(rowName(getFocusedRow()!)).toBe('folder1')
    })

    it('Enter expands or collapses a folder', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      const rows = getRows()
      await focusRowWithoutExpanding(rows[0])

      await keyDown('Enter')
      await act(async () => {
        await vi.waitFor(() => {
          return getRows().some((r) => rowName(r) === 'nested.txt')
        }, { timeout: 2000 })
      })

      await keyDown('Enter')
      const expandBtn = rows[0].querySelector('.file-tree__expand')
      expect(expandBtn?.classList.contains('file-tree__expand--expanded')).toBe(false)
    })

    it('Enter on a file does nothing', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      await clickRow(getRowByName('file1.txt'))

      const focusedBefore = rowName(getFocusedRow()!)
      await keyDown('Enter')
      expect(rowName(getFocusedRow()!)).toBe(focusedBefore)
    })

    it('Space toggles selection on focused item', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      const rows = getRows()
      await focusRowWithoutExpanding(rows[0])

      await keyDown(' ')
      expect(rows[0].classList.contains('file-tree__row--selected')).toBe(false)

      await keyDown(' ')
      expect(rows[0].classList.contains('file-tree__row--selected')).toBe(true)
    })

    it('Delete triggers trash operation on focused item when nothing selected', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      vi.mocked(mockApi.trashEntries).mockResolvedValueOnce({
        ok: true,
        affectedPaths: ['/test/file1.txt'],
      })

      await clickRow(getRowByName('file1.txt'))

      vi.mocked(mockApi.trashEntries).mockResolvedValueOnce({
        ok: true,
        affectedPaths: ['/test/file1.txt'],
      })
      vi.mocked(mockApi.listDirectory).mockResolvedValue({ ok: true, entries: [] })

      await keyDown('Delete')

      expect(mockApi.trashEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          rootPath: '/test',
          entryPaths: ['/test/file1.txt'],
        }),
      )
    })

    it('F2 triggers rename on focused item', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      await clickRow(getRowByName('file1.txt'))

      await keyDown('F2')

      const renameInput = getRowByName('file1.txt').querySelector('.file-tree__rename-input') as HTMLInputElement
      expect(renameInput).toBeTruthy()
      expect(renameInput.value).toBe('file1.txt')
    })

    it('F2 triggers rename on single selected item when no focus', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      await clickRow(getRowByName('file1.txt'))

      await keyDown('F2')

      const renameInput = getRowByName('file1.txt').querySelector('.file-tree__rename-input') as HTMLInputElement
      expect(renameInput).toBeTruthy()
    })

    it('Ctrl+C copies selected item', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      await clickRow(getRowByName('file1.txt'))

      await keyDown('c', { ctrlKey: true })

      expect(container.textContent).toContain('已复制 1 个项目')
    })

    it('Ctrl+X cuts selected item', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      await clickRow(getRowByName('file1.txt'))

      await keyDown('x', { ctrlKey: true })

      expect(container.textContent).toContain('已剪切 1 个项目')
    })

    it('Ctrl+V pastes to focused directory', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      vi.mocked(mockApi.copyEntries).mockResolvedValueOnce({
        ok: true,
        affectedPaths: ['/test/file1.txt', '/test/folder1/file1.txt'],
      })
      vi.mocked(mockApi.listDirectory).mockResolvedValue({ ok: true, entries: [] })

      await clickRow(getRowByName('file1.txt'))
      await keyDown('c', { ctrlKey: true })

      await focusRowWithoutExpanding(getRowByName('folder1'))

      await keyDown('v', { ctrlKey: true })

      expect(mockApi.copyEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          rootPath: '/test',
          sourcePaths: ['/test/file1.txt'],
          destinationDirectory: '/test/folder1',
          operationType: 'copy',
        }),
      )
    })

    it('Ctrl+C copies focused item when nothing selected', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      await clickRow(getRowByName('file1.txt'))

      await keyDown('c', { ctrlKey: true })
      expect(container.textContent).toContain('已复制 1 个项目')
    })

    it('keyboard events are suppressed when rename input is active', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      await clickRow(getRowByName('file1.txt'))

      await keyDown('F2')
      const renameInput = getRowByName('file1.txt').querySelector('.file-tree__rename-input') as HTMLInputElement
      expect(renameInput).toBeTruthy()

      const focusedBefore = rowName(getFocusedRow()!)

      await act(async () => {
        renameInput.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'ArrowDown',
            bubbles: true,
            cancelable: true,
          }),
        )
      })

      expect(rowName(getFocusedRow()!)).toBe(focusedBefore)
    })

    it('does not wrap ArrowUp past the first visible item', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      const rows = getRows()
      await focusRowWithoutExpanding(rows[0])

      await keyDown('ArrowUp')
      expect(rowName(getFocusedRow()!)).toBe('folder1')
    })

    it('does not wrap ArrowDown past the last visible item', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      const lastRow = getRowByName('file2.txt')
      await clickRow(lastRow)

      await keyDown('ArrowDown')
      expect(rowName(getFocusedRow()!)).toBe(rowName(lastRow))
    })
  })
})

describe('FilesWorkspace watcher lifecycle', () => {
  let mockApi: FileManagerApi

  beforeEach(() => {
    mockApi = createMockFileManagerApi()
    ;(window as unknown as Record<string, unknown>).fileManager = mockApi

    vi.mocked(mockApi.loadLastRootDirectory).mockResolvedValue({
      ok: true,
      rootPath: null,
    })

    vi.mocked(mockApi.watchDirectories).mockResolvedValue({ ok: true, affectedPaths: [] })
    vi.mocked(mockApi.unwatchDirectories).mockResolvedValue({ ok: true, affectedPaths: [] })
    vi.mocked(mockApi.saveLastRootDirectory).mockResolvedValue({ ok: true, affectedPaths: [] })
    vi.mocked(mockApi.clearLastRootDirectory).mockResolvedValue({ ok: true, affectedPaths: [] })

    vi.mocked(mockApi.onDirectoryChanged).mockReturnValue(() => {})
  })

  afterEach(() => {
    for (const { root, container } of activeRenderedRoots.splice(0)) {
      act(() => {
        root.unmount()
      })
      container.remove()
    }
    document.body.innerHTML = ''
  })

  describe('watcher – directory watch lifecycle', () => {
    it('registers watcher on rootPath + expandedPaths change', async () => {
      const { container } = renderFilesWorkspace()

      await selectRoot(container, mockApi)

      await act(async () => {
        await vi.waitFor(() => {
          expect(mockApi.watchDirectories).toHaveBeenCalled()
        }, { timeout: 2000 })
      })

      const calls = vi.mocked(mockApi.watchDirectories).mock.calls
      const lastCall = calls[calls.length - 1]?.[0]
      expect(lastCall?.paths).toContain('/test')
    })

    it('updates watcher when expanded paths change', async () => {
      const { container } = renderFilesWorkspace()

      vi.mocked(mockApi.listDirectory).mockResolvedValue({
        ok: true,
        entries: [createFileEntry({ path: '/test/folder1/nested.txt', name: 'nested.txt' })],
      })

      await selectRoot(container, mockApi)

      const expandBtn = container.querySelector('.file-tree__expand:not(.file-tree__expand--spacer)') as HTMLButtonElement
      await act(async () => {
        expandBtn.click()
      })

      await act(async () => {
        await vi.waitFor(() => {
          const waitCalls = vi.mocked(mockApi.watchDirectories).mock.calls
          const waitLastCall = waitCalls[waitCalls.length - 1]?.[0]
          return waitLastCall?.paths.includes('/test/folder1')
        }, { timeout: 2000 })
      })

      const calls = vi.mocked(mockApi.watchDirectories).mock.calls
      const lastCall = calls[calls.length - 1]?.[0]
      expect(lastCall?.paths).toContain('/test')
      expect(lastCall?.paths).toContain('/test/folder1')
    })

    it('subscribes to onDirectoryChanged and calls refreshDirectoryPath on event', async () => {
      let capturedListener: ((event: DirectoryChangedEvent) => void) | null = null

      vi.mocked(mockApi.onDirectoryChanged).mockImplementation((listener) => {
        capturedListener = listener
        return () => {
          capturedListener = null
        }
      })

      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      await act(async () => {
        await vi.waitFor(() => {
          expect(mockApi.onDirectoryChanged).toHaveBeenCalled()
        }, { timeout: 2000 })
      })

      expect(capturedListener).not.toBeNull()

      vi.mocked(mockApi.listDirectory).mockResolvedValue({
        ok: true,
        entries: [],
      })

      await act(async () => {
        capturedListener!({
          directoryPath: '/test',
          eventType: 'change',
          filename: 'newfile.txt',
          observedAt: new Date().toISOString(),
        })
        await new Promise((r) => setTimeout(r, 400))
      })

      expect(mockApi.listDirectory).toHaveBeenCalledWith({
        rootPath: '/test',
        directoryPath: '/test',
      })
    })

    it('keeps onDirectoryChanged subscription stable across tree refreshes', async () => {
      let capturedListener: ((event: DirectoryChangedEvent) => void) | null = null
      const unsubscribe = vi.fn(() => {
        capturedListener = null
      })

      vi.mocked(mockApi.onDirectoryChanged).mockImplementation((listener) => {
        capturedListener = listener
        return unsubscribe
      })

      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      await vi.waitFor(() => {
        expect(mockApi.onDirectoryChanged).toHaveBeenCalledTimes(1)
      }, { timeout: 2000 })

      vi.mocked(mockApi.listDirectory).mockResolvedValue({
        ok: true,
        entries: [
          createFileEntry({ path: '/test/after-refresh.txt', name: 'after-refresh.txt' }),
        ],
      })

      await act(async () => {
        capturedListener!({
          directoryPath: '/test',
          eventType: 'change',
          filename: 'after-refresh.txt',
          observedAt: new Date().toISOString(),
        })
        await new Promise((r) => setTimeout(r, 400))
      })

      await vi.waitFor(() => {
        expect(container.textContent).toContain('after-refresh.txt')
      }, { timeout: 2000 })

      expect(mockApi.onDirectoryChanged).toHaveBeenCalledTimes(1)
      expect(unsubscribe).not.toHaveBeenCalled()
      expect(capturedListener).not.toBeNull()
    })

    it('uses latest entries snapshot in stable watcher subscription callback', async () => {
      let capturedListener: ((event: DirectoryChangedEvent) => void) | null = null

      vi.mocked(mockApi.onDirectoryChanged).mockImplementation((listener) => {
        capturedListener = listener
        return () => {
          capturedListener = null
        }
      })

      vi.mocked(mockApi.selectRootDirectory).mockResolvedValueOnce({
        ok: true,
        rootPath: '/test',
        entries: [createFileEntry({ path: '/test/before.txt', name: 'before.txt' })],
      })
      vi.mocked(mockApi.probeDirectory).mockResolvedValueOnce({
        ok: true,
        totalItems: 1,
        isLarge: false,
        maxDepth: 2,
      })

      const hookPayloads: FileWorkspacePostChangeHookPayload[] = []
      setPostChangeHookListener((payload) => {
        hookPayloads.push(payload)
      })

      const { container } = renderFilesWorkspace()
      const selectButton = Array.from(container.querySelectorAll('.file-toolbar button')).find(
        (btn) => btn.textContent?.includes('选择文件夹'),
      ) as HTMLButtonElement

      await act(async () => {
        selectButton.click()
      })

      await vi.waitFor(() => {
        expect(mockApi.onDirectoryChanged).toHaveBeenCalledTimes(1)
      }, { timeout: 2000 })

      vi.mocked(mockApi.listDirectory).mockResolvedValueOnce({
        ok: true,
        entries: [
          createFileEntry({ path: '/test/after.txt', name: 'after.txt' }),
        ],
      })

      await act(async () => {
        capturedListener!({
          directoryPath: '/test',
          eventType: 'rename',
          filename: 'after.txt',
          observedAt: new Date().toISOString(),
        })
        await new Promise((r) => setTimeout(r, 400))
      })

      await vi.waitFor(() => {
        expect(hookPayloads.length).toBeGreaterThanOrEqual(1)
      }, { timeout: 2000 })

      expect(hookPayloads[0].observedChange.entriesBefore.map((entry) => entry.name)).toEqual(['before.txt'])
      expect(hookPayloads[0].observedChange.entriesAfter.map((entry) => entry.name)).toEqual(['after.txt'])
      expect(mockApi.onDirectoryChanged).toHaveBeenCalledTimes(1)

      setPostChangeHookListener(null)
    })

    it('unwatches and unsubscribes on unmount', async () => {
      const { container, unmount } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      await act(async () => {
        await vi.waitFor(() => {
          expect(mockApi.watchDirectories).toHaveBeenCalled()
        }, { timeout: 2000 })
      })

      unmount()

      expect(mockApi.unwatchDirectories).toHaveBeenCalled()
    })

    it('cleans previous watchers when watched paths become empty', async () => {
      const watchDirectories = vi.fn<FileManagerApi['watchDirectories']>().mockResolvedValue({ ok: true, affectedPaths: [] })
      const unwatchDirectories = vi.fn<FileManagerApi['unwatchDirectories']>().mockResolvedValue({ ok: true, affectedPaths: [] })
      const previousPaths = ['/test', '/test/folder1']

      syncWatchedDirectories({ watchDirectories, unwatchDirectories }, previousPaths, [])
      await Promise.resolve()

      expect(unwatchDirectories).toHaveBeenCalledWith({ paths: previousPaths })
      expect(watchDirectories).not.toHaveBeenCalled()
    })
  })
})

describe('FilesWorkspace post-hook watcher', () => {
  let mockApi: FileManagerApi

  beforeEach(() => {
    mockApi = createMockFileManagerApi()
    ;(window as unknown as Record<string, unknown>).fileManager = mockApi

    vi.mocked(mockApi.loadLastRootDirectory).mockResolvedValue({
      ok: true,
      rootPath: null,
    })

    vi.mocked(mockApi.watchDirectories).mockResolvedValue({ ok: true, affectedPaths: [] })
    vi.mocked(mockApi.unwatchDirectories).mockResolvedValue({ ok: true, affectedPaths: [] })
    vi.mocked(mockApi.saveLastRootDirectory).mockResolvedValue({ ok: true, affectedPaths: [] })
    vi.mocked(mockApi.clearLastRootDirectory).mockResolvedValue({ ok: true, affectedPaths: [] })

    vi.mocked(mockApi.onDirectoryChanged).mockReturnValue(() => {})
  })

  afterEach(() => {
    for (const { root, container } of activeRenderedRoots.splice(0)) {
      act(() => {
        root.unmount()
      })
      container.remove()
    }
    document.body.innerHTML = ''
  })

  describe('post-hook – watcher refresh emits hook', () => {
    it('calls post-hook listener on watcher refresh with entriesBefore/entriesAfter', async () => {
      let capturedListener: ((event: DirectoryChangedEvent) => void) | null = null

      vi.mocked(mockApi.onDirectoryChanged).mockImplementation((listener) => {
        capturedListener = listener
        return () => {
          capturedListener = null
        }
      })

      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      await act(async () => {
        await vi.waitFor(() => {
          expect(mockApi.onDirectoryChanged).toHaveBeenCalled()
        }, { timeout: 2000 })
      })

      const hookPayloads: FileWorkspacePostChangeHookPayload[] = []
      setPostChangeHookListener((payload) => {
        hookPayloads.push(payload)
      })

      vi.mocked(mockApi.listDirectory).mockResolvedValue({
        ok: true,
        entries: [
          createFileEntry({ path: '/test/file1.txt', name: 'file1.txt' }),
          createDirEntry({ path: '/test/new-folder', name: 'new-folder' }),
        ],
      })

      await act(async () => {
        capturedListener!({
          directoryPath: '/test',
          eventType: 'rename',
          filename: 'new-folder',
          observedAt: new Date().toISOString(),
        })
        await new Promise((r) => setTimeout(r, 500))
      })

      expect(hookPayloads.length).toBeGreaterThanOrEqual(1)
      const payload = hookPayloads[0]
      expect(payload.observedChange.source).toBe('filesystem-watch')
      expect(payload.observedChange.operation).toBe('watch-refresh')
      expect(payload.observedChange.rootPath).toBe('/test')
      expect(payload.observedChange.directoryPath).toBe('/test')
      expect(payload.semanticChanges.length).toBeGreaterThanOrEqual(1)

      setPostChangeHookListener(null)
    })
  })
})

describe('FilesWorkspace post-hook user ops', () => {
  let mockApi: FileManagerApi

  beforeEach(() => {
    mockApi = createMockFileManagerApi()
    ;(window as unknown as Record<string, unknown>).fileManager = mockApi

    vi.mocked(mockApi.loadLastRootDirectory).mockResolvedValue({
      ok: true,
      rootPath: null,
    })

    vi.mocked(mockApi.watchDirectories).mockResolvedValue({ ok: true, affectedPaths: [] })
    vi.mocked(mockApi.unwatchDirectories).mockResolvedValue({ ok: true, affectedPaths: [] })
    vi.mocked(mockApi.saveLastRootDirectory).mockResolvedValue({ ok: true, affectedPaths: [] })
    vi.mocked(mockApi.clearLastRootDirectory).mockResolvedValue({ ok: true, affectedPaths: [] })

    vi.mocked(mockApi.onDirectoryChanged).mockReturnValue(() => {})

    setPostChangeHookListener(null)
  })

  afterEach(() => {
    for (const { root, container } of activeRenderedRoots.splice(0)) {
      act(() => {
        root.unmount()
      })
      container.remove()
    }
    document.body.innerHTML = ''

    setPostChangeHookListener(null)
  })

  // eslint-disable-next-line max-lines-per-function
  describe('post-hook – user operations', () => {
    it('emits created on createDirectory success', async () => {
      const hookPayloads: FileWorkspacePostChangeHookPayload[] = []
      setPostChangeHookListener((payload) => {
        hookPayloads.push(payload)
      })

      vi.mocked(mockApi.selectRootDirectory).mockResolvedValueOnce({
        ok: true,
        rootPath: '/test',
        entries: [createFileEntry({ path: '/test/a.txt', name: 'a.txt' })],
      })
      vi.mocked(mockApi.probeDirectory).mockResolvedValueOnce({
        ok: true,
        totalItems: 1,
        isLarge: false,
        maxDepth: 2,
      })
      vi.mocked(mockApi.createDirectory).mockResolvedValueOnce({
        ok: true,
        affectedPaths: ['/test/新建文件夹'],
      })
      vi.mocked(mockApi.listDirectory).mockResolvedValue({
        ok: true,
        entries: [
          createFileEntry({ path: '/test/a.txt', name: 'a.txt' }),
          createDirEntry({ path: '/test/新建文件夹', name: '新建文件夹' }),
        ],
      })

      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      const tree = container.querySelector('.file-tree') as HTMLDivElement
      await act(async () => {
        tree.click()
      })
      await act(async () => {
        const event = new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 })
        tree.dispatchEvent(event)
      })

      await act(async () => {
        findContextMenuItem('新建文件夹').click()
      })

      await act(async () => {
        await vi.waitFor(() => {
          expect(hookPayloads.length).toBeGreaterThanOrEqual(1)
        }, { timeout: 3000 })
      })

      expect(hookPayloads[0].observedChange.source).toBe('user-action')
      expect(hookPayloads[0].observedChange.operation).toBe('create-directory')
      expect(hookPayloads[0].semanticChanges.some((sc) => sc.kind === 'created')).toBe(true)
    })

    it('emits deleted on trashEntries success', async () => {
      const hookPayloads: FileWorkspacePostChangeHookPayload[] = []
      setPostChangeHookListener((payload) => {
        hookPayloads.push(payload)
      })

      vi.mocked(mockApi.selectRootDirectory).mockResolvedValueOnce({
        ok: true,
        rootPath: '/test',
        entries: [createFileEntry({ path: '/test/file1.txt', name: 'file1.txt' })],
      })
      vi.mocked(mockApi.probeDirectory).mockResolvedValueOnce({
        ok: true,
        totalItems: 1,
        isLarge: false,
        maxDepth: 2,
      })
      vi.mocked(mockApi.trashEntries).mockResolvedValueOnce({
        ok: true,
        affectedPaths: ['/test/file1.txt'],
      })
      vi.mocked(mockApi.listDirectory).mockResolvedValue({ ok: true, entries: [] })

      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      const row = findRowByName(container, 'file1.txt')
      await openContextMenu(row)

      await act(async () => {
        findContextMenuItem('删除').click()
      })

      await act(async () => {
        await vi.waitFor(() => {
          expect(hookPayloads.length).toBeGreaterThanOrEqual(1)
        }, { timeout: 3000 })
      })

      expect(hookPayloads[0].observedChange.source).toBe('user-action')
      expect(hookPayloads[0].observedChange.operation).toBe('delete')
      expect(hookPayloads[0].semanticChanges.some((sc) => sc.kind === 'deleted')).toBe(true)
    })

    it('emits hook on commitRename success', async () => {
      const hookPayloads: FileWorkspacePostChangeHookPayload[] = []
      setPostChangeHookListener((payload) => {
        hookPayloads.push(payload)
      })

      vi.mocked(mockApi.selectRootDirectory).mockResolvedValueOnce({
        ok: true,
        rootPath: '/test',
        entries: [createFileEntry({ path: '/test/old.txt', name: 'old.txt' })],
      })
      vi.mocked(mockApi.probeDirectory).mockResolvedValueOnce({
        ok: true,
        totalItems: 1,
        isLarge: false,
        maxDepth: 2,
      })
      vi.mocked(mockApi.renameEntry).mockResolvedValueOnce({
        ok: true,
        affectedPaths: ['/test/old.txt', '/test/new.txt'],
      })
      vi.mocked(mockApi.listDirectory).mockResolvedValue({
        ok: true,
        entries: [
          createFileEntry({ path: '/test/new.txt', name: 'new.txt' }),
        ],
      })

      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      const row = findRowByName(container, 'old.txt')
      await openContextMenu(row)

      await act(async () => {
        findContextMenuItem('重命名').click()
      })

      const input = row.querySelector('.file-tree__rename-input') as HTMLInputElement
      expect(input).toBeTruthy()
      await act(async () => {
        input.value = 'new.txt'
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      })

      await act(async () => {
        await vi.waitFor(() => {
          expect(hookPayloads.length).toBeGreaterThanOrEqual(1)
        }, { timeout: 3000 })
      })

      expect(hookPayloads[0].observedChange.source).toBe('user-action')
      expect(hookPayloads[0].observedChange.operation).toBe('rename')
    })

    it('emits hook on copy-paste success', async () => {
      const hookPayloads: FileWorkspacePostChangeHookPayload[] = []
      setPostChangeHookListener((payload) => {
        hookPayloads.push(payload)
      })

      vi.mocked(mockApi.selectRootDirectory).mockResolvedValueOnce({
        ok: true,
        rootPath: '/test',
        entries: [
          createFileEntry({ path: '/test/file1.txt', name: 'file1.txt' }),
          createDirEntry({ path: '/test/subdir', name: 'subdir' }),
        ],
      })
      vi.mocked(mockApi.probeDirectory).mockResolvedValueOnce({
        ok: true,
        totalItems: 2,
        isLarge: false,
        maxDepth: 2,
      })
      vi.mocked(mockApi.copyEntries).mockResolvedValueOnce({
        ok: true,
        affectedPaths: ['/test/file1.txt', '/test/subdir/file1.txt'],
      })
      vi.mocked(mockApi.listDirectory).mockResolvedValue({ ok: true, entries: [] })

      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      const fileRow = findRowByName(container, 'file1.txt')
      await openContextMenu(fileRow)
      await act(async () => {
        findContextMenuItem('复制').click()
      })

      const dirRow = findRowByName(container, 'subdir')
      await openContextMenu(dirRow)
      await act(async () => {
        findContextMenuItem('粘贴').click()
      })

      await act(async () => {
        await vi.waitFor(() => {
          expect(hookPayloads.length).toBeGreaterThanOrEqual(1)
        }, { timeout: 3000 })
      })

      expect(hookPayloads[0].observedChange.source).toBe('user-action')
      expect(hookPayloads[0].observedChange.operation).toBe('paste')
    })

    it('emits hook on cut-paste (move) success', async () => {
      const hookPayloads: FileWorkspacePostChangeHookPayload[] = []
      setPostChangeHookListener((payload) => {
        hookPayloads.push(payload)
      })

      vi.mocked(mockApi.selectRootDirectory).mockResolvedValueOnce({
        ok: true,
        rootPath: '/test',
        entries: [
          createFileEntry({ path: '/test/file1.txt', name: 'file1.txt' }),
          createDirEntry({ path: '/test/subdir', name: 'subdir' }),
        ],
      })
      vi.mocked(mockApi.probeDirectory).mockResolvedValueOnce({
        ok: true,
        totalItems: 2,
        isLarge: false,
        maxDepth: 2,
      })
      vi.mocked(mockApi.moveEntries).mockResolvedValueOnce({
        ok: true,
        affectedPaths: ['/test/file1.txt', '/test/subdir'],
      })
      vi.mocked(mockApi.listDirectory).mockResolvedValue({ ok: true, entries: [] })

      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      const fileRow = findRowByName(container, 'file1.txt')
      await openContextMenu(fileRow)
      await act(async () => {
        findContextMenuItem('剪切').click()
      })

      const dirRow = findRowByName(container, 'subdir')
      await openContextMenu(dirRow)
      await act(async () => {
        findContextMenuItem('粘贴').click()
      })

      await act(async () => {
        await vi.waitFor(() => {
          expect(hookPayloads.length).toBeGreaterThanOrEqual(1)
        }, { timeout: 3000 })
      })

      expect(hookPayloads[0].observedChange.source).toBe('user-action')
      expect(hookPayloads[0].observedChange.operation).toBe('paste')
    })

    it('emits hook on drag-move success', async () => {
      const hookPayloads: FileWorkspacePostChangeHookPayload[] = []
      setPostChangeHookListener((payload) => {
        hookPayloads.push(payload)
      })

      if (typeof DragEvent === 'undefined') {
        (window as unknown as Record<string, unknown>).DragEvent = class DragEvent extends MouseEvent {
          dataTransfer: DataTransfer | null = null
          constructor(type: string, eventInitDict?: DragEventInit) {
            super(type, eventInitDict)
            if (eventInitDict?.dataTransfer) {
              this.dataTransfer = eventInitDict.dataTransfer
            }
          }
        } as unknown as typeof DragEvent
      }

      vi.mocked(mockApi.selectRootDirectory).mockResolvedValueOnce({
        ok: true,
        rootPath: '/test',
        entries: [
          createFileEntry({ path: '/test/file1.txt', name: 'file1.txt' }),
          createDirEntry({ path: '/test/target', name: 'target' }),
        ],
      })
      vi.mocked(mockApi.probeDirectory).mockResolvedValueOnce({
        ok: true,
        totalItems: 2,
        isLarge: false,
        maxDepth: 2,
      })
      vi.mocked(mockApi.moveEntries).mockResolvedValueOnce({
        ok: true,
        affectedPaths: ['/test/file1.txt', '/test/target'],
      })
      vi.mocked(mockApi.listDirectory).mockResolvedValue({ ok: true, entries: [] })

      function createDT(data: string): DataTransfer {
        return {
          getData: vi.fn().mockReturnValue(data),
          setData: vi.fn(),
          dropEffect: 'move',
          effectAllowed: 'move',
          items: [] as unknown as DataTransferItemList,
          types: [],
          files: {} as FileList,
          clearData: vi.fn(),
          setDragImage: vi.fn(),
        } as unknown as DataTransfer
      }

      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      const fileRow = findRowByName(container, 'file1.txt')
      const targetRow = findRowByName(container, 'target')

      await act(async () => {
        const dt = createDT(JSON.stringify(['/test/file1.txt']))
        const ev = new DragEvent('dragstart', { bubbles: true }) as MouseEvent
        Object.defineProperty(ev, 'dataTransfer', { value: dt, writable: false })
        fileRow.dispatchEvent(ev)
      })

      await act(async () => {
        const dt2 = createDT(JSON.stringify(['/test/file1.txt']))
        const ev2 = new DragEvent('dragover', { bubbles: true, cancelable: true }) as MouseEvent
        Object.defineProperty(ev2, 'dataTransfer', { value: dt2, writable: false })
        targetRow.dispatchEvent(ev2)
      })

      await act(async () => {
        const dt3 = createDT(JSON.stringify(['/test/file1.txt']))
        const ev3 = new DragEvent('drop', { bubbles: true, cancelable: true }) as MouseEvent
        Object.defineProperty(ev3, 'dataTransfer', { value: dt3, writable: false })
        targetRow.dispatchEvent(ev3)
      })

      await act(async () => {
        await vi.waitFor(() => {
          expect(hookPayloads.length).toBeGreaterThanOrEqual(1)
        }, { timeout: 3000 })
      })

      expect(hookPayloads[0].observedChange.source).toBe('user-action')
      expect(hookPayloads[0].observedChange.operation).toBe('drag-move')
    })
  })
})
