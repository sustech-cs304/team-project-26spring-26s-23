import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ClipboardImageAttachmentData, TemporaryAttachmentFile } from '../../../../electron/attachment-service/ipc'
import type { CopilotComposerAttachment } from './types'
import {
  createAttachmentId,
  createComposerAttachmentFromFile,
  createComposerAttachmentFromTempFile,
  createEmptyComposerAttachmentsState,
  createIdleComposerAttachmentPreviewState,
  extractFileSystemPath,
  mergeComposerAttachments,
  resolveComposerAttachmentKind,
  revokeComposerAttachmentPreviewUrl,
  revokeComposerAttachmentPreviewUrls,
} from './state'

const MOCK_IMAGE_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function createMockFile(overrides: Partial<File> & { path?: string; webkitRelativePath?: string } = {}): File {
  const { path, webkitRelativePath, ...rest } = overrides
  const name = rest.name ?? 'test.txt'
  const file = new File(['content'], name, { type: rest.type ?? 'text/plain' })
  if (path !== undefined) {
    Object.defineProperty(file, 'path', { value: path, writable: false, configurable: true })
  }
  if (webkitRelativePath !== undefined) {
    Object.defineProperty(file, 'webkitRelativePath', { value: webkitRelativePath, writable: false, configurable: true })
  }
  return file
}

function createClipboardImageData(overrides: Partial<ClipboardImageAttachmentData> = {}): ClipboardImageAttachmentData {
  return {
    mimeType: 'image/png',
    base64Data: MOCK_IMAGE_BASE64,
    byteLength: 100,
    width: 1,
    height: 1,
    suggestedName: 'clipboard.png',
    ...overrides,
  }
}

function createTempFile(overrides: Partial<TemporaryAttachmentFile> = {}): TemporaryAttachmentFile {
  return {
    path: '/tmp/clipboard-image-12345.png',
    name: 'clipboard.png',
    mimeType: 'image/png',
    size: 100,
    createdAt: '2026-05-21T10:00:00Z',
    isTemporary: true,
    ...overrides,
  }
}

function createComposerAttachmentFixture(overrides: Partial<CopilotComposerAttachment> & { path?: string } = {}): CopilotComposerAttachment {
  const path = overrides.path ?? '/project/file.txt'
  return {
    id: path,
    path,
    name: overrides.name ?? 'file.txt',
    mimeType: overrides.mimeType ?? 'text/plain',
    size: overrides.size ?? 100,
    isTemporary: overrides.isTemporary ?? false,
    source: overrides.source ?? 'filesystem',
    kind: overrides.kind ?? 'text',
    createdAt: overrides.createdAt ?? '2026-05-21T10:00:00Z',
    ...(overrides.previewUrl !== undefined ? { previewUrl: overrides.previewUrl } : {}),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createIdleComposerAttachmentPreviewState', () => {
  it('returns a preview state with open:false and idle status', () => {
    const state = createIdleComposerAttachmentPreviewState()
    expect(state).toEqual({
      open: false,
      attachmentId: null,
      status: 'idle',
      kind: null,
      title: '',
      previewUrl: null,
      text: '',
      truncated: false,
      message: null,
    })
  })

  it('returns a new object on each call', () => {
    const a = createIdleComposerAttachmentPreviewState()
    const b = createIdleComposerAttachmentPreviewState()
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
  })
})

describe('createEmptyComposerAttachmentsState', () => {
  it('returns a state with empty items and idle preview', () => {
    const state = createEmptyComposerAttachmentsState()
    expect(state).toEqual({
      items: [],
      panelOpen: false,
      isDragActive: false,
      dragDepth: 0,
      notice: null,
      preview: createIdleComposerAttachmentPreviewState(),
    })
  })

  it('returns a new object each call', () => {
    const a = createEmptyComposerAttachmentsState()
    const b = createEmptyComposerAttachmentsState()
    expect(a).not.toBe(b)
    expect(a.items).not.toBe(b.items)
  })
})

describe('createAttachmentId', () => {
  it('returns the path itself as the attachment id', () => {
    expect(createAttachmentId('/project/src/file.ts')).toBe('/project/src/file.ts')
  })

  it('works with empty string', () => {
    expect(createAttachmentId('')).toBe('')
  })

  it('works with Windows paths', () => {
    expect(createAttachmentId('C:\\Users\\test\\file.txt')).toBe('C:\\Users\\test\\file.txt')
  })
})

