import { describe, expect, it } from 'vitest'

import { hubWorkspaceContent, isHubWorkspaceView } from './config'
import { getHubWorkspaceContent } from './locale'

describe('workbench hub view configuration', () => {
  it('keeps files as a standalone workspace instead of a hub workspace', () => {
    expect(isHubWorkspaceView('files')).toBe(false)
    expect(isHubWorkspaceView('developer')).toBe(true)
    expect(Object.keys(hubWorkspaceContent)).toEqual(['developer'])
  })

  it('keeps locale hub content aligned with active hub workspace views', () => {
    const developerContent = getHubWorkspaceContent('zh-CN', 'developer')

    expect(developerContent.title).toBe('开发任务与联调面板')
    expect(developerContent.entries.map((entry) => entry.id)).toEqual([
      'dev-tasks',
      'dev-builds',
      'dev-history',
    ])
  })
})
