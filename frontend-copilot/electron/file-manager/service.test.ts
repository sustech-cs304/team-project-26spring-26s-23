import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as path from 'node:path'

import { isSubdirectory, listDirectoryEntries, performTwoLevelProbe } from './service'

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
    const result = generateCopyName('/tmp/testdir', 'file.txt', false)
    expect(result).toBe('file - 副本.txt')
  })

  it('generates "name - 副本" for a file without extension', () => {
    const result = generateCopyName('/tmp/testdir', 'noext', false)
    expect(result).toBe('noext - 副本')
  })

  it('generates "name - 副本" for a directory', () => {
    const result = generateCopyName('/tmp/testdir', 'myfolder', true)
    expect(result).toBe('myfolder - 副本')
  })

  it('handles file with multiple dots in name', () => {
    const result = generateCopyName('/tmp/testdir', 'archive.tar.gz', false)
    expect(result).toBe('archive.tar - 副本.gz')
  })

  it('handles directory with dots in name', () => {
    const result = generateCopyName('/tmp/testdir', 'my.folder.v2', true)
    expect(result).toBe('my.folder.v2 - 副本')
  })

  it('increments counter when copy name already exists', () => {
    fsMocks.existsSync
      .mockReturnValueOnce(true)  // "file - 副本.txt" exists
      .mockReturnValueOnce(false) // "file - 副本 2.txt" does not exist

    const result = generateCopyName('/tmp/testdir', 'file.txt', false)
    expect(result).toBe('file - 副本 2.txt')
  })

  it('continues incrementing until a free name is found', () => {
    fsMocks.existsSync
      .mockReturnValueOnce(true)  // first exists
      .mockReturnValueOnce(true)  // second exists
      .mockReturnValueOnce(false) // third is free

    const result = generateCopyName('/tmp/testdir', 'doc.md', false)
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

    const entries = listDirectoryEntries('/test/dir')
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
      mtime: new Date('2026-01-01T00:00:00.000Z'),
    })

    const entries = listDirectoryEntries('/test/dir')
    expect(entries).toHaveLength(1)
    const entry = entries[0]!
    expect(entry.name).toBe('test-file.txt')
    expect(entry.kind).toBe('file')
    expect(entry.size).toBe(42)
    expect(entry.modifiedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(entry.hasChildren).toBeNull()
  })

  it('returns directory entries with hasChildren null without reading child directories', () => {
    const rootPath = path.normalize('/test/dir')
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
          mtime: new Date('2026-01-01T00:00:00.000Z'),
        }
      }
      if (normalized === filePath) {
        return {
          isDirectory: () => false,
          isFile: () => true,
          size: 42,
          mtime: new Date('2026-01-01T00:00:00.000Z'),
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
    const rootPath = path.normalize('/test/root')
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

  it('returns not_found instead of throwing when stat sees a vanished directory', async () => {
    const dirPath = path.normalize('/test/vanished')
    fsMocks.statSync.mockImplementationOnce(() => {
      throw createFsError('ENOENT: no such file or directory', 'ENOENT')
    })

    await expect(service.listDirectory({ rootPath: dirPath, directoryPath: dirPath })).resolves.toMatchObject({
      ok: false,
      code: 'not_found',
      message: `目录不存在: ${dirPath}`,
      details: 'ENOENT: no such file or directory',
    })
  })

  it('returns permission_denied when directory stat is denied', async () => {
    const dirPath = path.normalize('/test/private')
    fsMocks.statSync.mockImplementationOnce(() => {
      throw createFsError('EACCES: permission denied', 'EACCES')
    })

    const result = await service.listDirectory({ rootPath: dirPath, directoryPath: dirPath })

    expect(result).toMatchObject({
      ok: false,
      code: 'permission_denied',
      message: `无法访问目录: ${dirPath}`,
      details: 'EACCES: permission denied',
    })
  })

  it('returns io_error for unexpected directory stat failures', async () => {
    const dirPath = path.normalize('/test/flaky')
    fsMocks.statSync.mockImplementationOnce(() => {
      throw createFsError('EIO: input/output error', 'EIO')
    })

    const result = await service.listDirectory({ rootPath: dirPath, directoryPath: dirPath })

    expect(result).toMatchObject({
      ok: false,
      code: 'io_error',
      message: `检查目录失败: ${dirPath}`,
      details: 'EIO: input/output error',
    })
  })
})

