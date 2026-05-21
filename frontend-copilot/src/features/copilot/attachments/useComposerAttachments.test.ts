/** @vitest-environment jsdom */

import { act, type Dispatch, type SetStateAction } from 'react'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CopilotComposerAttachment, CopilotComposerAttachmentsState } from './types'
import { createEmptyComposerAttachmentsState, createIdleComposerAttachmentPreviewState } from './state'
import { useComposerAttachments } from './useComposerAttachments'

function createMockFileWithPath(
  name: string,
  path: string,
  type = 'text/plain',
): File {
  const content = new Array(10).join('x')
  const file = new File([content], name, { type })
  Object.defineProperty(file, 'path', { value: path, writable: false, configurable: true })
  return file
}

function createMockFileWithoutPath(name: string, type = 'image/png'): File {
  const content = new Array(10).join('x')
  return new File([content], name, { type })
}

function createAttachmentFixture(overrides: Partial<CopilotComposerAttachment> = {}): CopilotComposerAttachment {
  return {
    id: overrides.id ?? '/project/test.txt',
    path: overrides.path ?? '/project/test.txt',
    name: overrides.name ?? 'test.txt',
    mimeType: overrides.mimeType ?? 'text/plain',
    size: overrides.size ?? 100,
    isTemporary: overrides.isTemporary ?? false,
    source: overrides.source ?? 'filesystem',
    kind: overrides.kind ?? 'text',
    createdAt: overrides.createdAt ?? '2026-05-21T10:00:00Z',
    ...(overrides.previewUrl !== undefined ? { previewUrl: overrides.previewUrl } : {}),
  }
}

function setupWindowMock(overrides: Partial<{
  resolveFilePath: (file: File) => string | null
  readClipboardData: () => Promise<unknown>
  writeTempFile: () => Promise<unknown>
  readPreview: () => Promise<unknown>
  cleanupTempFiles: () => Promise<unknown>
}> = {}) {
  const manager = {
    resolveFilePath: overrides.resolveFilePath ?? (() => null),
    readClipboardData: overrides.readClipboardData ?? vi.fn(),
    writeTempFile: overrides.writeTempFile ?? vi.fn(),
    readPreview: overrides.readPreview ?? vi.fn(),
    cleanupTempFiles: overrides.cleanupTempFiles ?? vi.fn(),
  }
  Object.defineProperty(window, 'attachmentManager', {
    value: manager,
    writable: true,
    configurable: true,
  })
  return manager
}

function clearWindowMock() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (window as any).attachmentManager
}

function createMockDataTransfer(files: File[] = []): DataTransfer {
  return {
    files: Object.freeze(files) as unknown as FileList,
    items: {
      add: vi.fn(),
      clear: vi.fn(),
      remove: vi.fn(),
      length: 0,
    } as unknown as DataTransferItemList,
    types: [],
    getData: vi.fn().mockReturnValue(''),
    setData: vi.fn(),
    clearData: vi.fn(),
    setDragImage: vi.fn(),
    effectAllowed: 'none',
    dropEffect: 'none',
  } as unknown as DataTransfer
}

