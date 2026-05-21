/** @vitest-environment jsdom */

import type { FileManagerApi } from '../../../electron/file-manager/ipc'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ReactElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BlackboardDataBrowser,
  resolveAssignmentDescription,
  resolveAssignmentMarkdown,
  buildDetailRequestUrl,
  buildResourceDownloadStatusRequestUrl,
  extractDetailItemsFromResponse,
  flattenResourceHierarchy,
  flattenVisibleResourceHierarchy,
  formatDetailTimestamp,
  resolveReadableResourceName,
  resolveAssignmentAttachments,
  resolveResourceDownloadUiState,
  resolveResourceExtensionLabel,
  resolveResourceVisualKind,
  resolveAssignmentLinkedAnnouncements,
  resolveAnnouncementMarkdown,
  formatGradePercentage,
  splitCourseDisplayName,
  type AssignmentDetailItem,
  type DataItem,
} from './BlackboardDataBrowser'

// Duplicate-string constants extracted for sonarjs/no-duplicate-string
const LABEL_ANNOUNCEMENT = 'Announcement 1'
const LABEL_API_BLACKBOARD_DATA = '/api/blackboard/data/courses'
const LABEL_API_BLACKBOARD_DATA_2 = '/api/blackboard/data/courses/course-1/announcements'
const LABEL_API_BLACKBOARD_DATA_3 = '/api/blackboard/data/courses/course-1/assignments'
const LABEL_API_BLACKBOARD_DATA_4 = '/api/blackboard/data/courses/course-1/resources'
const LABEL_API_BLACKBOARD_RESOURCES = '/api/blackboard/resources/downloads/status'
const LABEL_API_BLACKBOARD_RESOURCES_2 = '/api/blackboard/resources/downloads/select-start'
const LABEL_ASSIGNMENT = 'Assignment 1'
const LABEL_BLACKBOARD_DETAIL_ITEM = 'blackboard-detail-item-assignments-asg-1'
const LABEL_BLACKBOARD_RESOURCE_DOWNLOAD = 'blackboard-resource-download-res-1'
const LABEL_CS304_SOFTWARE_ENGINEERING = 'CS304: Software Engineering'
const LABEL_DOWNLOADS = 'C:/Downloads'
const LABEL_DOWNLOADS_RES = 'C:/Downloads/res-2.pdf'
const LABEL_HTTPS_EXAMPLE = 'https://bb.example/res-1.pdf'
const LABEL_HTTPS_EXAMPLE_2 = 'https://bb.example/starter.zip'
const LABEL_HTTPS_EXAMPLE_3 = 'https://bb.example/spec.pdf'
const LABEL_HTTPS_EXAMPLE_4 = 'https://bb.example/res-2.pdf'
const LABEL_HTTPS_EXAMPLE_5 = 'https://bb.example/ann-1'
const LABEL_HTTP_LOCALHOST = 'http://localhost'
const LABEL_LECTURE_SLIDES = 'Lecture 1 slides.pdf'
const LABEL_PREFERRED = 'C:/Preferred'
const LABEL_RES_STARTER = 'res-starter'
const LABEL_SPRING_2026 = 'Spring 2026'
const LABEL_STARTER_ZIP = 'starter.zip'
const SELECTOR_FILE_CONTEXT_MENU = '.file-context-menu__item'
const SELECTOR_SUSTECH_DETAIL_TAB = '.sustech-detail-tab'


// Shared test fixture helpers
function jsonResponse(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), init)
}

function singleCourseFixture(overrides: Partial<{
  totalAssignments: number
  totalResources: number
  totalAnnouncements: number
}> = {}): unknown {
  return {
    ok: true,
    courses: [{
      id: 1,
      course_id: 'course-1',
      name: LABEL_CS304_SOFTWARE_ENGINEERING,
      code: 'CS304',
      instructor: 'Ada',
      term: LABEL_SPRING_2026,
      is_active: true,
      total_assignments: overrides.totalAssignments ?? 0,
      total_resources: overrides.totalResources ?? 0,
      total_announcements: overrides.totalAnnouncements ?? 0,
    }],
  }
}

interface RenderedBrowser {
  container: HTMLDivElement
  getByTestId: (testId: string) => HTMLElement
  unmount: () => void
}

function renderWithRoot(element: ReactElement): RenderedBrowser {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  act(() => {
    root.render(element)
  })

  return {
    container,
    getByTestId(testId: string) {
      const target = container.querySelector(`[data-testid="${testId}"]`)
      if (!(target instanceof HTMLElement)) {
        throw new Error(`Missing element for data-testid=${testId}`)
      }
      return target
    },
    unmount() {
      act(() => {
        root.unmount()
      })
      container.remove()
    },
  }
}

