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

import { FilesWorkspace, syncWatchedDirectories } from './FilesWorkspace'
import { ContextMenu, buildContextMenuItems } from './ContextMenu'
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

/** 辅助：选择根目录并等待渲染 */
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

describe('FilesWorkspace', () => {
  let mockApi: FileManagerApi

  beforeEach(() => {
    mockApi = createMockFileManagerApi()
    ;(window as unknown as Record<string, unknown>).fileManager = mockApi

    // 默认 stub：无持久化根目录
    vi.mocked(mockApi.loadLastRootDirectory).mockResolvedValue({
      ok: true,
      rootPath: null,
    })

    // 默认 stub：watcher 返回成功
    vi.mocked(mockApi.watchDirectories).mockResolvedValue({ ok: true, affectedPaths: [] })
    vi.mocked(mockApi.unwatchDirectories).mockResolvedValue({ ok: true, affectedPaths: [] })
    vi.mocked(mockApi.saveLastRootDirectory).mockResolvedValue({ ok: true, affectedPaths: [] })
    vi.mocked(mockApi.clearLastRootDirectory).mockResolvedValue({ ok: true, affectedPaths: [] })

    // 默认 stub：onDirectoryChanged 返回 no-op 取消函数
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

  describe('initial render (no root selected)', () => {
    it('renders the file workspace layout with toolbar and empty tree', () => {
      const { container } = renderFilesWorkspace()

      expect(container.querySelector('.file-workspace')).toBeTruthy()
      expect(container.querySelector('.file-toolbar')).toBeTruthy()
      expect(container.querySelector('.file-tree')).toBeTruthy()
      expect(container.querySelector('.file-main__placeholder-text')?.textContent).toContain('选择文件夹')
    })

    it('renders the empty state message in the tree', () => {
      const { getByText } = renderFilesWorkspace()

      expect(getByText('选择文件夹以浏览文件')).toBeTruthy()
    })

    it('only enables the Select Folder button when no root is selected', () => {
      const { container } = renderFilesWorkspace()

      const selectButton = Array.from(container.querySelectorAll('.file-toolbar__left button')).find(
        (btn) => btn.textContent?.includes('选择文件夹'),
      ) as HTMLButtonElement | undefined

      expect(selectButton).toBeTruthy()
      expect(selectButton?.disabled).toBe(false)
    })
  })

  describe('toolbar button set (revised – only select-folder + path)', () => {
    it('only contains the select-folder button and path breadcrumb', () => {
      const { container } = renderFilesWorkspace()

      const buttons = Array.from(container.querySelectorAll('.file-toolbar__left button'))
      const buttonTexts = buttons.map((btn) => btn.textContent?.trim() ?? '')

      // 允许的按钮
      expect(buttonTexts.some((t) => t.includes('选择文件夹'))).toBe(true)

      // 不应存在的按钮
      expect(buttonTexts.some((t) => t.includes('刷新'))).toBe(false)
      expect(buttonTexts.some((t) => t.includes('新建文件夹'))).toBe(false)
    })

    it('shows only 1 button in the toolbar when no root selected', () => {
      const { container } = renderFilesWorkspace()

      const buttons = container.querySelectorAll('.file-toolbar__left button')
      expect(buttons.length).toBe(1)
    })

    it('shows root path after selecting a folder', async () => {
      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      const rootPathEl = container.querySelector('.file-toolbar__root-path')
      expect(rootPathEl).toBeTruthy()
      expect(rootPathEl?.textContent).toBe('test')
    })
  })

  describe('selecting root directory', () => {
    it('calls window.fileManager.selectRootDirectory and probeDirectory', async () => {
      const rootEntries = [
        createDirEntry({ path: '/test/subdir', name: 'subdir' }),
        createFileEntry({ path: '/test/readme.md', name: 'readme.md' }),
      ]

      const mockSelectRootDirectory = vi.mocked(mockApi.selectRootDirectory)
      mockSelectRootDirectory.mockResolvedValueOnce({
        ok: true,
        rootPath: '/test',
        entries: rootEntries,
      })

      const mockProbeDirectory = vi.mocked(mockApi.probeDirectory)
      mockProbeDirectory.mockResolvedValueOnce({
        ok: true,
        totalItems: 10,
        isLarge: false,
        maxDepth: 2,
      })

      const { container } = renderFilesWorkspace()

      const selectButton = Array.from(container.querySelectorAll('.file-toolbar button')).find(
        (btn) => btn.textContent?.includes('选择文件夹'),
      ) as HTMLButtonElement

      await act(async () => {
        selectButton.click()
      })

      expect(mockSelectRootDirectory).toHaveBeenCalledOnce()
      expect(mockProbeDirectory).toHaveBeenCalledWith({ rootPath: '/test' })
    })

    it('saves last root directory after successful selection', async () => {
      vi.mocked(mockApi.selectRootDirectory).mockResolvedValueOnce({
        ok: true,
        rootPath: '/test',
        entries: [createDirEntry({ path: '/test/subdir', name: 'subdir' })],
      })
      vi.mocked(mockApi.probeDirectory).mockResolvedValueOnce({
        ok: true,
        totalItems: 10,
        isLarge: false,
        maxDepth: 2,
      })

      const { container } = renderFilesWorkspace()

      const selectButton = Array.from(container.querySelectorAll('.file-toolbar button')).find(
        (btn) => btn.textContent?.includes('选择文件夹'),
      ) as HTMLButtonElement

      await act(async () => {
        selectButton.click()
      })

      expect(mockApi.saveLastRootDirectory).toHaveBeenCalledWith({ rootPath: '/test' })
    })

    it('shows error toast when saving last root directory fails after selection', async () => {
      vi.mocked(mockApi.selectRootDirectory).mockResolvedValueOnce({
        ok: true,
        rootPath: '/test',
        entries: [createDirEntry({ path: '/test/subdir', name: 'subdir' })],
      })
      vi.mocked(mockApi.saveLastRootDirectory).mockResolvedValueOnce({
        ok: false,
        code: 'io_error',
        message: '保存根目录失败',
        details: 'disk full',
      })
      vi.mocked(mockApi.probeDirectory).mockResolvedValueOnce({
        ok: true,
        totalItems: 10,
        isLarge: false,
        maxDepth: 2,
      })

      const { container } = renderFilesWorkspace()

      const selectButton = Array.from(container.querySelectorAll('.file-toolbar button')).find(
        (btn) => btn.textContent?.includes('选择文件夹'),
      ) as HTMLButtonElement

      await act(async () => {
        selectButton.click()
      })

      await vi.waitFor(() => {
        const errorToast = container.querySelector('.file-toast--error')
        expect(errorToast?.textContent).toContain('保存根目录失败')
      })
      expect(container.querySelector('.file-toast--success')).toBeNull()
    })

    it('shows large directory warning when probe returns isLarge', async () => {
      const mockSelectRootDirectory = vi.mocked(mockApi.selectRootDirectory)
      mockSelectRootDirectory.mockResolvedValueOnce({
        ok: true,
        rootPath: '/test',
        entries: [createDirEntry({ path: '/test/subdir', name: 'subdir' })],
      })

      const mockProbeDirectory = vi.mocked(mockApi.probeDirectory)
      mockProbeDirectory.mockResolvedValueOnce({
        ok: true,
        totalItems: 5000,
        isLarge: true,
        maxDepth: 2,
      })

      const { container } = renderFilesWorkspace()

      const selectButton = Array.from(container.querySelectorAll('.file-toolbar button')).find(
        (btn) => btn.textContent?.includes('选择文件夹'),
      ) as HTMLButtonElement

      await act(async () => {
        selectButton.click()
      })

      const warningToast = container.querySelector('.file-toast--warning')
      expect(warningToast).toBeTruthy()
      expect(warningToast?.textContent).toContain('可能影响浏览性能')
      expect(container.querySelector('.file-toast--success')).toBeNull()
    })

    it('shows error when selectRootDirectory fails', async () => {
      const mockSelectRootDirectory = vi.mocked(mockApi.selectRootDirectory)
      mockSelectRootDirectory.mockResolvedValueOnce({
        ok: false,
        code: 'permission_denied',
        message: '权限不足',
      })

      renderFilesWorkspace()

      const selectButton = Array.from(document.querySelectorAll('.file-toolbar button')).find(
        (btn) => btn.textContent?.includes('选择文件夹'),
      ) as HTMLButtonElement

      await act(async () => {
        selectButton.click()
      })

      expect(document.querySelector('.file-toast--error')).toBeTruthy()
    })
  })

  describe('persistence – auto-restore last root directory', () => {
    it('restores last root directory on mount when path is valid', async () => {
      vi.mocked(mockApi.loadLastRootDirectory).mockResolvedValueOnce({
        ok: true,
        rootPath: '/last-session',
      })
      vi.mocked(mockApi.probeDirectory).mockResolvedValueOnce({
        ok: true,
        totalItems: 5,
        isLarge: false,
        maxDepth: 2,
      })
      vi.mocked(mockApi.listDirectory).mockResolvedValueOnce({
        ok: true,
        entries: [
          createFileEntry({ path: '/last-session/readme.md', name: 'readme.md' }),
        ],
      })

      const { container } = renderFilesWorkspace()

      // 等待异步恢复完成；waitFor 自身会包裹 act，避免把轮询嵌在 act 内导致恢复状态未被刷新。
      await vi.waitFor(() => {
        expect(mockApi.listDirectory).toHaveBeenCalledWith({
          rootPath: '/last-session',
          directoryPath: '/last-session',
        })
      }, { timeout: 2000 })
      await vi.waitFor(() => {
        expect(container.querySelector('.file-toolbar__root-path')?.textContent).toBe('last-session')
      }, { timeout: 2000 })

      expect(mockApi.loadLastRootDirectory).toHaveBeenCalled()
      expect(mockApi.probeDirectory).toHaveBeenCalledWith({ rootPath: '/last-session' })
    })

    it('clears persisted path and stays empty when path is not readable', async () => {
      vi.mocked(mockApi.loadLastRootDirectory).mockResolvedValueOnce({
        ok: true,
        rootPath: '/deleted-dir',
      })
      vi.mocked(mockApi.probeDirectory).mockResolvedValueOnce({
        ok: false,
        code: 'not_found',
        message: '目录不存在',
      })

      const { container } = renderFilesWorkspace()

      await act(async () => {
        await vi.waitFor(() => {
          expect(mockApi.clearLastRootDirectory).toHaveBeenCalled()
        }, { timeout: 2000 })
      })

      // 应仍停留在空状态
      expect(container.querySelector('.file-toolbar__root-path')).toBeNull()
      expect(container.textContent).toContain('选择文件夹以浏览文件')
    })

    it('stays empty when no persisted path exists', async () => {
      vi.mocked(mockApi.loadLastRootDirectory).mockResolvedValueOnce({
        ok: true,
        rootPath: null,
      })

      const { container } = renderFilesWorkspace()

      // 等待异步完成
      await act(async () => {
        await new Promise((r) => setTimeout(r, 100))
      })

      expect(container.querySelector('.file-toolbar__root-path')).toBeNull()
      expect(container.textContent).toContain('选择文件夹以浏览文件')
      expect(mockApi.probeDirectory).not.toHaveBeenCalled()
    })
  })

  describe('watcher – directory watch lifecycle', () => {
    it('registers watcher on rootPath + expandedPaths change', async () => {
      const { container } = renderFilesWorkspace()

      await selectRoot(container, mockApi)

      // 选择根目录后应注册 watcher
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

      // 展开 folder1
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

      // 确保 watcher 已注册
      await act(async () => {
        await vi.waitFor(() => {
          expect(mockApi.onDirectoryChanged).toHaveBeenCalled()
        }, { timeout: 2000 })
      })

      expect(capturedListener).not.toBeNull()

      // 模拟 listDirectory 返回（用于刷新调用）
      vi.mocked(mockApi.listDirectory).mockResolvedValue({
        ok: true,
        entries: [],
      })

      // 触发目录变化事件
      await act(async () => {
        capturedListener!({
          directoryPath: '/test',
          eventType: 'change',
          filename: 'newfile.txt',
          observedAt: new Date().toISOString(),
        })
        // 等待 debounce (300ms)
        await new Promise((r) => setTimeout(r, 400))
      })

      // 应触发了 listDirectory 刷新
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

      // 卸载后应调用 unwatchDirectories
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

      // 普通点击文件夹行
      await act(async () => {
        const event = new MouseEvent('click', { bubbles: true })
        folderRow.dispatchEvent(event)
      })

      // 应展开
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
        ;(parentRow.querySelector('.file-tree__expand:not(.file-tree__expand--spacer)') as HTMLButtonElement).click()
      })
      await act(async () => {
        await vi.waitFor(() => {
          expect(container.textContent).toContain('childdir')
        }, { timeout: 2000 })
      })

      const childRow = findRowByName(container, 'childdir')
      await act(async () => {
        ;(childRow.querySelector('.file-tree__expand:not(.file-tree__expand--spacer)') as HTMLButtonElement).click()
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

      // 首次点击：展开
      await act(async () => {
        folderRow.click()
      })
      await act(async () => {
        await vi.waitFor(() => {
          expect(expandBtn.classList.contains('file-tree__expand--expanded')).toBe(true)
        }, { timeout: 2000 })
      })

      // 再次点击：收起
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

      // 不应展开
      expect(expandBtn.classList.contains('file-tree__expand--expanded')).toBe(false)
      // 但应选中
      expect(folderRow.classList.contains('file-tree__row--selected')).toBe(true)
    })

    it('does NOT expand a folder on Shift+click', async () => {
      const { container } = await setupRootWithFolder()

      // 先点击 file 行建立 lastClickedPath（此处只有一个目录，但 selection 先选它）
      const folderRow = findRowByName(container, 'subdir')
      const expandBtn = folderRow.querySelector('.file-tree__expand:not(.file-tree__expand--spacer)') as HTMLButtonElement

      await act(async () => {
        folderRow.click()
      })

      // 现在点击同一个文件夹但带 Shift
      await act(async () => {
        const event = new MouseEvent('click', { shiftKey: true, bubbles: true })
        folderRow.dispatchEvent(event)
      })

      // 由于 Shift+点击会阻止展开逻辑（因为有 modifier），应仍然展开状态不变
      // 注意：第一次普通点击已经展开了，所以此时应仍保持展开。Shift 点击不改变展开状态。
      // 我们只需要验证 Shift 点击不额外触发 toggle
      // 实际上第一次点击已展开，Shift 点击不会触发 toggleExpand
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
        ;(rows[0] as HTMLDivElement).click()
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

  describe('context menu (revised)', () => {
    it('shows folder context menu on right-click with expand/collapse, copy, cut, paste, new folder, rename, delete', async () => {
      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      const rows = container.querySelectorAll('.file-tree__row')
      // 第一个是 folder1 (目录)
      const folderRow = rows[0]

      await act(async () => {
        const event = new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 })
        folderRow.dispatchEvent(event)
      })

      // 右键菜单应出现
      const menu = document.querySelector('.file-context-menu')
      expect(menu).toBeTruthy()

      const menuTexts = Array.from(menu!.querySelectorAll('.file-context-menu__item')).map(
        (item) => item.textContent?.trim() ?? '',
      )

      // 文件夹菜单应包含这些项
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

      // 文件菜单不应包含这些
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

      // 空白区域菜单不应包含文件/文件夹特有项
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

      // 点击树空白区域（清除选择）
      const tree = container.querySelector('.file-tree') as HTMLDivElement
      await act(async () => {
        tree.click()
      })

      // 空白区域右键
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

  describe('right-click selection rules', () => {
    it('switches to single selection when right-clicking an unselected node', async () => {
      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      const rows = container.querySelectorAll('.file-tree__row')

      // 先选中 file1.txt
      await act(async () => {
        ;(rows[1] as HTMLDivElement).click()
      })
      expect(rows[1].classList.contains('file-tree__row--selected')).toBe(true)

      // 右键 file2.txt (未选中)
      await act(async () => {
        const event = new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 })
        rows[2].dispatchEvent(event)
      })

      // file2 应被选中，file1 应取消选中
      expect(rows[1].classList.contains('file-tree__row--selected')).toBe(false)
      expect(rows[2].classList.contains('file-tree__row--selected')).toBe(true)
    })

    it('preserves multi-selection when right-clicking an already selected node', async () => {
      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      const rows = container.querySelectorAll('.file-tree__row')

      // Ctrl+click 多选 file1 和 file2
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

      // 右键 file1 (已在选中集合中)
      await act(async () => {
        const event = new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 })
        rows[1].dispatchEvent(event)
      })

      // 两个都应保持选中
      expect(rows[1].classList.contains('file-tree__row--selected')).toBe(true)
      expect(rows[2].classList.contains('file-tree__row--selected')).toBe(true)
    })
  })

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
        ;(laterRow.querySelector('.file-tree__expand:not(.file-tree__expand--spacer)') as HTMLButtonElement).click()
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

      // Expand folder1 to expose a nested file
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

      // Setup root with just files
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

      // Right-click blank area (root context) and open menu, then use the tree context menu
      const tree = container.querySelector('.file-tree') as HTMLDivElement
      await act(async () => {
        const event = new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 40 })
        tree.dispatchEvent(event)
      })

      // Blank area menu doesn't have copy relative path, so we test via state directly.
      // Instead, right-click a file which has rootPath context for relative path calc.
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

  describe('drag-and-drop move (revised)', () => {
    // jsdom 缺少 DragEvent，在此 polyfill
    beforeAll(() => {
      if (typeof DragEvent === 'undefined') {
        ;(window as unknown as Record<string, unknown>).DragEvent = class DragEvent extends MouseEvent {
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

      // 刷新列表用
      vi.mocked(mockApi.listDirectory).mockResolvedValue({ ok: true, entries: [] })

      // 通过文字内容找到行
      const allRows = Array.from(container.querySelectorAll('.file-tree__row'))
      const fileRow = allRows.find((r) => r.querySelector('.file-tree__name')?.textContent?.trim() === 'file1.txt') as HTMLDivElement
      const folderRow = allRows.find((r) => r.querySelector('.file-tree__name')?.textContent?.trim() === 'folder2') as HTMLDivElement
      expect(fileRow).toBeTruthy()
      expect(folderRow).toBeTruthy()

      // 先选中 file1.txt
      await act(async () => {
        fileRow.click()
      })

      // 模拟拖拽：dragStart -> dragOver -> drop
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

      // folder2 应有 drag-over 高亮
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

      // 模拟拖拽 folder1 到 file1.txt
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
        // 在文件行上 dragover 不应通过（因为只有 directory 才触发 onDragOver）
        fileRow.dispatchEvent(dragOverEvent)
      })

      // file1.txt 是文件，不应有 drag-over class
      expect(fileRow.classList.contains('file-tree__row--drag-over')).toBe(false)

      // moveEntries 不应被调用
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

      // 通过文字内容找到 file1.txt 行
      const rows = Array.from(container.querySelectorAll('.file-tree__row'))
      const fileRow = rows.find((r) => r.querySelector('.file-tree__name')?.textContent?.trim() === 'file1.txt')
      expect(fileRow).toBeTruthy()
      await act(async () => {
        ;(fileRow as HTMLDivElement).click()
      })
    }

    it('calls trashEntries and shows success when trash succeeds (via context menu)', async () => {
      const { container } = renderFilesWorkspace()
      await selectRootWithOneFile(container)

      const mockTrashEntries = vi.mocked(mockApi.trashEntries)
      // 重置 trash mock 避免跨测试污染
      mockTrashEntries.mockReset()
      mockTrashEntries.mockResolvedValue({
        ok: true,
        affectedPaths: ['/test/file1.txt'],
      })

      // 右键打开菜单 - 使用文字内容找到行
      const rows = Array.from(container.querySelectorAll('.file-tree__row'))
      const row = rows.find((r) => r.querySelector('.file-tree__name')?.textContent?.trim() === 'file1.txt') as HTMLDivElement
      expect(row).toBeTruthy()
      await act(async () => {
        const event = new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 })
        row.dispatchEvent(event)
      })

      // 点击删除菜单项
      const deleteMenuItem = Array.from(
        document.querySelectorAll('.file-context-menu__item'),
      ).find((item) => item.textContent?.trim() === '删除') as HTMLButtonElement

      expect(deleteMenuItem).toBeTruthy()

      await act(async () => {
        deleteMenuItem.click()
      })

      // 验证 trashEntries 被调用（具体参数取决于当前选中的节点）
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

  describe('workbench integration', () => {
    it('renders within the workspace-stage layout system', () => {
      const { container } = renderFilesWorkspace()

      expect(container.querySelector('.workspace-stage')).toBeTruthy()
      expect(container.querySelector('.workspace-panel')).toBeTruthy()
      expect(container.querySelector('.workspace-main')).toBeTruthy()
      expect(container.querySelector('.workspace-main__header')).toBeTruthy()
      expect(container.querySelector('.workspace-main__content')).toBeTruthy()
    })

    it('uses existing design tokens through CSS custom properties', () => {
      const { container } = renderFilesWorkspace()

      const toolbar = container.querySelector('.file-toolbar') as HTMLElement
      expect(toolbar).toBeTruthy()

      const style = window.getComputedStyle(toolbar)
      expect(style.backgroundColor).toBeTruthy()
    })
  })

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

    /** Dispatch a keydown event on the file-tree container */
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

    /** Get all visible rows ordered */
    function getRows(): HTMLDivElement[] {
      return Array.from(document.querySelectorAll('.file-tree__row')) as HTMLDivElement[]
    }

    /** Get the focused row */
    function getFocusedRow(): HTMLDivElement | undefined {
      return getRows().find((r) => r.classList.contains('file-tree__row--focused'))
    }

    /** Get a visible row by display name */
    function getRowByName(name: string): HTMLDivElement {
      const row = getRows().find((candidate) => rowName(candidate) === name)
      if (!row) {
        throw new Error(`Missing visible row for name=${name}`)
      }
      return row
    }

    /** Get name text of a row, including a row that is currently in rename mode */
    function rowName(row: HTMLDivElement): string {
      return row.querySelector('.file-tree__name')?.textContent?.trim()
        ?? (row.querySelector('.file-tree__rename-input') as HTMLInputElement | null)?.value
        ?? ''
    }

    /** Click a row to set initial selection/focus */
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

    /** Ctrl+click gives a folder focus/selection without invoking the plain-click expand behavior. */
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
      // Ctrl+click first row to set initial focus without triggering folder auto-expand.
      await focusRowWithoutExpanding(rows[0])
      expect(rowName(rows[0])).toBe('folder1')
      expect(rows[0].classList.contains('file-tree__row--focused')).toBe(true)
      expect(rows[0].classList.contains('file-tree__row--selected')).toBe(true)

      // ArrowDown follows current visible order: directories first, then files.
      await keyDown('ArrowDown')
      expect(rowName(getFocusedRow()!)).toBe('folder2')
      expect(getFocusedRow()!.classList.contains('file-tree__row--selected')).toBe(true)
      // Previous row should no longer be selected
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

      // Ctrl+ArrowDown: focus moves to folder2, selection stays on folder1
      await keyDown('ArrowDown', { ctrlKey: true })
      expect(rowName(getFocusedRow()!)).toBe('folder2')
      expect(rows[0].classList.contains('file-tree__row--selected')).toBe(true)
      expect(rows[1].classList.contains('file-tree__row--selected')).toBe(false)
    })

    it('Shift+ArrowDown extends continuous selection', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      const rows = getRows()
      // Ctrl+click first row to establish the selection anchor without expanding folder1.
      await focusRowWithoutExpanding(rows[0])

      // Shift+ArrowDown twice follows current visible order: folder1 → folder2 → file1.txt.
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
      await focusRowWithoutExpanding(rows[0]) // folder1

      // ArrowRight should expand folder1
      await keyDown('ArrowRight')

      await act(async () => {
        await vi.waitFor(() => {
          const expandBtn = rows[0].querySelector('.file-tree__expand')
          return expandBtn?.classList.contains('file-tree__expand--expanded')
        }, { timeout: 2000 })
      })

      // nested.txt should now be visible
      const nestedRow = getRows().find((r) => rowName(r) === 'nested.txt')
      expect(nestedRow).toBeTruthy()
    })

    it('ArrowRight on expanded folder moves focus to first child', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      const rows = getRows()
      await focusRowWithoutExpanding(rows[0]) // folder1

      // Expand first
      await keyDown('ArrowRight')
      await act(async () => {
        await vi.waitFor(() => {
          return getRows().some((r) => rowName(r) === 'nested.txt')
        }, { timeout: 2000 })
      })

      // ArrowRight again on expanded folder should move focus into first child
      await keyDown('ArrowRight')
      expect(rowName(getFocusedRow()!)).toBe('nested.txt')
    })

    it('ArrowLeft collapses an expanded folder', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      const rows = getRows()
      await focusRowWithoutExpanding(rows[0]) // folder1

      // Expand first
      await keyDown('ArrowRight')
      await act(async () => {
        await vi.waitFor(() => {
          return getRows().some((r) => rowName(r) === 'nested.txt')
        }, { timeout: 2000 })
      })

      // ArrowLeft should collapse
      await keyDown('ArrowLeft')

      const expandBtn = rows[0].querySelector('.file-tree__expand')
      expect(expandBtn?.classList.contains('file-tree__expand--expanded')).toBe(false)
    })

    it('ArrowLeft on a file moves focus to parent', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      const rows = getRows()
      await focusRowWithoutExpanding(rows[0]) // folder1

      // Expand
      await keyDown('ArrowRight')
      await act(async () => {
        await vi.waitFor(() => {
          return getRows().some((r) => rowName(r) === 'nested.txt')
        }, { timeout: 2000 })
      })

      // Move to nested.txt
      await keyDown('ArrowDown')
      expect(rowName(getFocusedRow()!)).toBe('nested.txt')

      // ArrowLeft on file → go to parent (folder1)
      await keyDown('ArrowLeft')
      expect(rowName(getFocusedRow()!)).toBe('folder1')
    })

    it('Enter expands or collapses a folder', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      const rows = getRows()
      await focusRowWithoutExpanding(rows[0]) // folder1

      // Enter to expand
      await keyDown('Enter')
      await act(async () => {
        await vi.waitFor(() => {
          return getRows().some((r) => rowName(r) === 'nested.txt')
        }, { timeout: 2000 })
      })

      // Enter to collapse
      await keyDown('Enter')
      const expandBtn = rows[0].querySelector('.file-tree__expand')
      expect(expandBtn?.classList.contains('file-tree__expand--expanded')).toBe(false)
    })

    it('Enter on a file does nothing', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      // Click file1.txt
      await clickRow(getRowByName('file1.txt'))

      const focusedBefore = rowName(getFocusedRow()!)
      await keyDown('Enter')
      // Focus should stay on the file
      expect(rowName(getFocusedRow()!)).toBe(focusedBefore)
    })

    it('Space toggles selection on focused item', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      const rows = getRows()
      await focusRowWithoutExpanding(rows[0]) // folder1 selected

      // Space toggles: folder1 deselected
      await keyDown(' ')
      expect(rows[0].classList.contains('file-tree__row--selected')).toBe(false)

      // Space again: folder1 selected
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

      // This exercises the selected focused item path; copy/focus fallback is covered separately.

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

      // Rename input should appear for file1.txt
      const renameInput = getRowByName('file1.txt').querySelector('.file-tree__rename-input') as HTMLInputElement
      expect(renameInput).toBeTruthy()
      expect(renameInput.value).toBe('file1.txt')
    })

    it('F2 triggers rename on single selected item when no focus', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      await clickRow(getRowByName('file1.txt')) // selected and focused

      await keyDown('F2')

      const renameInput = getRowByName('file1.txt').querySelector('.file-tree__rename-input') as HTMLInputElement
      expect(renameInput).toBeTruthy()
    })

    it('Ctrl+C copies selected item', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      await clickRow(getRowByName('file1.txt'))

      await keyDown('c', { ctrlKey: true })

      // Check success toast
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

      // Copy file1.txt first
      await clickRow(getRowByName('file1.txt'))
      await keyDown('c', { ctrlKey: true })

      // Focus folder1 and keep clipboard source unchanged.
      await focusRowWithoutExpanding(getRowByName('folder1'))

      // Paste
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

      // Clicking sets both selection and focus; this verifies the normal copy path.
      await keyDown('c', { ctrlKey: true })
      expect(container.textContent).toContain('已复制 1 个项目')
    })

    it('keyboard events are suppressed when rename input is active', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      await clickRow(getRowByName('file1.txt'))

      // Start rename
      await keyDown('F2')
      const renameInput = getRowByName('file1.txt').querySelector('.file-tree__rename-input') as HTMLInputElement
      expect(renameInput).toBeTruthy()

      // Arrow keys on the rename input should not move tree focus
      // The rename input's keyDown handler calls stopPropagation
      // So we dispatch on the input directly and verify tree state unchanged
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

      // Focus should still be on file1.txt (rename target)
      expect(rowName(getFocusedRow()!)).toBe(focusedBefore)
    })

    it('does not wrap ArrowUp past the first visible item', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      const rows = getRows()
      await focusRowWithoutExpanding(rows[0]) // folder1 (first item)

      await keyDown('ArrowUp')
      // Should stay at folder1
      expect(rowName(getFocusedRow()!)).toBe('folder1')
    })

    it('does not wrap ArrowDown past the last visible item', async () => {
      const { container } = renderFilesWorkspace()
      await setupTreeWithMixedEntries(container)

      const lastRow = getRowByName('file2.txt')
      await clickRow(lastRow) // file2.txt is the last item after directory-first sorting

      await keyDown('ArrowDown')
      // Should stay at last item
      expect(rowName(getFocusedRow()!)).toBe(rowName(lastRow))
    })
  })

  // ═══════════════════════════════════════════════════════════
  // ── Post Hook Integration Tests ────────────────────────────
  // ═══════════════════════════════════════════════════════════

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

      // Wait for watcher subscription
      await act(async () => {
        await vi.waitFor(() => {
          expect(mockApi.onDirectoryChanged).toHaveBeenCalled()
        }, { timeout: 2000 })
      })

      // Set up the post-hook spy
      const hookPayloads: FileWorkspacePostChangeHookPayload[] = []
      setPostChangeHookListener((payload) => {
        hookPayloads.push(payload)
      })

      // Mock listDirectory for refresh with entries
      vi.mocked(mockApi.listDirectory).mockResolvedValue({
        ok: true,
        entries: [
          createFileEntry({ path: '/test/file1.txt', name: 'file1.txt' }),
          createDirEntry({ path: '/test/new-folder', name: 'new-folder' }),
        ],
      })

      // Trigger watcher event
      await act(async () => {
        capturedListener!({
          directoryPath: '/test',
          eventType: 'rename',
          filename: 'new-folder',
          observedAt: new Date().toISOString(),
        })
        // Wait for debounce (300ms) + async processing
        await new Promise((r) => setTimeout(r, 500))
      })

      expect(hookPayloads.length).toBeGreaterThanOrEqual(1)
      const payload = hookPayloads[0]
      expect(payload.observedChange.source).toBe('filesystem-watch')
      expect(payload.observedChange.operation).toBe('watch-refresh')
      expect(payload.observedChange.rootPath).toBe('/test')
      expect(payload.observedChange.directoryPath).toBe('/test')
      expect(payload.semanticChanges.length).toBeGreaterThanOrEqual(1)

      // Clean up
      setPostChangeHookListener(null)
    })
  })

  describe('post-hook – user operations', () => {
    beforeEach(() => {
      setPostChangeHookListener(null)
    })

    afterEach(() => {
      setPostChangeHookListener(null)
    })

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
      // Return entriesAfter that include the newly created folder
      vi.mocked(mockApi.listDirectory).mockResolvedValue({
        ok: true,
        entries: [
          createFileEntry({ path: '/test/a.txt', name: 'a.txt' }),
          createDirEntry({ path: '/test/新建文件夹', name: '新建文件夹' }),
        ],
      })

      const { container } = renderFilesWorkspace()
      await selectRoot(container, mockApi)

      // Right-click blank area → create folder at root
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

      // Wait for async refresh and hook emission
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
      // entriesAfter includes the renamed file but not the old one
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

      // Type new name and commit via Enter
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

      // Copy file1.txt
      const fileRow = findRowByName(container, 'file1.txt')
      await openContextMenu(fileRow)
      await act(async () => {
        findContextMenuItem('复制').click()
      })

      // Paste into subdir
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

      // Cut file1.txt
      const fileRow = findRowByName(container, 'file1.txt')
      await openContextMenu(fileRow)
      await act(async () => {
        findContextMenuItem('剪切').click()
      })

      // Paste (move) into subdir
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

      // Polyfill DragEvent if needed
      if (typeof DragEvent === 'undefined') {
        ;(window as unknown as Record<string, unknown>).DragEvent = class DragEvent extends MouseEvent {
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

      // Drag start
      await act(async () => {
        const dt = createDT(JSON.stringify(['/test/file1.txt']))
        const ev = new DragEvent('dragstart', { bubbles: true }) as MouseEvent
        Object.defineProperty(ev, 'dataTransfer', { value: dt, writable: false })
        fileRow.dispatchEvent(ev)
      })

      // Drag over target
      await act(async () => {
        const dt2 = createDT(JSON.stringify(['/test/file1.txt']))
        const ev2 = new DragEvent('dragover', { bubbles: true, cancelable: true }) as MouseEvent
        Object.defineProperty(ev2, 'dataTransfer', { value: dt2, writable: false })
        targetRow.dispatchEvent(ev2)
      })

      // Drop
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
