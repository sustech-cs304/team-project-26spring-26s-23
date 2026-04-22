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

describe('error detail overlay view model', () => {
  it('maps preflight, run-start, and streaming failures into the same stable group order', () => {
    const preflight = buildErrorDetailOverlayViewModel(createPreflightErrorDetail({
      summaryMessage: '请求选项格式无效，请检查 JSON。',
      rawMessage: 'Unexpected token } in JSON at position 4',
      code: 'request_options_invalid',
      details: {
        requestOptionsText: '{ trace: true }',
      },
      resolvedModelId: 'openai/gpt-4.1',
      resolvedModelRoute: createRuntimeModelRoute({
        providerProfileId: 'provider-openai',
        modelId: 'openai/gpt-4.1',
      }),
      resolvedToolIds: ['tool.remote-search'],
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
      resolvedModelId: 'openai/gpt-4.1',
      resolvedModelRoute: createRuntimeModelRoute({
        providerProfileId: 'provider-openai',
        modelId: 'openai/gpt-4.1',
      }),
      resolvedToolIds: ['tool.weather-current'],
      requestOptions: {
        trace: true,
      },
    }))
    const streaming = buildErrorDetailOverlayViewModel(createCopilotErrorDetailSource({
      source: 'streaming',
      title: '发送失败',
      summaryMessage: '工具执行失败，请重试。',
      rawMessage: 'Tool failed: boom',
      code: 'tool_execution_failed',
      stage: 'streaming',
      requestedMethod: 'run/stream',
      details: {
        toolId: 'tool.weather-current',
      },
      resolvedModelId: 'openai/gpt-4.1',
      resolvedModelRoute: createRuntimeModelRoute({
        providerProfileId: 'provider-openai',
        modelId: 'openai/gpt-4.1',
      }),
      resolvedToolIds: ['tool.weather-current'],
      requestOptions: {
        trace: true,
      },
    }))

    expect(preflight.groups.map((group) => group.key)).toEqual([
      'summary',
      'request-context',
      'tool-model-context',
      'raw-details',
    ])
    expect(runStart.groups.map((group) => group.key)).toEqual([
      'summary',
      'request-context',
      'tool-model-context',
      'raw-details',
    ])
    expect(streaming.groups.map((group) => group.key)).toEqual([
      'summary',
      'request-context',
      'tool-model-context',
      'raw-details',
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
      'request-context',
      'raw-details',
    ])
    expect(viewModel.groups[viewModel.groups.length - 1]?.key).toBe('raw-details')
  })

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
      summaryMessage: '工具执行失败，请重试。',
      rawMessage: 'blackboard search exploded',
      code: 'execution_failed',
      stage: 'streaming',
      requestedMethod: 'run/stream',
      details: {
        toolId: 'blackboard.course_catalog.search',
        toolCallId: 'tool-call-1',
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
      .find((group) => group.key === 'raw-details')
      ?.items.find((item) => item.kind === 'text' && item.label === '原始 details')

    expect(rawDetailsItem).toMatchObject({
      kind: 'text',
      label: '原始 details',
      presentation: 'json',
      structuredValue: {
        toolId: 'blackboard.course_catalog.search',
        toolCallId: 'tool-call-1',
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
      summaryMessage: '工具执行失败，请重试。',
      rawMessage: 'remote tool error',
      code: 'tool_execution_failed',
      stage: 'streaming',
      requestedMethod: 'run/stream',
      details: {
        toolId: 'mcp.mcp-stdio-stub.search-campus.00004d8d',
        toolCallId: 'tool-call-1',
        serverId: 'mcp-stdio-stub',
        serverName: 'stdio stub server',
        remoteToolName: 'search-campus',
        phase: 'tools/call',
        diagnosticSummary: 'connector ready but remote tool returned error',
        stderrSummary: 'stderr tail',
        snapshotRevision: 12,
      },
    }))

    expect(viewModel.groups.find((group) => group.key === 'request-context')?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'key-value', label: '调用阶段', value: 'tools/call' }),
        expect.objectContaining({ kind: 'key-value', label: '快照版本', value: '12' }),
        expect.objectContaining({ kind: 'key-value', label: '目录版本', value: '未提供' }),
      ]),
    )
    expect(viewModel.groups.find((group) => group.key === 'tool-model-context')?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'key-value', label: '工具名称', value: 'search-campus' }),
        expect.objectContaining({ kind: 'key-value', label: 'toolId', value: 'mcp.mcp-stdio-stub.search-campus.00004d8d' }),
        expect.objectContaining({ kind: 'key-value', label: '服务器名称', value: 'stdio stub server' }),
        expect.objectContaining({ kind: 'key-value', label: 'serverId', value: 'mcp-stdio-stub' }),
      ]),
    )
    expect(viewModel.groups.find((group) => group.key === 'raw-details')?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'key-value', label: '诊断摘要', value: 'connector ready but remote tool returned error' }),
        expect.objectContaining({ kind: 'key-value', label: 'stderr 摘要', value: 'stderr tail' }),
      ]),
    )
  })

  it('marks raw details as structured json only when the serialized value is a json object or array', () => {
    const jsonViewModel = buildErrorDetailOverlayViewModel(createCopilotErrorDetailSource({
      source: 'streaming',
      title: '发送失败',
      summaryMessage: '工具执行失败，请重试。',
      rawMessage: 'Tool failed: boom',
      details: {
        toolId: 'tool.weather-current',
        retryable: false,
        attempts: [1, 2],
      },
    }))
    const jsonItem = jsonViewModel.groups
      .find((group) => group.key === 'raw-details')
      ?.items.find((item) => item.kind === 'text' && item.label === '原始 details')

    expect(jsonItem).toMatchObject({
      kind: 'text',
      label: '原始 details',
      presentation: 'json',
      structuredValue: {
        toolId: 'tool.weather-current',
        retryable: false,
        attempts: [1, 2],
      },
    })

    expect(parseErrorDetailJsonTextForViewer('{"toolId":"tool.weather-current"}')).toEqual({
      toolId: 'tool.weather-current',
    })
    expect(parseErrorDetailJsonTextForViewer('[1,true,{"ok":false}]')).toEqual([1, true, { ok: false }])
    expect(parseErrorDetailJsonTextForViewer('"tool.weather-current"')).toBeNull()
    expect(parseErrorDetailJsonTextForViewer('123')).toBeNull()
    expect(parseErrorDetailJsonTextForViewer('invalid json')).toBeNull()
  })
})
