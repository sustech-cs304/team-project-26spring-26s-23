import { describe, expect, it } from 'vitest'

import {
  createPreflightErrorDetail,
  createRuntimeRequestErrorDetail,
} from './copilot-chat-helpers'
import {
  buildErrorDetailOverlayViewModel,
  createCopilotErrorDetailSource,
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
})
