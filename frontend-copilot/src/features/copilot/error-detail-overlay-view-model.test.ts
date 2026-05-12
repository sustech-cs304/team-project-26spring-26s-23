import { describe, expect, it } from 'vitest'

import {
  createPreflightErrorDetail,
  createRuntimeRequestErrorDetail,
} from './copilot-chat-helpers'
import {
  buildErrorDetailOverlayViewModel,
  createCopilotErrorDetailSource,
  parseErrorDetailJsonTextForViewer,
} from './error-detail-overlay-view-model'
import { RuntimeRequestError } from './thread-run-contract'
import { createRuntimeModelRoute } from './thread-run-contract.test-support'

// Duplicate-string constants extracted for sonarjs/no-duplicate-string
const DESC_CN_005 = '工具执行失败，请重试。'
const DESC_CN_008 = '原始 details'
const LABEL_OPENAI_GPT = 'openai/gpt-4.1'
const LABEL_RAW_DETAILS = 'raw-details'
const LABEL_REQUEST_CONTEXT = 'request-context'
const LABEL_RUN_STREAM = 'run/stream'
const LABEL_TOOL_CALL = 'tool-call-1'
const LABEL_TOOL_MODEL_CONTEXT = 'tool-model-context'
const LABEL_TOOL_REMOTE_SEARCH = 'tool.remote-search'


