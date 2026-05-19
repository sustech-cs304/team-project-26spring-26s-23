/* eslint-disable react-refresh/only-export-components */
import {
  BarChart3,
  BookOpen,
  ChevronRight,
  Copy,
  Download,
  File,
  FileAudio,
  FileArchive,
  FileCode2,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  FolderOpen,
  MessageSquare,
  Presentation,
  X,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import TurndownService from 'turndown'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import remarkGfm from 'remark-gfm'
import type { WorkbenchLanguage } from '../_locale/types'
import { ContextMenu } from '../files/ContextMenu'
import type { ContextMenuItem } from '../files/context-menu-items'
import { ANIM, gsap, useGSAP } from '../animation-utils'

interface Course {
  id: number
  course_id: string
  name: string
  code: string | null
  instructor: string | null
  term: string | null
  url?: string | null
  is_active: boolean
  total_grade?: string | null
  listed_grade?: string | null
  total_assignments?: number
  total_resources?: number
  total_announcements?: number
}

export interface DataItem {
  id: number
  resource_id?: string | null
  parent_id?: string | null
  assignment_id?: string | null
  title?: string
  name?: string
  item_name?: string
  description?: string | null
  description_html?: string | null
  body?: string | null
  body_markdown?: string | null
  content?: string | null
  content_markdown?: string | null
  author?: string | null
  score?: string | null
  total_score?: string | null
  percentage?: number | null
  status?: string | null
  grade_type?: string | null
  category?: string | null
  due_date?: string | null
  publish_time?: string | null
  posted_at?: string | null
  graded_date?: string | null
  feedback?: string | null
  type?: string | null
  size?: string | null
  url?: string | null
  local_path?: string | null
  is_downloaded?: boolean
  download_failed?: boolean
  attachments_json?: string | null
}

type AnnouncementScope = 'all' | 'course_only'

interface LinkedAssignmentSummary {
  assignment_id: string
  title?: string | null
  url?: string | null
  confidence?: string | null
  link_source?: string | null
}

interface LinkedAnnouncementItem {
  announcement_id: string
  title?: string | null
  posted_at?: string | null
  publish_time?: string | null
  content?: string | null
  content_html?: string | null
  body_markdown?: string | null
  content_markdown?: string | null
  relation_confidence?: string | null
  link_source?: string | null
}

const ANNOUNCEMENT_SCOPE_OPTIONS: {
  value: AnnouncementScope
  labelZh: string
  labelEn: string
}[] = [
  { value: 'all', labelZh: '所有公告', labelEn: 'All announcements' },
  { value: 'course_only', labelZh: '仅课程公告', labelEn: 'Course announcements only' },
]

interface AnnouncementDetailItem extends DataItem {
  relation_type?: string | null
  relation_confidence?: string | null
  linked_assignment_count?: number
  linked_assignments?: LinkedAssignmentSummary[] | null
}

export interface AssignmentDetailItem extends DataItem {
  linked_announcements_count?: number
  linked_announcements?: LinkedAnnouncementItem[] | null
}

interface AssignmentAttachmentItem {
  resource_id?: string | null
  title: string
  url?: string | null
  size?: string | null
  type?: string | null
}

type DownloadableItem = Pick<
  DataItem,
  'resource_id' | 'title' | 'name' | 'type' | 'url' | 'local_path' | 'is_downloaded' | 'download_failed'
>

interface ResourceDetailItem extends DataItem {}

export type ResourceDownloadState = 'idle' | 'downloading' | 'downloaded' | 'failed'

export interface ResourceDownloadStatusItem {
  task_id?: string | null
  course_id?: string | null
  resource_url?: string | null
  resource_title?: string | null
  resource_id?: string | null
  directory_path?: string | null
  file_name?: string | null
  state?: ResourceDownloadState | string | null
  downloaded_bytes?: number | null
  total_bytes?: number | null
  progress_percent?: number | null
  local_path?: string | null
  error_message?: string | null
  cancel_requested?: boolean
  preferred_directory?: string | null
}

interface ResourceDownloadStatusResponse {
  ok: boolean
  error?: string
  statuses?: ResourceDownloadStatusItem[]
}

interface ResourceDownloadUiState {
  state: ResourceDownloadState
  taskId: string | null
  localPath: string | null
  progressPercent: number | null
  errorMessage: string | null
  preferredDirectory: string | null
}

interface DetailContextMenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

interface AnnouncementResponse {
  ok: boolean
  error?: string
  scope?: AnnouncementScope
  announcements?: AnnouncementDetailItem[]
}

interface AssignmentResponse {
  ok: boolean
  error?: string
  assignments?: AssignmentDetailItem[]
}

interface GradeResponse {
  ok: boolean
  error?: string
  grades?: DataItem[]
}

interface ResourceResponse {
  ok: boolean
  error?: string
  resources?: ResourceDetailItem[]
}

type DetailResponseByTab = {
  announcements: AnnouncementResponse
  assignments: AssignmentResponse
  grades: GradeResponse
  resources: ResourceResponse
}

export interface ResourceTreeItem extends ResourceDetailItem {
  children: ResourceTreeItem[]
  depth: number
}

export type ResourceVisualKind =
  | 'folder'
  | 'pdf'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'code'
  | 'archive'
  | 'image'
  | 'audio'
  | 'video'
  | 'link'
  | 'file'

type DetailTab = 'announcements' | 'assignments' | 'grades' | 'resources'

const TAB_CONFIG: { key: DetailTab; labelZh: string; labelEn: string; icon: typeof BookOpen }[] = [
  { key: 'announcements', labelZh: '公告', labelEn: 'Announcements', icon: MessageSquare },
  { key: 'assignments', labelZh: '作业', labelEn: 'Assignments', icon: BookOpen },
  { key: 'grades', labelZh: '成绩', labelEn: 'Grades', icon: BarChart3 },
  { key: 'resources', labelZh: '资源', labelEn: 'Resources', icon: FolderOpen },
]

const DETAIL_TAB_FADE_OUT_MS = ANIM.DURATION_FEEDBACK

interface DetailTabState {
  items: DataItem[]
  loading: boolean
  error: string | null
}

function createInitialDetailTabState(): Record<DetailTab, DetailTabState> {
  return {
    announcements: { items: [], loading: false, error: null },
    assignments: { items: [], loading: false, error: null },
    grades: { items: [], loading: false, error: null },
    resources: { items: [], loading: false, error: null },
  }
}

export function splitCourseDisplayName(name: string): { prefix: string | null; title: string } {
  const match = /^([^:：]+)[:：]\s*(.+)$/.exec(name.trim())
  if (!match) {
    return { prefix: null, title: name }
  }

  const prefix = match[1]?.trim() ?? ''
  const title = match[2]?.trim() ?? ''
  if (!prefix || !title) {
    return { prefix: null, title: name }
  }
  return { prefix, title }
}

export function formatDetailTimestamp(value: string | null | undefined, isEnglish: boolean, now = new Date()): string | null {
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  const dayMs = 24 * 60 * 60 * 1000
  const diffMs = now.getTime() - date.getTime()
  if (diffMs >= 0 && diffMs < 30 * dayMs) {
    const daysAgo = Math.floor(diffMs / dayMs)
    if (daysAgo <= 0) {
      return isEnglish ? 'Today' : '今天'
    }
    if (isEnglish) {
      return `${daysAgo} ${daysAgo === 1 ? 'day' : 'days'} ago`
    }
    return `${daysAgo} 天前`
  }

  return value.slice(0, 10)
}

export function resolveAnnouncementMarkdown(
  item: Pick<DataItem, 'body_markdown' | 'content_markdown'>,
): string | null {
  const markdown = item.body_markdown ?? item.content_markdown ?? null
  if (typeof markdown !== 'string') {
    return null
  }
  const normalized = markdown.trim()
  return normalized || null
}

export function buildDetailRequestUrl(
  baseUrl: string,
  courseId: string,
  detailTab: DetailTab,
  options?: { announcementScope?: AnnouncementScope },
): string {
  const requestUrl = new URL(
    `${baseUrl}/api/blackboard/data/courses/${encodeURIComponent(courseId)}/${detailTab}`,
  )
  if (detailTab === 'announcements' && options?.announcementScope === 'course_only') {
    requestUrl.searchParams.set('scope', 'course_only')
  }
  return requestUrl.toString()
}

export function buildResourceDownloadStatusRequestUrl(
  baseUrl: string,
  courseId: string,
  resourceUrls: string[],
): string {
  const requestUrl = new URL(
    `${baseUrl}/api/blackboard/resources/downloads/status`,
  )
  requestUrl.searchParams.set('course_id', courseId)
  resourceUrls
    .map((resourceUrl) => String(resourceUrl ?? '').trim())
    .filter(Boolean)
    .forEach((resourceUrl) => {
      requestUrl.searchParams.append('resource_urls', resourceUrl)
    })
  return requestUrl.toString()
}

function normalizeResourceDownloadState(value: unknown): ResourceDownloadState | null {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'idle' || normalized === 'downloading' || normalized === 'downloaded' || normalized === 'failed') {
    return normalized
  }
  return null
}

function clampProgressPercent(value: unknown): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return null
  }
  return Math.max(0, Math.min(100, parsed))
}

function resolveDirectoryFromLocalPath(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').trim()
  if (!normalized) {
    return null
  }
  const separatorIndex = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'))
  if (separatorIndex <= 0) {
    return null
  }
  return normalized.slice(0, separatorIndex)
}

function resolveDownloadState(
  status: ResourceDownloadStatusItem | null | undefined,
  item: Pick<DataItem, 'local_path' | 'is_downloaded' | 'download_failed'>,
): ResourceDownloadState {
  const statusState = normalizeResourceDownloadState(status?.state)
  if (statusState) return statusState
  const hasStatusPayload = status !== null && status !== undefined
  if (!hasStatusPayload && (Boolean(item.is_downloaded) || Boolean(String(item.local_path ?? '').trim()))) {
    return 'downloaded'
  }
  if (item.download_failed) return 'failed'
  return 'idle'
}

function resolveDownloadLocalPath(
  status: ResourceDownloadStatusItem | null | undefined,
  item: Pick<DataItem, 'local_path'>,
): string | null {
  const hasStatusPayload = status !== null && status !== undefined
  return hasStatusPayload
    ? (String(status?.local_path ?? '').trim() || null)
    : (String(item.local_path ?? '').trim() || null)
}

function resolveDownloadProgressPercent(
  state: ResourceDownloadState,
  status: ResourceDownloadStatusItem | null | undefined,
): number | null {
  if (state === 'downloading') return clampProgressPercent(status?.progress_percent)
  if (state === 'downloaded') return 100
  return null
}

export function resolveResourceDownloadUiState(
  item: Pick<DataItem, 'local_path' | 'is_downloaded' | 'download_failed'>,
  status?: ResourceDownloadStatusItem | null,
): ResourceDownloadUiState {
  const state = resolveDownloadState(status, item)
  const localPath = resolveDownloadLocalPath(status, item)
  return {
    state,
    taskId: String(status?.task_id ?? '').trim() || null,
    localPath,
    progressPercent: resolveDownloadProgressPercent(state, status),
    errorMessage: String(status?.error_message ?? '').trim() || null,
    preferredDirectory:
      String(status?.preferred_directory ?? '').trim()
      || resolveDirectoryFromLocalPath(localPath)
      || null,
  }
}