async function clickElement(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

async function doubleClickElement(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  })
}

async function openContextMenu(element: Element, clientX = 120, clientY = 120) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX, clientY }))
  })
}

async function waitForNextFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve())
    })
  })
}

async function waitForCondition(check: () => boolean, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) {
      return
    }
    await waitForNextFrame()
    await act(async () => {
      await Promise.resolve()
    })
  }
  throw new Error('Condition was not met within timeout.')
}

function makeMockFileManager(): FileManagerApi {
  return {
    selectRootDirectory: vi.fn(async () => ({ ok: true as const, rootPath: 'C:/Chosen', entries: [] })),
    listDirectory: vi.fn(async () => ({ ok: true as const, entries: [] })),
    probeDirectory: vi.fn(async () => ({ ok: true as const, totalItems: 0, isLarge: false, maxDepth: 0 })),
    createDirectory: vi.fn(async () => ({ ok: true as const, affectedPaths: [] as never[] })),
    copyEntries: vi.fn(async () => ({ ok: true as const, affectedPaths: [] as never[] })),
    moveEntries: vi.fn(async () => ({ ok: true as const, affectedPaths: [] as never[] })),
    renameEntry: vi.fn(async () => ({ ok: true as const, affectedPaths: [] as never[] })),
    trashEntries: vi.fn(async () => ({ ok: true as const, affectedPaths: [] as never[] })),
    deleteEntriesPermanently: vi.fn(async () => ({ ok: true as const, affectedPaths: [] as never[] })),
    watchDirectories: vi.fn(async () => ({ ok: true as const, affectedPaths: [] as never[] })),
    unwatchDirectories: vi.fn(async () => ({ ok: true as const, affectedPaths: [] as never[] })),
    onDirectoryChanged: vi.fn(() => () => undefined),
    loadLastRootDirectory: vi.fn(async () => ({ ok: true as const, rootPath: null })),
    saveLastRootDirectory: vi.fn(async () => ({ ok: true as const, affectedPaths: [] as never[] })),
    clearLastRootDirectory: vi.fn(async () => ({ ok: true as const, affectedPaths: [] as never[] })),
    openEntryWithSystem: vi.fn(async () => ({ ok: true as const, affectedPaths: [] as never[] })),
    revealEntryInFolder: vi.fn(async () => ({ ok: true as const, affectedPaths: [] as never[] })),
    copyTextToClipboard: vi.fn(async () => ({ ok: true as const, affectedPaths: [] as never[] })),
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  delete (window as unknown as Record<string, unknown>).fileManager
})