describe('extractFileSystemPath', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the file.path when present and non-empty', () => {
    const file = createMockFile({ name: 'test.txt', path: '/project/test.txt' })
    expect(extractFileSystemPath(file)).toBe('/project/test.txt')
  })

  it('returns the file.webkitRelativePath when path is absent', () => {
    const file = createMockFile({ name: 'test.txt', webkitRelativePath: 'subdir/test.txt' })
    expect(extractFileSystemPath(file)).toBe('subdir/test.txt')
  })

  it('prefers path over webkitRelativePath when both are present', () => {
    const file = createMockFile({
      name: 'test.txt',
      path: '/project/test.txt',
      webkitRelativePath: 'subdir/test.txt',
    })
    expect(extractFileSystemPath(file)).toBe('/project/test.txt')
  })

  it('returns null when path is empty and webkitRelativePath is empty', () => {
    const file = createMockFile({ name: 'test.txt' })
    vi.stubGlobal('window', undefined)
    expect(extractFileSystemPath(file)).toBeNull()
  })

  it('returns null when path is a whitespace-only string', () => {
    const file = createMockFile({ name: 'test.txt', path: '   ' })
    vi.stubGlobal('window', undefined)
    expect(extractFileSystemPath(file)).toBeNull()
  })

  it('falls back to window.attachmentManager.resolveFilePath when no path available', () => {
    const file = createMockFile({ name: 'test.txt' })
    const resolveFilePath = vi.fn().mockReturnValue('/resolved/test.txt')
    vi.stubGlobal('window', { attachmentManager: { resolveFilePath } })
    expect(extractFileSystemPath(file)).toBe('/resolved/test.txt')
    expect(resolveFilePath).toHaveBeenCalledWith(file)
  })

  it('returns null when window is undefined and no file path', () => {
    const file = createMockFile({ name: 'test.txt' })
    vi.stubGlobal('window', undefined)
    expect(extractFileSystemPath(file)).toBeNull()
  })

  it('returns null when window.attachmentManager.resolveFilePath returns empty string', () => {
    const file = createMockFile({ name: 'test.txt' })
    vi.stubGlobal('window', { attachmentManager: { resolveFilePath: vi.fn().mockReturnValue('') } })
    expect(extractFileSystemPath(file)).toBeNull()
  })
})

describe('resolveComposerAttachmentKind', () => {
  it('returns "image" for image/ mime types', () => {
    expect(resolveComposerAttachmentKind({ mimeType: 'image/png', name: 'test.png' })).toBe('image')
    expect(resolveComposerAttachmentKind({ mimeType: 'image/jpeg', name: 'test.jpg' })).toBe('image')
    expect(resolveComposerAttachmentKind({ mimeType: 'image/gif', name: 'test.gif' })).toBe('image')
    expect(resolveComposerAttachmentKind({ mimeType: 'image/webp', name: 'test.webp' })).toBe('image')
    expect(resolveComposerAttachmentKind({ mimeType: 'image/svg+xml', name: 'test.svg' })).toBe('image')
  })

  it('handles case-insensitive image mime types', () => {
    expect(resolveComposerAttachmentKind({ mimeType: 'IMAGE/PNG', name: 'test.png' })).toBe('image')
  })

  it('returns "text" for text/ mime types', () => {
    expect(resolveComposerAttachmentKind({ mimeType: 'text/plain', name: 'test.txt' })).toBe('text')
    expect(resolveComposerAttachmentKind({ mimeType: 'text/html', name: 'test.html' })).toBe('text')
    expect(resolveComposerAttachmentKind({ mimeType: 'text/javascript', name: 'test.js' })).toBe('text')
  })

  it('falls back to extension-based detection when mime is absent', () => {
    expect(resolveComposerAttachmentKind({ mimeType: undefined, name: 'photo.png' })).toBe('image')
    expect(resolveComposerAttachmentKind({ mimeType: null, name: 'document.txt' })).toBe('text')
  })

  it('falls back to extension-based detection when mime is not image or text', () => {
    expect(resolveComposerAttachmentKind({ mimeType: 'application/octet-stream', name: 'photo.jpg' })).toBe('image')
    expect(resolveComposerAttachmentKind({ mimeType: 'application/json', name: 'data.json' })).toBe('text')
    expect(resolveComposerAttachmentKind({ mimeType: 'application/zip', name: 'archive.zip' })).toBe('other')
  })

  it('recognizes common image extensions', () => {
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp', '.ico', '.avif']
    for (const ext of imageExtensions) {
      expect(resolveComposerAttachmentKind({ mimeType: '', name: `file${ext}` })).toBe('image')
    }
  })

  it('recognizes common text extensions', () => {
    const textExtensions = ['.txt', '.md', '.json', '.yml', '.yaml', '.xml', '.csv', '.log', '.html', '.css', '.js', '.ts', '.py', '.java', '.go', '.rs', '.sh']
    for (const ext of textExtensions) {
      expect(resolveComposerAttachmentKind({ mimeType: '', name: `file${ext}` })).toBe('text')
    }
  })

  it('returns "other" for unknown types', () => {
    expect(resolveComposerAttachmentKind({ mimeType: 'application/pdf', name: 'doc.pdf' })).toBe('other')
    expect(resolveComposerAttachmentKind({ mimeType: 'application/octet-stream', name: 'file.bin' })).toBe('other')
  })

  it('handles empty mime and no extension', () => {
    expect(resolveComposerAttachmentKind({ mimeType: '', name: 'noextension' })).toBe('other')
  })

  it('handles mime with leading/trailing whitespace', () => {
    expect(resolveComposerAttachmentKind({ mimeType: '  image/png  ', name: 'test.png' })).toBe('image')
  })
})