export function resolveAssignmentLinkedAnnouncements(
  item: AssignmentDetailItem,
): LinkedAnnouncementItem[] {
  if (!Array.isArray(item.linked_announcements)) {
    return []
  }

  return [...item.linked_announcements]
    .filter((announcement): announcement is LinkedAnnouncementItem => {
      return typeof announcement === 'object' && announcement !== null
    })
    .sort((left, right) => {
      const leftDate = new Date(left.posted_at ?? left.publish_time ?? '').getTime()
      const rightDate = new Date(right.posted_at ?? right.publish_time ?? '').getTime()
      const safeLeft = Number.isNaN(leftDate) ? Number.NEGATIVE_INFINITY : leftDate
      const safeRight = Number.isNaN(rightDate) ? Number.NEGATIVE_INFINITY : rightDate
      return safeRight - safeLeft
    })
}

export function resolveAssignmentAttachments(
  item: Pick<AssignmentDetailItem, 'attachments_json'>,
): AssignmentAttachmentItem[] {
  const raw = String(item.attachments_json ?? '').trim()
  if (!raw) {
    return []
  }

  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      return []
    }

    return parsed
      .filter((attachment): attachment is Record<string, unknown> => typeof attachment === 'object' && attachment !== null)
      .map((attachment): AssignmentAttachmentItem | null => {
        const title = String(attachment.title ?? attachment.name ?? '').trim()
        const url = String(attachment.url ?? '').trim() || null
        const size = String(attachment.size ?? '').trim() || null
        const type = String(attachment.type ?? '').trim() || null
        const resourceId = String(attachment.resource_id ?? '').trim() || null
        if (!title) {
          return null
        }
        return {
          resource_id: resourceId,
          title,
          url,
          size,
          type,
        }
      })
      .filter((attachment): attachment is AssignmentAttachmentItem => attachment !== null)
  } catch {
    return []
  }
}

const assignmentHtmlTurndownService = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  emDelimiter: '*',
  strongDelimiter: '**',
})

function normalizeOptionalText(value: string | null | undefined): string | null {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text || null
}

function normalizeMarkdownText(value: string | null | undefined): string | null {
  if (value == null) {
    return null
  }
  const normalized = String(value).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const normalizedLines = normalized.split('\n').map((line) => {
    const trimmed = line.trim()
    return trimmed
      .replace(/^([-+*])\s+/, '$1 ')
      .replace(/^(\d+\.)\s+/, '$1 ')
  })
  const collapsed: string[] = []
  let previousBlank = false
  normalizedLines.forEach((line) => {
    if (line === '') {
      if (previousBlank) {
        return
      }
      previousBlank = true
      collapsed.push('')
      return
    }
    previousBlank = false
    collapsed.push(line)
  })
  const cleaned = collapsed.join('\n').trim()
  return cleaned || null
}

function stripHtmlToText(value: string | null | undefined): string | null {
  const html = String(value ?? '').trim()
  if (!html) {
    return null
  }

  if (typeof DOMParser !== 'undefined') {
    const document = new DOMParser().parseFromString(html, 'text/html')
    return normalizeOptionalText(document.body.textContent)
  }

  return normalizeOptionalText(html.replace(/<[^>]+>/g, ' '))
}

export function resolveAssignmentDescription(
  item: Pick<AssignmentDetailItem, 'description' | 'description_html' | 'body' | 'content' | 'feedback'>,
): string | null {
  return normalizeOptionalText(item.description)
    ?? stripHtmlToText(item.description_html)
    ?? normalizeOptionalText(item.body)
    ?? normalizeOptionalText(item.content)
    ?? normalizeOptionalText(item.feedback)
}

export function resolveAssignmentMarkdown(
  item: Pick<AssignmentDetailItem, 'description_html'>,
): string | null {
  const html = String(item.description_html ?? '').trim()
  if (!html) {
    return null
  }

  try {
    return normalizeMarkdownText(assignmentHtmlTurndownService.turndown(html))
  } catch {
    return null
  }
}

function resolveDownloadButtonTitle(
  state: ResourceDownloadState,
  isEnglish: boolean,
): string {
  if (state === 'downloaded') {
    return isEnglish ? 'Show in folder' : '在文件夹中显示'
  }
  if (state === 'downloading') {
    return isEnglish ? 'Cancel download' : '取消下载'
  }
  if (state === 'failed') {
    return isEnglish ? 'Retry download' : '重新下载'
  }
  return isEnglish ? 'Download' : '下载'
}

function normalizeHttpUrl(value: string | null | undefined): string | null {
  const text = String(value ?? '').trim()
  if (!text) {
    return null
  }

  try {
    const parsed = new URL(text)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed.toString()
  } catch {
    return null
  }
}

function buildAnnouncementCopyText(item: Pick<DataItem, 'title' | 'name' | 'item_name' | 'body' | 'content' | 'body_markdown' | 'content_markdown'>): string {
  const title = String(item.title ?? item.name ?? item.item_name ?? '').trim()
  const body = resolveAnnouncementMarkdown(item as DataItem) ?? String(item.body ?? item.content ?? '').trim()
  return [title, body].filter(Boolean).join('\n\n').trim()
}

function buildLinkedAnnouncementsCopyText(items: LinkedAnnouncementItem[]): string {
  return items
    .map((item) => {
      const title = String(item.title ?? item.announcement_id ?? '').trim()
      const body = resolveAnnouncementMarkdown(item as unknown as DataItem) ?? String(item.content ?? '').trim()
      return [title, body].filter(Boolean).join('\n\n').trim()
    })
    .filter(Boolean)
    .join('\n\n---\n\n')
}

function buildAssignmentCopyText(item: Pick<AssignmentDetailItem, 'title' | 'name' | 'item_name' | 'description' | 'description_html' | 'body' | 'content' | 'feedback'>): string {
  const title = String(item.title ?? item.name ?? item.item_name ?? '').trim()
  const body = resolveAssignmentMarkdown(item as AssignmentDetailItem)
    ?? resolveAssignmentDescription(item as AssignmentDetailItem)
    ?? ''
  return [title, body].filter(Boolean).join('\n\n').trim()
}

export function formatGradePercentage(
  score: string | null | undefined,
  totalScore: string | null | undefined,
  percentage: number | null | undefined,
): string | null {
  if (typeof percentage === 'number' && Number.isFinite(percentage)) {
    const normalized = Math.round(percentage * 10) / 10
    return Number.isInteger(normalized) ? `${normalized.toFixed(0)}%` : `${normalized.toFixed(1)}%`
  }

  const scoreValue = Number.parseFloat(String(score ?? '').trim())
  const totalValue = Number.parseFloat(String(totalScore ?? '').trim())
  if (!Number.isFinite(scoreValue) || !Number.isFinite(totalValue) || totalValue <= 0) {
    return null
  }

  const computed = Math.round((scoreValue / totalValue) * 1000) / 10
  return Number.isInteger(computed) ? `${computed.toFixed(0)}%` : `${computed.toFixed(1)}%`
}

export function extractDetailItemsFromResponse(
  detailTab: DetailTab,
  data: DetailResponseByTab[DetailTab],
): DataItem[] {
  if (detailTab === 'announcements') {
    return Array.isArray((data as AnnouncementResponse).announcements)
      ? (data as AnnouncementResponse).announcements as DataItem[]
      : []
  }
  if (detailTab === 'assignments') {
    return Array.isArray((data as AssignmentResponse).assignments)
      ? (data as AssignmentResponse).assignments as DataItem[]
      : []
  }
  if (detailTab === 'grades') {
    return Array.isArray((data as GradeResponse).grades)
      ? (data as GradeResponse).grades as DataItem[]
      : []
  }
  return Array.isArray((data as ResourceResponse).resources)
    ? (data as ResourceResponse).resources as DataItem[]
    : []
}

export function flattenResourceHierarchy(items: DataItem[]): ResourceTreeItem[] {
  const nodes = new Map<string, ResourceTreeItem>()
  const roots: ResourceTreeItem[] = []

  items.forEach((item, index) => {
    const key = item.resource_id ?? `row-${item.id ?? index}`
    nodes.set(key, { ...item, children: [], depth: 0 })
  })

  items.forEach((item, index) => {
    const key = item.resource_id ?? `row-${item.id ?? index}`
    const node = nodes.get(key)
    if (!node) return

    const parentKey = item.parent_id ?? null
    const parent = parentKey ? nodes.get(parentKey) : null
    if (parent && parent !== node) {
      parent.children.push(node)
      return
    }
    roots.push(node)
  })

  const result: ResourceTreeItem[] = []
  const append = (node: ResourceTreeItem, depth: number) => {
    node.depth = depth
    result.push(node)
    node.children.forEach((child) => append(child, depth + 1))
  }
  roots.forEach((root) => append(root, 0))
  return result
}

function buildResourceTree(items: DataItem[]): ResourceTreeItem[] {
  const nodes = new Map<string, ResourceTreeItem>()
  const roots: ResourceTreeItem[] = []

  items.forEach((item, index) => {
    const key = item.resource_id ?? `row-${item.id ?? index}`
    nodes.set(key, { ...item, children: [], depth: 0 })
  })

  items.forEach((item, index) => {
    const key = item.resource_id ?? `row-${item.id ?? index}`
    const node = nodes.get(key)
    if (!node) return

    const parentKey = item.parent_id ?? null
    const parent = parentKey ? nodes.get(parentKey) : null
    if (parent && parent !== node) {
      parent.children.push(node)
      return
    }
    roots.push(node)
  })

  return roots
}

const SUFFIX_KIND_MAP: Record<string, ResourceVisualKind> = {
  pdf: 'pdf',
  doc: 'document', docx: 'document', odt: 'document', rtf: 'document', txt: 'document', md: 'document',
  xls: 'spreadsheet', xlsx: 'spreadsheet', csv: 'spreadsheet', tsv: 'spreadsheet', ods: 'spreadsheet',
  ppt: 'presentation', pptx: 'presentation', odp: 'presentation', key: 'presentation',
  ts: 'code', tsx: 'code', js: 'code', jsx: 'code', py: 'code', java: 'code', c: 'code', cpp: 'code', cc: 'code',
  h: 'code', hpp: 'code', go: 'code', rs: 'code', json: 'code', yaml: 'code', yml: 'code', toml: 'code',
  xml: 'code', html: 'code', css: 'code', scss: 'code', sql: 'code', sh: 'code', ps1: 'code',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', bz2: 'archive', xz: 'archive',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', bmp: 'image', svg: 'image', webp: 'image', avif: 'image', ico: 'image',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', flac: 'audio', aac: 'audio',
  mp4: 'video', mov: 'video', avi: 'video', mkv: 'video', webm: 'video', m4v: 'video',
}

