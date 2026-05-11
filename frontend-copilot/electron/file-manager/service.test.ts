import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as path from 'node:path'

import { isSubdirectory, listDirectoryEntries, performTwoLevelProbe } from './service'

const TEST_DIR = '/tmp/testdir'
const TEST_MTIME = '2026-01-01T00:00:00.000Z'
const TEST_ROOT = '/test/root'
const TEST_SOURCE = '/test/source.txt'
const TEST_TARGET = '/test/target'
const TEST_FILE = '/test/file.txt'
const TEST_DIR_PATH = '/test/dir'
const EPERM_MSG = 'EPERM: permission denied'

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn((_p: string) => false),
  readdirSync: vi.fn((_p: string) => [] as string[]),
  statSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  copyFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  renameSync: vi.fn(),
  rmSync: vi.fn(),
  unlinkSync: vi.fn(),
  watch: vi.fn(),
}))

const electronMocks = vi.hoisted(() => ({
  openPath: vi.fn(),
  openExternal: vi.fn(),
  showItemInFolder: vi.fn(),
  writeText: vi.fn(),
  showOpenDialog: vi.fn(),
}))

vi.mock('node:fs', () => fsMocks)

vi.mock('electron', () => ({
  shell: {
    openPath: electronMocks.openPath,
    openExternal: electronMocks.openExternal,
    showItemInFolder: electronMocks.showItemInFolder,
  },
  clipboard: {
    writeText: electronMocks.writeText,
  },
  dialog: {
    showOpenDialog: electronMocks.showOpenDialog,
  },
}))

// We need the real generateCopyName for testing
import { generateCopyName } from './service'

describe('generateCopyName', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fsMocks.existsSync.mockReturnValue(false)
  })

  it('generates "name - 副本.ext" for a regular file (no conflict)', () => {
    const result = generateCopyName(TEST_DIR, 'file.txt', false)
    expect(result).toBe('file - 副本.txt')
  })

  it('generates "name - 副本" for a file without extension', () => {
    const result = generateCopyName(TEST_DIR, 'noext', false)
    expect(result).toBe('noext - 副本')
  })

  it('generates "name - 副本" for a directory', () => {
    const result = generateCopyName(TEST_DIR, 'myfolder', true)
    expect(result).toBe('myfolder - 副本')
  })

  it('handles file with multiple dots in name', () => {
    const result = generateCopyName(TEST_DIR, 'archive.tar.gz', false)
    expect(result).toBe('archive.tar - 副本.gz')
  })

  it('handles directory with dots in name', () => {
    const result = generateCopyName(TEST_DIR, 'my.folder.v2', true)
    expect(result).toBe('my.folder.v2 - 副本')
  })

  it('increments counter when copy name already exists', () => {
    fsMocks.existsSync
      .mockReturnValueOnce(true)  // "file - 副本.txt" exists
      .mockReturnValueOnce(false) // "file - 副本 2.txt" does not exist

    const result = generateCopyName(TEST_DIR, 'file.txt', false)
    expect(result).toBe('file - 副本 2.txt')
  })

  it('continues incrementing until a free name is found', () => {
    fsMocks.existsSync
      .mockReturnValueOnce(true)  // first exists
      .mockReturnValueOnce(true)  // second exists
      .mockReturnValueOnce(false) // third is free

    const result = generateCopyName(TEST_DIR, 'doc.md', false)
    expect(result).toBe('doc - 副本 3.md')
  })
})

describe('isSubdirectory', () => {
  it('returns true when child is direct child of parent', () => {
    expect(isSubdirectory('/parent/child', '/parent')).toBe(true)
  })

  it('returns true when child is deeply nested under parent', () => {
    expect(isSubdirectory('/parent/a/b/c', '/parent')).toBe(true)
  })

  it('returns false when paths are unrelated', () => {
    expect(isSubdirectory('/foo/bar', '/baz/qux')).toBe(false)
  })

  it('returns false when parent appears as prefix substring but is not an ancestor', () => {
    expect(isSubdirectory('/foobar/baz', '/foo')).toBe(false)
  })

  it('handles Windows-style backslash paths', () => {
    const result = isSubdirectory('D:\\workspace\\child', 'D:\\workspace')
    expect(result).toBe(true)
  })
})

