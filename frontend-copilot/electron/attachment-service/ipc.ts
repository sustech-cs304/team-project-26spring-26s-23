export const ATTACHMENT_MANAGER_READ_CLIPBOARD_DATA_CHANNEL = 'attachment-manager:read-clipboard-data'
export const ATTACHMENT_MANAGER_WRITE_TEMP_FILE_CHANNEL = 'attachment-manager:write-temp-file'
export const ATTACHMENT_MANAGER_READ_PREVIEW_CHANNEL = 'attachment-manager:read-preview'
export const ATTACHMENT_MANAGER_CLEANUP_TEMP_FILES_CHANNEL = 'attachment-manager:cleanup-temp-files'

export type AttachmentServiceErrorCode = 'not_found' | 'invalid_request' | 'io_error' | 'unsupported' | 'unknown'

export interface AttachmentServiceError {
  ok: false
  code: AttachmentServiceErrorCode
  message: string
  details?: string
}

export function createAttachmentServiceError(
  code: AttachmentServiceErrorCode,
  message: string,
  details?: string,
): AttachmentServiceError {
  return { ok: false, code, message, ...(details !== undefined ? { details } : {}) }
}

export type ClipboardAttachmentUnsupportedReason = 'file_data_not_supported' | 'non_image_data'

export interface ClipboardImageAttachmentData {
  mimeType: 'image/png'
  base64Data: string
  byteLength: number
  width: number
  height: number
  suggestedName: string
}

export interface ReadClipboardAttachmentImageResult {
  ok: true
  status: 'image'
  availableFormats: string[]
  data: ClipboardImageAttachmentData
}

export interface ReadClipboardAttachmentEmptyResult {
  ok: true
  status: 'empty'
  availableFormats: string[]
}

export interface ReadClipboardAttachmentUnsupportedResult {
  ok: true
  status: 'unsupported'
  availableFormats: string[]
  reason: ClipboardAttachmentUnsupportedReason
}

export type ReadClipboardAttachmentDataResult =
  | ReadClipboardAttachmentImageResult
  | ReadClipboardAttachmentEmptyResult
  | ReadClipboardAttachmentUnsupportedResult
  | AttachmentServiceError

export interface WriteAttachmentTempFileRequest {
  data: ClipboardImageAttachmentData
}

export interface TemporaryAttachmentFile {
  path: string
  name: string
  mimeType: string
  size: number
  createdAt: string
  isTemporary: true
}

export interface WriteAttachmentTempFileSuccess {
  ok: true
  file: TemporaryAttachmentFile
}

export type WriteAttachmentTempFileResult = WriteAttachmentTempFileSuccess | AttachmentServiceError

export interface ReadAttachmentPreviewRequest {
  path: string
  maxTextBytes?: number
}

interface AttachmentPreviewSuccessBase {
  ok: true
  path: string
  name: string
  size: number
}

export interface ImageAttachmentPreviewSuccess extends AttachmentPreviewSuccessBase {
  kind: 'image'
  mimeType: string
  dataUrl: string
  width: number
  height: number
}

export interface TextAttachmentPreviewSuccess extends AttachmentPreviewSuccessBase {
  kind: 'text'
  mimeType: 'text/plain'
  text: string
  truncated: boolean
  maxBytes: number
  encoding: 'utf-8'
}

export interface UnsupportedAttachmentPreviewSuccess extends AttachmentPreviewSuccessBase {
  kind: 'unsupported'
  reason: 'unsupported_type' | 'binary_content'
}

export type ReadAttachmentPreviewResult =
  | ImageAttachmentPreviewSuccess
  | TextAttachmentPreviewSuccess
  | UnsupportedAttachmentPreviewSuccess
  | AttachmentServiceError

export interface CleanupTemporaryAttachmentFilesRequest {
  paths: string[]
}

export interface CleanupTemporaryAttachmentFilesSuccess {
  ok: true
  deletedPaths: string[]
  missingPaths: string[]
  skippedPaths: string[]
}

export type CleanupTemporaryAttachmentFilesResult =
  | CleanupTemporaryAttachmentFilesSuccess
  | AttachmentServiceError

export interface AttachmentManagerApi {
  resolveFilePath(file: File): string | null
  readClipboardData(): Promise<ReadClipboardAttachmentDataResult>
  writeTempFile(request: WriteAttachmentTempFileRequest): Promise<WriteAttachmentTempFileResult>
  readPreview(request: ReadAttachmentPreviewRequest): Promise<ReadAttachmentPreviewResult>
  cleanupTempFiles(
    request: CleanupTemporaryAttachmentFilesRequest,
  ): Promise<CleanupTemporaryAttachmentFilesResult>
}