function resolveResourceSuffix(
  item: Pick<DataItem, 'title' | 'name' | 'type' | 'url'>,
): string {
  const declaredType = String(item.type ?? '').trim().toLocaleLowerCase()
  const fallbackName = String(item.title ?? item.name ?? '').trim()
  const basename = resolveUrlBasename(item.url)
  const suffixSource = [fallbackName, basename, declaredType]
    .map((value) => String(value ?? '').trim())
    .find((value) => /\.[A-Za-z0-9]{2,8}$/.test(value))
  return suffixSource
    ? suffixSource.slice(suffixSource.lastIndexOf('.') + 1).toLocaleLowerCase()
    : declaredType
}

export function resolveResourceVisualKind(
  item: Pick<DataItem, 'title' | 'name' | 'type' | 'url'>,
): ResourceVisualKind {
  const declaredType = String(item.type ?? '').trim().toLocaleLowerCase()
  if (declaredType === 'folder') return 'folder'

  const suffix = resolveResourceSuffix(item)
  if (suffix in SUFFIX_KIND_MAP) return SUFFIX_KIND_MAP[suffix] as ResourceVisualKind
  if (declaredType === 'link' && suffix === '') return 'link'
  return 'file'
}

export function resolveResourceExtensionLabel(
  item: Pick<DataItem, 'title' | 'name' | 'type' | 'url'>,
): string | null {
  const kind = resolveResourceVisualKind(item)
  if (kind === 'folder') return null

  const suffix = resolveResourceSuffix(item)
  if (!suffix) {
    if (kind === 'link') return 'LINK'
    return null
  }

  return suffix.toUpperCase()
}

function resolveUrlBasename(url: string | null | undefined): string | null {
  const normalized = String(url ?? '').trim()
  if (!normalized) {
    return null
  }

  const path = normalized.split('?')[0]?.split('#')[0] ?? ''
  const basename = path.slice(path.lastIndexOf('/') + 1).trim()
  if (!basename) {
    return null
  }

  try {
    return decodeURIComponent(basename)
  } catch {
    return basename
  }
}

function looksLikeOpaqueResourceName(name: string): boolean {
  const normalized = name.trim()
  if (normalized.length < 20) {
    return false
  }

  const digitCount = [...normalized].filter((char) => char >= '0' && char <= '9').length
  const separatorCount = [...normalized].filter((char) => char === '-' || char === '_').length
  const containsExtension = /\.[a-z0-9]{2,8}$/i.test(normalized)
  return digitCount >= 6 && separatorCount >= 2 && containsExtension
}

export function resolveReadableResourceName(
  item: Pick<DataItem, 'title' | 'name' | 'item_name' | 'url' | 'type'>,
): string {
  const kind = resolveResourceVisualKind(item)
  const candidate = String(item.title ?? item.name ?? item.item_name ?? '').trim()
  const basename = resolveUrlBasename(item.url)

  if (kind === 'folder') {
    return candidate || basename || ''
  }

  const stripTrailingOpaqueSuffix = (value: string): string => {
    return value.replace(/(?:[._-](?:\d{6,}|[A-Za-z0-9]{12,}))+?(?=\.[A-Za-z0-9]{2,8}$)/, '')
  }

  const cleanedCandidate = candidate ? stripTrailingOpaqueSuffix(candidate) : ''
  const cleanedBasename = basename ? stripTrailingOpaqueSuffix(basename) : null

  if (cleanedCandidate && cleanedBasename) {
    if (looksLikeOpaqueResourceName(cleanedCandidate) || (!cleanedCandidate.includes('.') && cleanedBasename.includes('.'))) {
      return cleanedBasename
    }
  }

  if (cleanedCandidate) {
    return cleanedCandidate
  }

  if (cleanedBasename) {
    return cleanedBasename
  }

  return ''
}

export function flattenVisibleResourceHierarchy(
  items: DataItem[],
  expandedResourceIds: ReadonlySet<string>,
): ResourceTreeItem[] {
  const roots = buildResourceTree(items)
  const result: ResourceTreeItem[] = []

  const append = (node: ResourceTreeItem, depth: number) => {
    node.depth = depth
    result.push(node)

    const resourceId = String(node.resource_id ?? '').trim()
    const isDirectory = resolveResourceVisualKind(node) === 'folder'
    if (!isDirectory || !resourceId || !expandedResourceIds.has(resourceId)) {
      return
    }

    node.children.forEach((child) => append(child, depth + 1))
  }

  roots.forEach((root) => append(root, 0))
  return result
}

function resolveResourceRowIcon(kind: ResourceVisualKind, isExpanded: boolean) {
  switch (kind) {
    case 'folder':
      return isExpanded ? FolderOpen : Folder
    case 'pdf':
      return FileText
    case 'document':
      return FileText
    case 'presentation':
      return Presentation
    case 'spreadsheet':
      return FileSpreadsheet
    case 'code':
      return FileCode2
    case 'archive':
      return FileArchive
    case 'image':
      return FileImage
    case 'audio':
      return FileAudio
    case 'video':
      return FileVideo
    default:
      return File
  }
}

function courseMatchesSearch(course: Course, query: string): boolean {
  const keyword = query.trim().toLocaleLowerCase()
  if (!keyword) {
    return true
  }

  const displayName = splitCourseDisplayName(course.name)
  return [
    course.course_id,
    course.code,
    course.name,
    displayName.prefix,
    displayName.title,
    course.instructor,
    course.term,
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLocaleLowerCase().includes(keyword))
}

// ─────────────────────────────────────────────────────────────
// Sub-components extracted from BlackboardDataBrowser
// ─────────────────────────────────────────────────────────────

interface CourseListPaneProps {
  isEnglish: boolean
  searchQuery: string
  onSearchChange: (value: string) => void
  courseCountLabel: string
  loadingCourses: boolean
  coursesError: string | null
  courses: Course[]
  filteredCourses: Course[]
  selectedCourseId: string | null
  onSelectCourse: (courseId: string) => void
}

function CourseListPane({
  isEnglish,
  searchQuery,
  onSearchChange,
  courseCountLabel,
  loadingCourses,
  coursesError,
  courses,
  filteredCourses,
  selectedCourseId,
  onSelectCourse,
}: CourseListPaneProps) {
  return (
    <section className="sustech-course-browser__list-pane" aria-label={isEnglish ? 'Courses' : '课程列表'}>
      <header className="sustech-course-browser__pane-header">
        <div>
          <p className="sustech-course-browser__eyebrow">Blackboard</p>
          <h3 className="sustech-course-browser__title">{isEnglish ? 'Courses' : '课程列表'}</h3>
        </div>
        <span className="sustech-course-browser__count">{courseCountLabel}</span>
      </header>

      <div className="sustech-course-search">
        <input
          type="search"
          className="sustech-course-search__input"
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={isEnglish ? 'Search by code, course, teacher…' : '搜索编号、课程名、授课老师…'}
          aria-label={isEnglish ? 'Search courses' : '搜索课程'}
        />
      </div>

      <CourseListBody
        isEnglish={isEnglish}
        loadingCourses={loadingCourses}
        coursesError={coursesError}
        courses={courses}
        filteredCourses={filteredCourses}
        selectedCourseId={selectedCourseId}
        onSelectCourse={onSelectCourse}
      />
    </section>
  )
}

interface CourseListBodyProps {
  isEnglish: boolean
  loadingCourses: boolean
  coursesError: string | null
  courses: Course[]
  filteredCourses: Course[]
  selectedCourseId: string | null
  onSelectCourse: (courseId: string) => void
}

function CourseListBody({
  isEnglish,
  loadingCourses,
  coursesError,
  courses,
  filteredCourses,
  selectedCourseId,
  onSelectCourse,
}: CourseListBodyProps) {
  if (loadingCourses) {
    return (
      <div className="sustech-course-list">
        <p className="sustech-empty-hint">
          {isEnglish ? 'Loading courses…' : '加载课程中…'}
        </p>
      </div>
    )
  }
  if (coursesError) {
    return (
      <div className="sustech-course-list">
        <div className="sustech-sync-error">
          <span>{coursesError}</span>
        </div>
      </div>
    )
  }
  if (courses.length === 0) {
    return (
      <div className="sustech-course-list">
        <p className="sustech-empty-hint">
          {isEnglish ? 'No courses synced yet. Run a sync first.' : '暂无已同步课程，请先执行同步。'}
        </p>
      </div>
    )
  }
  if (filteredCourses.length === 0) {
    return (
      <div className="sustech-course-list">
        <p className="sustech-empty-hint">
          {isEnglish ? 'No matching courses.' : '没有匹配的课程。'}
        </p>
      </div>
    )
  }
  return (
    <div className="sustech-course-list">
      {filteredCourses.map((course) => {
        const displayName = splitCourseDisplayName(course.name)
        const courseMeta = [course.term, course.instructor].filter(Boolean).join(' · ')
        const isSelected = selectedCourseId === course.course_id
        return (
          <button
            key={course.course_id}
            type="button"
            className={`sustech-course-item${isSelected ? ' sustech-course-item--active' : ''}`}
            onClick={() => onSelectCourse(course.course_id)}
          >
            <div className="sustech-course-item__body">
              {displayName.prefix && <span className="sustech-course-item__code">{displayName.prefix}</span>}
              <span className="sustech-course-item__name">{displayName.title}</span>
              {courseMeta && <span className="sustech-course-item__meta">{courseMeta}</span>}
              <span className="sustech-course-item__badges">
                <span>{isEnglish ? 'Announcements' : '公告'} {course.total_announcements ?? 0}</span>
                <span>{isEnglish ? 'Assignments' : '作业'} {course.total_assignments ?? 0}</span>
                <span>{isEnglish ? 'Resources' : '资源'} {course.total_resources ?? 0}</span>
                {(course.total_grade || course.listed_grade) && (
                  <span>{isEnglish ? 'Grade' : '总评'} {course.total_grade ?? course.listed_grade}</span>
                )}
              </span>
            </div>
            <ChevronRight size={15} className="sustech-course-item__chevron" />
          </button>
        )
      })}
    </div>
  )
}

interface AnnouncementScopeToolbarProps {
  isEnglish: boolean
  announcementScope: AnnouncementScope
  onScopeChange: (scope: AnnouncementScope) => void
  isMenuOpen: boolean
  onMenuOpenChange: (open: boolean) => void
  menuRef: React.RefObject<HTMLDivElement | null>
  selectedLabel: string
  isActive: boolean
  isExiting: boolean
}

