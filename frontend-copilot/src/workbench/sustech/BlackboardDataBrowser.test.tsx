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

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  delete (window as typeof window & { fileManager?: FileManagerApi }).fileManager
})

describe('BlackboardDataBrowser', () => {
  it('renders split browser shell without redundant data browser frame', () => {
    const html = renderToStaticMarkup(
      <BlackboardDataBrowser language="zh-CN" baseUrl="http://localhost" />,
    )
    expect(html).toContain('课程列表')
    expect(html).toContain('课程详情')
    expect(html).toContain('搜索编号、课程名、授课老师')
    expect(html).not.toContain('数据浏览')
  })

  it('renders split browser labels in English', () => {
    const html = renderToStaticMarkup(
      <BlackboardDataBrowser language="en-US" baseUrl="http://localhost" />,
    )
    expect(html).toContain('Courses')
    expect(html).toContain('Course details')
    expect(html).toContain('Search by code, course, teacher')
    expect(html).not.toContain('Data Browser')
  })

  it('splits Blackboard course code from full display title', () => {
    expect(splitCourseDisplayName('CS216-30020825-2026SP: Algorithm Design')).toEqual({
      prefix: 'CS216-30020825-2026SP',
      title: 'Algorithm Design',
    })
    expect(splitCourseDisplayName('No delimiter course')).toEqual({
      prefix: null,
      title: 'No delimiter course',
    })
  })

  it('formats recent detail timestamps as relative days', () => {
    const now = new Date('2026-04-30T12:00:00Z')
    expect(formatDetailTimestamp('2026-04-29T12:00:00Z', false, now)).toBe('1 天前')
    expect(formatDetailTimestamp('2026-04-29T12:00:00Z', true, now)).toBe('1 day ago')
    expect(formatDetailTimestamp('2026-04-30T08:00:00Z', false, now)).toBe('今天')
    expect(formatDetailTimestamp('2026-03-01T12:00:00Z', false, now)).toBe('2026-03-01')
  })

  it('prefers backend-provided markdown for announcement content', () => {
    expect(resolveAnnouncementMarkdown({
      id: 1,
      body: 'Plain announcement text',
      body_markdown: 'Plain announcement text\n\n- Item 1',
    })).toBe('Plain announcement text\n\n- Item 1')

    expect(resolveAnnouncementMarkdown({
      id: 2,
      body_markdown: '   ',
      content_markdown: 'Converted from HTML',
    })).toBeNull()
  })

  it('builds scoped announcement requests without affecting other tabs', () => {
    expect(buildDetailRequestUrl('http://localhost', 'course-1', 'announcements')).toBe(
      'http://localhost/api/blackboard/data/courses/course-1/announcements',
    )
    expect(
      buildDetailRequestUrl('http://localhost', 'course-1', 'announcements', {
        announcementScope: 'course_only',
      }),
    ).toBe('http://localhost/api/blackboard/data/courses/course-1/announcements?scope=course_only')
    expect(
      buildDetailRequestUrl('http://localhost', 'course-1', 'assignments', {
        announcementScope: 'course_only',
      }),
    ).toBe('http://localhost/api/blackboard/data/courses/course-1/assignments')
  })

  it('builds resource download status requests with repeated resource_urls params', () => {
    expect(
      buildResourceDownloadStatusRequestUrl('http://localhost', 'course-1', [
        'https://bb.example/a.pdf',
        'https://bb.example/b.pdf',
      ]),
    ).toBe(
      'http://localhost/api/blackboard/resources/downloads/status?course_id=course-1&resource_urls=https%3A%2F%2Fbb.example%2Fa.pdf&resource_urls=https%3A%2F%2Fbb.example%2Fb.pdf',
    )
  })

  it('sorts linked assignment announcements by newest timestamp first', () => {
    const item: AssignmentDetailItem = {
      id: 1,
      title: 'Homework 1',
      linked_announcements: [
        {
          announcement_id: 'ann-older',
          title: 'Older notice',
          publish_time: '2026-04-01T10:00:00Z',
          content_markdown: 'Older content',
          relation_confidence: 'medium',
        },
        {
          announcement_id: 'ann-newer',
          title: 'Newer notice',
          publish_time: '2026-04-02T10:00:00Z',
          content_markdown: 'Newer **content**',
          relation_confidence: 'high',
        },
      ],
    }

    const linked = resolveAssignmentLinkedAnnouncements(item)
    expect(linked.map((announcement) => announcement.announcement_id)).toEqual([
      'ann-newer',
      'ann-older',
    ])
    expect(resolveAnnouncementMarkdown(linked[0] as DataItem)).toBe('Newer **content**')
  })

  it('does not expose internal announcement relation metadata in the announcement card meta row', async () => {
    const fetchMock = vi.fn<(input: string | URL) => Promise<Response>>()
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/api/blackboard/data/courses')) {
        return new Response(JSON.stringify({
          ok: true,
          courses: [{
            id: 1,
            course_id: 'course-1',
            name: 'CS304: Software Engineering',
            code: 'CS304',
            instructor: 'Ada',
            term: 'Spring 2026',
            is_active: true,
            total_assignments: 0,
            total_resources: 0,
            total_announcements: 1,
          }],
        }))
      }
      if (url.includes('/api/blackboard/data/courses/course-1/announcements')) {
        return new Response(JSON.stringify({
          ok: true,
          announcements: [{
            id: 1,
            announcement_id: 'ann-1',
            title: 'Rubric released',
            author: '陈杉',
            body_markdown: 'The rubric is available now.',
            relation_type: 'plain_course_announcement',
            relation_confidence: 'none',
          }],
        }))
      }
      throw new Error(`Unhandled fetch URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const rendered = renderWithRoot(
      <BlackboardDataBrowser language="zh-CN" baseUrl="http://localhost" />,
    )

    try {
      await waitForCondition(() => rendered.container.textContent?.includes('Rubric released') === true)
      expect(rendered.container.textContent).toContain('陈杉')
      expect(rendered.container.textContent).not.toContain('plain_course_announcement')
      expect(rendered.container.textContent).not.toContain('assignment_notice')
      expect(rendered.container.textContent).not.toContain(' · none')
      expect(rendered.container.textContent).not.toContain(' · medium')
    } finally {
      rendered.unmount()
    }
  })

  it('does not show a loading hint while switching announcement scope', async () => {
    let announcementPayload = {
      ok: true,
      announcements: [{
        id: 1,
        announcement_id: 'ann-1',
        title: 'Course-only notice',
        author: 'Ada',
        body_markdown: 'Initial content',
      }],
    }

    const fetchMock = vi.fn<(input: string | URL) => Promise<Response>>()
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/api/blackboard/data/courses')) {
        return new Response(JSON.stringify({
          ok: true,
          courses: [{
            id: 1,
            course_id: 'course-1',
            name: 'CS304: Software Engineering',
            code: 'CS304',
            instructor: 'Ada',
            term: 'Spring 2026',
            is_active: true,
            total_assignments: 0,
            total_resources: 0,
            total_announcements: 1,
          }],
        }))
      }
      if (url.includes('/api/blackboard/data/courses/course-1/announcements')) {
        return new Promise((resolve) => {
          window.setTimeout(() => {
            resolve(new Response(JSON.stringify(announcementPayload)))
          }, 30)
        })
      }
      throw new Error(`Unhandled fetch URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const rendered = renderWithRoot(
      <BlackboardDataBrowser language="zh-CN" baseUrl="http://localhost" />,
    )

    try {
      await waitForCondition(() => rendered.container.textContent?.includes('Course-only notice') === true)

      const trigger = Array.from(rendered.container.querySelectorAll<HTMLButtonElement>('button')).find((button) => {
        return button.textContent?.includes('仅课程公告') === true
      })
      expect(trigger).toBeTruthy()
      await clickElement(trigger as HTMLButtonElement)

      announcementPayload = {
        ok: true,
        announcements: [{
          id: 2,
          announcement_id: 'ann-2',
          title: 'All-announcements notice',
          author: 'Ada',
          body_markdown: 'Updated content',
        }],
      }

      const allOption = Array.from(rendered.container.querySelectorAll<HTMLButtonElement>('button')).find((button) => {
        return button.textContent?.trim() === '所有公告'
      })
      expect(allOption).toBeTruthy()
      await clickElement(allOption as HTMLButtonElement)

      expect(rendered.container.textContent).not.toContain('加载中…')
      await waitForCondition(() => rendered.container.textContent?.includes('All-announcements notice') === true)
      expect(rendered.container.textContent).not.toContain('加载中…')
    } finally {
      rendered.unmount()
    }
  })

  it('formats grade percentages from explicit percentage or score fraction', () => {
    expect(formatGradePercentage('19', '20', 95)).toBe('95%')
    expect(formatGradePercentage('19', '20', null)).toBe('95%')
    expect(formatGradePercentage('8.5', '10', null)).toBe('85%')
    expect(formatGradePercentage('-', '100', null)).toBeNull()
  })

  it('extracts detail items from tab-specific response payloads', () => {
    expect(
      extractDetailItemsFromResponse('announcements', {
        ok: true,
        announcements: [{ id: 1, title: 'Announcement 1' }],
      }),
    ).toEqual([{ id: 1, title: 'Announcement 1' }])

    expect(
      extractDetailItemsFromResponse('assignments', {
        ok: true,
        assignments: [{ id: 2, title: 'Assignment 1', attachments_json: '[{"title":"spec.pdf","url":"https://bb.example/spec.pdf","type":"pdf"}]' }],
      }),
    ).toEqual([{ id: 2, title: 'Assignment 1', attachments_json: '[{"title":"spec.pdf","url":"https://bb.example/spec.pdf","type":"pdf"}]' }])
  })

  it('defines dedicated markdown styles for announcement descriptions', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/sustech-workspace.css'), 'utf8')
    expect(css).toMatch(
      /\.sustech-detail-item__desc--markdown\s*\{[^}]*display:\s*block;/s,
    )
    expect(css).toMatch(
      /\.sustech-detail-item__desc--markdown\s+p,[\s\S]*?margin:\s*0;/s,
    )
    expect(css).toMatch(/\.sustech-detail-filter__trigger\s*\{/s)
    expect(css).toMatch(/\.sustech-detail-filter__menu\s*\{/s)
    expect(css).toMatch(/\.sustech-linked-announcement-card\s*\{/s)
  })

  it('flattens resources according to parent-child hierarchy', () => {
    const items: DataItem[] = [
      { id: 1, resource_id: 'root-b', title: 'Root B', parent_id: null },
      { id: 2, resource_id: 'child-a', title: 'Child A', parent_id: 'root-a' },
      { id: 3, resource_id: 'root-a', title: 'Root A', parent_id: null },
      { id: 4, resource_id: 'grandchild-a', title: 'Grandchild A', parent_id: 'child-a' },
    ]

    expect(flattenResourceHierarchy(items).map((item) => [item.resource_id, item.depth])).toEqual([
      ['root-b', 0],
      ['root-a', 0],
      ['child-a', 1],
      ['grandchild-a', 2],
    ])
  })

  it('flattens only expanded resource descendants in tree mode', () => {
    const items: DataItem[] = [
      { id: 1, resource_id: 'root-a', title: 'Root A', parent_id: null, type: 'folder' },
      { id: 2, resource_id: 'child-a', title: 'Child A', parent_id: 'root-a', type: 'folder' },
      { id: 3, resource_id: 'leaf-a', title: 'leaf-a.pdf', parent_id: 'child-a', type: 'pdf' },
      { id: 4, resource_id: 'root-b', title: 'Root B', parent_id: null, type: 'folder' },
    ]

    expect(flattenVisibleResourceHierarchy(items, new Set()).map((item) => item.resource_id)).toEqual([
      'root-a',
      'root-b',
    ])

    expect(flattenVisibleResourceHierarchy(items, new Set(['root-a', 'child-a'])).map((item) => item.resource_id)).toEqual([
      'root-a',
      'child-a',
      'leaf-a',
      'root-b',
    ])
  })

  it('classifies resource visuals by suffix and declared type', () => {
    expect(resolveResourceVisualKind({ title: 'Week 1', type: 'folder' })).toBe('folder')
    expect(resolveResourceVisualKind({ title: 'slides.pdf', type: 'pdf' })).toBe('pdf')
    expect(resolveResourceVisualKind({ title: 'report.docx', type: 'docx' })).toBe('document')
    expect(resolveResourceVisualKind({ title: 'table.xlsx', type: 'xlsx' })).toBe('spreadsheet')
    expect(resolveResourceVisualKind({ title: 'demo.ts', type: 'ts' })).toBe('code')
    expect(resolveResourceVisualKind({ title: 'lec01.mp4', type: 'mp4' })).toBe('video')
    expect(resolveResourceVisualKind({ title: 'theme.mp3', type: 'mp3' })).toBe('audio')
    expect(resolveResourceVisualKind({ title: 'slides.pptx', type: 'pptx' })).toBe('presentation')
    expect(resolveResourceVisualKind({
      title: '03 Stable Matching.pdf',
      type: 'file',
      url: 'https://blackboard.sustech.edu.cn/bbcswebdav/pid-588326-dt-content-rid-19137628_1/xid-19137628_1',
    })).toBe('pdf')
    expect(resolveResourceExtensionLabel({ title: 'slides.pdf', type: 'pdf' })).toBe('PDF')
    expect(resolveResourceExtensionLabel({
      title: '03 Stable Matching.pdf',
      type: 'file',
      url: 'https://blackboard.sustech.edu.cn/bbcswebdav/pid-588326-dt-content-rid-19137628_1/xid-19137628_1',
    })).toBe('PDF')
    expect(resolveResourceExtensionLabel({ title: 'resource', type: 'folder' })).toBeNull()
  })

  it('prefers readable file basenames over opaque Blackboard resource labels', () => {
    expect(resolveReadableResourceName({
      title: '12345678_987654321_1122334455_lec01.mp4',
      url: 'https://bb.example/path/lec01.mp4?download=1',
    })).toBe('lec01.mp4')

    expect(resolveReadableResourceName({
      title: 'Assign1-rubric.pdf',
      url: 'https://bb.example/path/Assign1-rubric.pdf?download=1',
    })).toBe('Assign1-rubric.pdf')

    expect(resolveReadableResourceName({
      title: 'Lecture Video',
      url: 'https://bb.example/path/lec02.mp4?download=1',
    })).toBe('lec02.mp4')

    expect(resolveReadableResourceName({
      title: 'Week 1',
      type: 'folder',
      url: 'https://bb.example/webapps/blackboard/content/listContent.jsp?course_id=_1&content_id=_2',
    })).toBe('Week 1')

    expect(resolveReadableResourceName({
      title: 'lec01_202604301122334455.mp4',
      url: 'https://bb.example/path/lec01_202604301122334455.mp4?download=1',
    })).toBe('lec01.mp4')
  })

  it('parses assignment attachments from backend attachments_json payload', () => {
    expect(resolveAssignmentAttachments({
      attachments_json: JSON.stringify([
        {
          title: 'spec.pdf',
          url: 'https://bb.example/spec.pdf',
          type: 'pdf',
          size: '1.2 MB',
          resource_id: 'res-spec',
        },
        {
          name: 'starter.zip',
          url: 'https://bb.example/starter.zip',
          type: 'zip',
        },
      ]),
    })).toEqual([
      {
        title: 'spec.pdf',
        url: 'https://bb.example/spec.pdf',
        type: 'pdf',
        size: '1.2 MB',
        resource_id: 'res-spec',
      },
      {
        title: 'starter.zip',
        url: 'https://bb.example/starter.zip',
        type: 'zip',
        size: null,
        resource_id: null,
      },
    ])
  })

  it('resolves assignment descriptions from plain text fields and html fallback', () => {
    expect(resolveAssignmentDescription({
      description: '  Assignment body  ',
      description_html: '<p>Ignored rich text</p>',
    })).toBe('Assignment body')

    expect(resolveAssignmentDescription({
      description: '   ',
      description_html: '<div><strong>Remember</strong> to submit.</div>',
    })).toBe('Remember to submit.')
  })

  it('resolves assignment markdown from description html via turndown', () => {
    expect(resolveAssignmentMarkdown({
      description_html: '<p>Line 1</p><ul><li>item</li></ul>',
    })).toBe('Line 1\n\n- item')

    expect(resolveAssignmentMarkdown({
      description_html: '   ',
    })).toBeNull()
  })

  it('resolves resource download ui state from backend status payloads', () => {
    expect(resolveResourceDownloadUiState({ local_path: null, is_downloaded: false, download_failed: false }, {
      state: 'downloading',
      task_id: 'task-1',
      progress_percent: 42.5,
      preferred_directory: 'C:/Downloads',
    })).toEqual({
      state: 'downloading',
      taskId: 'task-1',
      localPath: null,
      progressPercent: 42.5,
      errorMessage: null,
      preferredDirectory: 'C:/Downloads',
    })

    expect(resolveResourceDownloadUiState({
      local_path: 'C:/Downloads/file.pdf',
      is_downloaded: true,
      download_failed: false,
    }, null)).toEqual({
      state: 'downloaded',
      taskId: null,
      localPath: 'C:/Downloads/file.pdf',
      progressPercent: 100,
      errorMessage: null,
      preferredDirectory: 'C:/Downloads',
    })

    expect(resolveResourceDownloadUiState({
      local_path: 'C:/Downloads/file.pdf',
      is_downloaded: true,
      download_failed: false,
    }, {
      state: 'idle',
      local_path: null,
      preferred_directory: 'C:/Downloads',
    })).toEqual({
      state: 'idle',
      taskId: null,
      localPath: null,
      progressPercent: null,
      errorMessage: null,
      preferredDirectory: 'C:/Downloads',
    })
  })

  it('starts a resource download after selecting a directory and switches the row action into cancel mode', async () => {
    let currentStatusState: 'idle' | 'downloading' = 'idle'
    const fetchMock = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>()
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/blackboard/data/courses')) {
        return new Response(JSON.stringify({
          ok: true,
          courses: [{
            id: 1,
            course_id: 'course-1',
            name: 'CS304: Software Engineering',
            code: 'CS304',
            instructor: 'Ada',
            term: 'Spring 2026',
            is_active: true,
            total_assignments: 0,
            total_resources: 1,
            total_announcements: 0,
          }],
        }))
      }
      if (url.includes('/api/blackboard/data/courses/course-1/announcements')) {
        return new Response(JSON.stringify({ ok: true, announcements: [] }))
      }
      if (url.includes('/api/blackboard/data/courses/course-1/resources')) {
        return new Response(JSON.stringify({
          ok: true,
          resources: [{
            id: 1,
            resource_id: 'res-1',
            title: 'Lecture 1 slides.pdf',
            type: 'pdf',
            size: '1 MB',
            url: 'https://bb.example/res-1.pdf',
            local_path: null,
            is_downloaded: false,
            download_failed: false,
            parent_id: null,
          }],
        }))
      }
      if (url.includes('/api/blackboard/resources/downloads/status')) {
        return new Response(JSON.stringify({
          ok: true,
          statuses: [{
            course_id: 'course-1',
            resource_url: 'https://bb.example/res-1.pdf',
            resource_id: 'res-1',
            state: currentStatusState,
            preferred_directory: 'C:/Preferred',
          }],
        }))
      }
      if (url.endsWith('/api/blackboard/resources/downloads/select-start')) {
        const payload = JSON.parse(String(init?.body ?? '{}'))
        expect(payload).toMatchObject({
          course_id: 'course-1',
          resource_url: 'https://bb.example/res-1.pdf',
          directory_path: 'C:/Chosen',
        })
        currentStatusState = 'downloading'
        return new Response(JSON.stringify({
          ok: true,
          task: {
            task_id: 'task-1',
            course_id: 'course-1',
            resource_url: 'https://bb.example/res-1.pdf',
            resource_id: 'res-1',
            state: 'downloading',
            progress_percent: 0,
            preferred_directory: 'C:/Chosen',
          },
        }))
      }
      throw new Error(`Unhandled fetch URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const fileManager: FileManagerApi = {
      selectRootDirectory: vi.fn(async () => ({ ok: true, rootPath: 'C:/Chosen', entries: [] })),
      listDirectory: vi.fn(async () => ({ ok: true, entries: [] })),
      probeDirectory: vi.fn(async () => ({ ok: true, totalItems: 0, isLarge: false, maxDepth: 0 })),
      createDirectory: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      copyEntries: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      moveEntries: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      renameEntry: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      trashEntries: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      deleteEntriesPermanently: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      watchDirectories: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      unwatchDirectories: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      onDirectoryChanged: vi.fn(() => () => undefined),
      loadLastRootDirectory: vi.fn(async () => ({ ok: true, rootPath: null })),
      saveLastRootDirectory: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      clearLastRootDirectory: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      openEntryWithSystem: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      revealEntryInFolder: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      copyTextToClipboard: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
    }
    ;(window as typeof window & { fileManager?: FileManagerApi }).fileManager = fileManager

    const rendered = renderWithRoot(
      <BlackboardDataBrowser language="zh-CN" baseUrl="http://localhost" />,
    )

    try {
      await waitForNextFrame()
      await waitForNextFrame()
      const resourcesTab = Array.from(rendered.container.querySelectorAll<HTMLButtonElement>('.sustech-detail-tab')).find((button) => {
        return button.textContent?.includes('资源')
      })
      expect(resourcesTab).toBeTruthy()
      await clickElement(resourcesTab as HTMLElement)
      await waitForCondition(() => rendered.container.querySelector('[data-testid="blackboard-resource-download-res-1"]') instanceof HTMLElement)

      const downloadButton = rendered.getByTestId('blackboard-resource-download-res-1') as HTMLButtonElement
      await clickElement(downloadButton)
      await waitForCondition(() => {
        const currentButton = rendered.getByTestId('blackboard-resource-download-res-1') as HTMLButtonElement
        return currentButton.title === '取消下载'
      })

      expect(fileManager.selectRootDirectory).toHaveBeenCalledWith({ initialPath: 'C:/Preferred' })
      expect((rendered.getByTestId('blackboard-resource-download-res-1') as HTMLButtonElement).title).toBe('取消下载')
    } finally {
      rendered.unmount()
    }
  })

  it('renders a progress overlay for downloading resources and reveals downloaded files via fileManager', async () => {
    const fetchMock = vi.fn<(input: string | URL) => Promise<Response>>()
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/api/blackboard/data/courses')) {
        return new Response(JSON.stringify({
          ok: true,
          courses: [{
            id: 1,
            course_id: 'course-1',
            name: 'CS304: Software Engineering',
            code: 'CS304',
            instructor: 'Ada',
            term: 'Spring 2026',
            is_active: true,
            total_assignments: 0,
            total_resources: 2,
            total_announcements: 0,
          }],
        }))
      }
      if (url.includes('/api/blackboard/data/courses/course-1/announcements')) {
        return new Response(JSON.stringify({ ok: true, announcements: [] }))
      }
      if (url.includes('/api/blackboard/data/courses/course-1/resources')) {
        return new Response(JSON.stringify({
          ok: true,
          resources: [
            {
              id: 1,
              resource_id: 'res-1',
              title: 'Lecture 1 slides.pdf',
              type: 'pdf',
              size: '1 MB',
              url: 'https://bb.example/res-1.pdf',
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
              url: 'https://bb.example/res-2.pdf',
              local_path: 'C:/Downloads/res-2.pdf',
              is_downloaded: true,
              download_failed: false,
              parent_id: null,
            },
          ],
        }))
      }
      if (url.includes('/api/blackboard/resources/downloads/status')) {
        return new Response(JSON.stringify({
          ok: true,
          statuses: [
            {
              task_id: 'task-1',
              course_id: 'course-1',
              resource_url: 'https://bb.example/res-1.pdf',
              resource_id: 'res-1',
              state: 'downloading',
              progress_percent: 42.5,
            },
            {
              course_id: 'course-1',
              resource_url: 'https://bb.example/res-2.pdf',
              resource_id: 'res-2',
              state: 'downloaded',
              local_path: 'C:/Downloads/res-2.pdf',
            },
          ],
        }))
      }
      throw new Error(`Unhandled fetch URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const fileManager: FileManagerApi = {
      selectRootDirectory: vi.fn(async () => ({ ok: true, rootPath: 'C:/Chosen', entries: [] })),
      listDirectory: vi.fn(async () => ({ ok: true, entries: [] })),
      probeDirectory: vi.fn(async () => ({ ok: true, totalItems: 0, isLarge: false, maxDepth: 0 })),
      createDirectory: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      copyEntries: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      moveEntries: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      renameEntry: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      trashEntries: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      deleteEntriesPermanently: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      watchDirectories: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      unwatchDirectories: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      onDirectoryChanged: vi.fn(() => () => undefined),
      loadLastRootDirectory: vi.fn(async () => ({ ok: true, rootPath: null })),
      saveLastRootDirectory: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      clearLastRootDirectory: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      openEntryWithSystem: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      revealEntryInFolder: vi.fn(async () => ({ ok: true, affectedPaths: ['C:/Downloads/res-2.pdf'] })),
      copyTextToClipboard: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
    }
    ;(window as typeof window & { fileManager?: FileManagerApi }).fileManager = fileManager

    const rendered = renderWithRoot(
      <BlackboardDataBrowser language="zh-CN" baseUrl="http://localhost" />,
    )

    try {
      await waitForNextFrame()
      await waitForNextFrame()
      const resourcesTab = Array.from(rendered.container.querySelectorAll<HTMLButtonElement>('.sustech-detail-tab')).find((button) => {
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
      expect(fileManager.revealEntryInFolder).toHaveBeenCalledWith({ path: 'C:/Downloads/res-2.pdf' })
    } finally {
      rendered.unmount()
    }
  })

  it('downloads idle resources and reveals downloaded resources on row double click', async () => {
    const fetchMock = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>()
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/blackboard/data/courses')) {
        return new Response(JSON.stringify({
          ok: true,
          courses: [{
            id: 1,
            course_id: 'course-1',
            name: 'CS304: Software Engineering',
            code: 'CS304',
            instructor: 'Ada',
            term: 'Spring 2026',
            is_active: true,
            total_assignments: 0,
            total_resources: 2,
            total_announcements: 0,
          }],
        }))
      }
      if (url.includes('/api/blackboard/data/courses/course-1/announcements')) {
        return new Response(JSON.stringify({ ok: true, announcements: [] }))
      }
      if (url.includes('/api/blackboard/data/courses/course-1/resources')) {
        return new Response(JSON.stringify({
          ok: true,
          resources: [
            {
              id: 1,
              resource_id: 'res-1',
              title: 'Lecture 1 slides.pdf',
              type: 'pdf',
              size: '1 MB',
              url: 'https://bb.example/res-1.pdf',
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
              url: 'https://bb.example/res-2.pdf',
              local_path: 'C:/Downloads/res-2.pdf',
              is_downloaded: true,
              download_failed: false,
              parent_id: null,
            },
          ],
        }))
      }
      if (url.includes('/api/blackboard/resources/downloads/status')) {
        return new Response(JSON.stringify({
          ok: true,
          statuses: [
            {
              course_id: 'course-1',
              resource_url: 'https://bb.example/res-1.pdf',
              resource_id: 'res-1',
              state: 'idle',
              preferred_directory: 'C:/Preferred',
            },
            {
              course_id: 'course-1',
              resource_url: 'https://bb.example/res-2.pdf',
              resource_id: 'res-2',
              state: 'downloaded',
              local_path: 'C:/Downloads/res-2.pdf',
            },
          ],
        }))
      }
      if (url.endsWith('/api/blackboard/resources/downloads/select-start')) {
        const payload = JSON.parse(String(init?.body ?? '{}'))
        expect(payload).toMatchObject({
          course_id: 'course-1',
          resource_url: 'https://bb.example/res-1.pdf',
          resource_title: 'Lecture 1 slides.pdf',
          directory_path: 'C:/Chosen',
        })
        return new Response(JSON.stringify({
          ok: true,
          task: {
            task_id: 'task-1',
            course_id: 'course-1',
            resource_url: 'https://bb.example/res-1.pdf',
            resource_id: 'res-1',
            state: 'downloading',
            progress_percent: 0,
            preferred_directory: 'C:/Chosen',
          },
        }))
      }
      throw new Error(`Unhandled fetch URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const fileManager: FileManagerApi = {
      selectRootDirectory: vi.fn(async () => ({ ok: true, rootPath: 'C:/Chosen', entries: [] })),
      listDirectory: vi.fn(async () => ({ ok: true, entries: [] })),
      probeDirectory: vi.fn(async () => ({ ok: true, totalItems: 0, isLarge: false, maxDepth: 0 })),
      createDirectory: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      copyEntries: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      moveEntries: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      renameEntry: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      trashEntries: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      deleteEntriesPermanently: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      watchDirectories: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      unwatchDirectories: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      onDirectoryChanged: vi.fn(() => () => undefined),
      loadLastRootDirectory: vi.fn(async () => ({ ok: true, rootPath: null })),
      saveLastRootDirectory: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      clearLastRootDirectory: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      openEntryWithSystem: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      revealEntryInFolder: vi.fn(async () => ({ ok: true, affectedPaths: ['C:/Downloads/res-2.pdf'] })),
      copyTextToClipboard: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
    }
    ;(window as typeof window & { fileManager?: FileManagerApi }).fileManager = fileManager

    const rendered = renderWithRoot(
      <BlackboardDataBrowser language="zh-CN" baseUrl="http://localhost" />,
    )

    try {
      await waitForNextFrame()
      await waitForNextFrame()
      const resourcesTab = Array.from(rendered.container.querySelectorAll<HTMLButtonElement>('.sustech-detail-tab')).find((button) => {
        return button.textContent?.includes('资源')
      })
      expect(resourcesTab).toBeTruthy()
      await clickElement(resourcesTab as HTMLElement)
      await waitForCondition(() => rendered.container.querySelector('[data-testid="blackboard-resource-row-res-1"]') instanceof HTMLElement)

      await doubleClickElement(rendered.getByTestId('blackboard-resource-row-res-1'))
      await waitForCondition(() => {
        const currentButton = rendered.getByTestId('blackboard-resource-download-res-1') as HTMLButtonElement
        return currentButton.title === '取消下载'
      })
      expect(fileManager.selectRootDirectory).toHaveBeenCalledWith({ initialPath: 'C:/Preferred' })

      await doubleClickElement(rendered.getByTestId('blackboard-resource-row-res-2'))
      expect(fileManager.revealEntryInFolder).toHaveBeenCalledWith({ path: 'C:/Downloads/res-2.pdf' })
    } finally {
      rendered.unmount()
    }
  })

  it('provides synchronized download buttons and double-click actions for assignment attachments', async () => {
    const fetchMock = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>()
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/blackboard/data/courses')) {
        return new Response(JSON.stringify({
          ok: true,
          courses: [{
            id: 1,
            course_id: 'course-1',
            name: 'CS304: Software Engineering',
            code: 'CS304',
            instructor: 'Ada',
            term: 'Spring 2026',
            is_active: true,
            total_assignments: 1,
            total_resources: 0,
            total_announcements: 0,
          }],
        }))
      }
      if (url.includes('/api/blackboard/data/courses/course-1/announcements')) {
        return new Response(JSON.stringify({ ok: true, announcements: [] }))
      }
      if (url.includes('/api/blackboard/data/courses/course-1/assignments')) {
        return new Response(JSON.stringify({
          ok: true,
          assignments: [{
            id: 1,
            assignment_id: 'assign-1',
            title: 'Assignment 1',
            attachments_json: JSON.stringify([
              {
                title: 'spec.pdf',
                url: 'https://bb.example/spec.pdf',
                type: 'pdf',
                size: '1.2 MB',
                resource_id: 'res-spec',
              },
              {
                title: 'starter.zip',
                url: 'https://bb.example/starter.zip',
                type: 'zip',
                size: '5 MB',
                resource_id: 'res-starter',
              },
            ]),
          }],
        }))
      }
      if (url.includes('/api/blackboard/resources/downloads/status')) {
        expect(url).toContain(encodeURIComponent('https://bb.example/spec.pdf'))
        expect(url).toContain(encodeURIComponent('https://bb.example/starter.zip'))
        return new Response(JSON.stringify({
          ok: true,
          statuses: [
            {
              course_id: 'course-1',
              resource_url: 'https://bb.example/spec.pdf',
              resource_id: 'res-spec',
              state: 'downloaded',
              local_path: 'C:/Downloads/spec.pdf',
            },
            {
              course_id: 'course-1',
              resource_url: 'https://bb.example/starter.zip',
              resource_id: 'res-starter',
              state: 'idle',
              preferred_directory: 'C:/Preferred',
            },
          ],
        }))
      }
      if (url.endsWith('/api/blackboard/resources/downloads/select-start')) {
        const payload = JSON.parse(String(init?.body ?? '{}'))
        expect(payload).toMatchObject({
          course_id: 'course-1',
          resource_url: 'https://bb.example/starter.zip',
          resource_title: 'starter.zip',
          directory_path: 'C:/Chosen',
        })
        return new Response(JSON.stringify({
          ok: true,
          task: {
            task_id: 'task-2',
            course_id: 'course-1',
            resource_url: 'https://bb.example/starter.zip',
            resource_id: 'res-starter',
            state: 'downloading',
            progress_percent: 0,
            preferred_directory: 'C:/Chosen',
          },
        }))
      }
      throw new Error(`Unhandled fetch URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const fileManager: FileManagerApi = {
      selectRootDirectory: vi.fn(async () => ({ ok: true, rootPath: 'C:/Chosen', entries: [] })),
      listDirectory: vi.fn(async () => ({ ok: true, entries: [] })),
      probeDirectory: vi.fn(async () => ({ ok: true, totalItems: 0, isLarge: false, maxDepth: 0 })),
      createDirectory: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      copyEntries: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      moveEntries: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      renameEntry: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      trashEntries: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      deleteEntriesPermanently: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      watchDirectories: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      unwatchDirectories: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      onDirectoryChanged: vi.fn(() => () => undefined),
      loadLastRootDirectory: vi.fn(async () => ({ ok: true, rootPath: null })),
      saveLastRootDirectory: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      clearLastRootDirectory: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      openEntryWithSystem: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      revealEntryInFolder: vi.fn(async () => ({ ok: true, affectedPaths: ['C:/Downloads/spec.pdf'] })),
      copyTextToClipboard: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
    }
    ;(window as typeof window & { fileManager?: FileManagerApi }).fileManager = fileManager

    const rendered = renderWithRoot(
      <BlackboardDataBrowser language="zh-CN" baseUrl="http://localhost" />,
    )

    try {
      await waitForNextFrame()
      await waitForNextFrame()
      const assignmentsTab = Array.from(rendered.container.querySelectorAll<HTMLButtonElement>('.sustech-detail-tab')).find((button) => {
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
      expect(fileManager.selectRootDirectory).toHaveBeenCalledWith({ initialPath: 'C:/Preferred' })
    } finally {
      rendered.unmount()
    }
  })

  it('opens announcement and assignment source urls in the system browser on double click', async () => {
    const fetchMock = vi.fn<(input: string | URL) => Promise<Response>>()
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/api/blackboard/data/courses')) {
        return new Response(JSON.stringify({
          ok: true,
          courses: [{
            id: 1,
            course_id: 'course-1',
            name: 'CS304: Software Engineering',
            code: 'CS304',
            instructor: 'Ada',
            term: 'Spring 2026',
            is_active: true,
            total_assignments: 1,
            total_resources: 0,
            total_announcements: 1,
          }],
        }))
      }
      if (url.includes('/api/blackboard/data/courses/course-1/announcements')) {
        return new Response(JSON.stringify({
          ok: true,
          announcements: [{
            id: 1,
            announcement_id: 'ann-1',
            title: 'Announcement 1',
            author: 'Ada',
            body_markdown: 'Announcement body',
            url: 'https://bb.example/ann-1',
          }],
        }))
      }
      if (url.includes('/api/blackboard/data/courses/course-1/assignments')) {
        return new Response(JSON.stringify({
          ok: true,
          assignments: [{
            id: 2,
            assignment_id: 'asg-1',
            title: 'Assignment 1',
            url: 'https://bb.example/asg-1',
            description: 'Assignment body',
            attachments_json: '[]',
          }],
        }))
      }
      throw new Error(`Unhandled fetch URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const fileManager: FileManagerApi = {
      selectRootDirectory: vi.fn(async () => ({ ok: true, rootPath: 'C:/Chosen', entries: [] })),
      listDirectory: vi.fn(async () => ({ ok: true, entries: [] })),
      probeDirectory: vi.fn(async () => ({ ok: true, totalItems: 0, isLarge: false, maxDepth: 0 })),
      createDirectory: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      copyEntries: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      moveEntries: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      renameEntry: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      trashEntries: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      deleteEntriesPermanently: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      watchDirectories: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      unwatchDirectories: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      onDirectoryChanged: vi.fn(() => () => undefined),
      loadLastRootDirectory: vi.fn(async () => ({ ok: true, rootPath: null })),
      saveLastRootDirectory: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      clearLastRootDirectory: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      openEntryWithSystem: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      revealEntryInFolder: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      copyTextToClipboard: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
    }
    ;(window as typeof window & { fileManager?: FileManagerApi }).fileManager = fileManager

    const rendered = renderWithRoot(
      <BlackboardDataBrowser language="zh-CN" baseUrl="http://localhost" />,
    )

    try {
      await waitForCondition(() => rendered.container.textContent?.includes('Announcement 1') === true)
      await doubleClickElement(rendered.getByTestId('blackboard-detail-item-announcements-1'))
      expect(fileManager.openEntryWithSystem).toHaveBeenCalledWith({ path: 'https://bb.example/ann-1' })

      const assignmentsTab = Array.from(rendered.container.querySelectorAll<HTMLButtonElement>('.sustech-detail-tab')).find((button) => {
        return button.textContent?.includes('作业')
      })
      expect(assignmentsTab).toBeTruthy()
      await clickElement(assignmentsTab as HTMLButtonElement)
      await waitForCondition(() => rendered.container.textContent?.includes('Assignment 1') === true)

      await doubleClickElement(rendered.getByTestId('blackboard-detail-item-assignments-asg-1'))
      expect(fileManager.openEntryWithSystem).toHaveBeenCalledWith({ path: 'https://bb.example/asg-1' })
    } finally {
      rendered.unmount()
    }
  })

  it('renders assignment descriptions from backend assignment description fields', async () => {
    const fetchMock = vi.fn<(input: string | URL) => Promise<Response>>()
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/api/blackboard/data/courses')) {
        return new Response(JSON.stringify({
          ok: true,
          courses: [{
            id: 1,
            course_id: 'course-1',
            name: 'CS304: Software Engineering',
            code: 'CS304',
            instructor: 'Ada',
            term: 'Spring 2026',
            is_active: true,
            total_assignments: 2,
            total_resources: 0,
            total_announcements: 0,
          }],
        }))
      }
      if (url.includes('/api/blackboard/data/courses/course-1/announcements')) {
        return new Response(JSON.stringify({ ok: true, announcements: [] }))
      }
      if (url.includes('/api/blackboard/data/courses/course-1/assignments')) {
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
      <BlackboardDataBrowser language="zh-CN" baseUrl="http://localhost" />,
    )

    try {
      await waitForNextFrame()
      await waitForNextFrame()
      const assignmentsTab = Array.from(rendered.container.querySelectorAll<HTMLButtonElement>('.sustech-detail-tab')).find((button) => {
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

  it('shows announcement and assignment context menus with requested actions', async () => {
    const downloadStartPayloads: Array<Record<string, unknown>> = []
    const fetchMock = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>()
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/blackboard/data/courses')) {
        return new Response(JSON.stringify({
          ok: true,
          courses: [{
            id: 1,
            course_id: 'course-1',
            name: 'CS304: Software Engineering',
            code: 'CS304',
            instructor: 'Ada',
            term: 'Spring 2026',
            is_active: true,
            total_assignments: 1,
            total_resources: 0,
            total_announcements: 1,
          }],
        }))
      }
      if (url.includes('/api/blackboard/data/courses/course-1/announcements')) {
        return new Response(JSON.stringify({
          ok: true,
          announcements: [{
            id: 1,
            announcement_id: 'ann-1',
            title: 'Announcement 1',
            author: 'Ada',
            body_markdown: 'Announcement body',
            url: 'https://bb.example/ann-1',
          }],
        }))
      }
      if (url.includes('/api/blackboard/data/courses/course-1/assignments')) {
        return new Response(JSON.stringify({
          ok: true,
          assignments: [{
            id: 2,
            assignment_id: 'asg-1',
            title: 'Assignment 1',
            url: 'https://bb.example/asg-1',
            description_html: '<p>Assignment body</p><ul><li>Detail A</li></ul>',
            linked_announcements: [{
              announcement_id: 'ann-linked-1',
              title: 'Homework 1 notice',
              content_markdown: 'Linked announcement body',
              publish_time: '2026-04-02T10:00:00Z',
            }],
            attachments_json: JSON.stringify([
              { title: 'spec.pdf', url: 'https://bb.example/spec.pdf', type: 'pdf', resource_id: 'res-spec' },
              { title: 'starter.zip', url: 'https://bb.example/starter.zip', type: 'zip', resource_id: 'res-starter' },
            ]),
          }],
        }))
      }
      if (url.includes('/api/blackboard/resources/downloads/status')) {
        return new Response(JSON.stringify({ ok: true, statuses: [] }))
      }
      if (url.endsWith('/api/blackboard/resources/downloads/select-start')) {
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

    const fileManager: FileManagerApi = {
      selectRootDirectory: vi.fn(async () => ({ ok: true, rootPath: 'C:/Chosen', entries: [] })),
      listDirectory: vi.fn(async () => ({ ok: true, entries: [] })),
      probeDirectory: vi.fn(async () => ({ ok: true, totalItems: 0, isLarge: false, maxDepth: 0 })),
      createDirectory: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      copyEntries: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      moveEntries: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      renameEntry: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      trashEntries: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      deleteEntriesPermanently: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      watchDirectories: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      unwatchDirectories: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      onDirectoryChanged: vi.fn(() => () => undefined),
      loadLastRootDirectory: vi.fn(async () => ({ ok: true, rootPath: null })),
      saveLastRootDirectory: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      clearLastRootDirectory: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      openEntryWithSystem: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      revealEntryInFolder: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      copyTextToClipboard: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
    }
    ;(window as typeof window & { fileManager?: FileManagerApi }).fileManager = fileManager

    const rendered = renderWithRoot(
      <BlackboardDataBrowser language="zh-CN" baseUrl="http://localhost" />,
    )

    try {
      await waitForCondition(() => rendered.container.textContent?.includes('Announcement 1') === true)

      await openContextMenu(rendered.getByTestId('blackboard-detail-item-announcements-1'))
      const announcementMenuLabels = Array.from(document.querySelectorAll('.file-context-menu__item')).map((item) => item.textContent?.trim() ?? '')
      expect(announcementMenuLabels).toEqual(['复制'])
      await clickElement(Array.from(document.querySelectorAll<HTMLButtonElement>('.file-context-menu__item')).find((item) => item.textContent?.trim() === '复制') as HTMLButtonElement)
      expect(fileManager.copyTextToClipboard).toHaveBeenCalledWith({ text: 'Announcement 1\n\nAnnouncement body' })

      const assignmentsTab = Array.from(rendered.container.querySelectorAll<HTMLButtonElement>('.sustech-detail-tab')).find((button) => {
        return button.textContent?.includes('作业')
      })
      expect(assignmentsTab).toBeTruthy()
      await clickElement(assignmentsTab as HTMLButtonElement)
      await waitForCondition(() => rendered.container.textContent?.includes('Assignment 1') === true)

      await openContextMenu(rendered.getByTestId('blackboard-detail-item-assignments-asg-1'))
      const assignmentMenuLabels = Array.from(document.querySelectorAll('.file-context-menu__item')).map((item) => item.textContent?.trim() ?? '')
      expect(assignmentMenuLabels).toEqual(['复制标题', '复制详情', '复制作业公告', '下载所有资源'])

      await clickElement(Array.from(document.querySelectorAll<HTMLButtonElement>('.file-context-menu__item')).find((item) => item.textContent?.trim() === '复制标题') as HTMLButtonElement)
      expect(fileManager.copyTextToClipboard).toHaveBeenCalledWith({ text: 'Assignment 1' })

      await openContextMenu(rendered.getByTestId('blackboard-detail-item-assignments-asg-1'))
      await clickElement(Array.from(document.querySelectorAll<HTMLButtonElement>('.file-context-menu__item')).find((item) => item.textContent?.trim() === '复制详情') as HTMLButtonElement)
      expect(fileManager.copyTextToClipboard).toHaveBeenCalledWith({ text: 'Assignment 1\n\nAssignment body\n\n- Detail A' })

      await openContextMenu(rendered.getByTestId('blackboard-detail-item-assignments-asg-1'))
      await clickElement(Array.from(document.querySelectorAll<HTMLButtonElement>('.file-context-menu__item')).find((item) => item.textContent?.trim() === '复制作业公告') as HTMLButtonElement)
      expect(fileManager.copyTextToClipboard).toHaveBeenCalledWith({ text: 'Homework 1 notice\n\nLinked announcement body' })

      await openContextMenu(rendered.getByTestId('blackboard-detail-item-assignments-asg-1'))
      await clickElement(Array.from(document.querySelectorAll<HTMLButtonElement>('.file-context-menu__item')).find((item) => item.textContent?.trim() === '下载所有资源') as HTMLButtonElement)

      expect(fileManager.selectRootDirectory).toHaveBeenCalledOnce()
      expect(downloadStartPayloads).toHaveLength(2)
      expect(downloadStartPayloads.map((payload) => payload.resource_url)).toEqual([
        'https://bb.example/spec.pdf',
        'https://bb.example/starter.zip',
      ])
    } finally {
      rendered.unmount()
    }
  })

  it('renders detail context menus in document.body so viewport coordinates do not drift under transformed ancestors', async () => {
    const fetchMock = vi.fn<(input: string | URL) => Promise<Response>>()
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/api/blackboard/data/courses')) {
        return new Response(JSON.stringify({
          ok: true,
          courses: [{
            id: 1,
            course_id: 'course-1',
            name: 'CS304: Software Engineering',
            code: 'CS304',
            instructor: 'Ada',
            term: 'Spring 2026',
            is_active: true,
            total_assignments: 0,
            total_resources: 0,
            total_announcements: 1,
          }],
        }))
      }
      if (url.includes('/api/blackboard/data/courses/course-1/announcements')) {
        return new Response(JSON.stringify({
          ok: true,
          announcements: [{
            id: 1,
            announcement_id: 'ann-1',
            title: 'Announcement 1',
            author: 'Ada',
            body_markdown: 'Announcement body',
            url: 'https://bb.example/ann-1',
          }],
        }))
      }
      if (url.includes('/api/blackboard/data/courses/course-1/assignments')) {
        return new Response(JSON.stringify({ ok: true, assignments: [] }))
      }
      throw new Error(`Unhandled fetch URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const rendered = renderWithRoot(
      <div style={{ transform: 'translateY(40px)' }}>
        <BlackboardDataBrowser language="zh-CN" baseUrl="http://localhost" />
      </div>,
    )

    try {
      await waitForCondition(() => rendered.container.textContent?.includes('Announcement 1') === true)
      await openContextMenu(rendered.getByTestId('blackboard-detail-item-announcements-1'), 240, 180)

      const menu = document.body.querySelector('.file-context-menu')
      expect(menu).toBeTruthy()
      expect(rendered.container.contains(menu as Node)).toBe(false)
    } finally {
      rendered.unmount()
    }
  })

  it('removes the downloaded label after status polling reports an idle resource with no local path', async () => {
    let statusCallCount = 0
    const fetchMock = vi.fn<(input: string | URL) => Promise<Response>>()
    fetchMock.mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/api/blackboard/data/courses')) {
        return new Response(JSON.stringify({
          ok: true,
          courses: [{
            id: 1,
            course_id: 'course-1',
            name: 'CS304: Software Engineering',
            code: 'CS304',
            instructor: 'Ada',
            term: 'Spring 2026',
            is_active: true,
            total_assignments: 0,
            total_resources: 1,
            total_announcements: 0,
          }],
        }))
      }
      if (url.includes('/api/blackboard/data/courses/course-1/announcements')) {
        return new Response(JSON.stringify({ ok: true, announcements: [] }))
      }
      if (url.includes('/api/blackboard/data/courses/course-1/resources')) {
        return new Response(JSON.stringify({
          ok: true,
          resources: [{
            id: 1,
            resource_id: 'res-1',
            title: 'Lecture 1 slides.pdf',
            type: 'pdf',
            size: '1 MB',
            url: 'https://bb.example/res-1.pdf',
            local_path: 'C:/Downloads/res-1.pdf',
            is_downloaded: true,
            download_failed: false,
            parent_id: null,
          }],
        }))
      }
      if (url.includes('/api/blackboard/resources/downloads/status')) {
        statusCallCount += 1
        return new Response(JSON.stringify({
          ok: true,
          statuses: [{
            course_id: 'course-1',
            resource_url: 'https://bb.example/res-1.pdf',
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
      selectRootDirectory: vi.fn(async () => ({ ok: true, rootPath: 'C:/Chosen', entries: [] })),
      listDirectory: vi.fn(async () => ({ ok: true, entries: [] })),
      probeDirectory: vi.fn(async () => ({ ok: true, totalItems: 0, isLarge: false, maxDepth: 0 })),
      createDirectory: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      copyEntries: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      moveEntries: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      renameEntry: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      trashEntries: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      deleteEntriesPermanently: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      watchDirectories: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      unwatchDirectories: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      onDirectoryChanged: vi.fn(() => () => undefined),
      loadLastRootDirectory: vi.fn(async () => ({ ok: true, rootPath: null })),
      saveLastRootDirectory: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      clearLastRootDirectory: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      openEntryWithSystem: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      revealEntryInFolder: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
      copyTextToClipboard: vi.fn(async () => ({ ok: true, affectedPaths: [] })),
    }
    ;(window as typeof window & { fileManager?: FileManagerApi }).fileManager = fileManager

    const rendered = renderWithRoot(
      <BlackboardDataBrowser language="zh-CN" baseUrl="http://localhost" />,
    )

    try {
      await waitForNextFrame()
      await waitForNextFrame()
      const resourcesTab = Array.from(rendered.container.querySelectorAll<HTMLButtonElement>('.sustech-detail-tab')).find((button) => {
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
