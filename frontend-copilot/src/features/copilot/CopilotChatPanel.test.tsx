/** @vitest-environment jsdom */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { CopilotHistoryRunReplaySuccess } from '../../../electron/copilot-history'
import type { AssistantSessionHistoryState } from '../../workbench/assistant/assistant-history-state'
import { createPersistedWorkspaceState } from '../../workbench/settings/test-support/settings-workspace-test-fixtures'
import {
  buildPersistedConversationFromHistory,
  getPersistedInlineFormRebuildability,
} from './persisted-history-view-model'
import { createIdleCopilotRunState } from './run-segment-reducer'
import {
  hasSufficientPersistedConversationForRun,
  resolvePersistedConversationHandoffWaitReason,
} from './state/useCopilotChatPanelState'
import { CopilotChatPanel } from './CopilotChatPanel'
import {
  clickElement,
  createDirectoryState,
  createEmptyState,
  createFailedState,
  createIdleDirectoryState,
  createReadyState,
  createSelectedAgent,
  createSessionShell,
  renderWithRoot,
} from './CopilotChatPanel.test-support'

// Duplicate-string constants extracted for sonarjs/no-duplicate-string
const DESC_CN_012 = '表单请求已发送，等待用户提交。'
const LABEL_2026_13T15 = '2026-04-13T15:00:01Z'
const LABEL_2026_13T15_2 = '2026-04-13T15:00:00Z'
const LABEL_2026_13T15_3 = '2026-04-13T15:05:00Z'
const LABEL_2026_13T15_4 = '2026-04-13T15:00:03Z'
const LABEL_2026_13T15_5 = '2026-04-13T15:00:02Z'
const LABEL_COURSE_FORM = 'course-form'
const LABEL_HISTORY_SHELL = 'history-shell'
const LABEL_INLINE_FORM = 'inline-form'
const LABEL_OPENAI_GPT = 'openai/gpt-4.1'
const LABEL_RUN_FORM_HISTORY = 'run-form-history'
const LABEL_RUN_FORM_PENDING = 'run-form-pending-history'
const LABEL_RUN_REASONING_HISTORY = 'run-reasoning-history'
const LABEL_TOOL_REQUEST_USER = 'tool.request-user-form:call-1'
const LABEL_TOOL_REQUEST_USER_2 = 'tool.request-user-form'
const SELECTOR_DATA_TESTID_CHAT = 'data-testid="chat-message-scroll-region"'
const SELECTOR_DATA_TESTID_CHAT_2 = 'data-testid="chat-history-loading-skeleton"'
const SELECTOR_DATA_TESTID_CHAT_3 = 'data-testid="chat-history-retry-button"'


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