describe('createComposerAttachmentFromFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates an attachment from a file with a path', () => {
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'test') })
    const file = createMockFile({ name: 'README.md', path: '/project/README.md', type: 'text/markdown' })

    const attachment = createComposerAttachmentFromFile(file)
    expect(attachment).not.toBeNull()
    expect(attachment).toMatchObject({
      id: '/project/README.md',
      path: '/project/README.md',
      name: 'README.md',
      mimeType: 'text/markdown',
      source: 'filesystem',
      kind: 'text',
      isTemporary: false,
    })
  })

  it('returns null when the file has no resolvable path', () => {
    vi.stubGlobal('window', undefined)
    const file = createMockFile({ name: 'test.txt' })
    expect(createComposerAttachmentFromFile(file)).toBeNull()
  })

  it('assigns a previewUrl via URL.createObjectURL for image files', () => {
    const createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/abc123')
    vi.stubGlobal('URL', { createObjectURL })
    const file = createMockFile({ name: 'photo.png', path: '/project/photo.png', type: 'image/png' })

    const attachment = createComposerAttachmentFromFile(file)
    expect(attachment).not.toBeNull()
    expect(attachment!.previewUrl).toBe('blob:http://localhost/abc123')
    expect(createObjectURL).toHaveBeenCalledWith(file)
  })

  it('does not assign previewUrl for non-image files', () => {
    vi.stubGlobal('URL', { createObjectURL: vi.fn() })
    const file = createMockFile({ name: 'data.json', path: '/project/data.json', type: 'application/json' })

    const attachment = createComposerAttachmentFromFile(file)
    expect(attachment).not.toBeNull()
    expect(attachment!.previewUrl).toBeUndefined()
  })

  it('includes the file size', () => {
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'test') })
    const file = createMockFile({ name: 'large.txt', path: '/project/large.txt' })

    const attachment = createComposerAttachmentFromFile(file)
    expect(attachment).not.toBeNull()
    expect(attachment!.size).toBe(file.size)
  })
})

describe('createComposerAttachmentFromTempFile', () => {
  it('creates an attachment from clipboard image data', () => {
    const data = createClipboardImageData()
    const file = createTempFile()

    const attachment = createComposerAttachmentFromTempFile({ data, file })
    expect(attachment).toMatchObject({
      id: file.path,
      path: file.path,
      name: file.name,
      mimeType: file.mimeType,
      size: file.size,
      isTemporary: true,
      source: 'clipboard-image',
      kind: 'image',
      createdAt: file.createdAt,
      previewUrl: `data:${data.mimeType};base64,${data.base64Data}`,
    })
  })

  it('uses the correct data URL format', () => {
    const data = createClipboardImageData({ mimeType: 'image/png', base64Data: 'QUJD' })
    const file = createTempFile()

    const attachment = createComposerAttachmentFromTempFile({ data, file })
    expect(attachment.previewUrl).toBe('data:image/png;base64,QUJD')
  })
})

