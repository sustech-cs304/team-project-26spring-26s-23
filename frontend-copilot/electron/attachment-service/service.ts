import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { clipboard, nativeImage } from 'electron'

import type {
  AttachmentManagerApi,
  AttachmentServiceError,
  CleanupTemporaryAttachmentFilesRequest,
  CleanupTemporaryAttachmentFilesResult,
  ClipboardAttachmentUnsupportedReason,
  ReadAttachmentPreviewRequest,
  ReadAttachmentPreviewResult,
  ReadClipboardAttachmentDataResult,
  WriteAttachmentTempFileRequest,
  WriteAttachmentTempFileResult,
} from './ipc'
import { createAttachmentServiceError } from './ipc'

const DEFAULT_TEXT_PREVIEW_MAX_BYTES = 64 * 1024
const MAX_TEXT_PREVIEW_MAX_BYTES = 256 * 1024
const TEMP_DIRECTORY_NAME = 'candue-attachments'

const TEXT_PREVIEWABLE_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.xml',
  '.csv',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.java',
  '.kt',
  '.go',
  '.rs',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.css',
  '.scss',
  '.html',
  '.htm',
  '.sql',
  '.sh',
  '.ps1',
  '.bat',
  '.cmd',
  '.log',
  '.ini',
  '.toml',
  '.env',
])

const IMAGE_EXTENSION_TO_MIME = new Map<string, string>([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.bmp', 'image/bmp'],
  ['.ico', 'image/x-icon'],
])

export interface ElectronAttachmentServiceOptions {
  appendLog?: (
    level: 'info' | 'warn' | 'error',
    message: string,
    context?: Record<string, unknown>,
  ) => void | Promise<void>
  temporaryRootPath?: string
  now?: () => Date
}

export interface ElectronAttachmentService extends AttachmentManagerApi {}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function getTemporaryRootPath(temporaryRootPath?: string): string {
  return path.resolve(temporaryRootPath ?? path.join(os.tmpdir(), TEMP_DIRECTORY_NAME))
}

function ensureWithinDirectory(candidatePath: string, directoryPath: string): boolean {
  const relativePath = path.relative(path.resolve(directoryPath), path.resolve(candidatePath))
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath))
}

function sanitizeFileName(input: string): string {
  const baseName = path.basename(input).replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-').trim()
  return baseName.length > 0 ? baseName : 'attachment'
}

function ensureExtension(fileName: string, extension: string): string {
  return path.extname(fileName).length > 0 ? fileName : `${fileName}${extension}`
}

function createTimestampToken(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}

function createClipboardSuggestedName(now: Date): string {
  return `pasted-image-${createTimestampToken(now)}.png`
}

function createUniqueTemporaryFilePath(rootPath: string, suggestedName: string): string {
  const sanitized = ensureExtension(sanitizeFileName(suggestedName), '.png')
  const parsed = path.parse(sanitized)

  let candidatePath = path.join(rootPath, sanitized)
  let attempt = 2
  while (fs.existsSync(candidatePath)) {
    candidatePath = path.join(rootPath, `${parsed.name}-${attempt}${parsed.ext || '.png'}`)
    attempt += 1
  }
  return candidatePath
}

function isPng(buffer: Buffer): boolean {
  return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
}

function isJpeg(buffer: Buffer): boolean {
  return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
}

function isGif(buffer: Buffer): boolean {
  return buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))
}

function isWebp(buffer: Buffer): boolean {
  return buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
}

function isBmp(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer.subarray(0, 2).toString('ascii') === 'BM'
}

function isIco(buffer: Buffer): boolean {
  return buffer.length >= 4
    && buffer[0] === 0x00
    && buffer[1] === 0x00
    && buffer[2] === 0x01
    && buffer[3] === 0x00
}

function detectImageMimeType(buffer: Buffer, filePath: string): string | null {
  if (isPng(buffer)) return 'image/png'
  if (isJpeg(buffer)) return 'image/jpeg'
  if (isGif(buffer)) return 'image/gif'
  if (isWebp(buffer)) return 'image/webp'
  if (isBmp(buffer)) return 'image/bmp'
  if (isIco(buffer)) return 'image/x-icon'

  return IMAGE_EXTENSION_TO_MIME.get(path.extname(filePath).toLowerCase()) ?? null
}

