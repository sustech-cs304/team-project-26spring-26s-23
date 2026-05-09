import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react'

import type { AttachmentServiceError, ReadClipboardAttachmentDataResult } from '../../../../electron/attachment-service/ipc'
import {
  createComposerAttachmentFromFile,
  createComposerAttachmentFromTempFile,
  createIdleComposerAttachmentPreviewState,
  extractFileSystemPath,
  mergeComposerAttachments,
  revokeComposerAttachmentPreviewUrl,
} from './state'
import type {
  CopilotComposerAttachment,
  CopilotComposerAttachmentsState,
} from './types'

const NOTICE_UNSUPPORTED_ZH = '当前剪贴板数据暂不支持作为附件。'
const NOTICE_UNSUPPORTED_EN = 'The current clipboard data type is not supported as an attachment.'
const NOTICE_PATHLESS_ZH = '当前文件无法解析为本地路径，已忽略。'
const NOTICE_PATHLESS_EN = 'The file could not be resolved to a local path and was ignored.'
const NOTICE_PREVIEW_FAILED_ZH = '附件预览加载失败。'
const NOTICE_PREVIEW_FAILED_EN = 'Failed to load the attachment preview.'

export function useComposerAttachments(input: {
  language: string
  state: CopilotComposerAttachmentsState
  setState: Dispatch<SetStateAction<CopilotComposerAttachmentsState>>
}) {
  const unsupportedNotice = input.language === 'en-US' ? NOTICE_UNSUPPORTED_EN : NOTICE_UNSUPPORTED_ZH
  const pathlessNotice = input.language === 'en-US' ? NOTICE_PATHLESS_EN : NOTICE_PATHLESS_ZH
  const previewFailedNotice = input.language === 'en-US' ? NOTICE_PREVIEW_FAILED_EN : NOTICE_PREVIEW_FAILED_ZH

  const showNotice = useCallback((message: string) => {
    input.setState((current) => ({
      ...current,
      notice: {
        id: Date.now(),
        message,
      },
    }))
  }, [input])

  const addAttachments = useCallback((attachments: readonly CopilotComposerAttachment[]) => {
    if (attachments.length === 0) {
      return
    }

    input.setState((current) => ({
      ...current,
      items: mergeComposerAttachments(current.items, attachments),
      panelOpen: current.items.length === 0 ? true : current.panelOpen,
      notice: null,
    }))
  }, [input])

  const importFiles = useCallback((files: readonly File[]) => {
    const attachments: CopilotComposerAttachment[] = []
    let hasPathlessFile = false

    for (const file of files) {
      const attachment = createComposerAttachmentFromFile(file)
      if (attachment === null) {
        hasPathlessFile = true
        continue
      }

      attachments.push(attachment)
    }

    addAttachments(attachments)
    if (hasPathlessFile) {
      showNotice(pathlessNotice)
    }
  }, [addAttachments, pathlessNotice, showNotice])

  const importClipboardImageData = useCallback(async () => {
    if (window.attachmentManager === undefined) {
      showNotice(unsupportedNotice)
      return
    }

    let clipboardDataResult: ReadClipboardAttachmentDataResult
    try {
      clipboardDataResult = await window.attachmentManager.readClipboardData()
    } catch {
      showNotice(unsupportedNotice)
      return
    }

    if (isAttachmentServiceError(clipboardDataResult) || clipboardDataResult.status !== 'image') {
      showNotice(unsupportedNotice)
      return
    }

    const tempFileResult = await window.attachmentManager.writeTempFile({
      data: clipboardDataResult.data,
    })
    if (isAttachmentServiceError(tempFileResult)) {
      showNotice(unsupportedNotice)
      return
    }

    addAttachments([
      createComposerAttachmentFromTempFile({
        data: clipboardDataResult.data,
        file: tempFileResult.file,
      }),
    ])
  }, [addAttachments, showNotice, unsupportedNotice])

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardFiles = Array.from(event.clipboardData.files)
    if (clipboardFiles.length > 0) {
      const localFiles = clipboardFiles.filter((file) => extractFileSystemPath(file) !== null)
      if (localFiles.length > 0) {
        event.preventDefault()
        importFiles(localFiles)
        return
      }

      const hasImageClipboardFile = clipboardFiles.some((file) => file.type.startsWith('image/'))
      event.preventDefault()
      if (hasImageClipboardFile) {
        void importClipboardImageData()
        return
      }

      showNotice(unsupportedNotice)
      return
    }

    const hasPlainText = Array.from(event.clipboardData.types).some((type) => type === 'text/plain' || type.startsWith('text/'))
    if (hasPlainText) {
      return
    }

    const hasBinaryClipboardPayload = Array.from(event.clipboardData.items).some((item) => item.kind === 'file' || item.type.startsWith('image/'))
      || Array.from(event.clipboardData.types).some((type) => type === 'Files' || type.startsWith('image/'))
    if (!hasBinaryClipboardPayload) {
      return
    }

    event.preventDefault()
    void importClipboardImageData()
  }, [importClipboardImageData, importFiles, showNotice, unsupportedNotice])

  const handleDragEnter = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (event.dataTransfer.files.length === 0) {
      return
    }

    event.preventDefault()
    input.setState((current) => ({
      ...current,
      isDragActive: true,
      dragDepth: current.dragDepth + 1,
    }))
  }, [input])

  const handleDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (event.dataTransfer.files.length === 0) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (event.dataTransfer.files.length === 0) {
      return
    }

    event.preventDefault()
    input.setState((current) => {
      const nextDragDepth = Math.max(0, current.dragDepth - 1)
      return {
        ...current,
        dragDepth: nextDragDepth,
        isDragActive: nextDragDepth > 0,
      }
    })
  }, [input])

  const handleDrop = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (event.dataTransfer.files.length === 0) {
      return
    }

    event.preventDefault()
    importFiles(Array.from(event.dataTransfer.files))
    input.setState((current) => ({
      ...current,
      dragDepth: 0,
      isDragActive: false,
    }))
  }, [importFiles, input])

  const togglePanel = useCallback(() => {
    input.setState((current) => ({
      ...current,
      panelOpen: current.items.length > 0 ? !current.panelOpen : false,
    }))
  }, [input])

  const closePanel = useCallback(() => {
    input.setState((current) => (current.panelOpen ? { ...current, panelOpen: false } : current))
  }, [input])

  const dismissNotice = useCallback(() => {
    input.setState((current) => (current.notice === null ? current : { ...current, notice: null }))
  }, [input])

  const closeAttachmentPreview = useCallback(() => {
    input.setState((current) => (current.preview.open ? { ...current, preview: createIdleComposerAttachmentPreviewState() } : current))
  }, [input])

  const removeAttachment = useCallback((attachmentId: string) => {
    const attachment = input.state.items.find((item) => item.id === attachmentId)
    if (attachment === undefined) {
      return
    }

    input.setState((current) => {
      const items = current.items.filter((item) => item.id !== attachmentId)
      return {
        ...current,
        items,
        panelOpen: items.length === 0 ? false : current.panelOpen,
        preview: current.preview.attachmentId === attachmentId ? createIdleComposerAttachmentPreviewState() : current.preview,
      }
    })

    revokeComposerAttachmentPreviewUrl(attachment)
    if (attachment.isTemporary && window.attachmentManager !== undefined) {
      void window.attachmentManager.cleanupTempFiles({ paths: [attachment.path] }).catch(() => undefined)
    }
  }, [input])

  const openAttachmentPreview = useCallback((attachmentId: string) => {
    const attachment = input.state.items.find((item) => item.id === attachmentId)
    if (attachment === undefined || attachment.kind === 'other') {
      return
    }

    if (attachment.kind === 'image') {
      input.setState((current) => ({
        ...current,
        preview: {
          open: true,
          attachmentId,
          status: 'ready',
          kind: 'image',
          title: attachment.name,
          previewUrl: attachment.previewUrl ?? null,
          text: '',
          truncated: false,
          message: null,
        },
      }))
      return
    }

    input.setState((current) => ({
      ...current,
      preview: {
        open: true,
        attachmentId,
        status: 'loading',
        kind: 'text',
        title: attachment.name,
        previewUrl: null,
        text: '',
        truncated: false,
        message: null,
      },
    }))

    void loadTextPreview(attachment.path).then((result) => {
      input.setState((current) => {
        if (!current.preview.open || current.preview.attachmentId !== attachmentId) {
          return current
        }

        if (result === null) {
          return {
            ...current,
            preview: createIdleComposerAttachmentPreviewState(),
          }
        }

        if (result.kind === 'error') {
          return {
            ...current,
            preview: {
              ...current.preview,
              status: 'error',
              message: previewFailedNotice,
            },
          }
        }

        return {
          ...current,
          preview: {
            open: true,
            attachmentId,
            status: 'ready',
            kind: 'text',
            title: result.name,
            previewUrl: null,
            text: result.text,
            truncated: result.truncated,
            message: null,
          },
        }
      })
    })
  }, [input, previewFailedNotice])

  return useMemo(() => ({
    attachmentCount: input.state.items.length,
    handlePaste,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    togglePanel,
    closePanel,
    removeAttachment,
    openAttachmentPreview,
    closeAttachmentPreview,
    dismissNotice,
  }), [
    closeAttachmentPreview,
    closePanel,
    dismissNotice,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handlePaste,
    input.state.items.length,
    openAttachmentPreview,
    removeAttachment,
    togglePanel,
  ])
}

async function loadTextPreview(path: string): Promise<{ kind: 'text'; name: string; text: string; truncated: boolean } | { kind: 'error' } | null> {
  if (window.attachmentManager === undefined) {
    return { kind: 'error' }
  }

  try {
    const result = await window.attachmentManager.readPreview({
      path,
      maxTextBytes: 256 * 1024,
    })
    if (isAttachmentServiceError(result) || result.kind === 'unsupported') {
      return null
    }

    if (result.kind !== 'text') {
      return { kind: 'error' }
    }

    return {
      kind: 'text',
      name: result.name,
      text: result.text,
      truncated: result.truncated,
    }
  } catch {
    return { kind: 'error' }
  }
}

function isAttachmentServiceError(value: unknown): value is AttachmentServiceError {
  return typeof value === 'object'
    && value !== null
    && 'ok' in value
    && (value as { ok?: unknown }).ok === false
}