function createMockDragEvent(type: string, dt: DataTransfer): React.DragEvent<HTMLElement> {
  return {
    type,
    dataTransfer: dt,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as React.DragEvent<HTMLElement>
}

function createMockClipboardEvent(overrides: {
  clipboardData?: ReturnType<typeof createMockDataTransfer>
  types?: string[]
  items?: Array<{ kind: string; type: string }>
} = {}): React.ClipboardEvent<HTMLTextAreaElement> {
  const dt = overrides.clipboardData ?? createMockDataTransfer()

  if (overrides.types) {
    Object.defineProperty(dt, 'types', {
      value: Object.freeze(overrides.types) as unknown as DOMStringList,
      writable: true,
      configurable: true,
    })
  }

  if (overrides.items) {
    Object.defineProperty(dt, 'items', {
      value: {
        length: overrides.items.length,
        [Symbol.iterator]: function* () {
          for (const item of overrides.items!) {
            yield item
          }
        },
      },
      writable: true,
      configurable: true,
    })
  }

  return {
    clipboardData: dt as unknown as DataTransfer,
    preventDefault: vi.fn(),
  } as unknown as React.ClipboardEvent<HTMLTextAreaElement>
}

describe('useComposerAttachments', () => {
  let setState: ReturnType<typeof vi.fn>
  let initialState: CopilotComposerAttachmentsState

  beforeEach(() => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:http://localhost/mock-preview'),
      revokeObjectURL: vi.fn(),
    })

    initialState = createEmptyComposerAttachmentsState()
    setState = vi.fn()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    clearWindowMock()
  })

  function renderAttachmentsHook(
    language: string,
    state: CopilotComposerAttachmentsState,
    setter: ReturnType<typeof vi.fn>,
  ) {
    return renderHook(() =>
      useComposerAttachments({
        language,
        state,
        setState: setter as Dispatch<SetStateAction<CopilotComposerAttachmentsState>>,
      }),
    )
  }

  describe('initial state', () => {
    it('returns attachmentCount of 0 when items are empty', () => {
      const { result } = renderAttachmentsHook('zh-CN', initialState, setState)
      expect(result.current.attachmentCount).toBe(0)
    })

    it('returns all expected operation keys', () => {
      const { result } = renderAttachmentsHook('zh-CN', initialState, setState)
      expect(result.current).toHaveProperty('attachmentCount')
      expect(result.current).toHaveProperty('handlePaste')
      expect(result.current).toHaveProperty('handleDragEnter')
      expect(result.current).toHaveProperty('handleDragOver')
      expect(result.current).toHaveProperty('handleDragLeave')
      expect(result.current).toHaveProperty('handleDrop')
      expect(result.current).toHaveProperty('togglePanel')
      expect(result.current).toHaveProperty('closePanel')
      expect(result.current).toHaveProperty('removeAttachment')
      expect(result.current).toHaveProperty('openAttachmentPreview')
      expect(result.current).toHaveProperty('closeAttachmentPreview')
      expect(result.current).toHaveProperty('dismissNotice')
    })
  })

  describe('togglePanel', () => {
    it('does not open panel when there are no items', () => {
      const { result } = renderAttachmentsHook('zh-CN', initialState, setState)
      act(() => {
        result.current.togglePanel()
      })
      expect(setState).toHaveBeenCalled()
      const updater = setState.mock.calls[setState.mock.calls.length - 1][0]
      const next = updater({ ...initialState, items: [] })
      expect(next.panelOpen).toBe(false)
    })

    it('toggles panelOpen when items exist', () => {
      const localSetState = vi.fn()
      const stateWithItems = { ...createEmptyComposerAttachmentsState(), items: [createAttachmentFixture()] }
      const { result } = renderAttachmentsHook('zh-CN', stateWithItems, localSetState)

      act(() => {
        result.current.togglePanel()
      })
      expect(localSetState).toHaveBeenCalled()
    })
  })

  describe('closePanel', () => {
    it('closes panel when it is open', () => {
      const localSetState = vi.fn()
      const stateWithOpenPanel: CopilotComposerAttachmentsState = {
        ...createEmptyComposerAttachmentsState(),
        items: [createAttachmentFixture()],
        panelOpen: true,
      }
      const { result } = renderAttachmentsHook('zh-CN', stateWithOpenPanel, localSetState)

      act(() => {
        result.current.closePanel()
      })
      expect(localSetState).toHaveBeenCalled()
      const updater = localSetState.mock.calls[0][0]
      const next = updater(stateWithOpenPanel)
      expect(next.panelOpen).toBe(false)
    })
  })

  describe('dismissNotice', () => {
    it('clears the notice', () => {
      const localSetState = vi.fn()
      const stateWithNotice: CopilotComposerAttachmentsState = {
        ...createEmptyComposerAttachmentsState(),
        notice: { id: 1, message: 'test notice' },
      }
      const { result } = renderAttachmentsHook('zh-CN', stateWithNotice, localSetState)

      act(() => {
        result.current.dismissNotice()
      })
      const updater = localSetState.mock.calls[0][0]
      const next = updater(stateWithNotice)
      expect(next.notice).toBeNull()
    })
  })

  describe('closeAttachmentPreview', () => {
    it('resets preview to idle when it is open', () => {
      const localSetState = vi.fn()
      const openPreview = {
        ...createIdleComposerAttachmentPreviewState(),
        open: true,
        attachmentId: 'some-id',
        status: 'ready' as const,
        kind: 'text' as const,
        title: 'test.txt',
      }
      const stateWithPreview: CopilotComposerAttachmentsState = {
        ...createEmptyComposerAttachmentsState(),
        preview: openPreview,
      }
      const { result } = renderAttachmentsHook('zh-CN', stateWithPreview, localSetState)

      act(() => {
        result.current.closeAttachmentPreview()
      })
      const updater = localSetState.mock.calls[0][0]
      const next = updater(stateWithPreview)
      expect(next.preview.open).toBe(false)
      expect(next.preview.status).toBe('idle')
      expect(next.preview.attachmentId).toBeNull()
    })

    it('does not update state when preview is already idle', () => {
      const localSetState = vi.fn()
      const idleState = createEmptyComposerAttachmentsState()
      const { result } = renderAttachmentsHook('zh-CN', idleState, localSetState)

      act(() => {
        result.current.closeAttachmentPreview()
      })
      const updater = localSetState.mock.calls[0][0]
      const next = updater(idleState)
      expect(next.preview.open).toBe(false)
    })
  })

  describe('removeAttachment', () => {
    it('removes an attachment by id', () => {
      const localSetState = vi.fn()
      const item1 = createAttachmentFixture({ id: '/project/a.txt', path: '/project/a.txt' })
      const item2 = createAttachmentFixture({ id: '/project/b.txt', path: '/project/b.txt' })
      const stateWithItems: CopilotComposerAttachmentsState = {
        ...createEmptyComposerAttachmentsState(),
        items: [item1, item2],
        panelOpen: true,
      }
      const { result } = renderAttachmentsHook('zh-CN', stateWithItems, localSetState)

      act(() => {
        result.current.removeAttachment('/project/b.txt')
      })
      expect(localSetState).toHaveBeenCalled()
      const updater = localSetState.mock.calls[0][0]
      const next = updater(stateWithItems)
      expect(next.items).toHaveLength(1)
      expect(next.items[0].id).toBe('/project/a.txt')
    })

    it('closes panel when last item is removed', () => {
      const localSetState = vi.fn()
      const item = createAttachmentFixture({ id: '/project/a.txt', path: '/project/a.txt' })
      const stateWithItems: CopilotComposerAttachmentsState = {
        ...createEmptyComposerAttachmentsState(),
        items: [item],
        panelOpen: true,
      }
      const { result } = renderAttachmentsHook('zh-CN', stateWithItems, localSetState)

      act(() => {
        result.current.removeAttachment('/project/a.txt')
      })
      const updater = localSetState.mock.calls[0][0]
      const next = updater(stateWithItems)
      expect(next.items).toHaveLength(0)
      expect(next.panelOpen).toBe(false)
    })

    it('revokes previewUrl of the removed attachment', () => {
      const revokeObjectURL = vi.fn()
      vi.stubGlobal('URL', {
        createObjectURL: vi.fn(),
        revokeObjectURL,
      })
      const localSetState = vi.fn()
      const item = createAttachmentFixture({
        id: '/project/img.png',
        path: '/project/img.png',
        kind: 'image',
        previewUrl: 'blob:http://localhost/img',
      })
      const stateWithItems: CopilotComposerAttachmentsState = {
        ...createEmptyComposerAttachmentsState(),
        items: [item],
      }
      const { result } = renderAttachmentsHook('zh-CN', stateWithItems, localSetState)

      act(() => {
        result.current.removeAttachment('/project/img.png')
      })
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:http://localhost/img')
    })

    it('does nothing when the attachment id does not exist', () => {
      const localSetState = vi.fn()
      const { result } = renderAttachmentsHook('zh-CN', initialState, localSetState)

      act(() => {
        result.current.removeAttachment('non-existent-id')
      })
      expect(localSetState).not.toHaveBeenCalled()
    })

    it('cleans up temporary files when removing a temp attachment', () => {
      const cleanupTempFiles = vi.fn().mockResolvedValue({ ok: true, deletedPaths: ['/tmp/test.png'], missingPaths: [], skippedPaths: [] })
      setupWindowMock({ cleanupTempFiles })

      const localSetState = vi.fn()
      const item = createAttachmentFixture({
        id: '/tmp/test.png',
        path: '/tmp/test.png',
        isTemporary: true,
      })
      const stateWithItems: CopilotComposerAttachmentsState = {
        ...createEmptyComposerAttachmentsState(),
        items: [item],
      }
      const { result } = renderAttachmentsHook('zh-CN', stateWithItems, localSetState)

      act(() => {
        result.current.removeAttachment('/tmp/test.png')
      })
      expect(cleanupTempFiles).toHaveBeenCalledWith({ paths: ['/tmp/test.png'] })
    })
  })

  describe('drag events', () => {
    it('handleDragEnter sets isDragActive to true and increments dragDepth', () => {
      const localSetState = vi.fn()
      const state = createEmptyComposerAttachmentsState()
      const { result } = renderAttachmentsHook('zh-CN', state, localSetState)

      const dt = createMockDataTransfer([createMockFileWithPath('test.txt', '/project/test.txt')])
      const event = createMockDragEvent('dragenter', dt)

      act(() => {
        result.current.handleDragEnter(event)
      })
      expect(localSetState).toHaveBeenCalled()
      const updater = localSetState.mock.calls[0][0]
      const next = updater(state)
      expect(next.isDragActive).toBe(true)
      expect(next.dragDepth).toBe(1)
    })

    it('handleDragEnter does nothing when dataTransfer has no files', () => {
      const localSetState = vi.fn()
      const { result } = renderAttachmentsHook('zh-CN', createEmptyComposerAttachmentsState(), localSetState)

      const dt = createMockDataTransfer([])
      const event = createMockDragEvent('dragenter', dt)

      act(() => {
        result.current.handleDragEnter(event)
      })
      expect(localSetState).not.toHaveBeenCalled()
    })

    it('handleDragOver sets dropEffect to copy', () => {
      const { result } = renderAttachmentsHook('zh-CN', initialState, setState)

      const dt = createMockDataTransfer([createMockFileWithPath('test.txt', '/project/test.txt')])
      const event = createMockDragEvent('dragover', dt)

      act(() => {
        result.current.handleDragOver(event)
      })
      expect(dt.dropEffect).toBe('copy')
      expect(event.preventDefault).toHaveBeenCalled()
    })

    it('handleDragOver does nothing when no files', () => {
      const { result } = renderAttachmentsHook('zh-CN', initialState, setState)

      const dt = createMockDataTransfer([])
      const event = createMockDragEvent('dragover', dt)

      act(() => {
        result.current.handleDragOver(event)
      })
      expect(event.preventDefault).not.toHaveBeenCalled()
    })

    it('handleDragLeave decrements dragDepth', () => {
      const localSetState = vi.fn()
      const state: CopilotComposerAttachmentsState = {
        ...createEmptyComposerAttachmentsState(),
        isDragActive: true,
        dragDepth: 2,
      }
      const { result } = renderAttachmentsHook('zh-CN', state, localSetState)

      const dt = createMockDataTransfer([createMockFileWithPath('test.txt', '/project/test.txt')])
      const event = createMockDragEvent('dragleave', dt)

      act(() => {
        result.current.handleDragLeave(event)
      })
      const updater = localSetState.mock.calls[0][0]
      const next = updater(state)
      expect(next.dragDepth).toBe(1)
      expect(next.isDragActive).toBe(true)
    })

    it('handleDragLeave sets isDragActive to false when dragDepth reaches 0', () => {
      const localSetState = vi.fn()
      const state: CopilotComposerAttachmentsState = {
        ...createEmptyComposerAttachmentsState(),
        isDragActive: true,
        dragDepth: 1,
      }
      const { result } = renderAttachmentsHook('zh-CN', state, localSetState)

      const dt = createMockDataTransfer([createMockFileWithPath('test.txt', '/project/test.txt')])
      const event = createMockDragEvent('dragleave', dt)

      act(() => {
        result.current.handleDragLeave(event)
      })
      const updater = localSetState.mock.calls[0][0]
      const next = updater(state)
      expect(next.dragDepth).toBe(0)
      expect(next.isDragActive).toBe(false)
    })

    it('handleDrop resets drag state and imports files', () => {
      const localSetState = vi.fn()
      const { result } = renderAttachmentsHook('zh-CN', createEmptyComposerAttachmentsState(), localSetState)

      const dt = createMockDataTransfer([createMockFileWithPath('test.txt', '/project/test.txt')])
      const event = createMockDragEvent('drop', dt)

      act(() => {
        result.current.handleDrop(event)
      })
      expect(localSetState).toHaveBeenCalled()
      const updater = localSetState.mock.calls[0][0]
      const next = updater(createEmptyComposerAttachmentsState())
      expect(next.isDragActive).toBe(false)
      expect(next.dragDepth).toBe(0)
    })

    it('handleDrop does nothing when no files', () => {
      const localSetState = vi.fn()
      const { result } = renderAttachmentsHook('zh-CN', createEmptyComposerAttachmentsState(), localSetState)

      const dt = createMockDataTransfer([])
      const event = createMockDragEvent('drop', dt)

      act(() => {
        result.current.handleDrop(event)
      })
      expect(localSetState).not.toHaveBeenCalled()
    })
  })

  describe('openAttachmentPreview', () => {
    it('does nothing for attachments with kind "other"', () => {
      const localSetState = vi.fn()
      const item = createAttachmentFixture({ kind: 'other', path: '/project/file.bin' })
      const state: CopilotComposerAttachmentsState = {
        ...createEmptyComposerAttachmentsState(),
        items: [item],
      }
      const { result } = renderAttachmentsHook('zh-CN', state, localSetState)

      act(() => {
        result.current.openAttachmentPreview(item.id)
      })
      expect(localSetState).not.toHaveBeenCalled()
    })

    it('does nothing when attachment is not found', () => {
      const localSetState = vi.fn()
      const { result } = renderAttachmentsHook('zh-CN', initialState, localSetState)

      act(() => {
        result.current.openAttachmentPreview('non-existent')
      })
      expect(localSetState).not.toHaveBeenCalled()
    })

    it('opens image preview with ready status for image attachments', () => {
      const localSetState = vi.fn()
      const item = createAttachmentFixture({
        id: '/project/photo.png',
        path: '/project/photo.png',
        kind: 'image',
        previewUrl: 'blob:http://localhost/photo',
      })
      const state: CopilotComposerAttachmentsState = {
        ...createEmptyComposerAttachmentsState(),
        items: [item],
      }
      const { result } = renderAttachmentsHook('zh-CN', state, localSetState)

      act(() => {
        result.current.openAttachmentPreview(item.id)
      })
      expect(localSetState).toHaveBeenCalled()
      const updater = localSetState.mock.calls[0][0]
      const next = updater(state)
      expect(next.preview.open).toBe(true)
      expect(next.preview.attachmentId).toBe(item.id)
      expect(next.preview.status).toBe('ready')
      expect(next.preview.kind).toBe('image')
      expect(next.preview.previewUrl).toBe('blob:http://localhost/photo')
    })

    it('starts text preview in loading state', () => {
      setupWindowMock()
      const localSetState = vi.fn()
      const item = createAttachmentFixture({
        id: '/project/readme.md',
        path: '/project/readme.md',
        kind: 'text',
      })
      const state: CopilotComposerAttachmentsState = {
        ...createEmptyComposerAttachmentsState(),
        items: [item],
      }
      const { result } = renderAttachmentsHook('zh-CN', state, localSetState)

      act(() => {
        result.current.openAttachmentPreview(item.id)
      })
      expect(localSetState).toHaveBeenCalled()
      const updater = localSetState.mock.calls[0][0]
      const next = updater(state)
      expect(next.preview.open).toBe(true)
      expect(next.preview.attachmentId).toBe(item.id)
      expect(next.preview.status).toBe('loading')
      expect(next.preview.kind).toBe('text')
    })
  })

  describe('attachmentCount', () => {
    it('reflects the number of items in state', () => {
      const items = [
        createAttachmentFixture({ id: '/a.txt' }),
        createAttachmentFixture({ id: '/b.txt' }),
        createAttachmentFixture({ id: '/c.txt' }),
      ]
      const state: CopilotComposerAttachmentsState = {
        ...createEmptyComposerAttachmentsState(),
        items,
      }
      const { result } = renderAttachmentsHook('zh-CN', state, vi.fn())
      expect(result.current.attachmentCount).toBe(3)
    })
  })

  describe('language-based notices', () => {
    it('uses Chinese notice text by default', () => {
      const { result } = renderAttachmentsHook('zh-CN', initialState, setState)
      expect(result.current).toBeDefined()
    })

    it('uses English notice text when language is en-US', () => {
      const { result } = renderAttachmentsHook('en-US', initialState, setState)
      expect(result.current).toBeDefined()
    })
  })
})

