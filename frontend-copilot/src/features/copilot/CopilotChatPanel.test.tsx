/** @vitest-environment jsdom */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { CopilotChatPanel } from './CopilotChatPanel'
import {
  createDirectoryState,
  createReadyState,
  createSelectedAgent,
  createSessionShell,
} from './CopilotChatPanel.test-support'

const SELECTOR_DATA_TESTID_CHAT = 'data-testid="chat-message-scroll-region"'


declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = undefined
})

/* eslint-disable-next-line max-lines-per-function -- organizational wrapper for all CopilotChatPanel unit tests */
describe('CopilotChatPanel', () => {
  describe('basic rendering', () => {
    it('renders the session-first placeholder when runtime is ready but no session has been created yet', () => {
      const html = renderToStaticMarkup(
        <CopilotChatPanel
          state={createReadyState()}
          retrying={false}
          retry={() => {}}
          selectedAgent={createSelectedAgent()}
          sessionShell={null}
          directoryState={createDirectoryState()}
          sessionStatus="idle"
          sessionError={null}
        />,
      )

      expect(html).toContain('可在左侧选择助手并新建会话')
      expect(html).toContain('data-testid="chat-session-placeholder"')
      expect(html).not.toContain('请选择智能体并创建会话')
      expect(html).not.toContain('当前选择：通用智能体')
      expect(html).not.toContain('会话创建状态：待创建')
      expect(html).not.toContain('尚未创建会话')
      expect(html).not.toContain('会话创建成功后会立即拉取')
      expect(html).not.toContain('当前 Runtime URL')
      expect(html).not.toContain('当前 threadId')
      expect(html).not.toContain('发送消息')
    })

    it('renders the minimal message shell for a bound session without the removed debug information blocks', () => {
      const html = renderToStaticMarkup(
        <CopilotChatPanel
          state={createReadyState()}
          retrying={false}
          retry={() => {}}
          selectedAgent={createSelectedAgent()}
          sessionShell={createSessionShell()}
          directoryState={createDirectoryState()}
          sessionStatus="idle"
          sessionError={null}
        />,
      )

      expect(html).toContain(SELECTOR_DATA_TESTID_CHAT)
      expect(html).toContain('data-testid="chat-composer-dock"')
      expect(html).toContain('data-testid="chat-composer-toolbar"')
      expect(html).toContain('data-testid="chat-composer-resize-handle"')
      expect(html).toContain('data-testid="chat-composer-surface"')
      expect(html).toContain('data-testid="chat-composer-send-button"')
      expect(html).not.toContain('data-testid="chat-composer-run-status"')
      expect(html).toContain('data-testid="chat-tool-picker-trigger"')
      expect(html).toContain('按 Enter 发送，按 Ctrl + Enter 换行')
      expect(html).toContain('copilot-chat__send-button')
      expect(html).toContain('copilot-chat__stream--scrollbarless')
      expect(html).toContain('aria-label="消息内容"')
      expect(html).toContain('尚未配置模型')
      expect(html).toContain('请先前往设置页添加模型服务商和模型。')
      expect(html.indexOf(SELECTOR_DATA_TESTID_CHAT)).toBeLessThan(
        html.indexOf('data-testid="chat-composer-dock"'),
      )
      expect(html.indexOf('data-testid="chat-composer-toolbar"')).toBeLessThan(
        html.indexOf('data-testid="chat-composer-resize-handle"'),
      )
      expect(html.indexOf('data-testid="chat-composer-resize-handle"')).toBeLessThan(
        html.indexOf('data-testid="chat-composer-surface"'),
      )
      expect(html).not.toContain('type="checkbox"')
      expect(html).not.toContain('requestOptions（JSON 对象）')
      expect(html).not.toContain('推荐工具只用于初始化默认勾选')
      expect(html).not.toContain('本阶段只保留最小透传结构')
      expect(html).not.toContain('发送时会显式提交 sessionId')
      expect(html).not.toContain('当前校验 Agent')
      expect(html).not.toContain('当前发送模型')
      expect(html).not.toContain('当前启用工具')
      expect(html).not.toContain('已连接')
      expect(html).not.toContain('当前 Runtime URL')
      expect(html).not.toContain('Runtime 来源')
      expect(html).not.toContain('目录状态')
      expect(html).not.toContain('Capabilities Version')
      expect(html).not.toContain('总体可用工具集合（后端能力面真源）')
      expect(html).not.toContain('当前默认启用来源')
      expect(html).not.toContain('当前 threadId')
    })
  })

})
