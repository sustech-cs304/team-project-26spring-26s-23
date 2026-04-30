/** @vitest-environment jsdom */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SustechWorkspace } from './SustechWorkspace'

describe('SustechWorkspace', () => {
  it('renders sidebar panel with Blackboard and TIS modules', () => {
    const html = renderToStaticMarkup(
      <SustechWorkspace bootstrap={{} as never} language="zh-CN" />,
    )
    expect(html).toContain('Blackboard')
    expect(html).toContain('TIS')
    expect(html).toContain('校园服务')
  })

  it('renders Blackboard management content by default', () => {
    const html = renderToStaticMarkup(
      <SustechWorkspace bootstrap={{} as never} language="zh-CN" />,
    )
    expect(html).toContain('Blackboard 管理系统')
    expect(html).toContain('课程列表')
    expect(html).toContain('课程详情')
    expect(html).not.toContain('同步状态')
    expect(html).not.toContain('数据浏览')
  })

  it('renders sync and settings buttons in header', () => {
    const html = renderToStaticMarkup(
      <SustechWorkspace bootstrap={{} as never} language="zh-CN" />,
    )
    expect(html).toContain('手动同步')
    expect(html).toContain('设置')
  })

  it('renders in English', () => {
    const html = renderToStaticMarkup(
      <SustechWorkspace bootstrap={{} as never} language="en-US" />,
    )
    expect(html).toContain('Campus Services')
    expect(html).toContain('Blackboard Management')
    expect(html).toContain('Courses')
    expect(html).toContain('Course details')
    expect(html).not.toContain('Sync Status')
  })

  it('does NOT contain back-link or home navigation elements', () => {
    const html = renderToStaticMarkup(
      <SustechWorkspace bootstrap={{} as never} language="zh-CN" />,
    )
    expect(html).not.toContain('SUSTech 首页')
    expect(html).not.toContain('仪表盘')
    expect(html).not.toContain('返回')
  })
})