function isLikelyPlainTextClipboardFormat(format: string): boolean {
  const normalized = format.toLowerCase()
  return normalized.includes('text')
    || normalized.includes('html')
    || normalized.includes('rtf')
    || normalized.includes('bookmark')
    || normalized.includes('uniformresource')
}

function getClipboardUnsupportedReason(formats: readonly string[]): ClipboardAttachmentUnsupportedReason {
  const normalizedFormats = formats.map((format) => format.toLowerCase())
  if (normalizedFormats.some((format) => format.includes('filename') || format.includes('file'))) {
    return 'file_data_not_supported'
  }
  return 'non_image_data'
}

function shouldTreatAsText(filePath: string, buffer: Buffer): boolean {
  const extension = path.extname(filePath).toLowerCase()
  if (TEXT_PREVIEWABLE_EXTENSIONS.has(extension)) {
    return true
  }

  if (buffer.length === 0) {
    return true
  }

  let suspiciousByteCount = 0
  for (const byte of buffer) {
    if (byte === 0) {
      return false
    }
    if ((byte < 0x09 || (byte > 0x0d && byte < 0x20)) && byte !== 0x1b) {
      suspiciousByteCount += 1
    }
  }

  return suspiciousByteCount / buffer.length < 0.05
}

function clampTextPreviewMaxBytes(requested?: number): number {
  if (requested === undefined || !Number.isFinite(requested)) {
    return DEFAULT_TEXT_PREVIEW_MAX_BYTES
  }

  return Math.max(1, Math.min(MAX_TEXT_PREVIEW_MAX_BYTES, Math.floor(requested)))
}

function createNotFoundError(filePath: string): AttachmentServiceError {
  return createAttachmentServiceError('not_found', `附件不存在: ${filePath}`)
}

