/* eslint-disable max-lines-per-function */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electronMocks = vi.hoisted(() => ({
  availableFormats: vi.fn(() => [] as string[]),
  readImage: vi.fn(),
  createFromBuffer: vi.fn(),
}))

vi.mock('electron', () => ({
  clipboard: {
    availableFormats: electronMocks.availableFormats,
    readImage: electronMocks.readImage,
  },
  nativeImage: {
    createFromBuffer: electronMocks.createFromBuffer,
  },
}))

describe('createElectronAttachmentService', () => {
  const tempRoots: string[] = []

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map(async (tempRoot) => rm(tempRoot, { recursive: true, force: true })))
  })

  async function createTempRoot(name: string): Promise<string> {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), `candue-attachment-service-${name}-`))
    tempRoots.push(tempRoot)
    return tempRoot
  }

  it('reads clipboard image data into a persistable PNG payload', async () => {
    const { createElectronAttachmentService } = await import('./service')
    const now = new Date('2026-05-09T06:00:00.000Z')
    const pngBuffer = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])

    electronMocks.availableFormats.mockReturnValue(['image/png'])
    electronMocks.readImage.mockReturnValue({
      isEmpty: () => false,
      toPNG: () => pngBuffer,
      getSize: () => ({ width: 320, height: 180 }),
    })

    const service = createElectronAttachmentService({ now: () => now })
    const result = await service.readClipboardData()

    expect(result).toEqual({
      ok: true,
      status: 'image',
      availableFormats: ['image/png'],
      data: {
        mimeType: 'image/png',
        base64Data: pngBuffer.toString('base64'),
        byteLength: pngBuffer.byteLength,
        width: 320,
        height: 180,
        suggestedName: 'pasted-image-2026-05-09_06-00-00-000.png',
      },
    })
  })

  it('returns unsupported when clipboard contains non-text non-image data', async () => {
    const { createElectronAttachmentService } = await import('./service')

    electronMocks.availableFormats.mockReturnValue(['application/x-custom-binary'])
    electronMocks.readImage.mockReturnValue({
      isEmpty: () => true,
    })

    const service = createElectronAttachmentService()
    await expect(service.readClipboardData()).resolves.toEqual({
      ok: true,
      status: 'unsupported',
      availableFormats: ['application/x-custom-binary'],
      reason: 'non_image_data',
    })
  })

  it('writes clipboard image data to a temporary file and previews it as an image', async () => {
    const { createElectronAttachmentService } = await import('./service')
    const tempRoot = await createTempRoot('image-preview')
    const now = new Date('2026-05-09T06:01:00.000Z')
    const pngBuffer = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4, 5])

    electronMocks.createFromBuffer.mockReturnValue({
      getSize: () => ({ width: 640, height: 480 }),
    })

    const service = createElectronAttachmentService({
      temporaryRootPath: tempRoot,
      now: () => now,
    })

    const writeResult = await service.writeTempFile({
      data: {
        mimeType: 'image/png',
        base64Data: pngBuffer.toString('base64'),
        byteLength: pngBuffer.byteLength,
        width: 640,
        height: 480,
        suggestedName: 'pasted-image.png',
      },
    })

    expect(writeResult.ok).toBe(true)
    if (!writeResult.ok) {
      throw new Error('Expected temporary attachment write to succeed.')
    }

    const persistedBuffer = await readFile(writeResult.file.path)
    expect(persistedBuffer.equals(pngBuffer)).toBe(true)

    await expect(service.readPreview({ path: writeResult.file.path })).resolves.toEqual({
      ok: true,
      kind: 'image',
      path: writeResult.file.path,
      name: path.basename(writeResult.file.path),
      size: pngBuffer.byteLength,
      mimeType: 'image/png',
      dataUrl: `data:image/png;base64,${pngBuffer.toString('base64')}`,
      width: 640,
      height: 480,
    })
  })

  it('returns truncated text previews and cleans up only files inside the temporary root', async () => {
    const { createElectronAttachmentService } = await import('./service')
    const tempRoot = await createTempRoot('text-preview')
    const outsideRoot = await createTempRoot('outside-root')
    const service = createElectronAttachmentService({ temporaryRootPath: tempRoot })

    const textPath = path.join(tempRoot, 'note.txt')
    const missingPath = path.join(tempRoot, 'missing.txt')
    const outsidePath = path.join(outsideRoot, 'outside.txt')
    await writeFile(textPath, 'hello attachment preview')
    await writeFile(outsidePath, 'do not delete')

    await expect(service.readPreview({ path: textPath, maxTextBytes: 5 })).resolves.toEqual({
      ok: true,
      kind: 'text',
      path: textPath,
      name: 'note.txt',
      size: 24,
      mimeType: 'text/plain',
      text: 'hello',
      truncated: true,
      maxBytes: 5,
      encoding: 'utf-8',
    })

    await expect(service.cleanupTempFiles({ paths: [textPath, outsidePath, missingPath] })).resolves.toEqual({
      ok: true,
      deletedPaths: [textPath],
      missingPaths: [missingPath],
      skippedPaths: [outsidePath],
    })
  })
})
