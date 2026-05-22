import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { CopilotMessageList } from './CopilotMessageList'
import { createRuntimeModelRoute } from './chat-contract.test-support'
import { createIdleCopilotRunState } from './run-segment-reducer'
import { createCopilotModelCatalog } from './model-picker'
import {
  buildCopilotMessageListItems,
  createUserMessageListItem,
  type CopilotMessageListItem,
} from './run-segment-view-model'
import type { CopilotRunState } from './types'
import { createProviderProfile } from '../../workbench/settings/settings-workspace-test-fixtures'

// Duplicate-string constants extracted for sonarjs/no-duplicate-string
const DESC_CN_008 = 'Shenzhen：晴 / 24°C / 湿度 60%'
const LABEL_HTTPS_API_EXAMPLE = 'https://api.example.com/v1'
const LABEL_LOCATION_SHENZHEN = '{"location":"Shenzhen"}'
const LABEL_OPENAI_COMPATIBLE = 'openai-compatible'
const LABEL_OPENAI_GPT = 'openai/gpt-4.1'
const LABEL_PROVIDER_OPENAI = 'provider-openai'
const LABEL_TOOL_REMOTE_SEARCH = 'tool.remote-search'
const LABEL_TOOL_REMOTE_SEARCH_2 = 'tool.remote-search:call-1'


