import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import type { CopilotBootstrapController } from '../../features/copilot/types'
import { SettingsWorkspace } from './SettingsWorkspace'

describe('SettingsWorkspace', () => {
  it('keeps the existing settings shell intact in the default section', () => {
    const html = renderToStaticMarkup(
      <SettingsWorkspace
        bootstrap={createBootstrapController()}
        themeMode="light"
        onThemeModeChange={vi.fn()}
      />,
    )

    expect(html).toContain('全局设置目录')
    expect(html).toContain('模型服务商')
    expect(html).toContain('设置工作区')
  })

  it('wires the assistant behavior public config card into the general section', () => {
    const html = renderToStaticMarkup(
      <SettingsWorkspace
        bootstrap={createBootstrapController()}
        themeMode="light"
        onThemeModeChange={vi.fn()}
        initialSection="general"
      />,
    )

    expect(html).toContain('常规设置')
    expect(html).toContain('Assistant 行为配置')
    expect(html).toContain('默认 Agent 名称')
  })

  it('wires the development runtime override card into the api section', () => {
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
    expect(html).toContain('不表示普通用户后端地址')
    expect(html).toContain('根层启动摘要')
  })
})

function createBootstrapController(): CopilotBootstrapController {
  return {
    retrying: false,
    retry: vi.fn(),
    state: {
      status: 'ready',
      settings: {
        runtimeUrl: 'http://127.0.0.1:8765',
        agentName: 'campus-agent',
      },
      storageState: 'stored',
      runtime: {
        status: 'ready',
        expectedMode: 'development',
        resolvedMode: 'development',
        runtimeUrl: 'http://127.0.0.1:8765',
        isPackaged: false,
        failure: null,
      },
      runtimeUrl: 'http://127.0.0.1:8765',
      runtimeSource: 'hosted',
      agentName: 'campus-agent',
      agentNameSource: 'settings',
      diagnostics: {
        hostedStatus: 'ready',
        failure: null,
        mode: 'development',
        modeSource: 'resolved',
        runtimeSource: 'hosted',
      },
      devOverrideAllowed: true,
      devOverrideConfigured: false,
    },
  }
}
