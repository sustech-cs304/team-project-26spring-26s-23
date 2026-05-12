import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type Dispatch,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type SetStateAction,
  type SyntheticEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react'
import { ArrowUp, FileText, Image as ImageIcon, Lightbulb, Paperclip, Square, X } from 'lucide-react'

import type { SettingsWorkspaceToolPermissionPolicyState } from '../../../../electron/settings-workspace/state-schema'
import type { CopilotComposerAttachmentsState } from '../attachments/types'
import { useComposerAttachments } from '../attachments/useComposerAttachments'
import { resolveThinkingValueLabel } from '../../../workbench/thinking-display'
import { getCopilotChatCopy } from '../../../workbench/locale'
import type { AssistantSessionShell } from '../../../workbench/types'
import {
  createEmptyComposerAttachmentsState,
} from '../attachments/state'
import {
  applyModelSelectionToComposerDraft,
  applyThinkingSelectionToComposerDraft,
  describeThinkingCapabilityUnavailableReason,
  resolveThinkingSelectionForCapability,
  type CopilotChatComposerDraft,
} from '../copilot-chat-helpers'
import type { CopilotModelGroup } from '../model-picker'
import type {
  RuntimeThinkingCapability,
  RuntimeThinkingSelection,
} from '../thread-run-contract'
import { ModelPicker } from '../components/ModelPicker'
import { ToolPicker } from '../components/ToolPicker'
import {
  buildComposerSurfaceHeightClassName,
  buildThinkingSeriesLabel,
  isThinkingSelectionActive,
  renderThinkingControlBody,
  resolveThinkingSelectionValue,
} from './CopilotComposerThinkingEditors'

export interface CopilotComposerShellProps {
  language?: string
  capabilities: AssistantSessionShell['capabilities']
  modelGroups: CopilotModelGroup[]
  thinkingCapability: RuntimeThinkingCapability | null
  draft: CopilotChatComposerDraft
  attachments?: CopilotComposerAttachmentsState
  toolPermissionPolicy?: SettingsWorkspaceToolPermissionPolicyState | null
  onDraftChange: Dispatch<SetStateAction<CopilotChatComposerDraft>>
  onAttachmentsChange?: Dispatch<SetStateAction<CopilotComposerAttachmentsState>>
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onCancel: () => void
  sendStatus: 'idle' | 'sending'
  canCancel: boolean
  sendDisabledReason: string | null
  controlsLockedReason?: string | null
  interactionLocked?: boolean
  composerInputRef: RefObject<HTMLTextAreaElement>
  composerHeight: number
  onResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void
}

