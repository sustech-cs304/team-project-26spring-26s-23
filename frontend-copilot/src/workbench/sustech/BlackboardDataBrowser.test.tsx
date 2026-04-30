/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  BlackboardDataBrowser,
  flattenResourceHierarchy,
  formatDetailTimestamp,
  splitCourseDisplayName,
  type DataItem,
} from './BlackboardDataBrowser'

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

  it('preserves source line breaks in announcement descriptions', () => {
    const css = readFileSync(join(process.cwd(), 'src/styles/sustech-workspace.css'), 'utf8')
    expect(css).toMatch(
      /\.sustech-detail-item--announcements\s+\.sustech-detail-item__desc\s*\{[^}]*white-space:\s*pre-wrap;/s,
    )
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
})