describe('mergeComposerAttachments', () => {
  it('returns a copy of current when incoming is empty', () => {
    const current = [createComposerAttachmentFixture({ path: '/a.txt' })]
    const result = mergeComposerAttachments(current, [])
    expect(result).toHaveLength(1)
    expect(result).not.toBe(current)
  })

  it('appends incoming attachments with unique paths', () => {
    const current = [createComposerAttachmentFixture({ path: '/a.txt' })]
    const incoming = [createComposerAttachmentFixture({ path: '/b.txt' })]

    const result = mergeComposerAttachments(current, incoming)
    expect(result).toHaveLength(2)
    expect(result.map((a) => a.path)).toEqual(['/a.txt', '/b.txt'])
  })

  it('deduplicates by path — keeps the first occurrence', () => {
    const current = [
      createComposerAttachmentFixture({ path: '/a.txt', name: 'first.txt' }),
    ]
    const incoming = [
      createComposerAttachmentFixture({ path: '/a.txt', name: 'duplicate.txt' }),
    ]

    const result = mergeComposerAttachments(current, incoming)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('first.txt')
  })

  it('revokes previewUrl of deduplicated blob attachments', () => {
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { revokeObjectURL })

    const current = [createComposerAttachmentFixture({ path: '/a.txt' })]
    const incoming = [
      createComposerAttachmentFixture({
        path: '/a.txt',
        previewUrl: 'blob:http://localhost/dup',
      }),
    ]

    mergeComposerAttachments(current, incoming)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/dup')

    vi.unstubAllGlobals()
  })

  it('does not revoke non-blob previewUrls of deduplicated attachments', () => {
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { revokeObjectURL })

    const current = [createComposerAttachmentFixture({ path: '/a.txt' })]
    const incoming = [
      createComposerAttachmentFixture({
        path: '/a.txt',
        previewUrl: 'data:image/png;base64,abc',
      }),
    ]

    mergeComposerAttachments(current, incoming)
    expect(revokeObjectURL).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  it('handles multiple incoming with mixed dedup and new', () => {
    const current = [
      createComposerAttachmentFixture({ path: '/a.txt' }),
      createComposerAttachmentFixture({ path: '/b.txt' }),
    ]
    const incoming = [
      createComposerAttachmentFixture({ path: '/a.txt', name: 'dup' }),
      createComposerAttachmentFixture({ path: '/c.txt' }),
      createComposerAttachmentFixture({ path: '/d.txt' }),
    ]

    const result = mergeComposerAttachments(current, incoming)
    expect(result.map((a) => a.path)).toEqual(['/a.txt', '/b.txt', '/c.txt', '/d.txt'])
  })

  it('does not mutate the current array', () => {
    const current = [createComposerAttachmentFixture({ path: '/a.txt' })]
    const incoming = [createComposerAttachmentFixture({ path: '/b.txt' })]

    const originalLength = current.length
    mergeComposerAttachments(current, incoming)
    expect(current).toHaveLength(originalLength)
  })
})

describe('revokeComposerAttachmentPreviewUrl', () => {
  it('revokes blob URLs', () => {
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { revokeObjectURL })

    revokeComposerAttachmentPreviewUrl({ previewUrl: 'blob:http://localhost/abc' })
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/abc')

    vi.unstubAllGlobals()
  })

  it('does not revoke non-blob URLs', () => {
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { revokeObjectURL })

    revokeComposerAttachmentPreviewUrl({ previewUrl: 'data:image/png;base64,abc' })
    expect(revokeObjectURL).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  it('does nothing when previewUrl is undefined', () => {
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { revokeObjectURL })

    revokeComposerAttachmentPreviewUrl({})
    expect(revokeObjectURL).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  it('does not revoke URLs that do not start with blob:', () => {
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { revokeObjectURL })

    revokeComposerAttachmentPreviewUrl({ previewUrl: 'https://example.com/image.png' })
    expect(revokeObjectURL).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })
})

describe('revokeComposerAttachmentPreviewUrls', () => {
  it('revokes all blob previewUrls in a list', () => {
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { revokeObjectURL })

    revokeComposerAttachmentPreviewUrls([
      { previewUrl: 'blob:http://localhost/a' },
      { previewUrl: 'blob:http://localhost/b' },
      { previewUrl: 'data:image/png;base64,c' },
      {},
    ])

    expect(revokeObjectURL).toHaveBeenCalledTimes(2)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/a')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/b')

    vi.unstubAllGlobals()
  })

  it('handles an empty list', () => {
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { revokeObjectURL })

    revokeComposerAttachmentPreviewUrls([])
    expect(revokeObjectURL).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })
})