/* eslint-disable-next-line max-lines-per-function */
describe('CopilotMessageList segment rendering', () => {
  describe('assistant headers and model fallback', () => {
    it('renders assistant headers with catalog icon and model name instead of the fixed assistant label', () => {
      const modelCatalog = createTestModelCatalog()
      const conversation: CopilotMessageListItem[] = [
        {
          id: 'assistant:run-streaming:1',
          kind: 'assistant',
          runId: 'run-streaming',
          sequence: 1,
          title: '助手响应',
          content: '正在生成内容',
          status: 'streaming',
          resolvedModelId: LABEL_OPENAI_GPT,
          resolvedModelRoute: createRuntimeModelRoute({
            providerProfileId: LABEL_PROVIDER_OPENAI,
            snapshot: {
              provider: 'openai',
              endpointType: LABEL_OPENAI_COMPATIBLE,
              baseUrl: LABEL_HTTPS_API_EXAMPLE,
              modelId: LABEL_OPENAI_GPT,
            },
          }),
          resolvedToolIds: [],
          requestOptions: {},
        },
        {
          id: 'tool:run-streaming:tool.remote-search:call-1',
          kind: 'tool',
          runId: 'run-streaming',
          sequence: 2,
          status: 'completed',
          toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
          toolId: LABEL_TOOL_REMOTE_SEARCH,
          toolPhase: 'completed',
          title: '天气工具已返回结果',
          content: DESC_CN_008,
          inputSummary: null,
          resultSummary: null,
          errorSummary: null,
        },
      ]

      const html = renderToStaticMarkup(
        <CopilotMessageList conversation={conversation} models={modelCatalog.models} />,
      )

      expect(html).not.toContain('助手响应')
      expect(html).toContain('GPT 4.1')
      expect(html).toContain('chat-message-assistant-icon-0')
      expect(html).toContain('GPT 4.1 图标')
      expect(html).toContain('正在生成内容')
      expect(html).toContain('天气工具被调用')
      expect(html).not.toContain('天气工具已返回结果')
      expect(html).not.toContain(DESC_CN_008)
      expect(html).toContain('chat-message-tool-toggle-1')
      expect(html).not.toContain('chat-message-tool-panel-1')
      expect(html).toContain('copilot-chat__message--streaming')
      expect(html).toContain('copilot-chat__message--completed')
      expect(html).not.toContain('流式输出中')
      expect(html).not.toContain('已完成')
    })

    it('falls back to resolved model id when the catalog entry no longer exists', () => {
      const conversation: CopilotMessageListItem[] = [{
        id: 'assistant:run-fallback:1',
        kind: 'assistant',
        runId: 'run-fallback',
        sequence: 1,
        title: '助手响应',
        content: '模型目录已经变更。',
        status: 'completed',
        resolvedModelId: 'legacy/retired-model',
        resolvedModelRoute: createRuntimeModelRoute({
          providerProfileId: 'provider-legacy',
          snapshot: {
            provider: 'openai',
            endpointType: LABEL_OPENAI_COMPATIBLE,
            baseUrl: LABEL_HTTPS_API_EXAMPLE,
            modelId: 'legacy/retired-model',
          },
        }),
        resolvedToolIds: [],
        requestOptions: {},
      }]

      const html = renderToStaticMarkup(
        <CopilotMessageList conversation={conversation} models={createTestModelCatalog().models} />,
      )

      expect(html).not.toContain('助手响应')
      expect(html).toContain('legacy/retired-model')
      expect(html).toContain('legacy/retired-model 图标')
    })
  })

  // 包含 2 个紧密相关的排序/渲染测试，拆分会导致语义分组不自然
  /* eslint-disable-next-line max-lines-per-function */
  describe('segment ordering and tool rendering', () => {
    it('renders assistant → tool → assistant in segment order', () => {
      const html = renderConversation({
        ...createIdleCopilotRunState(),
        phase: 'completed',
        runId: 'run-1',
        threadId: 'session-1',
        resolvedModelId: 'qwen-plus',
        resolvedModelRoute: createRuntimeModelRoute(),
        resolvedToolIds: [LABEL_TOOL_REMOTE_SEARCH],
        requestOptions: { trace: true },
        segments: [
          {
            id: 'assistant:run-1:1',
            kind: 'assistant',
            runId: 'run-1',
            assistantMessageId: 'run-1:assistant',
            text: '第一段',
            firstContentSequence: 1,
            startedSequence: 1,
            lastSequence: 1,
            status: 'completed',
            resolvedModelId: null,
            resolvedModelRoute: null,
            resolvedToolIds: [],
            requestOptions: {},
          },
          {
            id: 'tool:run-1:tool.remote-search:call-1',
            kind: 'tool',
            runId: 'run-1',
            startedSequence: 2,
            lastSequence: 3,
            status: 'completed',
            toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
            toolId: LABEL_TOOL_REMOTE_SEARCH,
            toolPhase: 'completed',
            title: '天气工具已返回结果',
            summary: DESC_CN_008,
            inputSummary: LABEL_LOCATION_SHENZHEN,
            resultSummary: DESC_CN_008,
            errorSummary: null,
          },
          {
            id: 'assistant:run-1:2',
            kind: 'assistant',
            runId: 'run-1',
            assistantMessageId: 'run-1:assistant',
            text: '第二段',
            firstContentSequence: 4,
            startedSequence: 4,
            lastSequence: 4,
            status: 'completed',
            resolvedModelId: 'qwen-plus',
            resolvedModelRoute: createRuntimeModelRoute(),
            resolvedToolIds: [LABEL_TOOL_REMOTE_SEARCH],
            requestOptions: { trace: true },
          },
          {
            id: 'terminal:run-1:completed',
            kind: 'terminal',
            runId: 'run-1',
            startedSequence: 5,
            lastSequence: 5,
            status: 'completed',
            terminalPhase: 'completed',
            assistantMessageId: 'run-1:assistant',
            cancelReason: null,
            failure: null,
            resolvedModelId: 'qwen-plus',
            resolvedModelRoute: createRuntimeModelRoute(),
            resolvedToolIds: [LABEL_TOOL_REMOTE_SEARCH],
            requestOptions: { trace: true },
          },
        ],
      })

      expect(html).toContain('第一段')
      expect(html).toContain('天气工具被调用')
      expect(html).toContain('第二段')
      expect(html.indexOf('第一段')).toBeLessThan(html.indexOf('天气工具被调用'))
      expect(html.indexOf('天气工具被调用')).toBeLessThan(html.indexOf('第二段'))
    })

    it('renders skill tool calls as normal tool cards without skill activity chrome or leaked body text', () => {
      const html = renderConversation({
        ...createIdleCopilotRunState(),
        phase: 'completed',
        runId: 'run-skill',
        threadId: 'session-1',
        segments: [
          {
            id: 'diagnostic:run-skill:2',
            kind: 'diagnostic',
            runId: 'run-skill',
            startedSequence: 2,
            lastSequence: 2,
            status: 'completed',
            diagnostic: {
              code: 'skill_index_loaded',
              message: 'Skill index loaded for this run.',
              stage: 'load_skill_index',
              details: {
                snapshotRevision: 8,
              },
            },
          },
          {
            id: 'tool:run-skill:skill.activate:call-1',
            kind: 'tool',
            runId: 'run-skill',
            startedSequence: 3,
            lastSequence: 3,
            status: 'completed',
            toolCallId: 'skill.activate:call-1',
            toolId: 'skill.activate',
            toolPhase: 'completed',
            title: '技能激活已返回结果',
            summary: '{"ok":true,"skillId":"writing-clear-docs","displayName":"清晰文档写作","entryContentLength":120,"resourceCount":1}',
            inputSummary: '{"skill_id":"writing-clear-docs"}',
            resultSummary: '{"ok":true,"skillId":"writing-clear-docs","displayName":"清晰文档写作","entryContentLength":120,"resourceCount":1}',
            errorSummary: null,
          },
          {
            id: 'tool:run-skill:skill.read_resource:call-2',
            kind: 'tool',
            runId: 'run-skill',
            startedSequence: 4,
            lastSequence: 4,
            status: 'failed',
            toolCallId: 'skill.read_resource:call-2',
            toolId: 'skill.read_resource',
            toolPhase: 'failed',
            title: '技能资源读取调用失败',
            summary: '内部 Skill 控制工具调用失败。',
            inputSummary: '{"path":"resources/checklist.md","skill_id":"writing-clear-docs"}',
            resultSummary: null,
            errorSummary: '{"errorCode":"resource_not_found","path":"resources/checklist.md","skillId":"writing-clear-docs","content":"Prefer structure","message":"Skill resource was not found in the enabled skill snapshot resource index."}',
          },
        ],
      })

      expect(html).toContain('技能激活被调用')
      expect(html).toContain('技能资源读取调用失败')
      expect(html).not.toContain('Skill 活动')
      expect(html).not.toContain('技能索引已加载')
      expect(html).not.toContain('Prefer structure')
      expect(html).not.toContain('SKILL.md')
      expect(html).not.toContain('skill activity')
    })
  })


  describe('markdown and code rendering', () => {
    it('renders assistant content as structured markdown with dividers, MathJax formulas, and highlighted code blocks', () => {
      const modelCatalog = createTestModelCatalog()
      const conversation: CopilotMessageListItem[] = [{
        id: 'assistant:run-markdown:1',
        kind: 'assistant',
        runId: 'run-markdown',
        sequence: 1,
        title: '助手响应',
        content: '# 标题\n\n---\n\n- 列表项\n\n**加粗** 与 `代码`\n\n```python\ndef bubble_sort(items):\n    return sorted(items)\n```\n\n行内公式 $E = mc^2$\n\n$$\na^2+b^2=c^2\n$$\n\n| 列 | 值 |\n| --- | --- |\n| A | B |',
        status: 'completed',
        resolvedModelId: LABEL_OPENAI_GPT,
        resolvedModelRoute: createRuntimeModelRoute({
          providerProfileId: LABEL_PROVIDER_OPENAI,
          snapshot: {
            provider: 'openai',
            endpointType: LABEL_OPENAI_COMPATIBLE,
            baseUrl: LABEL_HTTPS_API_EXAMPLE,
            modelId: LABEL_OPENAI_GPT,
          },
        }),
        resolvedToolIds: [],
        requestOptions: {},
      }]

      const html = renderToStaticMarkup(
        <CopilotMessageList conversation={conversation} models={modelCatalog.models} />,
      )

      expect(html).toContain('<h1>标题</h1>')
      expect(html).toContain('<hr')
      expect(html).toContain('copilot-chat__markdown-divider')
      expect(html).toContain('<ul>')
      expect(html).toContain('<li>列表项</li>')
      expect(html).toContain('<strong>加粗</strong>')
      expect(html).toContain('<code class="copilot-chat__inline-code">代码</code>')
      expect(html).toContain('copilot-chat__code-block')
      expect(html).toContain('copilot-chat__code-block-language">Python</span>')
      expect(html).toContain('data-code-block-action="copy"')
      expect(html).toContain('data-code-block-action="download"')
      expect(html).toContain('data-code-block-action="wrap"')
      expect(html).toContain('hljs language-python')
      expect(html).toContain('<table>')
      expect(html).toContain('mjx-container')
      expect(html).toContain('jax="SVG"')
      expect(html).not.toContain('**加粗**')
      expect(html).not.toContain('| --- |')
      expect(html).toContain('copilot-chat__message-text--markdown')
    })

    it('renders fenced code blocks without a declared language as block code instead of inline code', () => {
      const modelCatalog = createTestModelCatalog()
      const conversation: CopilotMessageListItem[] = [{
        id: 'assistant:run-markdown-no-language:1',
        kind: 'assistant',
        runId: 'run-markdown-no-language',
        sequence: 1,
        title: '助手响应',
        content: '```\nconst answer = 42\n```',
        status: 'completed',
        resolvedModelId: LABEL_OPENAI_GPT,
        resolvedModelRoute: createRuntimeModelRoute({
          providerProfileId: LABEL_PROVIDER_OPENAI,
          snapshot: {
            provider: 'openai',
            endpointType: LABEL_OPENAI_COMPATIBLE,
            baseUrl: LABEL_HTTPS_API_EXAMPLE,
            modelId: LABEL_OPENAI_GPT,
          },
        }),
        resolvedToolIds: [],
        requestOptions: {},
      }]

      const html = renderToStaticMarkup(
        <CopilotMessageList conversation={conversation} models={modelCatalog.models} />,
      )

      expect(html).toContain('copilot-chat__code-block')
      expect(html).toContain('copilot-chat__code-block-language">Text</span>')
      expect(html).toContain('<pre class="copilot-chat__code-block-pre"><code class="hljs">const answer = 42\n</code></pre>')
      expect(html).not.toContain('copilot-chat__inline-code">const answer = 42')
    })

    it('renders typst fenced blocks with the local fallback highlighter', () => {
      const modelCatalog = createTestModelCatalog()
      const conversation: CopilotMessageListItem[] = [{
        id: 'assistant:run-markdown-typst:1',
        kind: 'assistant',
        runId: 'run-markdown-typst',
        sequence: 1,
        title: '助手响应',
        content: '```typst\n#set text(size: 12pt)\n= Course Note\n// comment\n```',
        status: 'completed',
        resolvedModelId: LABEL_OPENAI_GPT,
        resolvedModelRoute: createRuntimeModelRoute({
          providerProfileId: LABEL_PROVIDER_OPENAI,
          snapshot: {
            provider: 'openai',
            endpointType: LABEL_OPENAI_COMPATIBLE,
            baseUrl: LABEL_HTTPS_API_EXAMPLE,
            modelId: LABEL_OPENAI_GPT,
          },
        }),
        resolvedToolIds: [],
        requestOptions: {},
      }]

      const html = renderToStaticMarkup(
        <CopilotMessageList conversation={conversation} models={modelCatalog.models} />,
      )

      expect(html).toContain('copilot-chat__code-block-language">Typst</span>')
      expect(html).toContain('data-language-id="typst"')
      expect(html).toContain('hljs language-typst')
      expect(html).toContain('<span class="hljs-keyword">#set</span>')
      expect(html).toContain('<span class="hljs-number">12pt</span>')
      expect(html).toContain('<span class="hljs-title">= Course Note</span>')
      expect(html).toContain('<span class="hljs-comment">// comment</span>')
    })
  })

  describe('user content and forms', () => {
    it('keeps user content as plain text and does not render markdown syntax as html', () => {
      const html = renderToStaticMarkup(
        <CopilotMessageList
          conversation={[createUserMessageListItem('**用户原文**\n第二行')]}
          models={createTestModelCatalog().models}
        />,
      )

      expect(html).toContain(`**用户原文**
第二行`)
      expect(html).toContain('copilot-chat__message-text--plain')
      expect(html).not.toContain('<strong>用户原文</strong>')
      expect(html).not.toContain('<br/>')
    })

    it('projects and renders controlled inline form segments inside the chat stream', () => {
      const html = renderConversation({
        ...createIdleCopilotRunState(),
        phase: 'completed',
        runId: 'run-form-1',
        threadId: 'session-1',
        segments: [
          {
            id: 'inline-form:run-form-1:tool.request-user-form:call-1',
            kind: 'inline-form',
            runId: 'run-form-1',
            startedSequence: 2,
            lastSequence: 2,
            status: 'completed',
            toolCallId: 'tool.request-user-form:call-1',
            toolId: 'tool.request-user-form',
            formId: 'course-search-form',
            title: '补充课程查询条件',
            summary: '请填写课程编码与学期。',
            description: '仅用于继续当前对话。',
            submitLabel: '提交表单',
            fields: [
              {
                name: 'courseCode',
                label: '课程编码',
                type: 'text',
                required: true,
              },
              {
                name: 'term',
                label: '学期',
                type: 'select',
                required: true,
                options: [
                  { value: '2026-spring', label: '2026 春' },
                ],
              },
            ],
            formState: 'pending',
            formValues: {
              courseCode: '',
              term: '',
            },
            submittedPayload: null,
          },
        ],
      })

      expect(html).toContain('chat-message-inline-form-card-1')
      expect(html).toContain('补充课程查询条件')
      expect(html).toContain('课程编码')
      expect(html).toContain('学期')
      expect(html).toContain('提交表单')
    })

    it('renders submitted inline forms as readonly history entries', () => {
      const html = renderConversation({
        ...createIdleCopilotRunState(),
        phase: 'completed',
        runId: 'run-form-2',
        threadId: 'session-1',
        segments: [
          {
            id: 'inline-form:run-form-2:tool.request-user-form:call-1',
            kind: 'inline-form',
            runId: 'run-form-2',
            startedSequence: 2,
            lastSequence: 2,
            status: 'completed',
            toolCallId: 'tool.request-user-form:call-1',
            toolId: 'tool.request-user-form',
            formId: 'course-search-form',
            title: '补充课程查询条件',
            summary: '请填写课程编码与学期。',
            description: null,
            submitLabel: '提交表单',
            fields: [
              {
                name: 'courseCode',
                label: '课程编码',
                type: 'text',
                required: true,
              },
            ],
            formState: 'submitted',
            formValues: {
              courseCode: 'CS304',
            },
            submittedPayload: {
              type: 'inline_form_submission',
            },
          },
        ],
      })

      expect(html).not.toContain('chat-message-inline-form-readonly-1')
      expect(html).toContain('CS304')
      expect(html).not.toContain('chat-message-inline-form-submit-1')
    })
  })

  describe('CSS verification', () => {
    it('uses a dedicated assistant markdown divider style instead of the old dotted visual', () => {
      const cssFilePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), './copilot-message-list.css')
      const css = readFileSync(cssFilePath, 'utf8')

      expect(css).toContain('.copilot-chat__markdown-divider')
      expect(css).toContain('border-top: 1px solid')
      expect(css).not.toContain('radial-gradient')
      expect(css).not.toContain('border-style: dotted')
    })

    it('styles assistant code blocks with a theme-aware shell and token colors', () => {
      const cssFilePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), './copilot-message-list.css')
      const css = readFileSync(cssFilePath, 'utf8')

      expect(css).toContain('.copilot-chat__code-block')
      expect(css).toContain('.copilot-chat__code-block-header')
      expect(css).toContain('.copilot-chat__code-block-language')
      expect(css).toContain('.copilot-chat__code-block-actions')
      expect(css).toContain('.copilot-chat__code-block-action')
      expect(css).toContain('.copilot-chat__code-block--nowrap .copilot-chat__code-block-pre code')
      expect(css).toContain('--copilot-code-block-bg:')
      expect(css).toContain('--copilot-code-text: #253044;')
      expect(css).toContain(":root[data-theme='dark'] .copilot-chat")
      expect(css).toContain('--copilot-code-text: #e2e8f0;')
      expect(css).toContain('.copilot-chat__code-block-pre .hljs-keyword')
      expect(css).toContain('color: var(--copilot-code-keyword);')
      expect(css).toContain('white-space: pre-wrap;')
      expect(css).toContain('white-space: pre;')
      expect(css).toContain('.copilot-chat__inline-code')
    })

    it('uses pre-wrap semantics for multiline user messages', () => {
      const cssFilePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), './copilot-message-list.css')
      const css = readFileSync(cssFilePath, 'utf8')

      expect(css).toContain('.copilot-chat__message-text--plain')
      expect(css).toContain('white-space: pre-wrap;')
    })
  })

  describe('approval actions', () => {
    it('renders approval action buttons without the legacy waiting callout', () => {
      const html = renderConversation({
        phase: 'streaming',
        runId: 'run-1',
        threadId: 'session-1',
        activeModelRoute: null,
        resolvedModelId: null,
        resolvedModelRoute: null,
        resolvedToolIds: [],
        requestOptions: {},
        requestedThinkingSelection: null,
        appliedThinkingSelection: null,
        requestedThinkingLevel: null,
        appliedThinkingLevel: null,
        thinkingCapabilitySnapshot: null,
        thinkingSeriesDecision: null,
        reasoningSuppressionBasis: null,
        reasoningSuppressed: false,
        reasoningTraceState: 'not_observed',
        diagnostic: null,
        failure: null,
        cancelReason: null,
        segments: [{
          id: 'tool:run-1:tool.remote-search:call-1',
          kind: 'tool',
          runId: 'run-1',
          startedSequence: 2,
          lastSequence: 2,
          status: 'streaming',
          toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
          toolId: LABEL_TOOL_REMOTE_SEARCH,
          toolPhase: 'waiting_approval',
          title: '等待批准',
          summary: '需要批准后继续。',
          inputSummary: LABEL_LOCATION_SHENZHEN,
          resultSummary: null,
          errorSummary: null,
          approval: {
            mode: 'delay',
            approvalMethod: 'accept_reject',
            riskLevel: 'high',
            timeoutAt: '2026-04-17T16:00:30Z',
            timeoutSeconds: 30,
            timeoutAction: 'deny',
          },
        }],
      })

      expect(html).toContain('拒绝（0s）')
      expect(html).toContain('批准')
      expect(html).not.toContain('等待批准')
      expect(html).not.toContain('后自动拒绝')
    })
  })
})

function createTestModelCatalog() {
  return createCopilotModelCatalog([
    createProviderProfile({
      id: LABEL_PROVIDER_OPENAI,
      name: 'OpenAI Compatible',
      availableModels: [
        {
          id: 'provider-openai:openai/gpt-4.1',
          modelId: LABEL_OPENAI_GPT,
          displayName: 'GPT 4.1',
          groupName: 'OpenAI',
          capabilities: ['reasoning', 'tools'],
          supportsStreaming: true,
          currency: 'usd',
          inputPrice: '1',
          outputPrice: '2',
        },
      ],
    }),
  ])
}

function renderConversation(runState: CopilotRunState): string {
  const conversation = buildCopilotMessageListItems({
    history: [createUserMessageListItem('请先查天气再回答')],
    runState,
  })

  return renderToStaticMarkup(
    <CopilotMessageList conversation={conversation} models={createTestModelCatalog().models} />,
  )
}