describe('selectRootDirectory', () => {
  let service: ReturnType<typeof import('./service').createElectronFileManagerService>

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('./service')
    service = mod.createElectronFileManagerService({ getMainWindow: () => null })
  })

  it('uses single-argument dialog overload when no main window is available', async () => {
    const rootPath = path.normalize('/test/root')
    electronMocks.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [rootPath],
    })
    fsMocks.existsSync.mockImplementation((p: string) => path.normalize(p) === rootPath)
    fsMocks.statSync.mockReturnValue({
      isDirectory: () => true,
      isFile: () => false,
      size: 0,
      mtime: new Date('2026-01-01T00:00:00.000Z'),
    })
    fsMocks.readdirSync.mockReturnValue([])

    const result = await service.selectRootDirectory()

    expect(electronMocks.showOpenDialog).toHaveBeenCalledWith({
      properties: ['openDirectory'],
      title: '选择文件夹',
    })
    expect(electronMocks.showOpenDialog).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ ok: true, rootPath })
  })

  it('passes normalized defaultPath when an initial path is provided', async () => {
    const rootPath = path.normalize('/test/root')
    const initialPath = path.normalize('/test/initial')
    electronMocks.showOpenDialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: [rootPath],
    })
    fsMocks.existsSync.mockImplementation((p: string) => {
      const normalized = path.normalize(p)
      return normalized === rootPath || normalized === initialPath
    })
    fsMocks.statSync.mockImplementation((p: string) => {
      const normalized = path.normalize(p)
      if (normalized === rootPath || normalized === initialPath) {
        return {
          isDirectory: () => true,
          isFile: () => false,
          size: 0,
          mtime: new Date('2026-01-01T00:00:00.000Z'),
        }
      }
      throw new Error(`Unexpected stat path: ${normalized}`)
    })
    fsMocks.readdirSync.mockReturnValue([])

    const result = await service.selectRootDirectory({ initialPath })

    expect(electronMocks.showOpenDialog).toHaveBeenCalledWith({
      properties: ['openDirectory'],
      title: '选择文件夹',
      defaultPath: initialPath,
    })
    expect(result).toMatchObject({ ok: true, rootPath })
  })
})

