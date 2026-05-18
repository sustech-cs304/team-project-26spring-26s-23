export type CopilotComposerAttachmentSource = 'filesystem' | 'clipboard-image'

export type CopilotComposerAttachmentKind = 'image' | 'text' | 'other'

export interface CopilotComposerAttachment {
  id: string
  path: string
  name: string
  mimeType: string
  size: number
  isTemporary: boolean
  source: CopilotComposerAttachmentSource
  kind: CopilotComposerAttachmentKind
  createdAt: string
  previewUrl?: string
}

export interface CopilotComposerAttachmentNotice {
  id: number
  message: string
}

export interface CopilotComposerAttachmentPreviewState {
  open: boolean
  attachmentId: string | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  kind: 'image' | 'text' | null
  title: string
  previewUrl: string | null
  text: string
  truncated: boolean
  message: string | null
}

export interface CopilotComposerAttachmentsState {
  items: CopilotComposerAttachment[]
  panelOpen: boolean
  isDragActive: boolean
  dragDepth: number
  notice: CopilotComposerAttachmentNotice | null
  preview: CopilotComposerAttachmentPreviewState
}
