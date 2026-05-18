import type { ClipboardImageAttachmentData, TemporaryAttachmentFile } from '../../../../electron/attachment-service/ipc'
import type {
  CopilotComposerAttachment,
  CopilotComposerAttachmentsState,
  CopilotComposerAttachmentKind,
} from './types'

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp', '.ico', '.avif'])
const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.mdx', '.json', '.yml', '.yaml', '.xml', '.csv', '.log', '.ini', '.toml', '.html', '.htm', '.css', '.js', '.jsx', '.ts', '.tsx', '.py', '.java', '.c', '.cc', '.cpp', '.h', '.hpp', '.go', '.rs', '.rb', '.php', '.sql', '.sh', '.ps1'])

export function createIdleComposerAttachmentPreviewState() {
  return {
    open: false,
    attachmentId: null,
    status: 'idle' as const,
    kind: null,
    title: '',
    previewUrl: null,
    text: '',
    truncated: false,
    message: null,
  }
}

export function createEmptyComposerAttachmentsState(): CopilotComposerAttachmentsState {
  return {
    items: [],
    panelOpen: false,
    isDragActive: false,
    dragDepth: 0,
    notice: null,
    preview: createIdleComposerAttachmentPreviewState(),
  }
}

export function createAttachmentId(path: string): string {
  return path
}

export function extractFileSystemPath(file: File): string | null {
  const fileWithPath = file as File & { path?: string; webkitRelativePath?: string }
  const path = typeof fileWithPath.path === 'string' && fileWithPath.path.trim() !== ''
    ? fileWithPath.path
    : typeof fileWithPath.webkitRelativePath === 'string' && fileWithPath.webkitRelativePath.trim() !== ''
      ? fileWithPath.webkitRelativePath
      : ''

  if (path.trim() !== '') {
    return path
  }

  const resolvedPath = typeof window !== 'undefined'
    ? window.attachmentManager?.resolveFilePath(file) ?? ''
    : ''

  return resolvedPath.trim() === '' ? null : resolvedPath
}

export function resolveComposerAttachmentKind(input: {
  mimeType?: string | null
  name: string
}): CopilotComposerAttachmentKind {
  const mimeType = input.mimeType?.trim().toLowerCase() ?? ''
  if (mimeType.startsWith('image/')) {
    return 'image'
  }

  if (mimeType.startsWith('text/')) {
    return 'text'
  }

  const extension = resolveExtension(input.name)
  if (IMAGE_EXTENSIONS.has(extension)) {
    return 'image'
  }

  if (TEXT_EXTENSIONS.has(extension)) {
    return 'text'
  }

  return 'other'
}

export function createComposerAttachmentFromFile(file: File): CopilotComposerAttachment | null {
  const path = extractFileSystemPath(file)
  if (path === null) {
    return null
  }

  const kind = resolveComposerAttachmentKind({
    mimeType: file.type,
    name: file.name,
  })
  const previewUrl = kind === 'image' && typeof URL.createObjectURL === 'function'
    ? URL.createObjectURL(file)
    : undefined

  return {
    id: createAttachmentId(path),
    path,
    name: file.name,
    mimeType: file.type,
    size: file.size,
    isTemporary: false,
    source: 'filesystem',
    kind,
    createdAt: new Date().toISOString(),
    ...(previewUrl === undefined ? {} : { previewUrl }),
  }
}

export function createComposerAttachmentFromTempFile(input: {
  data: ClipboardImageAttachmentData
  file: TemporaryAttachmentFile
}): CopilotComposerAttachment {
  return {
    id: createAttachmentId(input.file.path),
    path: input.file.path,
    name: input.file.name,
    mimeType: input.file.mimeType,
    size: input.file.size,
    isTemporary: input.file.isTemporary,
    source: 'clipboard-image',
    kind: 'image',
    createdAt: input.file.createdAt,
    previewUrl: `data:${input.data.mimeType};base64,${input.data.base64Data}`,
  }
}

export function mergeComposerAttachments(
  current: readonly CopilotComposerAttachment[],
  incoming: readonly CopilotComposerAttachment[],
): CopilotComposerAttachment[] {
  if (incoming.length === 0) {
    return [...current]
  }

  const seenPaths = new Set(current.map((attachment) => attachment.path))
  const next = [...current]

  for (const attachment of incoming) {
    if (seenPaths.has(attachment.path)) {
      revokeComposerAttachmentPreviewUrl(attachment)
      continue
    }

    seenPaths.add(attachment.path)
    next.push(attachment)
  }

  return next
}

export function revokeComposerAttachmentPreviewUrl(attachment: Pick<CopilotComposerAttachment, 'previewUrl'>) {
  if (attachment.previewUrl !== undefined && attachment.previewUrl.startsWith('blob:')) {
    URL.revokeObjectURL(attachment.previewUrl)
  }
}

export function revokeComposerAttachmentPreviewUrls(attachments: readonly Pick<CopilotComposerAttachment, 'previewUrl'>[]) {
  for (const attachment of attachments) {
    revokeComposerAttachmentPreviewUrl(attachment)
  }
}

function resolveExtension(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf('.')
  return lastDotIndex < 0 ? '' : fileName.slice(lastDotIndex).toLowerCase()
}