// eslint-disable-next-line max-lines-per-function
describe('BlackboardDataBrowser', () => {
  describe('assignment rendering', () => {
    it('renders assignment descriptions from backend assignment description fields', async () => {
      const fetchMock = vi.fn<(input: string | URL) => Promise<Response>>()
      fetchMock.mockImplementation(async (input) => {
        const url = String(input)
        if (url.endsWith(LABEL_API_BLACKBOARD_DATA)) {
          return new Response(JSON.stringify({
            ok: true,
            courses: [{
              id: 1,
              course_id: 'course-1',
              name: LABEL_CS304_SOFTWARE_ENGINEERING,
              code: 'CS304',
              instructor: 'Ada',
              term: LABEL_SPRING_2026,
              is_active: true,
              total_assignments: 2,
              total_resources: 0,
              total_announcements: 0,
            }],
          }))
        }
        if (url.includes(LABEL_API_BLACKBOARD_DATA_2)) {
          return new Response(JSON.stringify({ ok: true, announcements: [] }))
        }
        if (url.includes(LABEL_API_BLACKBOARD_DATA_3)) {
          return new Response(JSON.stringify({
            ok: true,
            assignments: [
              {
                id: 1,
                assignment_id: 'asg-plain',
                title: 'Assignment Plain',
                description: 'Plain assignment description that should stay complete without truncation.',
                attachments_json: '[]',
              },
              {
                id: 2,
                assignment_id: 'asg-html',
                title: 'Assignment Html',
                description: null,
                description_html: '<div><strong>Remember</strong> to submit.</div><ul><li>Keep the appendix</li></ul>',
                attachments_json: '[]',
              },
            ],
          }))
        }
        throw new Error(`Unhandled fetch URL: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const rendered = renderWithRoot(
        <BlackboardDataBrowser language="zh-CN" baseUrl={LABEL_HTTP_LOCALHOST} />,
      )

      try {
        await waitForNextFrame()
        await waitForNextFrame()
        const assignmentsTab = Array.from(rendered.container.querySelectorAll<HTMLButtonElement>(SELECTOR_SUSTECH_DETAIL_TAB)).find((button) => {
          return button.textContent?.includes('作业')
        })
        expect(assignmentsTab).toBeTruthy()
        await clickElement(assignmentsTab as HTMLButtonElement)
        await waitForCondition(() => rendered.container.textContent?.includes('Assignment Plain') === true)

        expect(rendered.container.textContent).toContain('Plain assignment description that should stay complete without truncation.')
        expect(rendered.container.textContent).toContain('Remember to submit.')
        expect(rendered.container.textContent).toContain('Keep the appendix')
      } finally {
        rendered.unmount()
      }
    })
  })

  describe('assignment attachment interactions', () => {
    it('provides synchronized download buttons and double-click actions for assignment attachments', async () => {
      const fetchMock = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>()
      fetchMock.mockImplementation(async (input, init) => {
        const url = String(input)
        if (url.endsWith(LABEL_API_BLACKBOARD_DATA)) {
          return jsonResponse(singleCourseFixture({ totalAssignments: 1 }))
        }
        if (url.includes(LABEL_API_BLACKBOARD_DATA_2)) {
          return jsonResponse({ ok: true, announcements: [] })
        }
        if (url.includes(LABEL_API_BLACKBOARD_DATA_3)) {
          return jsonResponse({ ok: true, assignments: [{ id: 1, assignment_id: 'assign-1', title: LABEL_ASSIGNMENT, attachments_json: JSON.stringify([{ title: 'spec.pdf', url: LABEL_HTTPS_EXAMPLE_3, type: 'pdf', size: '1.2 MB', resource_id: 'res-spec' }, { title: LABEL_STARTER_ZIP, url: LABEL_HTTPS_EXAMPLE_2, type: 'zip', size: '5 MB', resource_id: LABEL_RES_STARTER }]) }] })
        }
        if (url.includes(LABEL_API_BLACKBOARD_RESOURCES)) {
          expect(url).toContain(encodeURIComponent(LABEL_HTTPS_EXAMPLE_3))
          expect(url).toContain(encodeURIComponent(LABEL_HTTPS_EXAMPLE_2))
          return jsonResponse({ ok: true, statuses: [{ course_id: 'course-1', resource_url: LABEL_HTTPS_EXAMPLE_3, resource_id: 'res-spec', state: 'downloaded', local_path: 'C:/Downloads/spec.pdf' }, { course_id: 'course-1', resource_url: LABEL_HTTPS_EXAMPLE_2, resource_id: LABEL_RES_STARTER, state: 'idle', preferred_directory: LABEL_PREFERRED }] })
        }
        if (url.endsWith(LABEL_API_BLACKBOARD_RESOURCES_2)) {
          const payload = JSON.parse(String(init?.body ?? '{}'))
          expect(payload).toMatchObject({ course_id: 'course-1', resource_url: LABEL_HTTPS_EXAMPLE_2, resource_title: LABEL_STARTER_ZIP, directory_path: 'C:/Chosen' })
          return jsonResponse({ ok: true, task: { task_id: 'task-2', course_id: 'course-1', resource_url: LABEL_HTTPS_EXAMPLE_2, resource_id: LABEL_RES_STARTER, state: 'downloading', progress_percent: 0, preferred_directory: 'C:/Chosen' } })
        }
        throw new Error(`Unhandled fetch URL: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const fileManager = makeMockFileManager()
      fileManager.revealEntryInFolder = vi.fn(async () => ({ ok: true as const, affectedPaths: ['C:/Downloads/spec.pdf'] }))
      ;(window as typeof window & { fileManager?: FileManagerApi }).fileManager = fileManager

      const rendered = renderWithRoot(
        <BlackboardDataBrowser language="zh-CN" baseUrl={LABEL_HTTP_LOCALHOST} />,
      )

      try {
        await waitForNextFrame()
        await waitForNextFrame()
        const assignmentsTab = Array.from(rendered.container.querySelectorAll<HTMLButtonElement>(SELECTOR_SUSTECH_DETAIL_TAB)).find((button) => {
          return button.textContent?.includes('作业')
        })
        expect(assignmentsTab).toBeTruthy()
        await clickElement(assignmentsTab as HTMLElement)
        await waitForCondition(() => rendered.container.querySelector('[data-testid="blackboard-assignment-attachment-download-res-spec"]') instanceof HTMLElement)

        const revealButton = rendered.getByTestId('blackboard-assignment-attachment-download-res-spec') as HTMLButtonElement
        expect(revealButton.title).toBe('在文件夹中显示')
        await doubleClickElement(rendered.getByTestId('blackboard-assignment-attachment-row-res-spec'))
        expect(fileManager.revealEntryInFolder).toHaveBeenCalledWith({ path: 'C:/Downloads/spec.pdf' })

        const starterButton = rendered.getByTestId('blackboard-assignment-attachment-download-res-starter') as HTMLButtonElement
        expect(starterButton.title).toBe('下载')
        await clickElement(starterButton)
        await waitForCondition(() => {
          const currentButton = rendered.getByTestId('blackboard-assignment-attachment-download-res-starter') as HTMLButtonElement
          return currentButton.title === '取消下载'
        })
        expect(fileManager.selectRootDirectory).toHaveBeenCalledWith({ initialPath: LABEL_PREFERRED })
      } finally {
        rendered.unmount()
      }
    })
  })

  describe('detail item double-click', () => {
    it('opens announcement and assignment source urls in the system browser on double click', async () => {
      const fetchMock = vi.fn<(input: string | URL) => Promise<Response>>()
      fetchMock.mockImplementation(async (input) => {
        const url = String(input)
        if (url.endsWith(LABEL_API_BLACKBOARD_DATA)) {
          return new Response(JSON.stringify({
            ok: true,
            courses: [{
              id: 1,
              course_id: 'course-1',
              name: LABEL_CS304_SOFTWARE_ENGINEERING,
              code: 'CS304',
              instructor: 'Ada',
              term: LABEL_SPRING_2026,
              is_active: true,
              total_assignments: 1,
              total_resources: 0,
              total_announcements: 1,
            }],
          }))
        }
        if (url.includes(LABEL_API_BLACKBOARD_DATA_2)) {
          return new Response(JSON.stringify({
            ok: true,
            announcements: [{
              id: 1,
              announcement_id: 'ann-1',
              title: LABEL_ANNOUNCEMENT,
              author: 'Ada',
              body_markdown: 'Announcement body',
              url: LABEL_HTTPS_EXAMPLE_5,
            }],
          }))
        }
        if (url.includes(LABEL_API_BLACKBOARD_DATA_3)) {
          return new Response(JSON.stringify({
            ok: true,
            assignments: [{
              id: 2,
              assignment_id: 'asg-1',
              title: LABEL_ASSIGNMENT,
              url: 'https://bb.example/asg-1',
              description: 'Assignment body',
              attachments_json: '[]',
            }],
          }))
        }
        throw new Error(`Unhandled fetch URL: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const fileManager = makeMockFileManager()
      ;(window as typeof window & { fileManager?: FileManagerApi }).fileManager = fileManager

      const rendered = renderWithRoot(
        <BlackboardDataBrowser language="zh-CN" baseUrl={LABEL_HTTP_LOCALHOST} />,
      )

      try {
        await waitForCondition(() => rendered.container.textContent?.includes(LABEL_ANNOUNCEMENT) === true)
        await doubleClickElement(rendered.getByTestId('blackboard-detail-item-announcements-1'))
        expect(fileManager.openEntryWithSystem).toHaveBeenCalledWith({ path: LABEL_HTTPS_EXAMPLE_5 })

        const assignmentsTab = Array.from(rendered.container.querySelectorAll<HTMLButtonElement>(SELECTOR_SUSTECH_DETAIL_TAB)).find((button) => {
          return button.textContent?.includes('作业')
        })
        expect(assignmentsTab).toBeTruthy()
        await clickElement(assignmentsTab as HTMLButtonElement)
        await waitForCondition(() => rendered.container.textContent?.includes(LABEL_ASSIGNMENT) === true)

        await doubleClickElement(rendered.getByTestId(LABEL_BLACKBOARD_DETAIL_ITEM))
        expect(fileManager.openEntryWithSystem).toHaveBeenCalledWith({ path: 'https://bb.example/asg-1' })
      } finally {
        rendered.unmount()
      }
    })
  })

  // eslint-disable-next-line max-lines-per-function
  describe('context menus', () => {
    it('shows announcement and assignment context menus with requested actions', async () => {
      const downloadStartPayloads: Array<Record<string, unknown>> = []
      const fetchMock = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>()
      fetchMock.mockImplementation(async (input, init) => {
        const url = String(input)
        if (url.endsWith(LABEL_API_BLACKBOARD_DATA)) {
          return new Response(JSON.stringify({
            ok: true,
            courses: [{
              id: 1,
              course_id: 'course-1',
              name: LABEL_CS304_SOFTWARE_ENGINEERING,
              code: 'CS304',
              instructor: 'Ada',
              term: LABEL_SPRING_2026,
              is_active: true,
              total_assignments: 1,
              total_resources: 0,
              total_announcements: 1,
            }],
          }))
        }
        if (url.includes(LABEL_API_BLACKBOARD_DATA_2)) {
          return new Response(JSON.stringify({
            ok: true,
            announcements: [{
              id: 1,
              announcement_id: 'ann-1',
              title: LABEL_ANNOUNCEMENT,
              author: 'Ada',
              body_markdown: 'Announcement body',
              url: LABEL_HTTPS_EXAMPLE_5,
            }],
          }))
        }
        if (url.includes(LABEL_API_BLACKBOARD_DATA_3)) {
          return new Response(JSON.stringify({
            ok: true,
            assignments: [{
              id: 2,
              assignment_id: 'asg-1',
              title: LABEL_ASSIGNMENT,
              url: 'https://bb.example/asg-1',
              description_html: '<p>Assignment body</p><ul><li>Detail A</li></ul>',
              linked_announcements: [{
                announcement_id: 'ann-linked-1',
                title: 'Homework 1 notice',
                content_markdown: 'Linked announcement body',
                publish_time: '2026-04-02T10:00:00Z',
              }],
              attachments_json: JSON.stringify([
                { title: 'spec.pdf', url: LABEL_HTTPS_EXAMPLE_3, type: 'pdf', resource_id: 'res-spec' },
                { title: LABEL_STARTER_ZIP, url: LABEL_HTTPS_EXAMPLE_2, type: 'zip', resource_id: LABEL_RES_STARTER },
              ]),
            }],
          }))
        }
        if (url.includes(LABEL_API_BLACKBOARD_RESOURCES)) {
          return new Response(JSON.stringify({ ok: true, statuses: [] }))
        }
        if (url.endsWith(LABEL_API_BLACKBOARD_RESOURCES_2)) {
          const payload = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
          downloadStartPayloads.push(payload)
          return new Response(JSON.stringify({
            ok: true,
            task: {
              task_id: `task-${downloadStartPayloads.length}`,
              course_id: 'course-1',
              resource_url: payload.resource_url,
              state: 'downloading',
              progress_percent: 0,
            },
          }))
        }
        throw new Error(`Unhandled fetch URL: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const fileManager = makeMockFileManager()
      ;(window as typeof window & { fileManager?: FileManagerApi }).fileManager = fileManager

      const rendered = renderWithRoot(
        <BlackboardDataBrowser language="zh-CN" baseUrl={LABEL_HTTP_LOCALHOST} />,
      )

      try {
        await waitForCondition(() => rendered.container.textContent?.includes(LABEL_ANNOUNCEMENT) === true)

        await openContextMenu(rendered.getByTestId('blackboard-detail-item-announcements-1'))
        const announcementMenuLabels = Array.from(document.querySelectorAll(SELECTOR_FILE_CONTEXT_MENU)).map((item) => item.textContent?.trim() ?? '')
        expect(announcementMenuLabels).toEqual(['复制'])
        await clickElement(Array.from(document.querySelectorAll<HTMLButtonElement>(SELECTOR_FILE_CONTEXT_MENU)).find((item) => item.textContent?.trim() === '复制') as HTMLButtonElement)
        expect(fileManager.copyTextToClipboard).toHaveBeenCalledWith({ text: 'Announcement 1\n\nAnnouncement body' })

        const assignmentsTab = Array.from(rendered.container.querySelectorAll<HTMLButtonElement>(SELECTOR_SUSTECH_DETAIL_TAB)).find((button) => {
          return button.textContent?.includes('作业')
        })
        expect(assignmentsTab).toBeTruthy()
        await clickElement(assignmentsTab as HTMLButtonElement)
        await waitForCondition(() => rendered.container.textContent?.includes(LABEL_ASSIGNMENT) === true)

        await openContextMenu(rendered.getByTestId(LABEL_BLACKBOARD_DETAIL_ITEM))
        const assignmentMenuLabels = Array.from(document.querySelectorAll(SELECTOR_FILE_CONTEXT_MENU)).map((item) => item.textContent?.trim() ?? '')
        expect(assignmentMenuLabels).toEqual(['复制标题', '复制详情', '复制作业公告', '下载所有资源'])

        await clickElement(Array.from(document.querySelectorAll<HTMLButtonElement>(SELECTOR_FILE_CONTEXT_MENU)).find((item) => item.textContent?.trim() === '复制标题') as HTMLButtonElement)
        expect(fileManager.copyTextToClipboard).toHaveBeenCalledWith({ text: LABEL_ASSIGNMENT })

        await openContextMenu(rendered.getByTestId(LABEL_BLACKBOARD_DETAIL_ITEM))
        await clickElement(Array.from(document.querySelectorAll<HTMLButtonElement>(SELECTOR_FILE_CONTEXT_MENU)).find((item) => item.textContent?.trim() === '复制详情') as HTMLButtonElement)
        expect(fileManager.copyTextToClipboard).toHaveBeenCalledWith({ text: 'Assignment 1\n\nAssignment body\n\n- Detail A' })

        await openContextMenu(rendered.getByTestId(LABEL_BLACKBOARD_DETAIL_ITEM))
        await clickElement(Array.from(document.querySelectorAll<HTMLButtonElement>(SELECTOR_FILE_CONTEXT_MENU)).find((item) => item.textContent?.trim() === '复制作业公告') as HTMLButtonElement)
        expect(fileManager.copyTextToClipboard).toHaveBeenCalledWith({ text: 'Homework 1 notice\n\nLinked announcement body' })

        await openContextMenu(rendered.getByTestId(LABEL_BLACKBOARD_DETAIL_ITEM))
        await clickElement(Array.from(document.querySelectorAll<HTMLButtonElement>(SELECTOR_FILE_CONTEXT_MENU)).find((item) => item.textContent?.trim() === '下载所有资源') as HTMLButtonElement)

        expect(fileManager.selectRootDirectory).toHaveBeenCalledOnce()
        expect(downloadStartPayloads).toHaveLength(2)
        expect(downloadStartPayloads.map((payload) => payload.resource_url)).toEqual([
          LABEL_HTTPS_EXAMPLE_3,
          LABEL_HTTPS_EXAMPLE_2,
        ])
      } finally {
        rendered.unmount()
      }
    })

    it('renders detail context menus in document.body so viewport coordinates do not drift under transformed ancestors', async () => {
      const fetchMock = vi.fn<(input: string | URL) => Promise<Response>>()
      fetchMock.mockImplementation(async (input) => {
        const url = String(input)
        if (url.endsWith(LABEL_API_BLACKBOARD_DATA)) {
          return new Response(JSON.stringify({
            ok: true,
            courses: [{
              id: 1,
              course_id: 'course-1',
              name: LABEL_CS304_SOFTWARE_ENGINEERING,
              code: 'CS304',
              instructor: 'Ada',
              term: LABEL_SPRING_2026,
              is_active: true,
              total_assignments: 0,
              total_resources: 0,
              total_announcements: 1,
            }],
          }))
        }
        if (url.includes(LABEL_API_BLACKBOARD_DATA_2)) {
          return new Response(JSON.stringify({
            ok: true,
            announcements: [{
              id: 1,
              announcement_id: 'ann-1',
              title: LABEL_ANNOUNCEMENT,
              author: 'Ada',
              body_markdown: 'Announcement body',
              url: LABEL_HTTPS_EXAMPLE_5,
            }],
          }))
        }
        if (url.includes(LABEL_API_BLACKBOARD_DATA_3)) {
          return new Response(JSON.stringify({ ok: true, assignments: [] }))
        }
        throw new Error(`Unhandled fetch URL: ${url}`)
      })
      vi.stubGlobal('fetch', fetchMock)

      const rendered = renderWithRoot(
        <div style={{ transform: 'translateY(40px)' }}>
          <BlackboardDataBrowser language="zh-CN" baseUrl={LABEL_HTTP_LOCALHOST} />
        </div>,
      )

      try {
        await waitForCondition(() => rendered.container.textContent?.includes(LABEL_ANNOUNCEMENT) === true)
        await openContextMenu(rendered.getByTestId('blackboard-detail-item-announcements-1'), 240, 180)

        const menu = document.body.querySelector('.file-context-menu')
        expect(menu).toBeTruthy()
        expect(rendered.container.contains(menu as Node)).toBe(false)
      } finally {
        rendered.unmount()
      }
    })
  })
})