/* eslint-disable-next-line max-lines-per-function -- 测试文件包含多个集中 describe 分组，拆分将破坏语义完整性 */
describe('error detail overlay view model', () => {
  describe('group ordering', () => {
    it('maps preflight, run-start, and streaming failures into the same stable group order', () => {
    const preflight = buildErrorDetailOverlayViewModel(createPreflightErrorDetail({
      summaryMessage: '请求选项格式无效，请检查 JSON。',
      rawMessage: 'Unexpected token } in JSON at position 4',
      code: 'request_options_invalid',
      details: {
        requestOptionsText: '{ trace: true }',
      },
      resolvedModelId: LABEL_OPENAI_GPT,
      resolvedModelRoute: createRuntimeModelRoute({
        providerProfileId: 'provider-openai',
        modelId: LABEL_OPENAI_GPT,
      }),
      resolvedToolIds: [LABEL_TOOL_REMOTE_SEARCH],
      requestOptions: {
        trace: true,
      },
    }))
    const runStart = buildErrorDetailOverlayViewModel(createRuntimeRequestErrorDetail({
      error: new RuntimeRequestError('tool_not_found: unknown tool', {
        code: 'tool_not_found',
        status: 400,
        details: {
          supportedMethods: ['run/start'],
        },
      }),
      stage: 'run-start',
      requestedMethod: 'run/start',
      resolvedModelId: LABEL_OPENAI_GPT,
      resolvedModelRoute: createRuntimeModelRoute({
        providerProfileId: 'provider-openai',
        modelId: LABEL_OPENAI_GPT,
      }),
      resolvedToolIds: [LABEL_TOOL_REMOTE_SEARCH],
      requestOptions: {
        trace: true,
      },
    }))
    const streaming = buildErrorDetailOverlayViewModel(createCopilotErrorDetailSource({
      source: 'streaming',
      title: '发送失败',
      summaryMessage: DESC_CN_005,
      rawMessage: 'Tool failed: boom',
      code: 'tool_execution_failed',
      stage: 'streaming',
      requestedMethod: LABEL_RUN_STREAM,
      details: {
        toolId: LABEL_TOOL_REMOTE_SEARCH,
      },
      resolvedModelId: LABEL_OPENAI_GPT,
      resolvedModelRoute: createRuntimeModelRoute({
        providerProfileId: 'provider-openai',
        modelId: LABEL_OPENAI_GPT,
      }),
      resolvedToolIds: [LABEL_TOOL_REMOTE_SEARCH],
      requestOptions: {
        trace: true,
      },
    }))

    expect(preflight.groups.map((group) => group.key)).toEqual([
      'summary',
      LABEL_REQUEST_CONTEXT,
      LABEL_TOOL_MODEL_CONTEXT,
      LABEL_RAW_DETAILS,
    ])
    expect(runStart.groups.map((group) => group.key)).toEqual([
      'summary',
      LABEL_REQUEST_CONTEXT,
      LABEL_TOOL_MODEL_CONTEXT,
      LABEL_RAW_DETAILS,
    ])
    expect(streaming.groups.map((group) => group.key)).toEqual([
      'summary',
      LABEL_REQUEST_CONTEXT,
      LABEL_TOOL_MODEL_CONTEXT,
      LABEL_RAW_DETAILS,
    ])
  })

  it('keeps only the summary group and a restrained empty state when no extra fields exist', () => {
    const viewModel = buildErrorDetailOverlayViewModel(createCopilotErrorDetailSource({
      source: 'preflight',
      title: '发送失败',
      summaryMessage: '请输入消息内容后再发送。',
    }))

    expect(viewModel.groups.map((group) => group.key)).toEqual(['summary'])
    expect(viewModel.hasAdditionalDetails).toBe(false)
    expect(viewModel.emptyStateMessage).toBe('暂无更多详情')
  })

  it('omits empty middle groups while keeping raw details last', () => {
    const viewModel = buildErrorDetailOverlayViewModel(createCopilotErrorDetailSource({
      source: 'run-start',
      title: '发送失败',
      summaryMessage: '当前响应失败，请重试。',
      rawMessage: 'route rejected',
      code: 'adapter_missing',
      stage: 'run-start',
      requestedMethod: 'run/start',
      details: {
        providerId: 'openrouter',
      },
    }))

    expect(viewModel.groups.map((group) => group.key)).toEqual([
      'summary',
      LABEL_REQUEST_CONTEXT,
      LABEL_RAW_DETAILS,
    ])
    expect(viewModel.groups[viewModel.groups.length - 1]?.key).toBe(LABEL_RAW_DETAILS)
    })
  })

  /* eslint-disable-next-line max-lines-per-function -- 多个工具失败场景测试集中于同一 describe，拆分降低可读性 */
  describe('tool failure details', () => {
    it('preserves traceback diagnostics in the raw details group for streaming tool failures', () => {
    const traceback = [
      'Traceback (most recent call last):',
      '  File "/workspace/backend/tool.py", line 42, in invoke',
      '    raise RuntimeError("blackboard search exploded")',
      'RuntimeError: blackboard search exploded',
    ].join('\n')
    const viewModel = buildErrorDetailOverlayViewModel(createCopilotErrorDetailSource({
      source: 'streaming',
      title: '发送失败',
      summaryMessage: DESC_CN_005,
      rawMessage: 'blackboard search exploded',
      code: 'execution_failed',
      stage: 'streaming',
      requestedMethod: LABEL_RUN_STREAM,
      details: {
        toolId: 'blackboard.course_catalog.search',
        toolCallId: LABEL_TOOL_CALL,
        exceptionType: 'RuntimeError',
        exceptionMessage: 'blackboard search exploded',
        traceback,
        diagnosticContext: {
          integration: 'blackboard',
        },
      },
      resolvedToolIds: ['blackboard.course_catalog.search'],
    }))
    const rawDetailsItem = viewModel.groups
      .find((group) => group.key === LABEL_RAW_DETAILS)
      ?.items.find((item) => item.kind === 'text' && item.label === DESC_CN_008)

    expect(rawDetailsItem).toMatchObject({
      kind: 'text',
      label: DESC_CN_008,
      presentation: 'json',
      structuredValue: {
        toolId: 'blackboard.course_catalog.search',
        toolCallId: LABEL_TOOL_CALL,
        exceptionType: 'RuntimeError',
        exceptionMessage: 'blackboard search exploded',
        traceback,
        diagnosticContext: {
          integration: 'blackboard',
        },
      },
    })
    expect(rawDetailsItem?.kind).toBe('text')
    if (rawDetailsItem?.kind === 'text') {
      expect(rawDetailsItem.text).toContain('Traceback (most recent call last):')
      expect(rawDetailsItem.text).toContain('RuntimeError: blackboard search exploded')
    }
  })

  it('maps MCP failure details into stable technical fields with fallback placeholders', () => {
    const viewModel = buildErrorDetailOverlayViewModel(createCopilotErrorDetailSource({
      source: 'streaming',
      title: '工具调用失败',
      summaryMessage: DESC_CN_005,
      rawMessage: 'remote tool error',
      code: 'tool_execution_failed',
      stage: 'streaming',
      requestedMethod: LABEL_RUN_STREAM,
      details: {
        toolId: 'mcp.mcp-stdio-stub.search-campus.00004d8d',
        toolCallId: LABEL_TOOL_CALL,
        serverId: 'mcp-stdio-stub',
        serverName: 'stdio stub server',
        remoteToolName: 'search-campus',
        phase: 'tools/call',
        diagnosticSummary: 'connector ready but remote tool returned error',
        stderrSummary: 'stderr tail',
        snapshotRevision: 12,
      },
    }))

    expect(viewModel.groups.find((group) => group.key === LABEL_REQUEST_CONTEXT)?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'key-value', label: '调用阶段', value: 'tools/call' }),
        expect.objectContaining({ kind: 'key-value', label: '快照版本', value: '12' }),
        expect.objectContaining({ kind: 'key-value', label: '目录版本', value: '未提供' }),
      ]),
    )
    expect(viewModel.groups.find((group) => group.key === LABEL_TOOL_MODEL_CONTEXT)?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'key-value', label: '工具名称', value: 'search-campus' }),
        expect.objectContaining({ kind: 'key-value', label: 'toolId', value: 'mcp.mcp-stdio-stub.search-campus.00004d8d' }),
        expect.objectContaining({ kind: 'key-value', label: '服务器名称', value: 'stdio stub server' }),
        expect.objectContaining({ kind: 'key-value', label: 'serverId', value: 'mcp-stdio-stub' }),
      ]),
    )
    expect(viewModel.groups.find((group) => group.key === LABEL_RAW_DETAILS)?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'key-value', label: '诊断摘要', value: 'connector ready but remote tool returned error' }),
        expect.objectContaining({ kind: 'key-value', label: 'stderr 摘要', value: 'stderr tail' }),
      ]),
    )
  })

  it('keeps non-MCP tool failures on the generic detail path even when toolId is present', () => {
    const viewModel = buildErrorDetailOverlayViewModel(createCopilotErrorDetailSource({
      source: 'streaming',
      title: '工具调用失败',
      summaryMessage: DESC_CN_005,
      rawMessage: 'remote search failed',
      code: 'tool_execution_failed',
      stage: 'streaming',
      requestedMethod: LABEL_RUN_STREAM,
      details: {
        toolId: LABEL_TOOL_REMOTE_SEARCH,
        toolCallId: LABEL_TOOL_CALL,
        phase: 'tools/call',
        snapshotRevision: 12,
        catalogVersion: 9,
      },
      resolvedToolIds: [LABEL_TOOL_REMOTE_SEARCH],
    }))

    expect(viewModel.groups.find((group) => group.key === LABEL_REQUEST_CONTEXT)?.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'key-value', label: '调用阶段' }),
        expect.objectContaining({ kind: 'key-value', label: '快照版本' }),
        expect.objectContaining({ kind: 'key-value', label: '目录版本' }),
      ]),
    )
    expect(viewModel.groups.find((group) => group.key === LABEL_TOOL_MODEL_CONTEXT)?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'list', label: '工具', values: [LABEL_TOOL_REMOTE_SEARCH] }),
      ]),
    )
    expect(viewModel.groups.find((group) => group.key === LABEL_TOOL_MODEL_CONTEXT)?.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'key-value', label: 'serverId' }),
        expect.objectContaining({ kind: 'key-value', label: '服务器名称' }),
      ]),
    )
    expect(viewModel.groups.find((group) => group.key === LABEL_RAW_DETAILS)?.items).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'key-value', label: '诊断摘要' }),
        expect.objectContaining({ kind: 'key-value', label: 'stderr 摘要' }),
      ]),
    )
      })
    })
  })

  describe('json parsing', () => {
    it('marks raw details as structured json only when the serialized value is a json object or array', () => {
    const jsonViewModel = buildErrorDetailOverlayViewModel(createCopilotErrorDetailSource({
      source: 'streaming',
      title: '发送失败',
      summaryMessage: DESC_CN_005,
      rawMessage: 'Tool failed: boom',
      details: {
        toolId: LABEL_TOOL_REMOTE_SEARCH,
        retryable: false,
        attempts: [1, 2],
      },
    }))
    const jsonItem = jsonViewModel.groups
      .find((group) => group.key === LABEL_RAW_DETAILS)
      ?.items.find((item) => item.kind === 'text' && item.label === DESC_CN_008)

    expect(jsonItem).toMatchObject({
      kind: 'text',
      label: DESC_CN_008,
      presentation: 'json',
      structuredValue: {
        toolId: LABEL_TOOL_REMOTE_SEARCH,
        retryable: false,
        attempts: [1, 2],
      },
    })

    expect(parseErrorDetailJsonTextForViewer(`{"toolId":"${LABEL_TOOL_REMOTE_SEARCH}"}`)).toEqual({
      toolId: LABEL_TOOL_REMOTE_SEARCH,
    })
    expect(parseErrorDetailJsonTextForViewer('[1,true,{"ok":false}]')).toEqual([1, true, { ok: false }])
    expect(parseErrorDetailJsonTextForViewer('LABEL_TOOL_REMOTE_SEARCH')).toBeNull()
    expect(parseErrorDetailJsonTextForViewer('123')).toBeNull()
    expect(parseErrorDetailJsonTextForViewer('invalid json')).toBeNull()
  })
})
