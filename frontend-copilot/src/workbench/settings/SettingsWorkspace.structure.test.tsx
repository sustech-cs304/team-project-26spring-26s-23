/** @vitest-environment jsdom */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { SettingsWorkspace } from './SettingsWorkspace'
import { createBootstrapController } from './SettingsWorkspace.test-support'

describe('SettingsWorkspace structure', () => {
  it('keeps the settings shell intact while removing the top banner chrome', () => {
    const html = renderToStaticMarkup(
      <SettingsWorkspace
        bootstrap={createBootstrapController()}
        themeMode="light"
        onThemeModeChange={vi.fn()}
      />,
    )

    expect(html).toContain('全局设置目录')
    expect(html).toContain('SUSTech 信息')
    expect(html).toContain('基本信息')
    expect(html).toContain('设置工作区')
    expect(html).not.toContain('当前设置页')
    expect(html).not.toContain('设置布局')
  })

  it('removes assistant behavior and spell-check from the general section', () => {
    const html = renderToStaticMarkup(
      <SettingsWorkspace
        bootstrap={createBootstrapController()}
        themeMode="light"
        onThemeModeChange={vi.fn()}
        initialSection="general"
      />,
    )

    expect(html).toContain('常规设置')
    expect(html).toContain('助手消息通知')
    expect(html).not.toContain('Assistant 行为配置')
    expect(html).not.toContain('默认 Agent 名称')
    expect(html).not.toContain('拼写检查')
  })

  it('keeps only default model routing in the default model section', () => {
    const html = renderToStaticMarkup(
      <SettingsWorkspace
        bootstrap={createBootstrapController()}
        themeMode="light"
        onThemeModeChange={vi.fn()}
        initialSection="default-model"
      />,
    )

    expect(html).toContain('默认模型路由')
    expect(html).toContain('主助手模型')
    expect(html).toContain('快速执行模型')
    expect(html).not.toContain('后端模型')
    expect(html).not.toContain('后端默认模型 ID')
  })

  it('keeps only theme controls in the display section', () => {
    const html = renderToStaticMarkup(
      <SettingsWorkspace
        bootstrap={createBootstrapController()}
        themeMode="dark"
        onThemeModeChange={vi.fn()}
        initialSection="display"
      />,
    )

    expect(html).toContain('显示设置')
    expect(html).toContain('主题')
    expect(html).toContain('class="select-trigger__value">深色</span>')
    expect(html).not.toContain('字号')
    expect(html).not.toContain('界面密度')
    expect(html).not.toContain('启用微动画')
  })

  it('shows the empty provider state on first initialization without seeded provider examples', () => {
    const html = renderToStaticMarkup(
      <SettingsWorkspace
        bootstrap={createBootstrapController()}
        themeMode="light"
        onThemeModeChange={vi.fn()}
        initialSection="model-service"
      />,
    )

    expect(html).toContain('模型服务商')
    expect(html).toContain('可在左侧添加服务商信息')
    expect(html).not.toContain('OpenRouter')
    expect(html).not.toContain('Ollama Local')
    expect(html).not.toContain('BaiLiOpenAI')
  })

  it('keeps the development runtime override card wired into the api section', () => {
    const html = renderToStaticMarkup(
      <SettingsWorkspace
        bootstrap={createBootstrapController()}
        themeMode="light"
        onThemeModeChange={vi.fn()}
        initialSection="api"
      />,
    )

    expect(html).toContain('API 服务器')
    expect(html).toContain('宿主配置（开发态）')
    expect(html).toContain('开发态运行时覆盖地址')
    expect(html).not.toContain('不表示普通用户后端地址')
    expect(html).toContain('根层启动摘要')
  })

  it('keeps sustech and external source pages minimally visible', () => {
    const sustechHtml = renderToStaticMarkup(
      <SettingsWorkspace
        bootstrap={createBootstrapController()}
        themeMode="light"
        onThemeModeChange={vi.fn()}
        initialSection="sustech-info"
      />,
    )
    const externalSourceHtml = renderToStaticMarkup(
      <SettingsWorkspace
        bootstrap={createBootstrapController()}
        themeMode="light"
        onThemeModeChange={vi.fn()}
        initialSection="external-source"
      />,
    )

    expect(sustechHtml).toContain('基本信息')
    expect(sustechHtml).toContain('CAS 密码')
    expect(sustechHtml).toContain('Blackboard 信息')
    expect(externalSourceHtml).toContain('WakeUP 课程群同步')
    expect(externalSourceHtml).toContain('WakeUP 分享链接')
  })

  it('removes safe search and mcp sandbox toggles from their sections', () => {
    const searchHtml = renderToStaticMarkup(
      <SettingsWorkspace
        bootstrap={createBootstrapController()}
        themeMode="light"
        onThemeModeChange={vi.fn()}
        initialSection="search"
      />,
    )
    const mcpHtml = renderToStaticMarkup(
      <SettingsWorkspace
        bootstrap={createBootstrapController()}
        themeMode="light"
        onThemeModeChange={vi.fn()}
        initialSection="mcp"
      />,
    )

    expect(searchHtml).not.toContain('启用安全搜索')
    expect(mcpHtml).not.toContain('启用沙箱保护')
  })
})
