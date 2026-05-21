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
  // eslint-disable-next-line max-lines-per-function
  describe('resource interactions', () => {

    // eslint-disable-next-line max-lines-per-function
    describe('download lifecycle', () => {
      it('starts a resource download after selecting a directory and switches the row action into cancel mode', async () => {
        let currentStatusState: 'idle' | 'downloading' = 'idle'
        const fetchMock = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>()
        fetchMock.mockImplementation(async (input, init) => {
          const url = String(input)
          if (url.endsWith(LABEL_API_BLACKBOARD_DATA)) {
            return jsonResponse(singleCourseFixture({ totalResources: 1 }))
          }
          if (url.includes(LABEL_API_BLACKBOARD_DATA_2)) {
            return jsonResponse({ ok: true, announcements: [] })
          }
          if (url.includes(LABEL_API_BLACKBOARD_DATA_4)) {
            return jsonResponse({
              ok: true,
              resources: [{ id: 1, resource_id: 'res-1', title: LABEL_LECTURE_SLIDES, type: 'pdf', size: '1 MB', url: LABEL_HTTPS_EXAMPLE, local_path: null, is_downloaded: false, download_failed: false, parent_id: null }],
            })
          }
          if (url.includes(LABEL_API_BLACKBOARD_RESOURCES)) {
            return jsonResponse({ ok: true, statuses: [{ course_id: 'course-1', resource_url: LABEL_HTTPS_EXAMPLE, resource_id: 'res-1', state: currentStatusState, preferred_directory: LABEL_PREFERRED }] })
          }
          if (url.endsWith(LABEL_API_BLACKBOARD_RESOURCES_2)) {
            const payload = JSON.parse(String(init?.body ?? '{}'))
            expect(payload).toMatchObject({ course_id: 'course-1', resource_url: LABEL_HTTPS_EXAMPLE, directory_path: 'C:/Chosen' })
            currentStatusState = 'downloading'
            return jsonResponse({ ok: true, task: { task_id: 'task-1', course_id: 'course-1', resource_url: LABEL_HTTPS_EXAMPLE, resource_id: 'res-1', state: 'downloading', progress_percent: 0, preferred_directory: 'C:/Chosen' } })
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
          await waitForNextFrame()
          await waitForNextFrame()
          const resourcesTab = Array.from(rendered.container.querySelectorAll<HTMLButtonElement>(SELECTOR_SUSTECH_DETAIL_TAB)).find((button) => {
            return button.textContent?.includes('资源')
          })
          expect(resourcesTab).toBeTruthy()
          await clickElement(resourcesTab as HTMLElement)
          await waitForCondition(() => rendered.container.querySelector(`[data-testid="${LABEL_BLACKBOARD_RESOURCE_DOWNLOAD}"]`) instanceof HTMLElement)

          const downloadButton = rendered.getByTestId(LABEL_BLACKBOARD_RESOURCE_DOWNLOAD) as HTMLButtonElement
          await clickElement(downloadButton)
          await waitForCondition(() => {
            const currentButton = rendered.getByTestId(LABEL_BLACKBOARD_RESOURCE_DOWNLOAD) as HTMLButtonElement
            return currentButton.title === '取消下载'
          })

          expect(fileManager.selectRootDirectory).toHaveBeenCalledWith({ initialPath: LABEL_PREFERRED })
          expect((rendered.getByTestId(LABEL_BLACKBOARD_RESOURCE_DOWNLOAD) as HTMLButtonElement).title).toBe('取消下载')
        } finally {
          rendered.unmount()
        }
      })

      it('renders a progress overlay for downloading resources and reveals downloaded files via fileManager', async () => {
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
                total_resources: 2,
                total_announcements: 0,
              }],
            }))
          }
          if (url.includes(LABEL_API_BLACKBOARD_DATA_2)) {
            return new Response(JSON.stringify({ ok: true, announcements: [] }))
          }
          if (url.includes(LABEL_API_BLACKBOARD_DATA_4)) {
            return new Response(JSON.stringify({
              ok: true,
              resources: [
                {
                  id: 1,
                  resource_id: 'res-1',
                  title: LABEL_LECTURE_SLIDES,
                  type: 'pdf',
                  size: '1 MB',
                  url: LABEL_HTTPS_EXAMPLE,
                  local_path: null,
                  is_downloaded: false,
                  download_failed: false,
                  parent_id: null,
                },
                {
                  id: 2,
                  resource_id: 'res-2',
                  title: 'Lecture 2 slides.pdf',
                  type: 'pdf',
                  size: '2 MB',
                  url: LABEL_HTTPS_EXAMPLE_4,
                  local_path: LABEL_DOWNLOADS_RES,
                  is_downloaded: true,
                  download_failed: false,
                  parent_id: null,
                },
              ],
            }))
          }
          if (url.includes(LABEL_API_BLACKBOARD_RESOURCES)) {
            return new Response(JSON.stringify({
              ok: true,
              statuses: [
                {
                  task_id: 'task-1',
                  course_id: 'course-1',
                  resource_url: LABEL_HTTPS_EXAMPLE,
                  resource_id: 'res-1',
                  state: 'downloading',
                  progress_percent: 42.5,
                },
                {
                  course_id: 'course-1',
                  resource_url: LABEL_HTTPS_EXAMPLE_4,
                  resource_id: 'res-2',
                  state: 'downloaded',
                  local_path: LABEL_DOWNLOADS_RES,
                },
              ],
            }))
          }
          throw new Error(`Unhandled fetch URL: ${url}`)
        })
        vi.stubGlobal('fetch', fetchMock)

        const fileManager = makeMockFileManager()
        fileManager.revealEntryInFolder = vi.fn(async () => ({ ok: true as const, affectedPaths: [LABEL_DOWNLOADS_RES] }))
        ;(window as typeof window & { fileManager?: FileManagerApi }).fileManager = fileManager

        const rendered = renderWithRoot(
          <BlackboardDataBrowser language="zh-CN" baseUrl={LABEL_HTTP_LOCALHOST} />,
        )

        try {
          await waitForNextFrame()
          await waitForNextFrame()
          const resourcesTab = Array.from(rendered.container.querySelectorAll<HTMLButtonElement>(SELECTOR_SUSTECH_DETAIL_TAB)).find((button) => {
            return button.textContent?.includes('资源')
          })
          expect(resourcesTab).toBeTruthy()
          await clickElement(resourcesTab as HTMLElement)
          await waitForCondition(() => rendered.container.querySelector('[data-testid="blackboard-resource-progress-res-1"]') instanceof HTMLElement)

          const progress = rendered.getByTestId('blackboard-resource-progress-res-1') as HTMLElement
          expect(progress.getAttribute('style')).toContain('42.5%')

          const revealButton = rendered.getByTestId('blackboard-resource-download-res-2') as HTMLButtonElement
          expect(revealButton.title).toBe('在文件夹中显示')
          await clickElement(revealButton)
          expect(fileManager.revealEntryInFolder).toHaveBeenCalledWith({ path: LABEL_DOWNLOADS_RES })
        } finally {
          rendered.unmount()
        }
      })

      it('downloads idle resources and reveals downloaded resources on row double click', async () => {
        const fetchMock = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>()
        fetchMock.mockImplementation(async (input, init) => {
          const url = String(input)
          if (url.endsWith(LABEL_API_BLACKBOARD_DATA)) {
            return jsonResponse(singleCourseFixture({ totalResources: 2 }))
          }
          if (url.includes(LABEL_API_BLACKBOARD_DATA_2)) {
            return jsonResponse({ ok: true, announcements: [] })
          }
          if (url.includes(LABEL_API_BLACKBOARD_DATA_4)) {
            return jsonResponse({
              ok: true,
              resources: [{ id: 1, resource_id: 'res-1', title: LABEL_LECTURE_SLIDES, type: 'pdf', size: '1 MB', url: LABEL_HTTPS_EXAMPLE, local_path: null, is_downloaded: false, download_failed: false, parent_id: null }, { id: 2, resource_id: 'res-2', title: 'Lecture 2 slides.pdf', type: 'pdf', size: '2 MB', url: LABEL_HTTPS_EXAMPLE_4, local_path: LABEL_DOWNLOADS_RES, is_downloaded: true, download_failed: false, parent_id: null }],
            })
          }
          if (url.includes(LABEL_API_BLACKBOARD_RESOURCES)) {
            return jsonResponse({ ok: true, statuses: [{ course_id: 'course-1', resource_url: LABEL_HTTPS_EXAMPLE, resource_id: 'res-1', state: 'idle', preferred_directory: LABEL_PREFERRED }, { course_id: 'course-1', resource_url: LABEL_HTTPS_EXAMPLE_4, resource_id: 'res-2', state: 'downloaded', local_path: LABEL_DOWNLOADS_RES }] })
          }
          if (url.endsWith(LABEL_API_BLACKBOARD_RESOURCES_2)) {
            const payload = JSON.parse(String(init?.body ?? '{}'))
            expect(payload).toMatchObject({ course_id: 'course-1', resource_url: LABEL_HTTPS_EXAMPLE, resource_title: LABEL_LECTURE_SLIDES, directory_path: 'C:/Chosen' })
            return jsonResponse({ ok: true, task: { task_id: 'task-1', course_id: 'course-1', resource_url: LABEL_HTTPS_EXAMPLE, resource_id: 'res-1', state: 'downloading', progress_percent: 0, preferred_directory: 'C:/Chosen' } })
          }
          throw new Error(`Unhandled fetch URL: ${url}`)
        })
        vi.stubGlobal('fetch', fetchMock)

        const fileManager = makeMockFileManager()
        fileManager.revealEntryInFolder = vi.fn(async () => ({ ok: true as const, affectedPaths: [LABEL_DOWNLOADS_RES] }))
        ;(window as typeof window & { fileManager?: FileManagerApi }).fileManager = fileManager

        const rendered = renderWithRoot(
          <BlackboardDataBrowser language="zh-CN" baseUrl={LABEL_HTTP_LOCALHOST} />,
        )

        try {
          await waitForNextFrame()
          await waitForNextFrame()
          const resourcesTab = Array.from(rendered.container.querySelectorAll<HTMLButtonElement>(SELECTOR_SUSTECH_DETAIL_TAB)).find((button) => {
            return button.textContent?.includes('资源')
          })
          expect(resourcesTab).toBeTruthy()
          await clickElement(resourcesTab as HTMLElement)
          await waitForCondition(() => rendered.container.querySelector('[data-testid="blackboard-resource-row-res-1"]') instanceof HTMLElement)

          await doubleClickElement(rendered.getByTestId('blackboard-resource-row-res-1'))
          await waitForCondition(() => {
            const currentButton = rendered.getByTestId(LABEL_BLACKBOARD_RESOURCE_DOWNLOAD) as HTMLButtonElement
            return currentButton.title === '取消下载'
          })
          expect(fileManager.selectRootDirectory).toHaveBeenCalledWith({ initialPath: LABEL_PREFERRED })

          await doubleClickElement(rendered.getByTestId('blackboard-resource-row-res-2'))
          expect(fileManager.revealEntryInFolder).toHaveBeenCalledWith({ path: LABEL_DOWNLOADS_RES })
        } finally {
          rendered.unmount()
        }
      })
    })

    describe('status polling', () => {
      it('removes the downloaded label after status polling reports an idle resource with no local path', async () => {
        let statusCallCount = 0
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
                total_resources: 1,
                total_announcements: 0,
              }],
            }))
          }
          if (url.includes(LABEL_API_BLACKBOARD_DATA_2)) {
            return new Response(JSON.stringify({ ok: true, announcements: [] }))
          }
          if (url.includes(LABEL_API_BLACKBOARD_DATA_4)) {
            return new Response(JSON.stringify({
              ok: true,
              resources: [{
                id: 1,
                resource_id: 'res-1',
                title: LABEL_LECTURE_SLIDES,
                type: 'pdf',
                size: '1 MB',
                url: LABEL_HTTPS_EXAMPLE,
                local_path: 'C:/Downloads/res-1.pdf',
                is_downloaded: true,
                download_failed: false,
                parent_id: null,
              }],
            }))
          }
          if (url.includes(LABEL_API_BLACKBOARD_RESOURCES)) {
            statusCallCount += 1
            return new Response(JSON.stringify({
              ok: true,
              statuses: [{
                course_id: 'course-1',
                resource_url: LABEL_HTTPS_EXAMPLE,
                resource_id: 'res-1',
                state: statusCallCount >= 2 ? 'idle' : 'downloaded',
                local_path: statusCallCount >= 2 ? null : 'C:/Downloads/res-1.pdf',
              }],
            }))
          }
          throw new Error(`Unhandled fetch URL: ${url}`)
        })
        vi.stubGlobal('fetch', fetchMock)

        const fileManager: FileManagerApi = {
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
        ;(window as typeof window & { fileManager?: FileManagerApi }).fileManager = fileManager

        const rendered = renderWithRoot(
          <BlackboardDataBrowser language="zh-CN" baseUrl={LABEL_HTTP_LOCALHOST} />,
        )

        try {
          await waitForNextFrame()
          await waitForNextFrame()
          const resourcesTab = Array.from(rendered.container.querySelectorAll<HTMLButtonElement>(SELECTOR_SUSTECH_DETAIL_TAB)).find((button) => {
            return button.textContent?.includes('资源')
          })
          expect(resourcesTab).toBeTruthy()
          await clickElement(resourcesTab as HTMLElement)
          await waitForCondition(() => rendered.container.textContent?.includes('已下载') ?? false)

          await waitForCondition(
            () => statusCallCount >= 2 && !(rendered.container.textContent?.includes('已下载') ?? false),
            2500,
          )
        } finally {
          rendered.unmount()
        }
      })
    })
  })
})