describe('performTwoLevelProbe', () => {
  it('returns zero count for non-existent directory', () => {
    fsMocks.readdirSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    const result = performTwoLevelProbe('/nonexistent/path/12345')
    expect(result.totalItems).toBe(0)
    expect(result.isLarge).toBe(false)
    expect(result.maxDepth).toBe(0)
  })
})

describe('listDirectoryEntries', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array for non-existent directory', () => {
    fsMocks.readdirSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    const entries = listDirectoryEntries('/nonexistent/path/12345')
    expect(entries).toEqual([])
  })

  it('sorts directories before files and alphabetically within each group', () => {
    fsMocks.readdirSync.mockReturnValue(['b-dir', 'a-file.txt', 'a-dir', 'b-file.txt'])
    fsMocks.statSync.mockImplementation((p: string) => ({
      isDirectory: () => !(p as string).includes('file'),
      isFile: () => (p as string).includes('file'),
      size: 100,
      mtime: new Date(),
    }))

    const entries = listDirectoryEntries('/test/list-dir')
    const names = entries.map(e => e.name)
    // Directories should come first, alphabetically: a-dir, b-dir
    // Then files, alphabetically: a-file.txt, b-file.txt
    expect(names).toEqual(['a-dir', 'b-dir', 'a-file.txt', 'b-file.txt'])
  })

  it('returns entries with correct structure', () => {
    fsMocks.readdirSync.mockReturnValue(['test-file.txt'])
    fsMocks.statSync.mockReturnValue({
      isDirectory: () => false,
      isFile: () => true,
      size: 42,
      mtime: new Date(TEST_MTIME),
    })

    const entries = listDirectoryEntries('/test/list-dir')
    expect(entries).toHaveLength(1)
    const entry = entries[0]!
    expect(entry.name).toBe('test-file.txt')
    expect(entry.kind).toBe('file')
    expect(entry.size).toBe(42)
    expect(entry.modifiedAt).toBe(TEST_MTIME)
    expect(entry.hasChildren).toBeNull()
  })

  it('returns directory entries with hasChildren null without reading child directories', () => {
    const rootPath = path.normalize('/test/list-dir')
    const childDirPath = path.join(rootPath, 'child-dir')
    const filePath = path.join(rootPath, 'file.txt')

    fsMocks.readdirSync.mockImplementation((p: string) => {
      const normalized = path.normalize(p)
      if (normalized === rootPath) {
        return ['child-dir', 'file.txt']
      }
      throw new Error(`Unexpected child readdir: ${normalized}`)
    })
    fsMocks.statSync.mockImplementation((p: string) => {
      const normalized = path.normalize(p)
      if (normalized === childDirPath) {
        return {
          isDirectory: () => true,
          isFile: () => false,
          size: 0,
          mtime: new Date(TEST_MTIME),
        }
      }
      if (normalized === filePath) {
        return {
          isDirectory: () => false,
          isFile: () => true,
          size: 42,
          mtime: new Date(TEST_MTIME),
        }
      }
      throw new Error(`Unexpected stat path: ${normalized}`)
    })

    const entries = listDirectoryEntries(rootPath)

    expect(entries.find((entry) => entry.name === 'child-dir')).toMatchObject({
      kind: 'directory',
      hasChildren: null,
    })
    expect(fsMocks.readdirSync).not.toHaveBeenCalledWith(childDirPath)
    expect(fsMocks.readdirSync).not.toHaveBeenCalledWith(filePath)
  })
})

