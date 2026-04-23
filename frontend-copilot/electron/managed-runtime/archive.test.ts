import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const hoisted = vi.hoisted(() => ({
  execFileMock: vi.fn(),
  extractZipMock: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  execFile: hoisted.execFileMock,
}))

vi.mock('extract-zip', () => ({
  default: hoisted.extractZipMock,
}))

import { extractManagedRuntimeArchive } from './archive'

const tempRoots: string[] = []

afterEach(async () => {
  vi.clearAllMocks()
  await Promise.all(tempRoots.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })))
})

async function createTempRoot(prefix: string): Promise<string> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), prefix))
  tempRoots.push(tempRoot)
  return tempRoot
}

describe('extractManagedRuntimeArchive', () => {
  it('extracts zip archives through the Node-level extractor on non-Windows platforms', async () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux' })

    const tempRoot = await createTempRoot('candue-managed-runtime-archive-zip-')
    const archiveFile = path.join(tempRoot, 'runtime.zip')
    const destinationDir = path.join(tempRoot, 'destination')
    await writeFile(archiveFile, 'zip-bytes')

    hoisted.extractZipMock.mockImplementation(async (_archive: string, options: { dir: string }) => {
      await mkdir(options.dir, { recursive: true })
      await writeFile(path.join(options.dir, 'runtime.txt'), 'ready')
    })

    try {
      await extractManagedRuntimeArchive(archiveFile, destinationDir, 'zip')
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }

    expect(hoisted.extractZipMock).toHaveBeenCalledTimes(1)
    expect(hoisted.extractZipMock).toHaveBeenCalledWith(archiveFile, { dir: destinationDir })
    expect(hoisted.execFileMock).not.toHaveBeenCalledWith('tar', ['-xf', archiveFile, '-C', destinationDir])
    await expect(readFile(path.join(destinationDir, 'runtime.txt'), 'utf8')).resolves.toBe('ready')
  })

  it('normalizes a single extracted root directory after zip extraction', async () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux' })

    const tempRoot = await createTempRoot('candue-managed-runtime-archive-normalize-')
    const archiveFile = path.join(tempRoot, 'runtime.zip')
    const destinationDir = path.join(tempRoot, 'destination')
    await writeFile(archiveFile, 'zip-bytes')

    hoisted.extractZipMock.mockImplementation(async (_archive: string, options: { dir: string }) => {
      const nestedRoot = path.join(options.dir, 'runtime-root')
      await mkdir(path.join(nestedRoot, 'bin'), { recursive: true })
      await writeFile(path.join(nestedRoot, 'bin', 'node'), '#!/usr/bin/env node\n')
    })

    try {
      await extractManagedRuntimeArchive(archiveFile, destinationDir, 'zip')
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }

    await expect(readFile(path.join(destinationDir, 'bin', 'node'), 'utf8')).resolves.toBe('#!/usr/bin/env node\n')
    await expect(readFile(path.join(destinationDir, 'runtime-root', 'bin', 'node'), 'utf8')).rejects.toThrow()
  })
})