// eslint-disable-next-line complexity, max-lines-per-function -- shell component orchestrates many sub-components
export function CopilotComposerShell({
  language = 'zh-CN',
  capabilities,
  modelGroups,
  thinkingCapability,
  draft,
  attachments = EMPTY_COMPOSER_ATTACHMENTS_STATE,
  toolPermissionPolicy = null,
  onDraftChange,
  onAttachmentsChange = NOOP_ATTACHMENTS_CHANGE,
  onSubmit,
  onCancel,
  sendStatus,
  canCancel,
  sendDisabledReason,
  controlsLockedReason = null,
  interactionLocked = false,
  composerInputRef,
  composerHeight,
  onResizeStart,
}: CopilotComposerShellProps) {
  const copy = getCopilotChatCopy(language)
  const hasAvailableModels = modelGroups.some((group) => group.models.length > 0)
  const isSending = sendStatus === 'sending'
  const controlsLocked = controlsLockedReason !== null
  const controlsDisabled = isSending || interactionLocked || controlsLocked
  const inputDisabled = interactionLocked || controlsLocked
  const attachmentControlRef = useRef<HTMLDivElement | null>(null)
  const attachmentPanelCloseTimerRef = useRef<number | null>(null)
  const imagePreviewRef = useRef<HTMLImageElement | null>(null)
  const imagePreviewDragRef = useRef<{
    pointerId: number
    startClientX: number
    startClientY: number
    startOffsetX: number
    startOffsetY: number
  } | null>(null)
  const imagePreviewNaturalSizeRef = useRef<{ width: number; height: number } | null>(null)
  const imagePreviewTransformRef = useRef({
    offsetX: 0,
    offsetY: 0,
    scale: 1,
  })
  const imagePreviewFrameRef = useRef<number | null>(null)
  const attachmentPanelId = useId()
  const [attachmentPanelClosing, setAttachmentPanelClosing] = useState(false)
  const attachmentPanelVisible = attachments.panelOpen || attachmentPanelClosing
  const previewVisible = attachments.preview.open
  const attachmentActions = useComposerAttachments({
    language,
    state: attachments,
    setState: onAttachmentsChange,
  })

  const attachmentCopy = useMemo(() => resolveAttachmentCopy(language), [language])

  const requestCloseAttachmentPanel = useCallback(() => {
    if (!attachments.panelOpen) {
      return
    }

    if (attachmentPanelCloseTimerRef.current !== null) {
      window.clearTimeout(attachmentPanelCloseTimerRef.current)
    }

    setAttachmentPanelClosing(true)
    attachmentPanelCloseTimerRef.current = window.setTimeout(() => {
      attachmentActions.closePanel()
      setAttachmentPanelClosing(false)
      attachmentPanelCloseTimerRef.current = null
    }, 130)
  }, [attachmentActions, attachments.panelOpen])

  const requestCloseAttachmentPreview = useCallback(() => {
    if (!attachments.preview.open) {
      return
    }

    attachmentActions.closeAttachmentPreview()
  }, [attachmentActions, attachments.preview.open])

  useEffect(() => {
    if (attachments.panelOpen) {
      if (attachmentPanelCloseTimerRef.current !== null) {
        window.clearTimeout(attachmentPanelCloseTimerRef.current)
        attachmentPanelCloseTimerRef.current = null
      }
      setAttachmentPanelClosing(false)
    }
  }, [attachments.panelOpen])

  useEffect(() => () => {
    if (attachmentPanelCloseTimerRef.current !== null) {
      window.clearTimeout(attachmentPanelCloseTimerRef.current)
    }
    if (imagePreviewFrameRef.current !== null) {
      window.cancelAnimationFrame(imagePreviewFrameRef.current)
    }
  }, [])

  useEffect(() => {
    if (!attachmentPanelVisible) {
      return undefined
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (attachmentControlRef.current?.contains(event.target as Node)) {
        return
      }

      requestCloseAttachmentPanel()
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        requestCloseAttachmentPanel()
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [attachmentPanelVisible, requestCloseAttachmentPanel])

  useEffect(() => {
    if (attachments.notice === null) {
      return undefined
    }

    const timeoutId = window.setTimeout(() => {
      attachmentActions.dismissNotice()
    }, 2200)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [attachmentActions, attachments.notice])

  useEffect(() => {
    if (!attachments.preview.open) {
      return undefined
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        requestCloseAttachmentPreview()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('keydown', handleEscape)
    }
  }, [attachments.preview.open, requestCloseAttachmentPreview])

  useEffect(() => {
    if (controlsDisabled) {
      requestCloseAttachmentPanel()
      requestCloseAttachmentPreview()
    }
  }, [controlsDisabled, requestCloseAttachmentPanel, requestCloseAttachmentPreview])

  useEffect(() => {
    if (attachments.preview.open && attachments.preview.kind === 'image') {
      return
    }

    imagePreviewDragRef.current = null
    imagePreviewNaturalSizeRef.current = null
    imagePreviewTransformRef.current = { offsetX: 0, offsetY: 0, scale: 1 }
  }, [attachments.preview.kind, attachments.preview.open, attachments.preview.previewUrl])

  const writeImagePreviewTransform = () => {
    const image = imagePreviewRef.current
    if (image === null) {
      return
    }

    const { offsetX, offsetY, scale } = imagePreviewTransformRef.current
    image.style.transform = `translate3d(${offsetX}px, ${offsetY}px, 0) scale(${scale})`
  }

  const updateImagePreviewTransform = (nextTransform: { offsetX: number; offsetY: number; scale: number }) => {
    imagePreviewTransformRef.current = nextTransform
    if (imagePreviewFrameRef.current !== null) {
      return
    }

    imagePreviewFrameRef.current = window.requestAnimationFrame(() => {
      imagePreviewFrameRef.current = null
      writeImagePreviewTransform()
    })
  }

  const handleImagePreviewLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const image = event.currentTarget
    const naturalWidth = image.naturalWidth || image.width
    const naturalHeight = image.naturalHeight || image.height
    imagePreviewNaturalSizeRef.current = { width: naturalWidth, height: naturalHeight }

    const viewportWidth = Math.max(1, window.innerWidth * 0.9)
    const viewportHeight = Math.max(1, window.innerHeight * 0.9)
    const initialScale = Math.min(1, viewportWidth / Math.max(1, naturalWidth), viewportHeight / Math.max(1, naturalHeight))

    imagePreviewTransformRef.current = {
      offsetX: 0,
      offsetY: 0,
      scale: Number.isFinite(initialScale) ? initialScale : 1,
    }
    writeImagePreviewTransform()
  }

  const handleImagePreviewPointerDown = (event: ReactPointerEvent<HTMLImageElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const currentTransform = imagePreviewTransformRef.current
    imagePreviewDragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startOffsetX: currentTransform.offsetX,
      startOffsetY: currentTransform.offsetY,
    }
    event.currentTarget.style.transition = 'none'
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleImagePreviewPointerMove = (event: ReactPointerEvent<HTMLImageElement>) => {
    const dragState = imagePreviewDragRef.current
    if (dragState === null || dragState.pointerId !== event.pointerId) {
      return
    }

    event.preventDefault()
    updateImagePreviewTransform({
      ...imagePreviewTransformRef.current,
      offsetX: dragState.startOffsetX + event.clientX - dragState.startClientX,
      offsetY: dragState.startOffsetY + event.clientY - dragState.startClientY,
    })
  }

  const handleImagePreviewPointerEnd = (event: ReactPointerEvent<HTMLImageElement>) => {
    if (imagePreviewDragRef.current?.pointerId !== event.pointerId) {
      return
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    event.currentTarget.style.transition = ''
    imagePreviewDragRef.current = null
  }

  const handleImagePreviewWheel = (event: ReactWheelEvent<HTMLImageElement>) => {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.style.transition = 'transform 115ms cubic-bezier(0.2, 0, 0, 1)'

    const currentRect = event.currentTarget.getBoundingClientRect()
    const naturalSize = imagePreviewNaturalSizeRef.current
    const currentTransform = imagePreviewTransformRef.current
    const currentScale = currentTransform.scale
    const wheelFactor = Math.exp(-event.deltaY * 0.0016)
    const nextScale = clamp(currentScale * wheelFactor, 0.08, 8)
    if (Math.abs(nextScale - currentScale) < 0.0001) {
      return
    }

    const naturalWidth = naturalSize?.width ?? currentRect.width / Math.max(currentScale, 0.0001)
    const naturalHeight = naturalSize?.height ?? currentRect.height / Math.max(currentScale, 0.0001)
    const imageCenterX = currentRect.left + currentRect.width / 2
    const imageCenterY = currentRect.top + currentRect.height / 2
    const pointerFromCenterX = event.clientX - imageCenterX
    const pointerFromCenterY = event.clientY - imageCenterY
    const scaleRatio = nextScale / currentScale

    updateImagePreviewTransform({
      offsetX: currentTransform.offsetX + pointerFromCenterX * (1 - scaleRatio),
      offsetY: currentTransform.offsetY + pointerFromCenterY * (1 - scaleRatio),
      scale: nextScale,
    })

    if (naturalWidth <= 0 || naturalHeight <= 0) {
      imagePreviewNaturalSizeRef.current = null
    }
  }

  const handleMessageInputKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.metaKey) {
      return
    }

    if (event.ctrlKey) {
      event.preventDefault()
      const textarea = event.currentTarget
      const { selectionStart, selectionEnd } = textarea
      const currentValue = draft.messageText
      const nextValue = `${currentValue.slice(0, selectionStart)}\n${currentValue.slice(selectionEnd)}`

      onDraftChange((current) => ({
        ...current,
        messageText: nextValue,
      }))

      requestAnimationFrame(() => {
        textarea.focus()
        const nextCaretPosition = selectionStart + 1
        textarea.setSelectionRange(nextCaretPosition, nextCaretPosition)
      })
      return
    }

    event.preventDefault()
    if (sendDisabledReason === null) {
      event.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <form className="copilot-chat__composer" data-testid="chat-composer-dock" onSubmit={onSubmit}>
      <div className="copilot-chat__composer-toolbar" data-testid="chat-composer-toolbar">
        <ModelPicker
          language={language}
          selectedModelId={draft.selectedModelId}
          groups={modelGroups}
          disabled={!hasAvailableModels || controlsDisabled}
          onSelectModel={(model) => {
            onDraftChange((current) => applyModelSelectionToComposerDraft(current, {
              modelId: model.selectionValue,
              modelRoute: model.route,
            }))
          }}
        />
        <ComposerThinkingControl
          thinkingCapability={thinkingCapability}
          draft={draft}
          controlsDisabled={controlsDisabled}
          copyComposer={copy.composer}
          onDraftChange={onDraftChange}
        />
        <ToolPicker
          language={language}
          tools={capabilities.allAvailableTools}
          selectedToolIds={draft.enabledTools}
          recommendedToolIds={capabilities.recommendedToolsForAgent}
          toolPermissionPolicy={toolPermissionPolicy}
          disabled={controlsDisabled}
          onChangeToolIds={(enabledTools: string[]) => {
            onDraftChange((current) => ({
              ...current,
              enabledTools,
            }))
          }}
        />
      </div>

      <div
        className="copilot-chat__composer-resize-handle"
        data-testid="chat-composer-resize-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label={copy.composer.resizeHandleAriaLabel}
        onMouseDown={interactionLocked ? undefined : onResizeStart}
      />

      {renderComposerSurface({
        composerHeight,
        attachments,
        attachmentPanelVisible,
        attachmentPanelClosing,
        attachmentPanelId,
        attachmentCopy,
        attachmentControlRef,
        openAttachmentPreview: attachmentActions.openAttachmentPreview,
        removeAttachment: attachmentActions.removeAttachment,
        handleDragEnter: attachmentActions.handleDragEnter,
        handleDragOver: attachmentActions.handleDragOver,
        handleDragLeave: attachmentActions.handleDragLeave,
        handleDrop: attachmentActions.handleDrop,
        handlePaste: attachmentActions.handlePaste,
        attachmentCount: attachmentActions.attachmentCount,
        togglePanel: attachmentActions.togglePanel,
        requestCloseAttachmentPanel,
        composerInputRef,
        copy,
        draftMessageText: draft.messageText,
        inputDisabled,
        onDraftChange,
        handleMessageInputKeyDown,
        isSending,
        canCancel,
        sendDisabledReason,
        onCancel,
      })}

      {controlsLockedReason !== null && (
        <p className="copilot-chat__composer-note" data-testid="chat-composer-note">{controlsLockedReason}</p>
      )}

      {renderAttachmentPreviewDialog({
        previewVisible,
        attachments,
        attachmentCopy,
        requestCloseAttachmentPreview,
        imagePreviewRef,
        handleImagePreviewLoad,
        handleImagePreviewPointerDown,
        handleImagePreviewPointerMove,
        handleImagePreviewPointerEnd,
        handleImagePreviewWheel,
      })}
    </form>
  )
}

const EMPTY_COMPOSER_ATTACHMENTS_STATE = createEmptyComposerAttachmentsState()

const NOOP_ATTACHMENTS_CHANGE: Dispatch<SetStateAction<CopilotComposerAttachmentsState>> = () => undefined

function renderAttachmentPanel(input: {
  attachmentPanelVisible: boolean
  attachments: CopilotComposerAttachmentsState
  attachmentPanelClosing: boolean
  attachmentPanelId: string
  attachmentCopy: { panelLabel: string; removeLabel: (name: string) => string }
  attachmentControlRef: RefObject<HTMLDivElement | null>
  openAttachmentPreview: (id: string) => void
  removeAttachment: (id: string) => void
}) {
  const { attachmentPanelVisible, attachments, attachmentPanelClosing, attachmentPanelId, attachmentCopy, attachmentControlRef, openAttachmentPreview, removeAttachment } = input
  if (!attachmentPanelVisible || attachments.items.length === 0) {
    return null
  }
  return (
    <section
      id={attachmentPanelId}
      className={[
        'copilot-chat__attachment-panel',
        attachmentPanelClosing ? 'copilot-chat__attachment-panel--closing' : '',
      ].filter((className) => className !== '').join(' ')}
      role="dialog"
      aria-label={attachmentCopy.panelLabel}
      data-testid="chat-composer-attachment-panel"
      ref={attachmentControlRef}
    >
      <div className="copilot-chat__attachment-panel-header">
        <span className="copilot-chat__attachment-panel-title">{attachmentCopy.panelLabel}</span>
        <span className="copilot-chat__attachment-panel-count" data-testid="chat-composer-attachment-count">
          {attachments.items.length}
        </span>
      </div>
      <div className="copilot-chat__attachment-list">
        {attachments.items.map((attachment) => (
          <div
            key={attachment.id}
            className="copilot-chat__attachment-item"
            data-testid="chat-composer-attachment-item"
            data-attachment-path={attachment.path}
          >
            <button
              type="button"
              className="copilot-chat__attachment-open"
              data-testid={`chat-composer-attachment-open-${attachment.id}`}
              onClick={() => {
                openAttachmentPreview(attachment.id)
              }}
            >
              {attachment.kind === 'image'
                ? (
                    attachment.previewUrl !== undefined
                      ? <img className="copilot-chat__attachment-thumbnail" src={attachment.previewUrl} alt={attachment.name} data-testid="chat-composer-attachment-thumbnail" />
                      : <ImageIcon className="copilot-chat__attachment-icon" aria-hidden="true" />
                  )
                : attachment.kind === 'text'
                  ? <FileText className="copilot-chat__attachment-icon" aria-hidden="true" />
                  : <Paperclip className="copilot-chat__attachment-icon" aria-hidden="true" />}
              <span className="copilot-chat__attachment-meta">
                <span className="copilot-chat__attachment-name">{attachment.name}</span>
                <span className="copilot-chat__attachment-path">{attachment.path}</span>
              </span>
            </button>
            <button
              type="button"
              className="copilot-chat__attachment-remove"
              aria-label={attachmentCopy.removeLabel(attachment.name)}
              title={attachmentCopy.removeLabel(attachment.name)}
              data-testid={`chat-composer-attachment-remove-${attachment.id}`}
              onClick={() => {
                removeAttachment(attachment.id)
              }}
            >
              <X aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

function renderAttachmentPreviewDialog(input: {
  previewVisible: boolean
  attachments: CopilotComposerAttachmentsState
  attachmentCopy: { previewDialogLabel: string; closePreviewLabel: string; previewLoading: string }
  requestCloseAttachmentPreview: () => void
  imagePreviewRef: RefObject<HTMLImageElement | null>
  handleImagePreviewLoad: (event: SyntheticEvent<HTMLImageElement>) => void
  handleImagePreviewPointerDown: (event: ReactPointerEvent<HTMLImageElement>) => void
  handleImagePreviewPointerMove: (event: ReactPointerEvent<HTMLImageElement>) => void
  handleImagePreviewPointerEnd: (event: ReactPointerEvent<HTMLImageElement>) => void
  handleImagePreviewWheel: (event: ReactWheelEvent<HTMLImageElement>) => void
}) {
  const { previewVisible, attachments, attachmentCopy, requestCloseAttachmentPreview, imagePreviewRef, handleImagePreviewLoad, handleImagePreviewPointerDown, handleImagePreviewPointerMove, handleImagePreviewPointerEnd, handleImagePreviewWheel } = input
  if (!previewVisible) {
    return null
  }
  return (
    <div
      className={[
        'copilot-chat__attachment-preview-backdrop',
        attachments.preview.kind === 'image' ? 'copilot-chat__attachment-preview-backdrop--image' : '',
      ].filter((className) => className !== '').join(' ')}
      data-testid="chat-composer-attachment-preview-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          requestCloseAttachmentPreview()
        }
      }}
    >
      <section
        className={[
          'copilot-chat__attachment-preview-dialog',
          attachments.preview.kind === 'image' ? 'copilot-chat__attachment-preview-dialog--image' : '',
        ].filter((className) => className !== '').join(' ')}
        role="dialog"
        aria-label={attachmentCopy.previewDialogLabel}
        data-testid="chat-composer-attachment-preview-dialog"
      >
        <div className="copilot-chat__attachment-preview-header">
          <h2 className="copilot-chat__attachment-preview-title">{attachments.preview.title}</h2>
          <button
            type="button"
            className="copilot-chat__attachment-preview-close"
            aria-label={attachmentCopy.closePreviewLabel}
            title={attachmentCopy.closePreviewLabel}
            data-testid="chat-composer-attachment-preview-close"
            onClick={requestCloseAttachmentPreview}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <div className="copilot-chat__attachment-preview-body">
          {attachments.preview.status === 'loading' && (
            <p className="copilot-chat__attachment-preview-loading" data-testid="chat-composer-attachment-preview-loading">
              {attachmentCopy.previewLoading}
            </p>
          )}
          {attachments.preview.status === 'error' && attachments.preview.message !== null && (
            <p className="copilot-chat__attachment-preview-error" data-testid="chat-composer-attachment-preview-error">
              {attachments.preview.message}
            </p>
          )}
          {attachments.preview.status === 'ready' && attachments.preview.kind === 'image' && attachments.preview.previewUrl !== null && (
            <img
              ref={imagePreviewRef}
              className="copilot-chat__attachment-preview-image"
              src={attachments.preview.previewUrl}
              alt={attachments.preview.title}
              draggable={false}
              data-testid="chat-composer-attachment-preview-image"
              style={{ transform: 'translate3d(0, 0, 0) scale(1)' }}
              onClick={(event) => event.stopPropagation()}
              onLoad={handleImagePreviewLoad}
              onPointerDown={handleImagePreviewPointerDown}
              onPointerMove={handleImagePreviewPointerMove}
              onPointerUp={handleImagePreviewPointerEnd}
              onPointerCancel={handleImagePreviewPointerEnd}
              onWheel={handleImagePreviewWheel}
            />
          )}
          {attachments.preview.status === 'ready' && attachments.preview.kind === 'text' && (
            <pre className="copilot-chat__attachment-preview-text" data-testid="chat-composer-attachment-preview-text">
              {attachments.preview.text}
            </pre>
          )}
        </div>
      </section>
    </div>
  )
}

// eslint-disable-next-line max-lines-per-function -- render function with many child elements
function renderComposerSurface(input: {
  composerHeight: number
  attachments: CopilotComposerAttachmentsState
  attachmentPanelVisible: boolean
  attachmentPanelClosing: boolean
  attachmentPanelId: string
  attachmentCopy: {
    panelLabel: string
    removeLabel: (name: string) => string
    triggerLabel: (count: number) => string
    dropHint: string
  }
  attachmentControlRef: RefObject<HTMLDivElement | null>
  openAttachmentPreview: (id: string) => void
  removeAttachment: (id: string) => void
  handleDragEnter: (event: ReactDragEvent) => void
  handleDragOver: (event: ReactDragEvent) => void
  handleDragLeave: (event: ReactDragEvent) => void
  handleDrop: (event: ReactDragEvent) => void
  handlePaste: (event: ReactClipboardEvent) => void
  attachmentCount: number
  togglePanel: () => void
  requestCloseAttachmentPanel: () => void
  composerInputRef: RefObject<HTMLTextAreaElement>
  copy: ReturnType<typeof getCopilotChatCopy>
  draftMessageText: string
  inputDisabled: boolean
  onDraftChange: Dispatch<SetStateAction<CopilotChatComposerDraft>>
  handleMessageInputKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void
  isSending: boolean
  canCancel: boolean
  sendDisabledReason: string | null
  onCancel: () => void
}) {
  const {
    composerHeight,
    attachments,
    attachmentPanelVisible,
    attachmentPanelClosing,
    attachmentPanelId,
    attachmentCopy,
    attachmentControlRef,
    openAttachmentPreview,
    removeAttachment,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handlePaste,
    attachmentCount,
    togglePanel,
    requestCloseAttachmentPanel,
    composerInputRef,
    copy,
    draftMessageText,
    inputDisabled,
    onDraftChange,
    handleMessageInputKeyDown,
    isSending,
    canCancel,
    sendDisabledReason,
    onCancel,
  } = input
  return (
    <div
      className={[
        'copilot-chat__composer-surface',
        buildComposerSurfaceHeightClassName(composerHeight),
        attachments.isDragActive ? 'copilot-chat__composer-surface--drag-active' : '',
      ].filter((className) => className !== '').join(' ')}
      data-testid="chat-composer-surface"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {renderAttachmentPanel({
        attachmentPanelVisible,
        attachments,
        attachmentPanelClosing,
        attachmentPanelId,
        attachmentCopy: { panelLabel: attachmentCopy.panelLabel, removeLabel: attachmentCopy.removeLabel },
        attachmentControlRef,
        openAttachmentPreview,
        removeAttachment,
      })}

      {attachments.isDragActive && (
        <div className="copilot-chat__attachment-drop-hint" data-testid="chat-composer-attachment-drop-hint">
          {attachmentCopy.dropHint}
        </div>
      )}

      {attachments.notice !== null && (
        <div className="copilot-chat__attachment-notice" data-testid="chat-composer-attachment-notice">
          {attachments.notice.message}
        </div>
      )}

      <div className="copilot-panel__field-group copilot-chat__composer-field">
        <textarea
          ref={composerInputRef}
          className="copilot-chat__composer-input"
          name="messageText"
          aria-label={copy.composer.messageInputAriaLabel}
          value={draftMessageText}
          disabled={inputDisabled}
          onChange={(event) => {
            const nextValue = event.currentTarget.value
            onDraftChange((current) => ({
              ...current,
              messageText: nextValue,
            }))
          }}
          onKeyDown={handleMessageInputKeyDown}
          onPaste={handlePaste}
          placeholder={copy.composer.messageInputPlaceholder}
        />
      </div>

      {attachments.items.length > 0 && (
        <div className="copilot-chat__attachment-trigger-shell" ref={attachmentPanelVisible ? undefined : attachmentControlRef}>
          <button
            type="button"
            className="copilot-chat__attachment-trigger"
            data-testid="chat-composer-attachment-trigger"
            aria-label={attachmentCopy.triggerLabel(attachmentCount)}
            title={attachmentCopy.triggerLabel(attachmentCount)}
            aria-controls={attachmentPanelId}
            aria-expanded={attachments.panelOpen}
            onClick={() => {
              if (attachmentPanelVisible) {
                requestCloseAttachmentPanel()
                return
              }

              togglePanel()
            }}
          >
            <Paperclip className="copilot-chat__attachment-trigger-icon" aria-hidden="true" />
            <span className="copilot-chat__attachment-trigger-count" data-testid="chat-composer-attachment-trigger-count">
              {attachmentCount}
            </span>
          </button>
        </div>
      )}

      <button
        type={isSending ? 'button' : 'submit'}
        className={[
          'copilot-chat__send-button',
          isSending ? 'copilot-chat__send-button--cancel' : '',
        ].filter((className) => className !== '').join(' ')}
        data-testid="chat-composer-send-button"
        disabled={isSending ? !canCancel : sendDisabledReason !== null}
        title={isSending ? copy.composer.cancelCurrentResponse : sendDisabledReason ?? copy.composer.sendMessage}
        aria-label={isSending ? copy.composer.cancelCurrentResponse : sendDisabledReason ?? copy.composer.sendMessage}
        onClick={isSending ? onCancel : undefined}
      >
        {isSending
          ? <Square className="copilot-chat__send-button-icon" aria-hidden="true" />
          : <ArrowUp className="copilot-chat__send-button-icon" aria-hidden="true" />}
      </button>
    </div>
  )
}

interface ComposerThinkingControlProps {
  thinkingCapability: RuntimeThinkingCapability | null
  draft: CopilotChatComposerDraft
  controlsDisabled: boolean
  copyComposer: ReturnType<typeof getCopilotChatCopy>['composer']
  onDraftChange: Dispatch<SetStateAction<CopilotChatComposerDraft>>
}

// eslint-disable-next-line max-lines-per-function -- extracted component with its own hooks and rendering
function ComposerThinkingControl({
  thinkingCapability,
  draft,
  controlsDisabled,
  copyComposer,
  onDraftChange,
}: ComposerThinkingControlProps) {
  const thinkingControlRef = useRef<HTMLDivElement | null>(null)
  const thinkingPanelId = useId()
  const [thinkingPanelOpen, setThinkingPanelOpen] = useState(false)

  const canRenderThinkingControl = thinkingCapability !== null
    && thinkingCapability.supported !== false
    && thinkingCapability.series !== null
    && thinkingCapability.editorType !== null
  const effectiveThinkingSelection = useMemo(
    () => (thinkingCapability === null ? draft.thinkingSelection : resolveThinkingSelectionForCapability(thinkingCapability, draft.thinkingSelection)),
    [draft.thinkingSelection, thinkingCapability],
  )
  const currentThinkingValue = useMemo(
    () => resolveThinkingSelectionValue(effectiveThinkingSelection, thinkingCapability),
    [effectiveThinkingSelection, thinkingCapability],
  )
  const currentThinkingLabel = useMemo(
    () => resolveThinkingValueLabel(currentThinkingValue),
    [currentThinkingValue],
  )
  const thinkingTriggerPlaceholder = copyComposer.thinkingPlaceholder
  const thinkingTriggerLabel = currentThinkingLabel === null ? thinkingTriggerPlaceholder : currentThinkingLabel
  const unavailableThinkingReason = useMemo(
    () => describeThinkingCapabilityUnavailableReason(thinkingCapability),
    [thinkingCapability],
  )
  const thinkingTriggerTitle = canRenderThinkingControl
    ? thinkingTriggerLabel
    : unavailableThinkingReason ?? copyComposer.thinkingPlaceholder
  const thinkingTriggerActive = effectiveThinkingSelection === null
    ? false
    : isThinkingSelectionActive(effectiveThinkingSelection)
  const thinkingTriggerAriaProps = canRenderThinkingControl
    ? {
        'aria-haspopup': 'dialog' as const,
        'aria-controls': thinkingPanelId,
        'aria-expanded': thinkingPanelOpen,
      }
    : {}

  useEffect(() => {
    if (!thinkingPanelOpen) {
      return undefined
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (thinkingControlRef.current?.contains(event.target as Node)) {
        return
      }

      setThinkingPanelOpen(false)
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setThinkingPanelOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleEscape)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [thinkingPanelOpen])

  useEffect(() => {
    if (controlsDisabled || !canRenderThinkingControl) {
      setThinkingPanelOpen(false)
    }
  }, [canRenderThinkingControl, controlsDisabled])

  const handleThinkingSelectionChange = (thinkingSelection: RuntimeThinkingSelection | null) => {
    onDraftChange((current) => applyThinkingSelectionToComposerDraft(current, {
      modelRoute: current.selectedModelRoute,
      thinkingSelection,
    }))
  }

  return (
    <div
      className="copilot-chat__thinking-control"
      data-testid="chat-thinking-control"
      ref={thinkingControlRef}
    >
      <button
        type="button"
        className={[
          'copilot-model-picker__trigger',
          'copilot-chat__thinking-trigger',
          controlsDisabled ? 'copilot-chat__thinking-trigger--disabled' : '',
          thinkingTriggerActive ? 'copilot-chat__thinking-trigger--active' : '',
        ].filter((className) => className !== '').join(' ')}
        data-testid="chat-thinking-trigger"
        aria-label={thinkingTriggerTitle}
        title={thinkingTriggerTitle}
        disabled={controlsDisabled}
        {...thinkingTriggerAriaProps}
        onClick={() => {
          if (!canRenderThinkingControl) {
            setThinkingPanelOpen(false)
            return
          }

          setThinkingPanelOpen((current) => !current)
        }}
      >
        <span className="copilot-chat__thinking-trigger-main">
          <Lightbulb className="copilot-chat__thinking-trigger-icon" aria-hidden="true" />
          <span className="copilot-chat__thinking-trigger-label" data-testid="chat-thinking-trigger-label">
            {thinkingTriggerLabel}
          </span>
        </span>
      </button>
      {canRenderThinkingControl && thinkingCapability !== null && thinkingPanelOpen && (
        <section
          id={thinkingPanelId}
          className="copilot-model-picker__panel copilot-chat__thinking-panel"
          role="dialog"
          aria-label={copyComposer.thinkingSettingsAriaLabel}
          data-testid="chat-thinking-panel"
        >
          <div className="copilot-chat__thinking-panel-header">
            <div className="copilot-chat__thinking-panel-summary">
              <span className="copilot-chat__thinking-panel-title" data-testid="chat-thinking-series-title">
                {buildThinkingSeriesLabel(thinkingCapability)}
              </span>
              <span className="copilot-chat__thinking-panel-current-shell">
                <span className="copilot-chat__thinking-panel-current-label">{copyComposer.currentValueLabel}</span>
                <span className="copilot-chat__thinking-panel-current-value" data-testid="chat-thinking-current-value">
                  {currentThinkingLabel ?? copyComposer.unsetValue}
                </span>
              </span>
            </div>
          </div>
          {renderThinkingControlBody({
            capability: thinkingCapability,
            currentSelection: effectiveThinkingSelection,
            disabled: controlsDisabled,
            onChange: handleThinkingSelectionChange,
            onClose: () => setThinkingPanelOpen(false),
          })}
        </section>
      )}
    </div>
  )
}

function resolveAttachmentCopy(language: string) {
  if (language === 'en-US') {
    return {
      triggerLabel: (count: number) => `Attached files (${count})`,
      panelLabel: 'Attached files',
      removeLabel: (name: string) => `Remove ${name}`,
      closePreviewLabel: 'Close attachment preview',
      previewDialogLabel: 'Attachment preview',
      dropHint: 'Drop files to attach',
      previewLoading: 'Loading preview…',
    }
  }

  return {
    triggerLabel: (count: number) => `已附加 ${count} 个文件`,
    panelLabel: '已附加文件',
    removeLabel: (name: string) => `移除 ${name}`,
    closePreviewLabel: '关闭附件预览',
    previewDialogLabel: '附件预览',
    dropHint: '松开即可附加文件',
    previewLoading: '正在加载预览…',
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