function readFilePrefix(filePath: string, byteLength: number): Buffer {
  if (byteLength <= 0) {
    return Buffer.alloc(0)
  }

  const fd = fs.openSync(filePath, 'r')
  try {
    const buffer = Buffer.alloc(byteLength)
    const bytesRead = fs.readSync(fd, buffer, 0, byteLength, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    fs.closeSync(fd)
  }
}

export function createElectronAttachmentService(
  options: ElectronAttachmentServiceOptions = {},
): Omit<ElectronAttachmentService, 'resolveFilePath'> {
  const { appendLog, temporaryRootPath, now = () => new Date() } = options
  const tempRootPath = getTemporaryRootPath(temporaryRootPath)

  function log(level: 'info' | 'warn' | 'error', message: string, context?: Record<string, unknown>): void {
    appendLog?.(level, message, context)
  }

  return {
    async readClipboardData(): Promise<ReadClipboardAttachmentDataResult> {
      try {
        const availableFormats = clipboard.availableFormats()
        const image = clipboard.readImage()
        if (!image.isEmpty()) {
          const pngBuffer = image.toPNG()
          const size = image.getSize()
          const currentTime = now()
          return {
            ok: true,
            status: 'image',
            availableFormats,
            data: {
              mimeType: 'image/png',
              base64Data: pngBuffer.toString('base64'),
              byteLength: pngBuffer.byteLength,
              width: size.width,
              height: size.height,
              suggestedName: createClipboardSuggestedName(currentTime),
            },
          }
        }

        const nonTextFormats = availableFormats.filter((format) => !isLikelyPlainTextClipboardFormat(format))
        if (nonTextFormats.length > 0) {
          return {
            ok: true,
            status: 'unsupported',
            availableFormats,
            reason: getClipboardUnsupportedReason(nonTextFormats),
          }
        }

        return {
          ok: true,
          status: 'empty',
          availableFormats,
        }
      } catch (error) {
        const details = getErrorMessage(error)
        log('error', '附件服务: 读取剪贴板失败', { details })
        return createAttachmentServiceError('io_error', '读取剪贴板附件失败', details)
      }
    },

    async writeTempFile(request: WriteAttachmentTempFileRequest): Promise<WriteAttachmentTempFileResult> {
      try {
        if (request.data.mimeType !== 'image/png') {
          return createAttachmentServiceError('unsupported', '当前仅支持将 PNG 图片数据写入临时附件文件')
        }

        const buffer = Buffer.from(request.data.base64Data, 'base64')
        if (buffer.byteLength === 0) {
          return createAttachmentServiceError('invalid_request', '附件图片数据为空，无法写入临时文件')
        }

        fs.mkdirSync(tempRootPath, { recursive: true })
        const currentTime = now()
        const filePath = createUniqueTemporaryFilePath(tempRootPath, request.data.suggestedName)
        fs.writeFileSync(filePath, buffer)

        log('info', '附件服务: 已写入临时图片附件', {
          filePath,
          size: buffer.byteLength,
        })

        return {
          ok: true,
          file: {
            path: filePath,
            name: path.basename(filePath),
            mimeType: 'image/png',
            size: buffer.byteLength,
            createdAt: currentTime.toISOString(),
            isTemporary: true,
          },
        }
      } catch (error) {
        const details = getErrorMessage(error)
        log('error', '附件服务: 写入临时附件文件失败', { details })
        return createAttachmentServiceError('io_error', '写入临时附件文件失败', details)
      }
    },

    async readPreview(request: ReadAttachmentPreviewRequest): Promise<ReadAttachmentPreviewResult> {
      try {
        const previewPath = path.resolve(request.path)
        if (!fs.existsSync(previewPath)) {
          return createNotFoundError(previewPath)
        }

        const stats = fs.statSync(previewPath)
        if (!stats.isFile()) {
          return createAttachmentServiceError('unsupported', `当前仅支持预览文件附件: ${previewPath}`)
        }

        const name = path.basename(previewPath)
        const extension = path.extname(previewPath).toLowerCase()
        const maxBytes = clampTextPreviewMaxBytes(request.maxTextBytes)

        if (IMAGE_EXTENSION_TO_MIME.has(extension)) {
          const buffer = fs.readFileSync(previewPath)
          const imageMimeType = detectImageMimeType(buffer, previewPath)

          if (imageMimeType !== null) {
            const image = nativeImage.createFromBuffer(buffer)
            const size = image.getSize()
            return {
              ok: true,
              kind: 'image',
              path: previewPath,
              name,
              size: stats.size,
              mimeType: imageMimeType,
              dataUrl: `data:${imageMimeType};base64,${buffer.toString('base64')}`,
              width: size.width,
              height: size.height,
            }
          }
        }

        const previewBuffer = readFilePrefix(previewPath, maxBytes)
        if (shouldTreatAsText(previewPath, previewBuffer)) {
          return {
            ok: true,
            kind: 'text',
            path: previewPath,
            name,
            size: stats.size,
            mimeType: 'text/plain',
            text: previewBuffer.toString('utf8'),
            truncated: stats.size > previewBuffer.byteLength,
            maxBytes,
            encoding: 'utf-8',
          }
        }

        return {
          ok: true,
          kind: 'unsupported',
          path: previewPath,
          name,
          size: stats.size,
          reason: 'binary_content',
        }
      } catch (error) {
        const details = getErrorMessage(error)
        log('error', '附件服务: 读取附件预览失败', { details, path: request.path })
        return createAttachmentServiceError('io_error', '读取附件预览失败', details)
      }
    },

    async cleanupTempFiles(
      request: CleanupTemporaryAttachmentFilesRequest,
    ): Promise<CleanupTemporaryAttachmentFilesResult> {
      try {
        const deletedPaths: string[] = []
        const missingPaths: string[] = []
        const skippedPaths: string[] = []

        for (const candidate of request.paths) {
          const resolvedPath = path.resolve(candidate)
          if (!ensureWithinDirectory(resolvedPath, tempRootPath)) {
            skippedPaths.push(resolvedPath)
            continue
          }

          if (!fs.existsSync(resolvedPath)) {
            missingPaths.push(resolvedPath)
            continue
          }

          const stats = fs.statSync(resolvedPath)
          if (stats.isDirectory()) {
            skippedPaths.push(resolvedPath)
            continue
          }

           fs.unlinkSync(resolvedPath)
          deletedPaths.push(resolvedPath)
        }

        log('info', '附件服务: 已执行临时附件清理', {
          deletedCount: deletedPaths.length,
          missingCount: missingPaths.length,
          skippedCount: skippedPaths.length,
        })

        return {
          ok: true,
          deletedPaths,
          missingPaths,
          skippedPaths,
        }
      } catch (error) {
        const details = getErrorMessage(error)
        log('error', '附件服务: 清理临时附件失败', { details })
        return createAttachmentServiceError('io_error', '清理临时附件失败', details)
      }
    },
  }
}
