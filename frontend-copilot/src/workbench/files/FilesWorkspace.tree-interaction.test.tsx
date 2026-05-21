/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'

import type {
  FileManagerApi,
  FileTreeEntry,
  ListDirectoryResult,
  ProbeDirectoryResult,
  SelectDirectoryResult,
  FileOperationResult,
  LoadLastRootDirectoryResult,
} from '../../../electron/file-manager/ipc'

import { FilesWorkspace } from './FilesWorkspace'

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

describe('FilesWorkspace tree interaction', () => {
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
  describe('tree expansion – click to expand/collapse (revised)', () => {
    async function setupRootWithFolder(): Promise<{ container: HTMLElement }> {
      const { container } = renderFilesWorkspace()

      vi.mocked(mockApi.selectRootDirectory).mockResolvedValueOnce({
        ok: true,
        rootPath: '/test',
        entries: [createDirEntry({ path: '/test/subdir', name: 'subdir' })],
      })
      vi.mocked(mockApi.probeDirectory).mockResolvedValueOnce({
        ok: true,
        totalItems: 1,
        isLarge: false,
        maxDepth: 2,
      })
      vi.mocked(mockApi.listDirectory).mockResolvedValue({
        ok: true,
        entries: [createFileEntry({ path: '/test/subdir/nested.txt', name: 'nested.txt' })],
      })

      const selectButton = Array.from(container.querySelectorAll('.file-toolbar button')).find(
        (btn) => btn.textContent?.includes('选择文件夹'),
      ) as HTMLButtonElement

      await act(async () => {
        selectButton.click()
      })

      return { container }
    }

    it('expands a folder on plain click (no modifier)', async () => {
      const { container } = await setupRootWithFolder()

      const folderRow = findRowByName(container, 'subdir')
      const expandBtn = folderRow.querySelector('.file-tree__expand:not(.file-tree__expand--spacer)') as HTMLButtonElement
      expect(expandBtn.classList.contains('file-tree__expand--expanded')).toBe(false)

      await act(async () => {
        const event = new MouseEvent('click', { bubbles: true })
        folderRow.dispatchEvent(event)
      })

      await act(async () => {
        await vi.waitFor(() => {
          expect(expandBtn.classList.contains('file-tree__expand--expanded')).toBe(true)
        }, { timeout: 2000 })
      })

      expect(container.textContent).toContain('nested.txt')
    })

    it('renders a children container for every nested directory node', async () => {
      const { container } = renderFilesWorkspace()

      vi.mocked(mockApi.selectRootDirectory).mockResolvedValueOnce({
        ok: true,
        rootPath: '/test',
        entries: [createDirEntry({ path: '/test/parent', name: 'parent' })],
      })
      vi.mocked(mockApi.probeDirectory).mockResolvedValueOnce({
        ok: true,
        totalItems: 3,
        isLarge: false,
        maxDepth: 2,
      })
      vi.mocked(mockApi.listDirectory).mockImplementation((request) => {
        if (request.directoryPath === '/test/parent') {
          return Promise.resolve({
            ok: true,
            entries: [
              createDirEntry({
                path: '/test/parent/childdir',
                name: 'childdir',
                parentPath: '/test/parent',
              }),
            ],
          })
        }
        if (request.directoryPath === '/test/parent/childdir') {
          return Promise.resolve({
            ok: true,
            entries: [
              createFileEntry({
                path: '/test/parent/childdir/grandchild.txt',
                name: 'grandchild.txt',
                parentPath: '/test/parent/childdir',
              }),
            ],
          })
        }
        return Promise.resolve({ ok: true, entries: [] })
      })

      const selectButton = Array.from(container.querySelectorAll('.file-toolbar button')).find(
        (btn) => btn.textContent?.includes('选择文件夹'),
      ) as HTMLButtonElement
      await act(async () => {
        selectButton.click()
      })

      const parentRow = findRowByName(container, 'parent')
      await act(async () => {
        (parentRow.querySelector('.file-tree__expand:not(.file-tree__expand--spacer)') as HTMLButtonElement).click()
      })
      await act(async () => {
        await vi.waitFor(() => {
          expect(container.textContent).toContain('childdir')
        }, { timeout: 2000 })
      })

      const childRow = findRowByName(container, 'childdir')
      await act(async () => {
        (childRow.querySelector('.file-tree__expand:not(.file-tree__expand--spacer)') as HTMLButtonElement).click()
      })
      await act(async () => {
        await vi.waitFor(() => {
          expect(container.textContent).toContain('grandchild.txt')
        }, { timeout: 2000 })
      })

      const childContainer = childRow.nextElementSibling as HTMLElement | null
      expect(childContainer?.classList.contains('file-tree__children')).toBe(true)
      expect(childContainer?.classList.contains('file-tree__children--expanded')).toBe(true)
      expect(childContainer?.textContent).toContain('grandchild.txt')
    })

    it('collapses a folder on plain click when already expanded', async () => {
      const { container } = await setupRootWithFolder()

      const folderRow = findRowByName(container, 'subdir')
      const expandBtn = folderRow.querySelector('.file-tree__expand:not(.file-tree__expand--spacer)') as HTMLButtonElement

      await act(async () => {
        folderRow.click()
      })
      await act(async () => {
        await vi.waitFor(() => {
          expect(expandBtn.classList.contains('file-tree__expand--expanded')).toBe(true)
        }, { timeout: 2000 })
      })

      await act(async () => {
        folderRow.click()
      })

      expect(expandBtn.classList.contains('file-tree__expand--expanded')).toBe(false)
    })

    it('does NOT expand a folder on Ctrl+click', async () => {
      const { container } = await setupRootWithFolder()

      const folderRow = findRowByName(container, 'subdir')
      const expandBtn = folderRow.querySelector('.file-tree__expand:not(.file-tree__expand--spacer)') as HTMLButtonElement

      await act(async () => {
        const event = new MouseEvent('click', { ctrlKey: true, bubbles: true })
        folderRow.dispatchEvent(event)
      })

      expect(expandBtn.classList.contains('file-tree__expand--expanded')).toBe(false)
      expect(folderRow.classList.contains('file-tree__row--selected')).toBe(true)
    })

    it('does NOT expand a folder on Shift+click', async () => {
      const { container } = await setupRootWithFolder()

      const folderRow = findRowByName(container, 'subdir')
      const expandBtn = folderRow.querySelector('.file-tree__expand:not(.file-tree__expand--spacer)') as HTMLButtonElement

      await act(async () => {
        folderRow.click()
      })

      await act(async () => {
        const event = new MouseEvent('click', { shiftKey: true, bubbles: true })
        folderRow.dispatchEvent(event)
      })

      expect(expandBtn.classList.contains('file-tree__expand--expanded')).toBe(true)
    })
  })

  describe('selection behavior', () => {
    it('selects a single item on click', async () => {
      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      const rows = container.querySelectorAll('.file-tree__row')
      expect(rows.length).toBe(3)

      await act(async () => {
        (rows[0] as HTMLDivElement).click()
      })

      expect(rows[0].classList.contains('file-tree__row--selected')).toBe(true)
      expect(rows[1].classList.contains('file-tree__row--selected')).toBe(false)
      expect(rows[2].classList.contains('file-tree__row--selected')).toBe(false)
    })

    it('toggles selection with Ctrl+click', async () => {
      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      const rows = container.querySelectorAll('.file-tree__row')

      await act(async () => {
        const event = new MouseEvent('click', { ctrlKey: true, bubbles: true })
        rows[0].dispatchEvent(event)
      })

      expect(rows[0].classList.contains('file-tree__row--selected')).toBe(true)

      await act(async () => {
        const event = new MouseEvent('click', { ctrlKey: true, bubbles: true })
        rows[1].dispatchEvent(event)
      })

      expect(rows[0].classList.contains('file-tree__row--selected')).toBe(true)
      expect(rows[1].classList.contains('file-tree__row--selected')).toBe(true)

      await act(async () => {
        const event = new MouseEvent('click', { ctrlKey: true, bubbles: true })
        rows[0].dispatchEvent(event)
      })

      expect(rows[0].classList.contains('file-tree__row--selected')).toBe(false)
      expect(rows[1].classList.contains('file-tree__row--selected')).toBe(true)
    })

    it('selects range with Shift+click', async () => {
      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      const rows = container.querySelectorAll('.file-tree__row')

      await act(async () => {
        const event = new MouseEvent('click', { bubbles: true })
        rows[0].dispatchEvent(event)
      })

      await act(async () => {
        const event = new MouseEvent('click', { shiftKey: true, bubbles: true })
        rows[2].dispatchEvent(event)
      })

      expect(rows[0].classList.contains('file-tree__row--selected')).toBe(true)
      expect(rows[1].classList.contains('file-tree__row--selected')).toBe(true)
      expect(rows[2].classList.contains('file-tree__row--selected')).toBe(true)
    })
  })

  describe('right-click selection rules', () => {
    it('switches to single selection when right-clicking an unselected node', async () => {
      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      const rows = container.querySelectorAll('.file-tree__row')

      await act(async () => {
        (rows[1] as HTMLDivElement).click()
      })
      expect(rows[1].classList.contains('file-tree__row--selected')).toBe(true)

      await act(async () => {
        const event = new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 })
        rows[2].dispatchEvent(event)
      })

      expect(rows[1].classList.contains('file-tree__row--selected')).toBe(false)
      expect(rows[2].classList.contains('file-tree__row--selected')).toBe(true)
    })

    it('preserves multi-selection when right-clicking an already selected node', async () => {
      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      const rows = container.querySelectorAll('.file-tree__row')

      await act(async () => {
        const event = new MouseEvent('click', { ctrlKey: true, bubbles: true })
        rows[1].dispatchEvent(event)
      })
      await act(async () => {
        const event = new MouseEvent('click', { ctrlKey: true, bubbles: true })
        rows[2].dispatchEvent(event)
      })

      expect(rows[1].classList.contains('file-tree__row--selected')).toBe(true)
      expect(rows[2].classList.contains('file-tree__row--selected')).toBe(true)

      await act(async () => {
        const event = new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 })
        rows[1].dispatchEvent(event)
      })

      expect(rows[1].classList.contains('file-tree__row--selected')).toBe(true)
      expect(rows[2].classList.contains('file-tree__row--selected')).toBe(true)
    })
  })
})