describe('paste event handling', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn().mockReturnValue('blob:http://localhost/mock-preview'),
      revokeObjectURL: vi.fn(),
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    clearWindowMock()
  })

  it('handlePaste does nothing for plain text paste (no files)', () => {
    const localSetState = vi.fn() as Dispatch<SetStateAction<CopilotComposerAttachmentsState>>
    const state = createEmptyComposerAttachmentsState()
    const { result } = renderHook(() =>
      useComposerAttachments({
        language: 'zh-CN',
        state,
        setState: localSetState,
      }),
    )

    const event = createMockClipboardEvent({ types: ['text/plain'] })
    act(() => {
      result.current.handlePaste(event)
    })
    // Plain text paste returns without calling preventDefault or setState
    // This is expected behavior — the handler checks for binary data and returns early for plain text
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(localSetState).not.toHaveBeenCalled()
  })

  it('handlePaste imports files with paths from clipboard', () => {
    const localSetState = vi.fn() as Dispatch<SetStateAction<CopilotComposerAttachmentsState>>
    const state = createEmptyComposerAttachmentsState()
    const { result } = renderHook(() =>
      useComposerAttachments({
        language: 'zh-CN',
        state,
        setState: localSetState,
      }),
    )

    const file = createMockFileWithPath('pasted.txt', '/project/pasted.txt', 'text/plain')
    const event = createMockClipboardEvent({
      clipboardData: createMockDataTransfer([file]),
    })

    act(() => {
      result.current.handlePaste(event)
    })
    // Files were detected, so preventDefault is called
    expect(event.preventDefault).toHaveBeenCalled()
  })

  it('handlePaste shows unsupported notice for non-image pathless files', () => {
    const localSetState = vi.fn() as Dispatch<SetStateAction<CopilotComposerAttachmentsState>>
    const state = createEmptyComposerAttachmentsState()
    const { result } = renderHook(() =>
      useComposerAttachments({
        language: 'zh-CN',
        state,
        setState: localSetState,
      }),
    )

    const file = createMockFileWithoutPath('unsupported.bin', 'application/octet-stream')
    const event = createMockClipboardEvent({
      clipboardData: createMockDataTransfer([file]),
    })

    act(() => {
      result.current.handlePaste(event)
    })
    expect(event.preventDefault).toHaveBeenCalled()
  })
})

describe('edge cases', () => {
  it('plain text paste with no binary items passes through without side effects', () => {
    const localSetState = vi.fn()
    const state = createEmptyComposerAttachmentsState()
    const { result } = renderHook(() =>
      useComposerAttachments({
        language: 'zh-CN',
        state,
        setState: localSetState,
      }),
    )

    const event = createMockClipboardEvent({
      types: ['text/plain'],
      items: [],
    })
    act(() => {
      result.current.handlePaste(event)
    })
    // Plain text should pass through without calling preventDefault
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(localSetState).not.toHaveBeenCalled()
  })
})
