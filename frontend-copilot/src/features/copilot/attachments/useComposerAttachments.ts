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

  const operations = useComposerAttachmentOperations({
    setState: input.setState,
    state: input.state,
    unsupportedNotice,
    pathlessNotice,
    previewFailedNotice,
  })

  return useMemo(() => ({
    attachmentCount: input.state.items.length,
    handlePaste: operations.handlePaste,
    handleDragEnter: operations.handleDragEnter,
    handleDragOver: operations.handleDragOver,
    handleDragLeave: operations.handleDragLeave,
    handleDrop: operations.handleDrop,
    togglePanel: operations.togglePanel,
    closePanel: operations.closePanel,
    removeAttachment: operations.removeAttachment,
    openAttachmentPreview: operations.openAttachmentPreview,
    closeAttachmentPreview: operations.closeAttachmentPreview,
    dismissNotice: operations.dismissNotice,
  }), [
    operations.closeAttachmentPreview,
    operations.closePanel,
    operations.dismissNotice,
    operations.handleDragEnter,
    operations.handleDragLeave,
    operations.handleDragOver,
    operations.handleDrop,
    operations.handlePaste,
    input.state.items.length,
    operations.openAttachmentPreview,
    operations.removeAttachment,
    operations.togglePanel,
  ])
}

function useComposerAttachmentOperations(input: {
  setState: Dispatch<SetStateAction<CopilotComposerAttachmentsState>>
  state: CopilotComposerAttachmentsState
  unsupportedNotice: string
  pathlessNotice: string
  previewFailedNotice: string
}) {
  const {
    setState,
    state,
    unsupportedNotice,
    pathlessNotice,
    previewFailedNotice,
  } = input

  const showNotice = useCallback((message: string) => {
    setState((current) => ({
      ...current,
      notice: {
        id: Date.now(),
        message,
      },
    }))
  }, [setState])

  const addAttachments = useCallback((attachments: readonly CopilotComposerAttachment[]) => {
    if (attachments.length === 0) {
      return
    }

    setState((current) => ({
      ...current,
      items: mergeComposerAttachments(current.items, attachments),
      panelOpen: current.items.length === 0 ? true : current.panelOpen,
      notice: null,
    }))
  }, [setState])

  const importFiles = useCallback((files: readonly File[]) => {
    const resolvedAttachments: CopilotComposerAttachment[] = []
    let hasPathlessFile = false

    for (const file of files) {
      const attachment = createComposerAttachmentFromFile(file)
      if (attachment === null) {
        hasPathlessFile = true
        continue
      }

      resolvedAttachments.push(attachment)
    }

    addAttachments(resolvedAttachments)
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
      const localFiles: File[] = []
      let hasPathlessImageClipboardFile = false
      let hasUnsupportedClipboardFile = false

      for (const file of clipboardFiles) {
        if (extractFileSystemPath(file) !== null) {
          localFiles.push(file)
          continue
        }

        if (file.type.startsWith('image/')) {
          hasPathlessImageClipboardFile = true
          continue
        }

        hasUnsupportedClipboardFile = true
      }

      event.preventDefault()
      if (localFiles.length > 0) {
        importFiles(localFiles)
      }

      if (hasPathlessImageClipboardFile) {
        void (async () => {
          await importClipboardImageData()
          if (hasUnsupportedClipboardFile) {
            showNotice(unsupportedNotice)
          }
        })()
        return
      }

      if (hasUnsupportedClipboardFile) {
        showNotice(unsupportedNotice)
      }
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
    setState((current) => ({
      ...current,
      isDragActive: true,
      dragDepth: current.dragDepth + 1,
    }))
  }, [setState])

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
    setState((current) => {
      const nextDragDepth = Math.max(0, current.dragDepth - 1)
      return {
        ...current,
        dragDepth: nextDragDepth,
        isDragActive: nextDragDepth > 0,
      }
    })
  }, [setState])

  const handleDrop = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (event.dataTransfer.files.length === 0) {
      return
    }

    event.preventDefault()
    importFiles(Array.from(event.dataTransfer.files))
    setState((current) => ({
      ...current,
      dragDepth: 0,
      isDragActive: false,
    }))
  }, [importFiles, setState])

  const togglePanel = useCallback(() => {
    setState((current) => ({
      ...current,
      panelOpen: current.items.length > 0 ? !current.panelOpen : false,
    }))
  }, [setState])

  const closePanel = useCallback(() => {
    setState((current) => (current.panelOpen ? { ...current, panelOpen: false } : current))
  }, [setState])

  const dismissNotice = useCallback(() => {
    setState((current) => (current.notice === null ? current : { ...current, notice: null }))
  }, [setState])

  const closeAttachmentPreview = useCallback(() => {
    setState((current) => (current.preview.open ? { ...current, preview: createIdleComposerAttachmentPreviewState() } : current))
  }, [setState])

  const removeAttachment = useCallback((attachmentId: string) => {
    const attachment = state.items.find((item) => item.id === attachmentId)
    if (attachment === undefined) {
      return
    }

    setState((current) => {
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
  }, [setState, state.items])

  const openAttachmentPreview = useCallback((attachmentId: string) => {
    const attachment = state.items.find((item) => item.id === attachmentId)
    if (attachment === undefined || attachment.kind === 'other') {
      return
    }

    if (attachment.kind === 'image') {
      setState((current) => ({
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

    setState((current) => ({
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
      setState((current) => {
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
  }, [setState, state.items, previewFailedNotice])

  return useMemo(() => ({
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