describe('root directory persistence', () => {
  let service: ReturnType<typeof import('./service').createElectronFileManagerService>

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('./service')
    service = mod.createElectronFileManagerService({ userDataPath: path.normalize('/userdata') })
  })

  it('returns io_error when saving last root directory fails', async () => {
    const rootPath = path.normalize(TEST_ROOT)
    fsMocks.writeFileSync.mockImplementationOnce(() => {
      throw new Error('EACCES: permission denied')
    })

    const result = await service.saveLastRootDirectory({ rootPath })

    expect(result).toMatchObject({
      ok: false,
      code: 'io_error',
      message: '保存根目录失败',
      details: 'EACCES: permission denied',
    })
  })
})

describe('directory validation', () => {
  let service: ReturnType<typeof import('./service').createElectronFileManagerService>

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('./service')
    service = mod.createElectronFileManagerService()
  })

  function createFsError(message: string, code: string): NodeJS.ErrnoException {
    return Object.assign(new Error(message), { code })
  }

  it('returns not_found for ENOENT', async () => {
    const dirPath = path.normalize('/test/missing')
    fsMocks.readdirSync.mockImplementation(() => {
      throw createFsError('ENOENT', 'ENOENT')
    })
    fsMocks.statSync.mockImplementation(() => {
      throw createFsError('ENOENT', 'ENOENT')
    })

    const result = await service.listDirectory({ rootPath: dirPath, directoryPath: dirPath })
    expect(result).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('returns not_found for ENOTDIR', async () => {
    const dirPath = path.normalize('/test/missing')
    fsMocks.statSync.mockImplementation(() => {
      throw createFsError('ENOTDIR', 'ENOTDIR')
    })

    const result = await service.listDirectory({ rootPath: dirPath, directoryPath: dirPath })
    expect(result).toMatchObject({ ok: false, code: 'not_found' })
  })
})

describe('selectRootDirectory', () => {
  let service: ReturnType<typeof import('./service').createElectronFileManagerService>

  beforeEach(async () => {
    vi.clearAllMocks()
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    const mod = await import('./service')
    service = mod.createElectronFileManagerService()
  })

  it('returns invalid_operation when dialog is cancelled', async () => {
    const result = await service.selectRootDirectory()
    expect(result).toMatchObject({ ok: false, code: 'invalid_operation', message: '未选择任何目录' })
  })

  it('returns ok with entries when a directory is selected', async () => {
    const initialPath = path.normalize('/test/initial')
    const rootPath = path.normalize(TEST_ROOT)
    electronMocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [rootPath] })
    fsMocks.existsSync.mockReturnValue(true)
    fsMocks.readdirSync.mockReturnValue([])
    fsMocks.statSync.mockImplementation((p: string) => {
      const normalized = path.normalize(p)
      if (normalized === rootPath) {
        return {
          isDirectory: () => true,
          isFile: () => false,
          size: 0,
          mtime: new Date(TEST_MTIME),
        }
      }
      throw new Error(`Unexpected stat path: ${normalized}`)
    })

    const result = await service.selectRootDirectory({ initialPath })

    expect(electronMocks.showOpenDialog).toHaveBeenCalledWith({
      properties: ['openDirectory'],
      title: '选择文件夹',
      defaultPath: initialPath,
    })
    expect(result).toMatchObject({ ok: true, rootPath })
  })
})

function mockCopyFileOpPaths(src: string, destDir: string, extraPaths: string[] = []) {
  const existing = new Set([src, destDir, ...extraPaths].map((p) => path.normalize(p)))
  fsMocks.existsSync.mockImplementation((p: string) => existing.has(path.normalize(p)))
  fsMocks.statSync.mockImplementation((p: string) => {
    const normalized = path.normalize(p)
    if (normalized === destDir) {
      return {
        isDirectory: () => true,
        isFile: () => false,
        size: 0,
        mtime: new Date(TEST_MTIME),
      }
    }
    if (normalized === src) {
      return {
        isDirectory: () => false,
        isFile: () => true,
        size: 10,
        mtime: new Date(TEST_MTIME),
      }
    }
    throw new Error(`Unexpected stat path: ${normalized}`)
  })
}

