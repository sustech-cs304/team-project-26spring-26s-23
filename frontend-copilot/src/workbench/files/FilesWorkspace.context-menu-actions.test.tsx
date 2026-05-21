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
import { ContextMenu } from './ContextMenu'
import { buildContextMenuItems } from './context-menu-items'

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

describe('FilesWorkspace context menu actions', () => {
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
  describe('context menu (revised)', () => {
    it('shows folder context menu on right-click with expand/collapse, copy, cut, paste, new folder, rename, delete', async () => {
      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      const rows = container.querySelectorAll('.file-tree__row')
      const folderRow = rows[0]

      await act(async () => {
        const event = new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 })
        folderRow.dispatchEvent(event)
      })

      const menu = document.querySelector('.file-context-menu')
      expect(menu).toBeTruthy()

      const menuTexts = Array.from(menu!.querySelectorAll('.file-context-menu__item')).map(
        (item) => item.textContent?.trim() ?? '',
      )

      expect(menuTexts.some((t) => t === '展开' || t === '折叠')).toBe(true)
      expect(menuTexts).toContain('复制')
      expect(menuTexts).toContain('剪切')
      expect(menuTexts).toContain('粘贴')
      expect(menuTexts).toContain('新建文件夹')
      expect(menuTexts).toContain('重命名')
      expect(menuTexts).toContain('删除')
    })

    it('shows file context menu items: copy, cut, rename, delete (no expand, paste, new folder)', () => {
      const noop = () => {}

      const items = buildContextMenuItems({
        targetKind: 'file',
        targetPath: '/test/file1.txt',
        isExpanded: false,
        selectedPaths: new Set(['/test/file1.txt']),
        clipboard: null,
        busyOperation: 'idle',
        onCopy: noop,
        onCut: noop,
        onPaste: noop,
        onNewFolder: noop,
        onRename: noop,
        onDelete: noop,
        onRefresh: noop,
      })

      const labels = items.map((i) => i.label)

      expect(labels).toContain('复制')
      expect(labels).toContain('剪切')
      expect(labels).toContain('重命名')
      expect(labels).toContain('删除')

      expect(labels.some((t) => t === '展开' || t === '折叠')).toBe(false)
      expect(labels).not.toContain('粘贴')
      expect(labels).not.toContain('新建文件夹')
      expect(labels).not.toContain('刷新')
    })

    it('shows blank area context menu items: new folder and paste only (no refresh)', () => {
      const noop = () => {}

      const items = buildContextMenuItems({
        targetKind: null,
        targetPath: null,
        isExpanded: false,
        selectedPaths: new Set(),
        clipboard: { operation: 'copy', sourcePaths: ['/test/x.txt'], sourceRoot: '/test' },
        busyOperation: 'idle',
        onCopy: noop,
        onCut: noop,
        onPaste: noop,
        onNewFolder: noop,
        onRename: noop,
        onDelete: noop,
        onRefresh: noop,
      })

      const labels = items.map((i) => i.label)

      expect(labels).toContain('新建文件夹')
      expect(labels).toContain('粘贴')
      expect(labels).not.toContain('刷新')

      expect(labels).not.toContain('复制')
      expect(labels).not.toContain('剪切')
      expect(labels).not.toContain('重命名')
      expect(labels).not.toContain('删除')
      expect(labels.some((t) => t === '展开' || t === '折叠')).toBe(false)
    })

    it('clamps context menu coordinates to non-negative values in a small viewport', () => {
      const originalInnerWidth = window.innerWidth
      const originalInnerHeight = window.innerHeight
      Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 120 })
      Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 80 })

      const host = document.createElement('div')
      document.body.appendChild(host)
      const root = createRoot(host)
      const items = Array.from({ length: 6 }, (_, index) => ({
        label: `操作 ${index}`,
        onClick: vi.fn(),
      }))

      try {
        act(() => {
          root.render(<ContextMenu x={100} y={100} items={items} onClose={() => {}} />)
        })

        const menu = document.querySelector('.file-context-menu') as HTMLElement
        expect(menu.style.left).toBe('0px')
        expect(menu.style.top).toBe('0px')
      } finally {
        act(() => {
          root.unmount()
        })
        host.remove()
        Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: originalInnerWidth })
        Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: originalInnerHeight })
      }
    })

    it('disables paste in blank area when clipboard is empty', () => {
      const noop = () => {}

      const items = buildContextMenuItems({
        targetKind: null,
        targetPath: null,
        isExpanded: false,
        selectedPaths: new Set(),
        clipboard: null,
        busyOperation: 'idle',
        onCopy: noop,
        onCut: noop,
        onPaste: noop,
        onNewFolder: noop,
        onRename: noop,
        onDelete: noop,
        onRefresh: noop,
      })

      const pasteItem = items.find((i) => i.label === '粘贴')
      expect(pasteItem?.disabled).toBe(true)
    })

    it('creates a new folder from blank area context menu (targets root)', async () => {
      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      vi.mocked(mockApi.createDirectory).mockResolvedValueOnce({
        ok: true,
        affectedPaths: ['/test/新建文件夹'],
      })
      vi.mocked(mockApi.listDirectory).mockResolvedValue({ ok: true, entries: [] })

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

      expect(mockApi.createDirectory).toHaveBeenCalledWith({
        rootPath: '/test',
        parentPath: '/test',
        name: '新建文件夹',
      })
    })

    it('switches context when right-clicking a different node', async () => {
      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      const folderRow = findRowByName(container, 'folder1')
      await openContextMenu(folderRow)
      expect(findContextMenuItem('新建文件夹')).toBeTruthy()

      const fileRow = findRowByName(container, 'file1.txt')
      await openContextMenu(fileRow)

      const menuTexts = Array.from(document.querySelectorAll('.file-context-menu__item')).map(
        (item) => item.textContent?.trim() ?? '',
      )
      expect(menuTexts).toContain('复制')
      expect(menuTexts).toContain('剪切')
      expect(menuTexts).toContain('重命名')
      expect(menuTexts).toContain('删除')
      expect(menuTexts).not.toContain('新建文件夹')
      expect(menuTexts).not.toContain('粘贴')
    })
  })

  // eslint-disable-next-line max-lines-per-function
  describe('paste and create-directory target resolution', () => {
    it('pastes from blank-area context menu into the root directory after clearing selection', async () => {
      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      vi.mocked(mockApi.copyEntries).mockResolvedValueOnce({
        ok: true,
        affectedPaths: ['/test/file1.txt', '/test/file1 - 副本.txt'],
      })
      vi.mocked(mockApi.listDirectory).mockResolvedValue({ ok: true, entries: [] })

      const fileRow = findRowByName(container, 'file1.txt')
      await openContextMenu(fileRow)

      await act(async () => {
        findContextMenuItem('复制').click()
      })

      const tree = container.querySelector('.file-tree') as HTMLDivElement
      await act(async () => {
        tree.click()
      })

      await act(async () => {
        const event = new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 })
        tree.dispatchEvent(event)
      })

      await act(async () => {
        findContextMenuItem('粘贴').click()
      })

      expect(mockApi.copyEntries).toHaveBeenCalledWith({
        rootPath: '/test',
        sourcePaths: ['/test/file1.txt'],
        destinationDirectory: '/test',
        operationType: 'copy',
      })
    })

    it('preserves entries cache populated while post-operation refresh is pending', async () => {
      const { container } = renderFilesWorkspace()

      vi.mocked(mockApi.selectRootDirectory).mockResolvedValueOnce({
        ok: true,
        rootPath: '/test',
        entries: [
          createFileEntry({ path: '/test/file1.txt', name: 'file1.txt' }),
          createDirEntry({ path: '/test/target', name: 'target' }),
          createDirEntry({ path: '/test/later', name: 'later' }),
        ],
      })
      vi.mocked(mockApi.probeDirectory).mockResolvedValueOnce({
        ok: true,
        totalItems: 3,
        isLarge: false,
        maxDepth: 2,
      })
      vi.mocked(mockApi.copyEntries).mockResolvedValueOnce({
        ok: true,
        affectedPaths: ['/test/target/file1.txt'],
      })

      let resolveTargetRefresh!: (result: ListDirectoryResult) => void
      const targetRefresh = new Promise<ListDirectoryResult>((resolve) => {
        resolveTargetRefresh = resolve
      })
      vi.mocked(mockApi.listDirectory).mockImplementation((request) => {
        if (request.directoryPath === '/test/target') {
          return targetRefresh
        }
        if (request.directoryPath === '/test/later') {
          return Promise.resolve({
            ok: true,
            entries: [
              createFileEntry({
                path: '/test/later/later-child.txt',
                name: 'later-child.txt',
                parentPath: '/test/later',
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

      const fileRow = findRowByName(container, 'file1.txt')
      await openContextMenu(fileRow)
      await act(async () => {
        findContextMenuItem('复制').click()
      })

      const targetRow = findRowByName(container, 'target')
      await openContextMenu(targetRow)
      await act(async () => {
        findContextMenuItem('粘贴').click()
      })
      await act(async () => {
        await vi.waitFor(() => {
          expect(mockApi.listDirectory).toHaveBeenCalledWith({ rootPath: '/test', directoryPath: '/test/target' })
        }, { timeout: 2000 })
      })

      const laterRow = findRowByName(container, 'later')
      await act(async () => {
        (laterRow.querySelector('.file-tree__expand:not(.file-tree__expand--spacer)') as HTMLButtonElement).click()
      })
      await act(async () => {
        await vi.waitFor(() => {
          expect(container.textContent).toContain('later-child.txt')
        }, { timeout: 2000 })
      })

      await act(async () => {
        resolveTargetRefresh({
          ok: true,
          entries: [
            createFileEntry({
              path: '/test/target/file1.txt',
              name: 'file1.txt',
              parentPath: '/test/target',
            }),
          ],
        })
        await Promise.resolve()
      })

      await act(async () => {
        await vi.waitFor(() => {
          expect(container.textContent).toContain('later-child.txt')
        }, { timeout: 2000 })
      })
    })

    it('pastes into the folder targeted by the folder context menu', async () => {
      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      vi.mocked(mockApi.copyEntries).mockResolvedValueOnce({
        ok: true,
        affectedPaths: ['/test/file1.txt', '/test/folder1/file1.txt'],
      })
      vi.mocked(mockApi.listDirectory).mockResolvedValue({ ok: true, entries: [] })

      const fileRow = findRowByName(container, 'file1.txt')
      await openContextMenu(fileRow)
      await act(async () => {
        findContextMenuItem('复制').click()
      })

      const folderRow = findRowByName(container, 'folder1')
      await openContextMenu(folderRow)
      await act(async () => {
        findContextMenuItem('粘贴').click()
      })

      expect(mockApi.copyEntries).toHaveBeenCalledWith({
        rootPath: '/test',
        sourcePaths: ['/test/file1.txt'],
        destinationDirectory: '/test/folder1',
        operationType: 'copy',
      })
    })

    it('creates a folder in the folder targeted by the folder context menu', async () => {
      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      vi.mocked(mockApi.createDirectory).mockResolvedValueOnce({
        ok: true,
        affectedPaths: ['/test/folder1/新建文件夹'],
      })
      vi.mocked(mockApi.listDirectory).mockResolvedValue({ ok: true, entries: [] })

      const folderRow = findRowByName(container, 'folder1')
      await openContextMenu(folderRow)

      await act(async () => {
        findContextMenuItem('新建文件夹').click()
      })

      expect(mockApi.createDirectory).toHaveBeenCalledWith({
        rootPath: '/test',
        parentPath: '/test/folder1',
        name: '新建文件夹',
      })
    })
  })

  describe('system actions – buildContextMenuItems entries', () => {
    const noop = () => {}

    it('file menu includes system open, reveal in folder, copy path, copy relative path', () => {
      const items = buildContextMenuItems({
        targetKind: 'file',
        targetPath: '/test/file1.txt',
        isExpanded: false,
        selectedPaths: new Set(['/test/file1.txt']),
        clipboard: null,
        busyOperation: 'idle',
        onOpenWithSystem: noop,
        onRevealInFolder: noop,
        onCopyPath: noop,
        onCopyRelativePath: noop,
        onCopy: noop,
        onCut: noop,
        onPaste: noop,
        onNewFolder: noop,
        onRename: noop,
        onDelete: noop,
        onRefresh: noop,
      })

      const labels = items.map((i) => i.label)
      expect(labels).toContain('通过系统方式打开')
      expect(labels).toContain('在文件资源管理器中显示')
      expect(labels).toContain('复制路径')
      expect(labels).toContain('复制相对路径')
    })

    it('directory menu does NOT include system open', () => {
      const items = buildContextMenuItems({
        targetKind: 'directory',
        targetPath: '/test/folder1',
        isExpanded: false,
        selectedPaths: new Set(['/test/folder1']),
        clipboard: null,
        busyOperation: 'idle',
        onOpenWithSystem: noop,
        onRevealInFolder: noop,
        onCopyPath: noop,
        onCopyRelativePath: noop,
        onCopy: noop,
        onCut: noop,
        onPaste: noop,
        onNewFolder: noop,
        onRename: noop,
        onDelete: noop,
        onRefresh: noop,
      })

      const labels = items.map((i) => i.label)
      expect(labels).not.toContain('通过系统方式打开')
    })

    it('directory menu includes reveal in folder, copy path, copy relative path', () => {
      const items = buildContextMenuItems({
        targetKind: 'directory',
        targetPath: '/test/folder1',
        isExpanded: false,
        selectedPaths: new Set(['/test/folder1']),
        clipboard: null,
        busyOperation: 'idle',
        onOpenWithSystem: noop,
        onRevealInFolder: noop,
        onCopyPath: noop,
        onCopyRelativePath: noop,
        onCopy: noop,
        onCut: noop,
        onPaste: noop,
        onNewFolder: noop,
        onRename: noop,
        onDelete: noop,
        onRefresh: noop,
      })

      const labels = items.map((i) => i.label)
      expect(labels).toContain('在文件资源管理器中显示')
      expect(labels).toContain('复制路径')
      expect(labels).toContain('复制相对路径')
    })
  })

  // eslint-disable-next-line max-lines-per-function
  describe('system actions – API calls via context menu', () => {
    it('calls openEntryWithSystem when clicking "通过系统方式打开" on a file', async () => {
      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      const fileRow = findRowByName(container, 'file1.txt')
      await openContextMenu(fileRow)

      vi.mocked(mockApi.openEntryWithSystem).mockResolvedValueOnce({
        ok: true,
        affectedPaths: [],
      })

      await act(async () => {
        findContextMenuItem('通过系统方式打开').click()
      })

      expect(mockApi.openEntryWithSystem).toHaveBeenCalledWith({
        path: '/test/file1.txt',
      })
    })

    it('calls revealEntryInFolder when clicking "在文件资源管理器中显示" on a folder', async () => {
      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      const folderRow = findRowByName(container, 'folder1')
      await openContextMenu(folderRow)

      vi.mocked(mockApi.revealEntryInFolder).mockResolvedValueOnce({
        ok: true,
        affectedPaths: [],
      })

      await act(async () => {
        findContextMenuItem('在文件资源管理器中显示').click()
      })

      expect(mockApi.revealEntryInFolder).toHaveBeenCalledWith({
        path: '/test/folder1',
      })
    })

    it('calls copyTextToClipboard with absolute path when clicking "复制路径"', async () => {
      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      const fileRow = findRowByName(container, 'file1.txt')
      await openContextMenu(fileRow)

      vi.mocked(mockApi.copyTextToClipboard).mockResolvedValueOnce({
        ok: true,
        affectedPaths: [],
      })

      await act(async () => {
        findContextMenuItem('复制路径').click()
      })

      expect(mockApi.copyTextToClipboard).toHaveBeenCalledWith({
        text: '/test/file1.txt',
      })
    })

    it('calls copyTextToClipboard with relative path (no ./ prefix) when clicking "复制相对路径"', async () => {
      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      vi.mocked(mockApi.listDirectory).mockResolvedValue({
        ok: true,
        entries: [createFileEntry({ path: '/test/folder1/nested.txt', name: 'nested.txt', parentPath: '/test/folder1' })],
      })

      const folderRow = findRowByName(container, 'folder1')
      const expandBtn = folderRow.querySelector('.file-tree__expand:not(.file-tree__expand--spacer)') as HTMLButtonElement
      await act(async () => {
        expandBtn.click()
      })
      await act(async () => {
        await vi.waitFor(() => {
          return container.textContent?.includes('nested.txt')
        }, { timeout: 2000 })
      })

      const nestedRow = findRowByName(container, 'nested.txt')
      await openContextMenu(nestedRow)

      vi.mocked(mockApi.copyTextToClipboard).mockResolvedValueOnce({
        ok: true,
        affectedPaths: [],
      })

      await act(async () => {
        findContextMenuItem('复制相对路径').click()
      })

      expect(mockApi.copyTextToClipboard).toHaveBeenCalledWith({
        text: 'folder1/nested.txt',
      })
    })

    it('shows error toast when openEntryWithSystem fails', async () => {
      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      const fileRow = findRowByName(container, 'file1.txt')
      await openContextMenu(fileRow)

      vi.mocked(mockApi.openEntryWithSystem).mockResolvedValueOnce({
        ok: false,
        code: 'io_error',
        message: '无法打开文件',
      })

      await act(async () => {
        findContextMenuItem('通过系统方式打开').click()
      })

      const errorToast = container.querySelector('.file-toast--error')
      expect(errorToast).toBeTruthy()
      expect(errorToast?.textContent).toContain('系统打开失败')
    })

    it('shows error toast when copyTextToClipboard fails', async () => {
      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      const fileRow = findRowByName(container, 'file1.txt')
      await openContextMenu(fileRow)

      vi.mocked(mockApi.copyTextToClipboard).mockResolvedValueOnce({
        ok: false,
        code: 'unknown',
        message: '剪贴板写入失败',
      })

      await act(async () => {
        findContextMenuItem('复制路径').click()
      })

      const errorToast = container.querySelector('.file-toast--error')
      expect(errorToast).toBeTruthy()
      expect(errorToast?.textContent).toContain('复制路径失败')
    })

    it('shows success toast after copy relative path', async () => {
      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      const folderRow = findRowByName(container, 'folder1')
      await openContextMenu(folderRow)

      vi.mocked(mockApi.copyTextToClipboard).mockResolvedValueOnce({
        ok: true,
        affectedPaths: [],
      })

      await act(async () => {
        findContextMenuItem('复制相对路径').click()
      })

      expect(container.textContent).toContain('已复制相对路径：folder1')
    })

    it('copies "." for the root directory itself', async () => {
      const { container } = renderFilesWorkspace()

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

      const tree = container.querySelector('.file-tree') as HTMLDivElement
      await act(async () => {
        const event = new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 })
        tree.dispatchEvent(event)
      })

      const fileRow = findRowByName(container, 'file1.txt')
      await openContextMenu(fileRow)

      vi.mocked(mockApi.copyTextToClipboard).mockResolvedValueOnce({
        ok: true,
        affectedPaths: [],
      })

      await act(async () => {
        findContextMenuItem('复制相对路径').click()
      })

      expect(mockApi.copyTextToClipboard).toHaveBeenCalledWith({
        text: 'file1.txt',
      })
    })
  })
})