function AnnouncementScopeToolbar({
  isEnglish,
  announcementScope,
  onScopeChange,
  isMenuOpen,
  onMenuOpenChange,
  menuRef,
  selectedLabel,
  isActive,
  isExiting,
}: AnnouncementScopeToolbarProps) {
  return (
    <div
      className={[
        'sustech-detail-toolbar',
        'sustech-detail-toolbar--announcements',
        isActive ? 'sustech-detail-toolbar--active' : null,
        isExiting ? 'sustech-detail-toolbar--exiting' : null,
      ].filter(Boolean).join(' ')}
    >
      <div className="sustech-detail-toolbar__spacer" />
      <div className="sustech-detail-filter" ref={menuRef as React.Ref<HTMLDivElement>}>
        <span className="sustech-detail-filter__label">
          {isEnglish ? 'Scope' : '范围'}
        </span>
        <div className="sustech-detail-filter__menu-shell">
          <button
            type="button"
            className={`sustech-detail-filter__trigger${isMenuOpen ? ' sustech-detail-filter__trigger--open' : ''}`}
            onClick={() => onMenuOpenChange(!isMenuOpen)}
            aria-haspopup="listbox"
            aria-expanded={isMenuOpen}
            aria-label={isEnglish ? 'Announcement scope' : '公告范围'}
          >
            <span className="sustech-detail-filter__trigger-text">{selectedLabel}</span>
            <span
              className={`sustech-detail-filter__trigger-icon${isMenuOpen ? ' sustech-detail-filter__trigger-icon--open' : ''}`}
              aria-hidden="true"
            >
              <ChevronRight size={14} />
            </span>
          </button>
          <div
            className={`sustech-detail-filter__menu${isMenuOpen ? ' sustech-detail-filter__menu--open' : ''}`}
            role="listbox"
            aria-label={isEnglish ? 'Announcement scope options' : '公告范围选项'}
            aria-hidden={!isMenuOpen}
          >
            {ANNOUNCEMENT_SCOPE_OPTIONS.map((option) => {
              const isSelected = announcementScope === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`sustech-detail-filter__option${isSelected ? ' sustech-detail-filter__option--active' : ''}`}
                  onClick={() => {
                    onScopeChange(option.value)
                    onMenuOpenChange(false)
                  }}
                  tabIndex={isMenuOpen ? 0 : -1}
                >
                  <span>{isEnglish ? option.labelEn : option.labelZh}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function DownloadButtonIcon({ state }: { state: ResourceDownloadState }) {
  if (state === 'downloading') return <X size={14} />
  if (state === 'downloaded') return <FolderOpen size={14} />
  return <Download size={14} />
}

interface ResourceTreeDownloadButtonProps {
  resourceId: string
  resourceUrl: string
  isActionBusy: boolean
  downloadState: ResourceDownloadUiState
  downloadButtonTitle: string
  item: DownloadableItem
  onDownloadAction: (item: DownloadableItem, options?: { allowCancel?: boolean }) => void
}

function ResourceTreeDownloadButton({
  resourceId,
  resourceUrl,
  isActionBusy,
  downloadState,
  downloadButtonTitle,
  item,
  onDownloadAction,
}: ResourceTreeDownloadButtonProps) {
  const btnClassNames = [
    'sustech-download-button sustech-resource-tree__download',
    downloadState.state === 'downloading' && 'sustech-resource-tree__download--cancel',
    downloadState.state === 'downloaded' && 'sustech-resource-tree__download--reveal',
  ].filter(Boolean).join(' ')

  return (
    <button
      type="button"
      data-testid={`blackboard-resource-download-${resourceId}`}
      className={btnClassNames}
      disabled={!resourceUrl || isActionBusy}
      title={downloadButtonTitle}
      aria-label={downloadButtonTitle}
      onClick={(event) => {
        event.stopPropagation()
        void onDownloadAction(item, { allowCancel: true })
      }}
    >
      <DownloadButtonIcon state={downloadState.state} />
    </button>
  )
}

interface ResourceTreeRowProps {
  item: ResourceTreeItem
  index: number
  isEnglish: boolean
  expandedResourceIds: ReadonlySet<string>
  onToggleExpand: (resourceId: string) => void
  resourceDownloadStatusByUrl: Record<string, ResourceDownloadStatusItem>
  resourceDownloadActionByUrl: Record<string, 'selecting' | 'starting' | 'cancelling' | 'revealing'>
  onDownloadAction: (item: DownloadableItem, options?: { allowCancel?: boolean }) => void
}

// eslint-disable-next-line complexity
function ResourceTreeRow({
  item,
  index,
  isEnglish,
  expandedResourceIds,
  onToggleExpand,
  resourceDownloadStatusByUrl,
  resourceDownloadActionByUrl,
  onDownloadAction,
}: ResourceTreeRowProps) {
  const title = resolveReadableResourceName(item) || `#${item.id}`
  const kind = resolveResourceVisualKind(item)
  const resourceId = String(item.resource_id ?? `resource-${index}`)
  const resourceUrl = String(item.url ?? '').trim()
  const downloadState = resolveResourceDownloadUiState(
    item,
    resourceUrl ? resourceDownloadStatusByUrl[resourceUrl] ?? null : null,
  )
  const isDirectory = kind === 'folder'
  const isExpanded = isDirectory && expandedResourceIds.has(resourceId)
  const Icon = resolveResourceRowIcon(kind, isExpanded)
  const paddingLeft = 12 + Math.min(item.depth ?? 0, 4) * 20
  const trailingMeta = [item.size, downloadState.localPath ? (isEnglish ? 'Downloaded' : '已下载') : null]
    .filter(Boolean)
    .join(' · ')
  const actionState = resourceUrl ? resourceDownloadActionByUrl[resourceUrl] ?? null : null
  const downloadButtonTitle = resolveDownloadButtonTitle(downloadState.state, isEnglish)

  const progressRef = useRef<HTMLSpanElement>(null)
  const percentRef = useRef<HTMLSpanElement>(null)

  useGSAP(() => {
    if (progressRef.current && downloadState.progressPercent != null) {
      gsap.fromTo(progressRef.current,
        { width: `${Math.max(0, (downloadState.progressPercent ?? 0) - 1)}%` },
        {
          width: `${downloadState.progressPercent}%`,
          duration: 0.35,
          ease: 'power2.out',
          overwrite: 'auto',
        },
      )
    }
    if (percentRef.current && downloadState.progressPercent != null) {
      const counter = { value: Number.parseFloat(percentRef.current.textContent ?? '0') || 0 }
      gsap.to(counter, {
        value: downloadState.progressPercent,
        duration: 0.35,
        ease: 'power2.out',
        overwrite: 'auto',
        onUpdate: () => {
          if (percentRef.current) {
            percentRef.current.textContent = `${counter.value.toFixed(1)}%`
          }
        },
      })
    }
  }, { dependencies: [downloadState.progressPercent, downloadState.state] })

  const rowClassNames = [
    'file-tree__row sustech-resource-tree__row',
    isDirectory ? 'sustech-resource-tree__row--directory' : 'sustech-resource-tree__row--file',
    downloadState.state === 'downloading' && 'sustech-resource-tree__row--downloading',
    downloadState.state === 'failed' && 'sustech-resource-tree__row--failed',
  ].filter(Boolean).join(' ')

  return (
    <div
      key={`resource-tree-${item.resource_id ?? item.id ?? index}`}
      data-testid={!isDirectory ? `blackboard-resource-row-${resourceId}` : undefined}
      className={rowClassNames}
      role="treeitem"
      aria-expanded={isDirectory ? isExpanded : undefined}
      aria-level={(item.depth ?? 0) + 1}
      style={{ paddingLeft: `${paddingLeft}px` }}
      onClick={() => {
        if (!isDirectory || !resourceId) return
        onToggleExpand(resourceId)
      }}
      onDoubleClick={(event) => {
        if (isDirectory || !resourceUrl) return
        event.stopPropagation()
        void onDownloadAction(item, { allowCancel: false })
      }}
    >
      {!isDirectory && downloadState.state === 'downloading' && (
        <span
          ref={progressRef}
          className="sustech-resource-tree__progress"
          data-testid={`blackboard-resource-progress-${resourceId}`}
          style={{ width: `${downloadState.progressPercent ?? 0}%` }}
          aria-hidden="true"
        />
      )}
      {!isDirectory && downloadState.state === 'downloading' && downloadState.progressPercent != null && (
        <span ref={percentRef} className="sustech-resource-tree__percent">0%</span>
      )}
      {isDirectory ? (
        <button
          type="button"
          className={`file-tree__expand${isExpanded ? ' file-tree__expand--expanded' : ''}`}
          tabIndex={-1}
          aria-hidden="true"
          onClick={(event) => {
            event.stopPropagation()
            onToggleExpand(resourceId)
          }}
        >
          <ChevronRight size={14} className="file-tree__expand-icon" />
        </button>
      ) : (
        <span className="file-tree__expand file-tree__expand--spacer" />
      )}
      <span className={`file-tree__icon sustech-resource-tree__icon sustech-resource-tree__icon--${kind}`} aria-hidden="true">
        <Icon size={16} />
      </span>
      <span className="file-tree__name sustech-resource-tree__name">{title}</span>
      {trailingMeta && <span className="sustech-resource-tree__meta">{trailingMeta}</span>}
      {!isDirectory && (
        <ResourceTreeDownloadButton
          resourceId={resourceId}
          resourceUrl={resourceUrl}
          isActionBusy={actionState !== null}
          downloadState={downloadState}
          downloadButtonTitle={downloadButtonTitle}
          item={item}
          onDownloadAction={onDownloadAction}
        />
      )}
    </div>
  )
}

interface ResourceTreeViewProps {
  items: ResourceTreeItem[]
  isEnglish: boolean
  expandedResourceIds: ReadonlySet<string>
  onToggleExpand: (resourceId: string) => void
  resourceDownloadStatusByUrl: Record<string, ResourceDownloadStatusItem>
  resourceDownloadActionByUrl: Record<string, 'selecting' | 'starting' | 'cancelling' | 'revealing'>
  onDownloadAction: (item: DownloadableItem, options?: { allowCancel?: boolean }) => void
}

function ResourceTreeView({
  items,
  isEnglish,
  expandedResourceIds,
  onToggleExpand,
  resourceDownloadStatusByUrl,
  resourceDownloadActionByUrl,
  onDownloadAction,
}: ResourceTreeViewProps) {
  return (
    <div className="file-tree sustech-resource-tree" role="tree" aria-label={isEnglish ? 'Course resources' : '课程资源树'}>
      {items.map((item, index) => (
        <ResourceTreeRow
          key={`resource-tree-${item.resource_id ?? item.id ?? index}`}
          item={item}
          index={index}
          isEnglish={isEnglish}
          expandedResourceIds={expandedResourceIds}
          onToggleExpand={onToggleExpand}
          resourceDownloadStatusByUrl={resourceDownloadStatusByUrl}
          resourceDownloadActionByUrl={resourceDownloadActionByUrl}
          onDownloadAction={onDownloadAction}
        />
      ))}
    </div>
  )
}

interface AssignmentAttachmentRowProps {
  attachment: AssignmentAttachmentItem
  attachmentIndex: number
  isEnglish: boolean
  resourceDownloadStatusByUrl: Record<string, ResourceDownloadStatusItem>
  resourceDownloadActionByUrl: Record<string, 'selecting' | 'starting' | 'cancelling' | 'revealing'>
  onDownloadAction: (item: DownloadableItem, options?: { allowCancel?: boolean }) => void
}

// eslint-disable-next-line complexity
function AssignmentAttachmentRow({
  attachment,
  attachmentIndex,
  isEnglish,
  resourceDownloadStatusByUrl,
  resourceDownloadActionByUrl,
  onDownloadAction,
}: AssignmentAttachmentRowProps) {
  const kind = resolveResourceVisualKind({
    title: attachment.title,
    name: attachment.title,
    type: attachment.type ?? null,
    url: attachment.url ?? null,
  })
  const Icon = resolveResourceRowIcon(kind, false)
  const attachmentKey = attachment.resource_id ?? attachment.url ?? `${attachment.title}-${attachmentIndex}`
  const attachmentUrl = String(attachment.url ?? '').trim()
  const downloadState = resolveResourceDownloadUiState(
    { local_path: null, is_downloaded: false, download_failed: false } as Pick<DataItem, 'local_path' | 'is_downloaded' | 'download_failed'>,
    attachmentUrl ? resourceDownloadStatusByUrl[attachmentUrl] ?? null : null,
  )
  const attachmentMeta = [
    attachment.size,
    downloadState.localPath ? (isEnglish ? 'Downloaded' : '已下载') : null,
  ].filter(Boolean).join(' · ')
  const actionState = attachmentUrl ? resourceDownloadActionByUrl[attachmentUrl] ?? null : null
  const downloadButtonTitle = resolveDownloadButtonTitle(downloadState.state, isEnglish)

  const buildDownloadableItem = (): DownloadableItem => ({
    resource_id: attachment.resource_id ?? null,
    title: attachment.title,
    name: attachment.title,
    type: attachment.type ?? null,
    url: attachment.url ?? null,
    local_path: null,
    is_downloaded: false,
    download_failed: false,
  })

  const attachmentProgressRef = useRef<HTMLSpanElement>(null)
  const attachmentPercentRef = useRef<HTMLSpanElement>(null)

  useGSAP(() => {
    if (attachmentProgressRef.current && downloadState.progressPercent != null) {
      gsap.fromTo(attachmentProgressRef.current,
        { width: `${Math.max(0, (downloadState.progressPercent ?? 0) - 1)}%` },
        {
          width: `${downloadState.progressPercent}%`,
          duration: 0.35,
          ease: 'power2.out',
          overwrite: 'auto',
        },
      )
    }
    if (attachmentPercentRef.current && downloadState.progressPercent != null) {
      gsap.to(attachmentPercentRef.current, {
        innerText: downloadState.progressPercent.toFixed(1),
        duration: 0.35,
        snap: { innerText: 0.5 },
        ease: 'power2.out',
      })
    }
  }, { dependencies: [downloadState.progressPercent, downloadState.state] })

  return (
    <div
      key={attachmentKey}
      data-testid={`blackboard-assignment-attachment-row-${attachment.resource_id ?? attachmentIndex}`}
      className="file-tree__row sustech-resource-tree__row sustech-resource-tree__row--file sustech-assignment-attachments__row"
      role="listitem"
      onDoubleClick={() => {
        if (!attachmentUrl) return
        void onDownloadAction(buildDownloadableItem(), { allowCancel: false })
      }}
    >
      {downloadState.state === 'downloading' && (
        <span
          ref={attachmentProgressRef}
          className="sustech-resource-tree__progress"
          data-testid={`blackboard-assignment-attachment-progress-${attachment.resource_id ?? attachmentIndex}`}
          style={{ width: `${downloadState.progressPercent ?? 0}%` }}
          aria-hidden="true"
        />
      )}
      {downloadState.state === 'downloading' && downloadState.progressPercent != null && (
        <span ref={attachmentPercentRef} className="sustech-resource-tree__percent">0%</span>
      )}
      <span className="file-tree__expand file-tree__expand--spacer" />
      <span className={`file-tree__icon sustech-resource-tree__icon sustech-resource-tree__icon--${kind}`} aria-hidden="true">
        <Icon size={16} />
      </span>
      <span className="file-tree__name sustech-resource-tree__name sustech-assignment-attachments__name">
        {resolveReadableResourceName({
          title: attachment.title,
          name: attachment.title,
          type: attachment.type ?? null,
          url: attachment.url ?? null,
        })}
      </span>
      {attachmentMeta && (
        <span className="sustech-resource-tree__meta sustech-assignment-attachments__meta">
          {attachmentMeta}
        </span>
      )}
      <button
        type="button"
        data-testid={`blackboard-assignment-attachment-download-${attachment.resource_id ?? attachmentIndex}`}
        className={[
          'sustech-download-button sustech-resource-tree__download',
          downloadState.state === 'downloading' && 'sustech-resource-tree__download--cancel',
          downloadState.state === 'downloaded' && 'sustech-resource-tree__download--reveal',
        ].filter(Boolean).join(' ')}
        disabled={!attachmentUrl || actionState !== null}
        title={downloadButtonTitle}
        aria-label={downloadButtonTitle}
        onClick={(event) => {
          event.stopPropagation()
          void onDownloadAction(buildDownloadableItem(), { allowCancel: true })
        }}
      >
        <DownloadButtonIcon state={downloadState.state} />
      </button>
    </div>
  )
}

function LinkedAssignmentsSection({ item, isEnglish }: { item: AnnouncementDetailItem; isEnglish: boolean }) {
  if (!Array.isArray(item.linked_assignments) || item.linked_assignments.length === 0) return null
  return (
    <div className="sustech-linked-announcements">
      <span className="sustech-linked-announcements__heading">
        {isEnglish ? 'Linked assignments' : '关联作业'}
      </span>
      <div className="sustech-linked-announcement-list">
        {item.linked_assignments.map((assignment, assignmentIndex) => (
          <div
            key={`${assignment.assignment_id}-${assignmentIndex}`}
            className="sustech-linked-announcement-card"
          >
            <div className="sustech-linked-announcement-card__header">
              <strong className="sustech-linked-announcement-card__title">
                {assignment.title ?? assignment.assignment_id}
              </strong>
            </div>
            {assignment.url && (
              <span className="sustech-linked-announcement-card__meta">
                {assignment.url}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function LinkedAnnouncementsSection({ items, isEnglish }: { items: LinkedAnnouncementItem[]; isEnglish: boolean }) {
  if (items.length === 0) return null
  return (
    <div className="sustech-linked-announcements">
      <span className="sustech-linked-announcements__heading">
        {isEnglish ? 'Linked announcements' : '关联公告'}
      </span>
      <div className="sustech-linked-announcement-list">
        {items.map((announcement, annIndex) => {
          const linkedMarkdown = resolveAnnouncementMarkdown(announcement)
          const linkedTimestamp = formatDetailTimestamp(
            announcement.posted_at ?? announcement.publish_time ?? null,
            isEnglish,
          )
          return (
            <div
              key={`${announcement.announcement_id}-${annIndex}`}
              className="sustech-linked-announcement-card"
            >
              <div className="sustech-linked-announcement-card__header">
                <strong className="sustech-linked-announcement-card__title">
                  {announcement.title ?? announcement.announcement_id}
                </strong>
              </div>
              {linkedTimestamp && (
                <span className="sustech-linked-announcement-card__meta">
                  {linkedTimestamp}
                </span>
              )}
              {linkedMarkdown ? (
                <div className="sustech-detail-item__desc sustech-detail-item__desc--markdown">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {linkedMarkdown}
                  </ReactMarkdown>
                </div>
              ) : (
                announcement.content && (
                  <span className="sustech-detail-item__desc">
                    {announcement.content}
                  </span>
                )
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function GradeSummaryRenderer({ item, gradePercentage }: { item: DataItem; gradePercentage: string | null }) {
  return (
    <div className="sustech-detail-item__grade-summary">
      {item.score !== undefined && item.score !== null ? (
        <span className="sustech-detail-item__score">
          {item.score}{item.total_score ? ` / ${item.total_score}` : ''}
        </span>
      ) : (
        <span className="sustech-detail-item__score sustech-detail-item__score--muted">-</span>
      )}
      {gradePercentage && (
        <span className="sustech-detail-item__score-percentage">
          ({gradePercentage})
        </span>
      )}
    </div>
  )
}

function DetailBodyContent({
  announcementMarkdown,
  assignmentMarkdown,
  description,
}: {
  announcementMarkdown: string | null
  assignmentMarkdown: string | null
  description: string | null
}) {
  if (announcementMarkdown) {
    return (
      <div className="sustech-detail-item__desc sustech-detail-item__desc--markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {announcementMarkdown}
        </ReactMarkdown>
      </div>
    )
  }
  if (assignmentMarkdown) {
    return (
      <div className="sustech-detail-item__desc sustech-detail-item__desc--markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {assignmentMarkdown}
        </ReactMarkdown>
      </div>
    )
  }
  if (description) return <span className="sustech-detail-item__desc">{description}</span>
  return null
}

function DetailItemFooter({
  tabKey,
  item,
  gradePercentage,
  timestamp,
}: {
  tabKey: DetailTab
  item: DataItem
  gradePercentage: string | null
  timestamp: string | null
}) {
  const isGradesTab = tabKey === 'grades'
  return (
    <>
      {isGradesTab ? (
        <GradeSummaryRenderer item={item} gradePercentage={gradePercentage} />
      ) : (
        item.score !== undefined && item.score !== null && (
          <span className="sustech-detail-item__score">
            {item.score}{item.total_score ? ` / ${item.total_score}` : ''}
          </span>
        )
      )}
      {item.due_date && <span className="sustech-detail-item__meta">{item.due_date}</span>}
      {isGradesTab ? (
        <span
          className={`sustech-detail-item__meta sustech-detail-item__date${timestamp ? '' : ' sustech-detail-item__date--placeholder'}`}
          aria-hidden={timestamp ? undefined : 'true'}
        >
          {timestamp ?? '—'}
        </span>
      ) : (
        timestamp && (
          <span className="sustech-detail-item__meta sustech-detail-item__date">
            {timestamp}
          </span>
        )
      )}
    </>
  )
}

interface DetailItemRowProps {
  tabKey: DetailTab
  item: DataItem
  index: number
  isEnglish: boolean
  onOpenSourceUrl: (url: string | null | undefined) => void
  onCopyText: (text: string) => void
  resourceDownloadStatusByUrl: Record<string, ResourceDownloadStatusItem>
  resourceDownloadActionByUrl: Record<string, 'selecting' | 'starting' | 'cancelling' | 'revealing'>
  onDownloadAction: (item: DownloadableItem, options?: { allowCancel?: boolean }) => void
  onDownloadAllAttachments: (attachments: AssignmentAttachmentItem[]) => void
  onContextMenu: (event: React.MouseEvent, title: string, item: DataItem) => void
}

// eslint-disable-next-line complexity
function DetailItemRow({
  tabKey,
  item,
  index,
  isEnglish,
  onOpenSourceUrl,
  resourceDownloadStatusByUrl,
  resourceDownloadActionByUrl,
  onDownloadAction,
  onContextMenu,
}: DetailItemRowProps) {
  const title = item.title ?? item.name ?? item.item_name ?? `#${item.id}`
  const isAnnouncementTab = tabKey === 'announcements'
  const isAssignmentTab = tabKey === 'assignments'
  const isGradesTab = tabKey === 'grades'
  const announcementItem = isAnnouncementTab ? item as AnnouncementDetailItem : null
  const assignmentItem = isAssignmentTab ? item as AssignmentDetailItem : null

  const announcementMarkdown = announcementItem ? resolveAnnouncementMarkdown(announcementItem) : null
  const assignmentMarkdown = assignmentItem ? resolveAssignmentMarkdown(assignmentItem) : null
  const description = isAssignmentTab
    ? resolveAssignmentDescription(assignmentItem as AssignmentDetailItem)
    : item.body ?? item.content ?? item.feedback ?? null

  const secondaryMeta = (isAnnouncementTab
    ? [item.author]
    : [item.category, item.grade_type, item.status, item.author, item.type, item.size,
      item.local_path ? (isEnglish ? 'Downloaded' : '已下载') : null]
  ).filter(Boolean)

  const timestamp = formatDetailTimestamp(
    item.publish_time ?? item.posted_at ?? item.graded_date ?? null,
    isEnglish,
  )
  const gradePercentage = isGradesTab
    ? formatGradePercentage(item.score ?? null, item.total_score ?? null, item.percentage ?? null)
    : null

  const detailSourceUrl = (isAnnouncementTab || isAssignmentTab) ? normalizeHttpUrl(item.url ?? null) : null
  const testId = `blackboard-detail-item-${tabKey}-${item.assignment_id ?? item.resource_id ?? item.id ?? index}`

  return (
    <div
      key={`${tabKey}-${item.resource_id ?? item.id ?? index}`}
      className={`sustech-detail-item sustech-detail-item--${tabKey}`}
      data-testid={testId}
      onDoubleClick={() => { if (detailSourceUrl) void onOpenSourceUrl(detailSourceUrl) }}
      onContextMenu={(event) => onContextMenu(event, title, item)}
    >
      <div className="sustech-detail-item__body">
        <span className="sustech-detail-item__title">
          <span>{title}</span>
        </span>

        <DetailBodyContent
          announcementMarkdown={announcementMarkdown}
          assignmentMarkdown={assignmentMarkdown}
          description={description}
        />

        {secondaryMeta.length > 0 && (
          <span className="sustech-detail-item__meta-row">{secondaryMeta.join(' · ')}</span>
        )}

        {announcementItem && <LinkedAssignmentsSection item={announcementItem} isEnglish={isEnglish} />}

        {isAssignmentTab && (
          <LinkedAnnouncementsSection
            items={resolveAssignmentLinkedAnnouncements(assignmentItem as AssignmentDetailItem)}
            isEnglish={isEnglish}
          />
        )}

        {isAssignmentTab && (() => {
          const attachments = resolveAssignmentAttachments(assignmentItem as AssignmentDetailItem)
          if (attachments.length === 0) return null
          return (
            <div className="sustech-linked-announcements sustech-linked-announcements--attachments">
              <div className="sustech-assignment-attachments" role="list">
                {attachments.map((attachment, attachmentIndex) => (
                  <AssignmentAttachmentRow
                    key={attachment.resource_id ?? attachment.url ?? `${attachment.title}-${attachmentIndex}`}
                    attachment={attachment}
                    attachmentIndex={attachmentIndex}
                    isEnglish={isEnglish}
                    resourceDownloadStatusByUrl={resourceDownloadStatusByUrl}
                    resourceDownloadActionByUrl={resourceDownloadActionByUrl}
                    onDownloadAction={onDownloadAction}
                  />
                ))}
              </div>
            </div>
          )
        })()}
      </div>

      <DetailItemFooter
        tabKey={tabKey}
        item={item}
        gradePercentage={gradePercentage}
        timestamp={timestamp}
      />
    </div>
  )
}

interface DetailTabPanelProps {
  tabKey: DetailTab
  tabState: DetailTabState
  visitedDetailTabs: Set<DetailTab>
  visibleDetailTab: DetailTab
  exitingDetailTab: DetailTab | null
  expandedResourceIds: ReadonlySet<string>
  isEnglish: boolean
  resourceDownloadStatusByUrl: Record<string, ResourceDownloadStatusItem>
  resourceDownloadActionByUrl: Record<string, 'selecting' | 'starting' | 'cancelling' | 'revealing'>
  onDownloadAction: (item: DownloadableItem, options?: { allowCancel?: boolean }) => void
  onDownloadAllAttachments: (attachments: AssignmentAttachmentItem[]) => void
  onToggleExpand: (resourceId: string) => void
  onOpenSourceUrl: (url: string | null | undefined) => void
  onCopyText: (text: string) => void
  onContextMenuAction: (key: DetailTab, event: React.MouseEvent, ctxTitle: string, ctxItem: DataItem) => void
}

function DetailTabPanel({
  tabKey,
  tabState,
  visitedDetailTabs,
  visibleDetailTab,
  exitingDetailTab,
  expandedResourceIds,
  isEnglish,
  resourceDownloadStatusByUrl,
  resourceDownloadActionByUrl,
  onDownloadAction,
  onDownloadAllAttachments,
  onToggleExpand,
  onOpenSourceUrl,
  onCopyText,
  onContextMenuAction,
}: DetailTabPanelProps) {
  if (!visitedDetailTabs.has(tabKey)) return null

  const isExiting = tabKey === exitingDetailTab
  const isActive = tabKey === visibleDetailTab && !isExiting
  const isVisible = tabKey === visibleDetailTab || isExiting
  const displayedDetailItems = tabKey === 'resources'
    ? flattenVisibleResourceHierarchy(tabState.items, expandedResourceIds)
    : tabState.items

  return (
    <div
      key={tabKey}
      className={[
        'sustech-detail-keepalive-panel',
        isActive ? 'sustech-detail-keepalive-panel--active' : null,
        isExiting ? 'sustech-detail-keepalive-panel--exiting' : null,
      ].filter(Boolean).join(' ')}
      data-sustech-detail-tab={tabKey}
      hidden={!isVisible}
      aria-hidden={!isActive}
    >
      <div className="sustech-detail-list">
        {tabState.error && (
          <div className="sustech-sync-error">
            <span>{tabState.error}</span>
          </div>
        )}
        {!tabState.loading && !tabState.error && tabState.items.length === 0 && (
          <p className="sustech-empty-hint">{isEnglish ? 'No data available.' : '暂无数据。'}</p>
        )}
        {tabKey === 'resources' ? (
          <ResourceTreeView
            items={displayedDetailItems as ResourceTreeItem[]}
            isEnglish={isEnglish}
            expandedResourceIds={expandedResourceIds}
            onToggleExpand={onToggleExpand}
            resourceDownloadStatusByUrl={resourceDownloadStatusByUrl}
            resourceDownloadActionByUrl={resourceDownloadActionByUrl}
            onDownloadAction={onDownloadAction}
          />
        ) : displayedDetailItems.map((item, index) => (
          <DetailItemRow
            key={`${tabKey}-${item.resource_id ?? item.id ?? index}`}
            tabKey={tabKey}
            item={item}
            index={index}
            isEnglish={isEnglish}
            onOpenSourceUrl={onOpenSourceUrl}
            onCopyText={onCopyText}
            resourceDownloadStatusByUrl={resourceDownloadStatusByUrl}
            resourceDownloadActionByUrl={resourceDownloadActionByUrl}
            onDownloadAction={onDownloadAction}
            onDownloadAllAttachments={onDownloadAllAttachments}
            onContextMenu={(event, ctxTitle, ctxItem) => onContextMenuAction(tabKey, event, ctxTitle, ctxItem)}
          />
        ))}
      </div>
    </div>
  )
}

function useDetailTabTransition(activeTab: DetailTab, resetKey: string | null) {
  const [visitedDetailTabs, setVisitedDetailTabs] = useState<Set<DetailTab>>(
    () => new Set<DetailTab>(['announcements']),
  )
  const [visibleDetailTab, setVisibleDetailTab] = useState<DetailTab>('announcements')
  const [exitingDetailTab, setExitingDetailTab] = useState<DetailTab | null>(null)
  const targetDetailTabRef = useRef<DetailTab>('announcements')
  const visibleDetailTabRef = useRef<DetailTab>('announcements')
  const detailTabTransitionTimerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (detailTabTransitionTimerRef.current !== null) {
      window.clearTimeout(detailTabTransitionTimerRef.current)
    }
  }, [])

  useEffect(() => {
    setVisitedDetailTabs(new Set<DetailTab>(['announcements']))
    setVisibleDetailTab('announcements')
    setExitingDetailTab(null)
    targetDetailTabRef.current = 'announcements'
    visibleDetailTabRef.current = 'announcements'
    if (detailTabTransitionTimerRef.current !== null) {
      window.clearTimeout(detailTabTransitionTimerRef.current)
      detailTabTransitionTimerRef.current = null
    }
  }, [resetKey])

  useEffect(() => {
    targetDetailTabRef.current = activeTab
    setVisitedDetailTabs((prev) => {
      if (prev.has(activeTab)) return prev
      const next = new Set(prev)
      next.add(activeTab)
      return next
    })

    if (detailTabTransitionTimerRef.current !== null) {
      window.clearTimeout(detailTabTransitionTimerRef.current)
      detailTabTransitionTimerRef.current = null
    }

    if (activeTab === visibleDetailTabRef.current) {
      setExitingDetailTab(null)
      return
    }

    const tabToFadeOut = visibleDetailTabRef.current
    setExitingDetailTab(tabToFadeOut)
    detailTabTransitionTimerRef.current = window.setTimeout(() => {
      const tabToFadeIn = targetDetailTabRef.current
      visibleDetailTabRef.current = tabToFadeIn
      setVisibleDetailTab(tabToFadeIn)
      setExitingDetailTab(null)
      detailTabTransitionTimerRef.current = null
    }, DETAIL_TAB_FADE_OUT_MS)
  }, [activeTab])

  return { visitedDetailTabs, visibleDetailTab, exitingDetailTab }
}

function useResourceDownloadPolling(
  activeTab: DetailTab,
  selectedCourseId: string | null,
  downloadStatusQueryUrls: string[],
  fetchStatuses: () => Promise<void>,
) {
  useEffect(() => {
    if (!selectedCourseId || downloadStatusQueryUrls.length === 0) return
    if (activeTab !== 'resources' && activeTab !== 'assignments') return
    void fetchStatuses()
  }, [activeTab, downloadStatusQueryUrls.length, fetchStatuses, selectedCourseId])

  useEffect(() => {
    if (!selectedCourseId || (activeTab !== 'resources' && activeTab !== 'assignments')) return
    const timer = window.setInterval(() => { void fetchStatuses() }, 800)
    return () => { window.clearInterval(timer) }
  }, [activeTab, fetchStatuses, selectedCourseId])
}

interface BlackboardDataBrowserProps {
  language: WorkbenchLanguage
  baseUrl: string
  refreshToken?: number
}

// eslint-disable-next-line max-lines-per-function, complexity, sonarjs/cognitive-complexity
export function BlackboardDataBrowser({ language, baseUrl, refreshToken = 0 }: BlackboardDataBrowserProps) {
  const isEnglish = language === 'en-US'
  const [courses, setCourses] = useState<Course[]>([])
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)
  const [loadingCourses, setLoadingCourses] = useState(false)
  const [coursesError, setCoursesError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<DetailTab>('announcements')
  const { visitedDetailTabs, visibleDetailTab, exitingDetailTab } = useDetailTabTransition(activeTab, selectedCourseId)
  const [detailStateByTab, setDetailStateByTab] = useState<Record<DetailTab, DetailTabState>>(
    createInitialDetailTabState,
  )
  const [expandedResourceIds, setExpandedResourceIds] = useState<Set<string>>(() => new Set())
  const [resourceDownloadStatusByUrl, setResourceDownloadStatusByUrl] = useState<Record<string, ResourceDownloadStatusItem>>({})
  const [resourceDownloadActionByUrl, setResourceDownloadActionByUrl] = useState<Record<string, 'selecting' | 'starting' | 'cancelling' | 'revealing'>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [announcementScope, setAnnouncementScope] = useState<AnnouncementScope>('course_only')
  const [isAnnouncementScopeMenuOpen, setIsAnnouncementScopeMenuOpen] = useState(false)
  const [detailContextMenu, setDetailContextMenu] = useState<DetailContextMenuState | null>(null)
  const announcementScopeMenuRef = useRef<HTMLDivElement | null>(null)

  const fetchCourses = useCallback(async () => {
    setLoadingCourses(true)
    setCoursesError(null)
    try {
      const res = await fetch(`${baseUrl}/api/blackboard/data/courses`)
      const data = await res.json()
      if (data.ok) {
        const loadedCourses = Array.isArray(data.courses) ? data.courses as Course[] : []
        setCourses(loadedCourses)
        setSelectedCourseId((current) => {
          if (current && loadedCourses.some((course) => course.course_id === current)) return current
          return loadedCourses[0]?.course_id ?? null
        })
      } else {
        setCoursesError(data.error ?? 'Failed to load courses')
      }
    } catch (err) {
      setCoursesError(String(err))
    } finally {
      setLoadingCourses(false)
    }
  }, [baseUrl])

  useEffect(() => { void fetchCourses() }, [fetchCourses, refreshToken])

  const filteredCourses = useMemo(
    () => courses.filter((course) => courseMatchesSearch(course, searchQuery)),
    [courses, searchQuery],
  )

  useEffect(() => {
    setSelectedCourseId((current) => {
      if (filteredCourses.length === 0) return null
      if (current && filteredCourses.some((course) => course.course_id === current)) return current
      return filteredCourses[0]?.course_id ?? null
    })
  }, [filteredCourses])

  useEffect(() => {
    setDetailStateByTab(() => createInitialDetailTabState())
    setExpandedResourceIds(new Set())
    setResourceDownloadStatusByUrl({})
    setResourceDownloadActionByUrl({})
    setActiveTab('announcements')
    setAnnouncementScope('course_only')
    setIsAnnouncementScopeMenuOpen(false)
  }, [selectedCourseId])

  useEffect(() => {
    if (!isAnnouncementScopeMenuOpen) return
    const handlePointerDown = (event: MouseEvent) => {
      if (!announcementScopeMenuRef.current?.contains(event.target as Node)) {
        setIsAnnouncementScopeMenuOpen(false)
      }
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsAnnouncementScopeMenuOpen(false)
    }
    window.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      window.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [isAnnouncementScopeMenuOpen])

  useEffect(() => {
    if (!selectedCourseId) return
    let cancelled = false
    const detailTab = activeTab
    setDetailStateByTab((prev) => ({
      ...prev,
      [detailTab]: { ...prev[detailTab], loading: true, error: null },
    }))
    void (async () => {
      try {
        const res = await fetch(
          buildDetailRequestUrl(baseUrl, selectedCourseId, detailTab, { announcementScope }),
        )
        const data = await res.json() as DetailResponseByTab[DetailTab]
        if (cancelled) return
        if (data.ok) {
          setDetailStateByTab((prev) => ({
            ...prev,
            [detailTab]: { items: extractDetailItemsFromResponse(detailTab, data), loading: false, error: null },
          }))
          return
        }
        setDetailStateByTab((prev) => ({
          ...prev,
          [detailTab]: { items: [], loading: false, error: data.error ?? (isEnglish ? 'Failed to load detail data.' : '加载详情数据失败。') },
        }))
      } catch (err) {
        if (!cancelled) {
          setDetailStateByTab((prev) => ({
            ...prev,
            [detailTab]: { items: [], loading: false, error: String(err) },
          }))
        }
      }
    })()
    return () => { cancelled = true }
  }, [selectedCourseId, activeTab, baseUrl, isEnglish, announcementScope])

  const selectedCourse = courses.find((course) => course.course_id === selectedCourseId) ?? null
  const selectedCourseName = selectedCourse ? splitCourseDisplayName(selectedCourse.name) : null
  const selectedCourseMeta = selectedCourse
    ? [selectedCourse.term, selectedCourse.instructor].filter(Boolean).join(' · ')
    : ''
  const hasSearchQuery = searchQuery.trim().length > 0
  const courseCountLabel = hasSearchQuery
    ? isEnglish ? `${filteredCourses.length}/${courses.length} course(s)` : `${filteredCourses.length}/${courses.length} 门`
    : isEnglish ? `${courses.length} course(s)` : `${courses.length} 门`
  const selectedAnnouncementScopeLabel = useMemo(() => {
    const selectedOption = ANNOUNCEMENT_SCOPE_OPTIONS.find((option) => option.value === announcementScope)
    if (!selectedOption) return isEnglish ? 'Course announcements only' : '仅课程公告'
    return isEnglish ? selectedOption.labelEn : selectedOption.labelZh
  }, [announcementScope, isEnglish])
  const isAnnouncementToolbarVisible = visibleDetailTab === 'announcements' || exitingDetailTab === 'announcements'
  const isAnnouncementToolbarExiting = exitingDetailTab === 'announcements'
  const isAnnouncementToolbarActive = visibleDetailTab === 'announcements' && !isAnnouncementToolbarExiting
  const resourceDownloadUrls = useMemo(
    () => detailStateByTab.resources.items.map((item) => String(item.url ?? '').trim()).filter(Boolean),
    [detailStateByTab.resources.items],
  )
  const assignmentAttachmentUrls = useMemo(
    () => detailStateByTab.assignments.items
      .flatMap((item) => resolveAssignmentAttachments(item as AssignmentDetailItem))
      .map((attachment) => String(attachment.url ?? '').trim())
      .filter(Boolean),
    [detailStateByTab.assignments.items],
  )
  const downloadStatusQueryUrls = useMemo(
    () => Array.from(new Set([...resourceDownloadUrls, ...assignmentAttachmentUrls])),
    [assignmentAttachmentUrls, resourceDownloadUrls],
  )

  const fetchResourceDownloadStatuses = useCallback(async () => {
    if (!selectedCourseId || downloadStatusQueryUrls.length === 0) return
    try {
      const response = await fetch(
        buildResourceDownloadStatusRequestUrl(baseUrl, selectedCourseId, downloadStatusQueryUrls),
      )
      const data = await response.json() as ResourceDownloadStatusResponse
      if (!data.ok || !Array.isArray(data.statuses)) return
      setResourceDownloadStatusByUrl((prev) => {
        const next: Record<string, ResourceDownloadStatusItem> = {}
        downloadStatusQueryUrls.forEach((resourceUrl) => {
          if (prev[resourceUrl]) next[resourceUrl] = prev[resourceUrl] as ResourceDownloadStatusItem
        })
        data.statuses?.forEach((status) => {
          const resourceUrl = String(status.resource_url ?? '').trim()
          if (!resourceUrl) return
          next[resourceUrl] = status
        })
        return next
      })
    } catch {
      // Best-effort polling only; keep existing UI state if a transient request fails.
    }
  }, [baseUrl, downloadStatusQueryUrls, selectedCourseId])

  useResourceDownloadPolling(activeTab, selectedCourseId, downloadStatusQueryUrls, fetchResourceDownloadStatuses)

  const setResourceDownloadAction = useCallback((resourceUrl: string, action: 'selecting' | 'starting' | 'cancelling' | 'revealing' | null) => {
    setResourceDownloadActionByUrl((prev) => {
      const normalizedUrl = String(resourceUrl ?? '').trim()
      if (!normalizedUrl) return prev
      if (action === null) {
        if (!(normalizedUrl in prev)) return prev
        const next = { ...prev }
        delete next[normalizedUrl]
        return next
      }
      return { ...prev, [normalizedUrl]: action }
    })
  }, [])

  const closeDetailContextMenu = useCallback(() => { setDetailContextMenu(null) }, [])

  const copyTextToClipboard = useCallback(async (text: string) => {
    const normalized = String(text ?? '').trim()
    if (!normalized) return
    const fileManager = window.fileManager
    if (fileManager) {
      await fileManager.copyTextToClipboard({ text: normalized })
      return
    }
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(normalized)
    }
  }, [])

  const openSourceUrlInSystemBrowser = useCallback(async (url: string | null | undefined) => {
    const normalized = normalizeHttpUrl(url)
    if (!normalized) return
    const fileManager = window.fileManager
    if (fileManager) {
      await fileManager.openEntryWithSystem({ path: normalized })
      return
    }
    if (typeof window.open === 'function') window.open(normalized, '_blank', 'noopener,noreferrer')
  }, [])

  const startResourceDownloadWithDirectory = useCallback(async (
    item: DownloadableItem,
    directoryPath: string,
  ) => {
    if (!selectedCourseId) return
    const resourceUrl = String(item.url ?? '').trim()
    if (!resourceUrl) return
    const response = await fetch(`${baseUrl}/api/blackboard/resources/downloads/select-start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        course_id: selectedCourseId,
        resource_url: resourceUrl,
        resource_title: resolveReadableResourceName(item),
        directory_path: directoryPath,
      }),
    })
    const data = await response.json() as { ok: boolean; task?: ResourceDownloadStatusItem }
    if (data.ok && data.task) {
      setResourceDownloadStatusByUrl((prev) => ({ ...prev, [resourceUrl]: data.task as ResourceDownloadStatusItem }))
    }
  }, [baseUrl, selectedCourseId])

  const handleDownloadAllAssignmentResources = useCallback(async (attachments: AssignmentAttachmentItem[]) => {
    if (!selectedCourseId) return
    const fileManager = window.fileManager
    if (!fileManager) return

    const candidates = attachments
      .map((attachment) => {
        const attachmentUrl = String(attachment.url ?? '').trim()
        if (!attachmentUrl) return null
        const item: DownloadableItem = {
          resource_id: attachment.resource_id ?? null,
          title: attachment.title,
          name: attachment.title,
          type: attachment.type ?? null,
          url: attachment.url ?? null,
          local_path: null,
          is_downloaded: false,
          download_failed: false,
        }
        const state = resolveResourceDownloadUiState(item, resourceDownloadStatusByUrl[attachmentUrl] ?? null)
        return { attachmentUrl, item, state }
      })
      .filter((candidate): candidate is { attachmentUrl: string; item: DownloadableItem; state: ResourceDownloadUiState } => candidate !== null)
      .filter((candidate) => candidate.state.state !== 'downloaded' && candidate.state.state !== 'downloading')

    if (candidates.length === 0) return

    const preferredDirectory = candidates[0]?.state.preferredDirectory ?? null
    const selection = await fileManager.selectRootDirectory(
      preferredDirectory ? { initialPath: preferredDirectory } : undefined,
    )
    if (!selection.ok) return

    for (const candidate of candidates) {
      setResourceDownloadAction(candidate.attachmentUrl, 'starting')
      try {
        await startResourceDownloadWithDirectory(candidate.item, selection.rootPath)
      } finally {
        setResourceDownloadAction(candidate.attachmentUrl, null)
      }
    }
  }, [resourceDownloadStatusByUrl, selectedCourseId, setResourceDownloadAction, startResourceDownloadWithDirectory])

  const handleRevealDownloadedItem = useCallback(async (resourceUrl: string, localPath: string) => {
    const fileManager = window.fileManager
    if (!fileManager) return
    setResourceDownloadAction(resourceUrl, 'revealing')
    try {
      await fileManager.revealEntryInFolder({ path: localPath })
    } finally {
      setResourceDownloadAction(resourceUrl, null)
    }
  }, [setResourceDownloadAction])

  const handleCancelDownload = useCallback(async (resourceUrl: string, taskId: string | null) => {
    setResourceDownloadAction(resourceUrl, 'cancelling')
    try {
      const response = await fetch(`${baseUrl}/api/blackboard/resources/downloads/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId, resource_url: resourceUrl }),
      })
      const data = await response.json() as { ok: boolean; task?: ResourceDownloadStatusItem }
      if (data.ok && data.task) {
        setResourceDownloadStatusByUrl((prev) => ({ ...prev, [resourceUrl]: data.task as ResourceDownloadStatusItem }))
      }
    } finally {
      setResourceDownloadAction(resourceUrl, null)
    }
  }, [baseUrl, setResourceDownloadAction])

  const handleStartNewDownload = useCallback(async (resourceUrl: string, item: DownloadableItem, preferredDirectory: string | null) => {
    const fileManager = window.fileManager
    if (!fileManager) return
    setResourceDownloadAction(resourceUrl, 'selecting')
    try {
      const selection = await fileManager.selectRootDirectory(
        preferredDirectory ? { initialPath: preferredDirectory } : undefined,
      )
      if (!selection.ok) return
      setResourceDownloadAction(resourceUrl, 'starting')
      const response = await fetch(`${baseUrl}/api/blackboard/resources/downloads/select-start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          course_id: selectedCourseId,
          resource_url: resourceUrl,
          resource_title: resolveReadableResourceName(item),
          directory_path: selection.rootPath,
        }),
      })
      const data = await response.json() as { ok: boolean; task?: ResourceDownloadStatusItem }
      if (data.ok && data.task) {
        setResourceDownloadStatusByUrl((prev) => ({ ...prev, [resourceUrl]: data.task as ResourceDownloadStatusItem }))
      }
    } finally {
      setResourceDownloadAction(resourceUrl, null)
    }
  }, [baseUrl, selectedCourseId, setResourceDownloadAction])

  const handleDownloadableItemAction = useCallback(async (
    item: DownloadableItem,
    options?: { allowCancel?: boolean },
  ) => {
    if (!selectedCourseId) return
    const resourceUrl = String(item.url ?? '').trim()
    if (!resourceUrl) return
    const status = resolveResourceDownloadUiState(item, resourceDownloadStatusByUrl[resourceUrl] ?? null)
    if (status.state === 'downloaded' && status.localPath) {
      await handleRevealDownloadedItem(resourceUrl, status.localPath)
      return
    }
    if (status.state === 'downloading') {
      if (!options?.allowCancel) return
      await handleCancelDownload(resourceUrl, status.taskId)
      return
    }
    await handleStartNewDownload(resourceUrl, item, status.preferredDirectory)
  }, [handleCancelDownload, handleRevealDownloadedItem, handleStartNewDownload, resourceDownloadStatusByUrl, selectedCourseId])

  useEffect(() => {
    const nextExpanded = new Set<string>()
    detailStateByTab.resources.items.forEach((item) => {
      if (resolveResourceVisualKind(item) !== 'folder') return
      const resourceId = String(item.resource_id ?? '').trim()
      if (resourceId) nextExpanded.add(resourceId)
    })
    setExpandedResourceIds(nextExpanded)
  }, [selectedCourseId, detailStateByTab.resources.items])

  const handleContextMenuAction = useCallback((key: DetailTab, event: React.MouseEvent, ctxTitle: string, ctxItem: DataItem) => {
    if (key !== 'announcements' && key !== 'assignments') return
    event.preventDefault()
    event.stopPropagation()
    if (key === 'announcements') {
      setDetailContextMenu({
        x: event.clientX,
        y: event.clientY,
        items: [{ label: '复制', icon: <Copy size={14} />, onClick: () => { void copyTextToClipboard(buildAnnouncementCopyText(ctxItem)) } }],
      })
      return
    }
    const assignmentItem = ctxItem as AssignmentDetailItem
    const anns = resolveAssignmentLinkedAnnouncements(assignmentItem)
    const atts = resolveAssignmentAttachments(assignmentItem)
    const ctxItems: ContextMenuItem[] = [
      { label: '复制标题', icon: <Copy size={14} />, onClick: () => { void copyTextToClipboard(ctxTitle) } },
      { label: '复制详情', icon: <Copy size={14} />, onClick: () => { void copyTextToClipboard(buildAssignmentCopyText(assignmentItem)) } },
    ]
    if (anns.length > 0) {
      ctxItems.push({ label: '复制作业公告', icon: <Copy size={14} />, onClick: () => { void copyTextToClipboard(buildLinkedAnnouncementsCopyText(anns)) } })
    }
    if (atts.some((a) => String(a.url ?? '').trim())) {
      ctxItems.push({ label: '下载所有资源', icon: <Download size={14} />, onClick: () => { void handleDownloadAllAssignmentResources(atts) } })
    }
    setDetailContextMenu({ x: event.clientX, y: event.clientY, items: ctxItems })
  }, [copyTextToClipboard, handleDownloadAllAssignmentResources])

  return (
    <div className="sustech-course-browser">
      <CourseListPane
        isEnglish={isEnglish}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        courseCountLabel={courseCountLabel}
        loadingCourses={loadingCourses}
        coursesError={coursesError}
        courses={courses}
        filteredCourses={filteredCourses}
        selectedCourseId={selectedCourseId}
        onSelectCourse={setSelectedCourseId}
      />

      <section className="sustech-course-browser__detail-pane" aria-label={isEnglish ? 'Course details' : '课程详情'}>
        <header className="sustech-course-detail__header">
          <div className="sustech-course-detail__header-main">
            <p className="sustech-course-browser__eyebrow">Blackboard</p>
            <h3 className="sustech-course-browser__title">{isEnglish ? 'Course details' : '课程详情'}</h3>
          </div>
        </header>

        {!selectedCourse ? (
          <div className="sustech-course-detail__empty">
            <BookOpen size={20} />
            <p>{isEnglish ? 'Select a course from the left list to view details.' : '从左侧课程列表选择课程以查看详情。'}</p>
          </div>
        ) : (
          <>
            <div className="sustech-course-detail__summary">
              <div className="sustech-course-detail__summary-main">
                <strong>{selectedCourseName?.title ?? selectedCourse.name}</strong>
                {selectedCourseMeta && (
                  <span className="sustech-course-detail__summary-meta">{selectedCourseMeta}</span>
                )}
              </div>
              <div className="sustech-course-detail__summary-badges">
                <span>{isEnglish ? 'Announcements' : '公告'} {selectedCourse.total_announcements ?? 0}</span>
                <span>{isEnglish ? 'Assignments' : '作业'} {selectedCourse.total_assignments ?? 0}</span>
                <span>{isEnglish ? 'Resources' : '资源'} {selectedCourse.total_resources ?? 0}</span>
                {(selectedCourse.total_grade || selectedCourse.listed_grade) && (
                  <span>{isEnglish ? 'Grade' : '总评'} {selectedCourse.total_grade ?? selectedCourse.listed_grade}</span>
                )}
              </div>
            </div>

            <div className="sustech-detail-tabs" aria-label={isEnglish ? 'Course detail sections' : '课程详情分类'}>
              {TAB_CONFIG.map(({ key, labelZh, labelEn, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  className={`sustech-detail-tab${activeTab === key ? ' sustech-detail-tab--active' : ''}`}
                  onClick={() => setActiveTab(key)}
                >
                  <Icon size={14} />
                  {isEnglish ? labelEn : labelZh}
                </button>
              ))}
            </div>

            {isAnnouncementToolbarVisible && (
              <AnnouncementScopeToolbar
                isEnglish={isEnglish}
                announcementScope={announcementScope}
                onScopeChange={setAnnouncementScope}
                isMenuOpen={isAnnouncementScopeMenuOpen}
                onMenuOpenChange={setIsAnnouncementScopeMenuOpen}
                menuRef={announcementScopeMenuRef}
                selectedLabel={selectedAnnouncementScopeLabel}
                isActive={isAnnouncementToolbarActive}
                isExiting={isAnnouncementToolbarExiting}
              />
            )}

            <div className="sustech-detail-viewport">
              {TAB_CONFIG.map(({ key }) => (
                <DetailTabPanel
                  key={key}
                  tabKey={key}
                  tabState={detailStateByTab[key]}
                  visitedDetailTabs={visitedDetailTabs}
                  visibleDetailTab={visibleDetailTab}
                  exitingDetailTab={exitingDetailTab}
                  expandedResourceIds={expandedResourceIds}
                  isEnglish={isEnglish}
                  resourceDownloadStatusByUrl={resourceDownloadStatusByUrl}
                  resourceDownloadActionByUrl={resourceDownloadActionByUrl}
                  onDownloadAction={handleDownloadableItemAction}
                  onDownloadAllAttachments={handleDownloadAllAssignmentResources}
                  onToggleExpand={(resourceId) => {
                    setExpandedResourceIds((prev) => {
                      const next = new Set(prev)
                      if (next.has(resourceId)) { next.delete(resourceId) } else { next.add(resourceId) }
                      return next
                    })
                  }}
                  onOpenSourceUrl={openSourceUrlInSystemBrowser}
                  onCopyText={copyTextToClipboard}
                  onContextMenuAction={handleContextMenuAction}
                />
              ))}
            </div>
          </>
        )}
      </section>
      {detailContextMenu !== null && (
        <ContextMenu
          x={detailContextMenu.x}
          y={detailContextMenu.y}
          items={detailContextMenu.items}
          onClose={closeDetailContextMenu}
        />
      )}
    </div>
  )
}