describe('copyEntries', () => {
  let service: ReturnType<typeof import('./service').createElectronFileManagerService>

  beforeEach(async () => {
    vi.clearAllMocks()
    fsMocks.copyFileSync.mockImplementation(() => undefined)
    fsMocks.mkdirSync.mockImplementation(() => undefined)
    fsMocks.renameSync.mockImplementation(() => undefined)
    fsMocks.rmSync.mockImplementation(() => undefined)
    fsMocks.unlinkSync.mockImplementation(() => undefined)
    const mod = await import('./service')
    service = mod.createElectronFileManagerService()
  })

  it('returns source and created target path for a successful copy', async () => {
    const src = path.normalize(TEST_SOURCE)
    const destDir = path.normalize(TEST_TARGET)
    const destPath = path.join(destDir, 'source.txt')
    mockCopyFileOpPaths(src, destDir)

    const result = await service.copyEntries({
      rootPath: path.normalize(TEST_ROOT),
      sourcePaths: [src],
      destinationDirectory: destDir,
      operationType: 'copy',
    })

    expect(result).toMatchObject({ ok: true, affectedPaths: [src, destPath] })
    expect(fsMocks.copyFileSync).toHaveBeenCalledWith(src, destPath)
  })

  it('marks cut as failed when source deletion fails after copy succeeds', async () => {
    const src = path.normalize(TEST_SOURCE)
    const destDir = path.normalize(TEST_TARGET)
    const destPath = path.join(destDir, 'source.txt')
    mockCopyFileOpPaths(src, destDir)
    fsMocks.unlinkSync.mockImplementationOnce(() => {
      throw new Error(EPERM_MSG)
    })

    const result = await service.copyEntries({
      rootPath: path.normalize(TEST_ROOT),
      sourcePaths: [src],
      destinationDirectory: destDir,
      operationType: 'cut',
    })

    expect(result).toMatchObject({
      ok: true,
      affectedPaths: [destPath],
      failedItems: [{ path: src, reason: EPERM_MSG }],
    })
    if (result.ok) {
      expect(result.affectedPaths).not.toContain(src)
    }
  })

  it('does not add the failed cut source to affected paths in a mixed batch', async () => {
    const srcOk = path.normalize('/test/ok.txt')
    const srcFail = path.normalize('/test/fail.txt')
    const destDir = path.normalize(TEST_TARGET)
    const destOk = path.join(destDir, 'ok.txt')
    const destFail = path.join(destDir, 'fail.txt')
    const existing = new Set([srcOk, srcFail, destDir])

    fsMocks.existsSync.mockImplementation((p: string) => existing.has(path.normalize(p)))
    fsMocks.statSync.mockImplementation((p: string) => {
      const normalized = path.normalize(p)
      if (normalized === destDir) {
        return {
          isDirectory: () => true,
          isFile: () => false,
          size: 0,
          mtime: new Date(TEST_MTIME),
        }
      }
      if (normalized === srcOk || normalized === srcFail) {
        return {
          isDirectory: () => false,
          isFile: () => true,
          size: 10,
          mtime: new Date(TEST_MTIME),
        }
      }
      throw new Error(`Unexpected stat path: ${normalized}`)
    })
    fsMocks.unlinkSync.mockImplementation((p: string) => {
      const normalized = path.normalize(p)
      if (normalized === srcOk) {
        existing.delete(srcOk)
        return
      }
      if (normalized === srcFail) {
        throw new Error(EPERM_MSG)
      }
    })

    const result = await service.copyEntries({
      rootPath: path.normalize(TEST_ROOT),
      sourcePaths: [srcOk, srcFail],
      destinationDirectory: destDir,
      operationType: 'cut',
    })

    expect(result).toMatchObject({
      ok: true,
      affectedPaths: [srcOk, destOk, destFail],
      failedItems: [{ path: srcFail, reason: EPERM_MSG }],
    })
    if (result.ok) {
      expect(result.affectedPaths).not.toContain(srcFail)
    }
  })
})

