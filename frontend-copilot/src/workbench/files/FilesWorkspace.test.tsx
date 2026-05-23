/** @vitest-environment jsdom */

/* eslint-disable sonarjs/no-duplicate-string */

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

// eslint-disable-next-line max-lines-per-function
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

  // eslint-disable-next-line max-lines-per-function
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
})