describe('copyEntries and moveEntries', () => {
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

  function mockFileOperationPaths(src: string, destDir: string, existingExtraPaths: string[] = []) {
    const existing = new Set([src, destDir, ...existingExtraPaths].map((p) => path.normalize(p)))
    fsMocks.existsSync.mockImplementation((p: string) => existing.has(path.normalize(p)))
    fsMocks.statSync.mockImplementation((p: string) => {
      const normalized = path.normalize(p)
      if (normalized === destDir) {
        return {
          isDirectory: () => true,
          isFile: () => false,
          size: 0,
          mtime: new Date('2026-01-01T00:00:00.000Z'),
        }
      }
      if (normalized === src) {
        return {
          isDirectory: () => false,
          isFile: () => true,
          size: 10,
          mtime: new Date('2026-01-01T00:00:00.000Z'),
        }
      }
      throw new Error(`Unexpected stat path: ${normalized}`)
    })
  }

  it('returns source and created target path for a successful copy', async () => {
    const src = path.normalize('/test/source.txt')
    const destDir = path.normalize('/test/target')
    const destPath = path.join(destDir, 'source.txt')
    mockFileOperationPaths(src, destDir)

    const result = await service.copyEntries({
      rootPath: path.normalize('/test'),
      sourcePaths: [src],
      destinationDirectory: destDir,
      operationType: 'copy',
    })

    expect(result).toMatchObject({ ok: true, affectedPaths: [src, destPath] })
    expect(fsMocks.copyFileSync).toHaveBeenCalledWith(src, destPath)
  })

  it('marks cut as failed when source deletion fails after copy succeeds', async () => {
    const src = path.normalize('/test/source.txt')
    const destDir = path.normalize('/test/target')
    const destPath = path.join(destDir, 'source.txt')
    mockFileOperationPaths(src, destDir)
    fsMocks.unlinkSync.mockImplementationOnce(() => {
      throw new Error('EPERM: permission denied')
    })

    const result = await service.copyEntries({
      rootPath: path.normalize('/test'),
      sourcePaths: [src],
      destinationDirectory: destDir,
      operationType: 'cut',
    })

    expect(result).toMatchObject({
      ok: true,
      affectedPaths: [destPath],
      failedItems: [{ path: src, reason: 'EPERM: permission denied' }],
    })
    if (result.ok) {
      expect(result.affectedPaths).not.toContain(src)
    }
  })

  it('does not add the failed cut source to affected paths in a mixed batch', async () => {
    const srcOk = path.normalize('/test/ok.txt')
    const srcFail = path.normalize('/test/fail.txt')
    const destDir = path.normalize('/test/target')
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
          mtime: new Date('2026-01-01T00:00:00.000Z'),
        }
      }
      if (normalized === srcOk || normalized === srcFail) {
        return {
          isDirectory: () => false,
          isFile: () => true,
          size: 10,
          mtime: new Date('2026-01-01T00:00:00.000Z'),
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
        throw new Error('EPERM: permission denied')
      }
    })

    const result = await service.copyEntries({
      rootPath: path.normalize('/test'),
      sourcePaths: [srcOk, srcFail],
      destinationDirectory: destDir,
      operationType: 'cut',
    })

    expect(result).toMatchObject({
      ok: true,
      affectedPaths: [srcOk, destOk, destFail],
      failedItems: [{ path: srcFail, reason: 'EPERM: permission denied' }],
    })
    if (result.ok) {
      expect(result.affectedPaths).not.toContain(srcFail)
    }
  })

  it('returns source and target path for a successful move', async () => {
    const src = path.normalize('/test/source.txt')
    const destDir = path.normalize('/test/target')
    const destPath = path.join(destDir, 'source.txt')
    mockFileOperationPaths(src, destDir)

    const result = await service.moveEntries({
      rootPath: path.normalize('/test'),
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
    const dirPath = path.normalize('/test/root')
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
    const dirPath = path.normalize('/test/root')
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

    const result = await service.openEntryWithSystem({ path: '/test/file.txt' })

    const normalizedPath = path.normalize('/test/file.txt')
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

    const result = await service.openEntryWithSystem({ path: '/test/dir' })

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

    const result = await service.revealEntryInFolder({ path: '/test/file.txt' })

    const normalizedPath = path.normalize('/test/file.txt')
    expect(result).toEqual({ ok: true, affectedPaths: [normalizedPath] })
    expect(electronMocks.showItemInFolder).toHaveBeenCalledWith(normalizedPath)
  })

  it('returns ok with affectedPaths for an existing directory', async () => {
    fsMocks.existsSync.mockReturnValue(true)

    const result = await service.revealEntryInFolder({ path: '/test/dir' })

    const normalizedDir = path.normalize('/test/dir')
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

describe('savePastedFile', () => {
  let service: ReturnType<typeof import('./service').createElectronFileManagerService>

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('./service')
    service = mod.createElectronFileManagerService({ userDataPath: path.normalize('/userdata') })
  })

  it('saves pasted file bytes into the persisted pasted-files directory', async () => {
    const result = await service.savePastedFile({
      name: ' report?.txt ',
      content: new Uint8Array([65, 66, 67]),
    })

    const expectedDirectory = path.join(path.normalize('/userdata'), 'desktop-runtime', 'workspace', 'copilot-pasted-files')
    const expectedFilePath = path.join(expectedDirectory, 'report_.txt')

    expect(result).toEqual({ ok: true, filePath: expectedFilePath })
    expect(fsMocks.mkdirSync).toHaveBeenCalledWith(expectedDirectory, { recursive: true })
    expect(fsMocks.writeFileSync).toHaveBeenCalledTimes(1)
    expect(fsMocks.writeFileSync.mock.calls[0]?.[0]).toBe(expectedFilePath)
    expect(Buffer.isBuffer(fsMocks.writeFileSync.mock.calls[0]?.[1])).toBe(true)
    expect([...((fsMocks.writeFileSync.mock.calls[0]?.[1]) as Buffer)]).toEqual([65, 66, 67])
  })

  it('creates a unique file name when the sanitized target already exists', async () => {
    const expectedDirectory = path.join(path.normalize('/userdata'), 'desktop-runtime', 'workspace', 'copilot-pasted-files')
    const firstPath = path.join(expectedDirectory, 'pasted-file.txt')
    const secondPath = path.join(expectedDirectory, 'pasted-file-2.txt')
    fsMocks.existsSync.mockImplementation((input: string) => path.normalize(input) === path.normalize(firstPath))

    const result = await service.savePastedFile({
      name: 'pasted-file.txt',
      content: new Uint8Array([1, 2]),
    })

    expect(result).toEqual({ ok: true, filePath: secondPath })
    expect(fsMocks.writeFileSync).toHaveBeenCalledWith(secondPath, expect.any(Buffer))
  })
})