describe('moveEntries', () => {
  let service: ReturnType<typeof import('./service').createElectronFileManagerService>

  beforeEach(async () => {
    vi.clearAllMocks()
    fsMocks.renameSync.mockImplementation(() => undefined)
    const mod = await import('./service')
    service = mod.createElectronFileManagerService()
  })

  function mockFileOpPaths(src: string, destDir: string) {
    const existing = new Set([src, destDir].map((p) => path.normalize(p)))
    fsMocks.existsSync.mockImplementation((p: string) => existing.has(path.normalize(p)))
    fsMocks.statSync.mockImplementation((p: string) => {
      const normalized = path.normalize(p)
      if (normalized === destDir) {
        return {
          isDirectory: () => true,
          isFile: () => false,
          size: 0,
          mtime: new Date(TEST_MTIME),
        }
      }
      if (normalized === src) {
        return {
          isDirectory: () => false,
          isFile: () => true,
          size: 10,
          mtime: new Date(TEST_MTIME),
        }
      }
      throw new Error(`Unexpected stat path: ${normalized}`)
    })
  }

  it('returns source and target path for a successful move', async () => {
    const src = path.normalize(TEST_SOURCE)
    const destDir = path.normalize(TEST_TARGET)
    const destPath = path.join(destDir, 'source.txt')
    mockFileOpPaths(src, destDir)

    const result = await service.moveEntries({
      rootPath: path.normalize(TEST_ROOT),
      sourcePaths: [src],
      destinationDirectory: destDir,
    })

    expect(result).toMatchObject({ ok: true, affectedPaths: [src, destPath] })
    expect(fsMocks.renameSync).toHaveBeenCalledWith(src, destPath)
  })
})

describe('watchDirectories', () => {
  let service: ReturnType<typeof import('./service').createElectronFileManagerService>

  beforeEach(async () => {
    vi.clearAllMocks()
    fsMocks.watch.mockReturnValue({
      on: vi.fn(),
      close: vi.fn(),
    })
    const mod = await import('./service')
    service = mod.createElectronFileManagerService()
  })

  it('normalizes Buffer filenames before emitting directory change events', async () => {
    const dirPath = path.normalize(TEST_ROOT)
    const listener = vi.fn()
    service.onDirectoryChanged(listener)

    await service.watchDirectories({ paths: [dirPath] })

    const watchCallback = fsMocks.watch.mock.calls[0]?.[1] as ((eventType: 'rename' | 'change', filename: Buffer) => void) | undefined
    expect(watchCallback).toBeDefined()
    watchCallback?.('rename', Buffer.from('buffer-name.txt'))

    expect(listener).toHaveBeenCalledWith(expect.objectContaining({
      directoryPath: dirPath,
      eventType: 'rename',
      filename: 'buffer-name.txt',
    }))
  })

  it('omits empty or unavailable watcher filenames', async () => {
    const dirPath = path.normalize(TEST_ROOT)
    const listener = vi.fn()
    service.onDirectoryChanged(listener)

    await service.watchDirectories({ paths: [dirPath] })

    const watchCallback = fsMocks.watch.mock.calls[0]?.[1] as ((eventType: 'rename' | 'change', filename: Buffer | null) => void) | undefined
    watchCallback?.('change', Buffer.from(''))
    watchCallback?.('rename', null)

    expect(listener).toHaveBeenCalledTimes(2)
    expect(listener).toHaveBeenNthCalledWith(1, expect.not.objectContaining({ filename: expect.anything() }))
    expect(listener).toHaveBeenNthCalledWith(2, expect.not.objectContaining({ filename: expect.anything() }))
  })
})

describe('openEntryWithSystem', () => {
  let service: ReturnType<typeof import('./service').createElectronFileManagerService>

  beforeEach(async () => {
    vi.clearAllMocks()
    // dynamic import so the electron mock is applied
    const mod = await import('./service')
    service = mod.createElectronFileManagerService()
  })

  it('returns ok with affectedPaths when shell.openPath succeeds (empty string)', async () => {
    fsMocks.existsSync.mockReturnValue(true)
    fsMocks.statSync.mockReturnValue({ isFile: () => true, isDirectory: () => false })
    electronMocks.openPath.mockResolvedValue('')

    const result = await service.openEntryWithSystem({ path: TEST_FILE })

    const normalizedPath = path.normalize(TEST_FILE)
    expect(result).toEqual({ ok: true, affectedPaths: [normalizedPath] })
    expect(electronMocks.openPath).toHaveBeenCalledWith(normalizedPath)
  })

  it('opens http urls with the system browser', async () => {
    electronMocks.openExternal.mockResolvedValue(undefined)

    const result = await service.openEntryWithSystem({ path: 'https://bb.example/announcement/1' })

    expect(result).toEqual({ ok: true, affectedPaths: ['https://bb.example/announcement/1'] })
    expect(electronMocks.openExternal).toHaveBeenCalledWith('https://bb.example/announcement/1')
    expect(fsMocks.existsSync).not.toHaveBeenCalled()
  })

  it('returns not_found when path does not exist', async () => {
    fsMocks.existsSync.mockReturnValue(false)

    const result = await service.openEntryWithSystem({ path: '/missing.txt' })

    expect(result).toMatchObject({ ok: false, code: 'not_found' })
  })

  it('returns invalid_operation when path is a directory', async () => {
    fsMocks.existsSync.mockReturnValue(true)
    fsMocks.statSync.mockReturnValue({ isFile: () => false, isDirectory: () => true })

    const result = await service.openEntryWithSystem({ path: TEST_DIR_PATH })

    expect(result).toMatchObject({ ok: false, code: 'invalid_operation' })
  })

  it('returns io_error when shell.openPath returns an error message', async () => {
    fsMocks.existsSync.mockReturnValue(true)
    fsMocks.statSync.mockReturnValue({ isFile: () => true, isDirectory: () => false })
    electronMocks.openPath.mockResolvedValue('No default app for this file type')

    const result = await service.openEntryWithSystem({ path: '/test/unknown.xyz' })

    expect(result).toMatchObject({ ok: false, code: 'io_error' })
  })
})

describe('revealEntryInFolder', () => {
  let service: ReturnType<typeof import('./service').createElectronFileManagerService>

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('./service')
    service = mod.createElectronFileManagerService()
  })

  it('returns ok with affectedPaths for an existing file', async () => {
    fsMocks.existsSync.mockReturnValue(true)

    const result = await service.revealEntryInFolder({ path: TEST_FILE })

    const normalizedPath = path.normalize(TEST_FILE)
    expect(result).toEqual({ ok: true, affectedPaths: [normalizedPath] })
    expect(electronMocks.showItemInFolder).toHaveBeenCalledWith(normalizedPath)
  })

  it('returns ok with affectedPaths for an existing directory', async () => {
    fsMocks.existsSync.mockReturnValue(true)

    const result = await service.revealEntryInFolder({ path: TEST_DIR_PATH })

    const normalizedDir = path.normalize(TEST_DIR_PATH)
    expect(result).toEqual({ ok: true, affectedPaths: [normalizedDir] })
  })

  it('returns not_found when path does not exist', async () => {
    fsMocks.existsSync.mockReturnValue(false)

    const result = await service.revealEntryInFolder({ path: '/missing.txt' })

    expect(result).toMatchObject({ ok: false, code: 'not_found' })
  })
})

describe('copyTextToClipboard', () => {
  let service: ReturnType<typeof import('./service').createElectronFileManagerService>

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('./service')
    service = mod.createElectronFileManagerService()
  })

  it('writes text to clipboard and returns ok', async () => {
    const result = await service.copyTextToClipboard({ text: 'hello world' })

    expect(result).toEqual({ ok: true, affectedPaths: [] })
    expect(electronMocks.writeText).toHaveBeenCalledWith('hello world')
  })

  it('allows empty string (writes empty string to clipboard)', async () => {
    const result = await service.copyTextToClipboard({ text: '' })

    expect(result).toEqual({ ok: true, affectedPaths: [] })
    expect(electronMocks.writeText).toHaveBeenCalledWith('')
  })
})
