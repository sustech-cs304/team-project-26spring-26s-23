import { describe, expect, it, vi } from 'vitest'

import {
  formatErrorDetailOverlayCopyText,
  formatErrorDetailOverlayGroupCopyText,
} from './error-detail-overlay-copy'
import { buildErrorDetailOverlayViewModel, createCopilotErrorDetailSource } from './error-detail-overlay-view-model'

describe('error detail overlay copy helpers', () => {
  it('formats the full copy text as structured plain text without empty sections', () => {
    const viewModel = buildErrorDetailOverlayViewModel(createCopilotErrorDetailSource({
      source: 'run-start',
      title: '发送失败',
      summaryMessage: '当前模型不可用，请重新选择模型。',
      rawMessage: 'provider not enabled',
      code: 'provider_catalog_only',
      stage: 'run-start',
      requestedMethod: 'run/start',
      details: {
        providerId: 'openrouter',
      },
      resolvedModelId: 'openrouter/auto',
      resolvedToolIds: ['tool.weather-current'],
      requestOptions: {
        trace: true,
      },
    }))

    expect(formatErrorDetailOverlayCopyText(viewModel)).toBe([
      '错误详情',
      '',
      '[摘要]',
      '标题: 发送失败',
      '说明: 当前模型不可用，请重新选择模型。',
      '失败阶段: run-start',
      '错误码: provider_catalog_only',
      '',
      '[请求 / 运行上下文]',
      '请求动作: run/start',
      '阶段: run-start',
      '请求选项: {"trace":true}',
      '',
      '[工具 / 模型上下文]',
      '模型: openrouter/auto',
      '工具: tool.weather-current',
      '',
      '[原始详情]',
      '原始消息:',
      'provider not enabled',
      '原始 details:',
      '{',
      '  "providerId": "openrouter"',
      '}',
    ].join('\n'))
  })

  it('includes traceback text in full and group copy output for tool failures', () => {
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
        exceptionType: 'RuntimeError',
        exceptionMessage: 'blackboard search exploded',
        traceback,
      },
      resolvedToolIds: ['blackboard.course_catalog.search'],
    }))

    const rawDetailsGroup = viewModel.groups.find((group) => group.key === 'raw-details')
    expect(rawDetailsGroup).not.toBeUndefined()
    expect(formatErrorDetailOverlayCopyText(viewModel)).toContain('Traceback (most recent call last):')
    expect(formatErrorDetailOverlayCopyText(viewModel)).toContain('RuntimeError: blackboard search exploded')
    expect(formatErrorDetailOverlayGroupCopyText(rawDetailsGroup!)).toContain('Traceback (most recent call last):')
    expect(formatErrorDetailOverlayGroupCopyText(rawDetailsGroup!)).toContain('RuntimeError: blackboard search exploded')
  })

  it('formats a single group copy with only that group content', () => {
    const viewModel = buildErrorDetailOverlayViewModel(createCopilotErrorDetailSource({
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
      resolvedToolIds: ['tool.weather-current'],
    }))

    const toolGroup = viewModel.groups.find((group) => group.key === 'tool-model-context')
    expect(toolGroup).not.toBeUndefined()
    expect(formatErrorDetailOverlayGroupCopyText(toolGroup!)).toBe([
      '[工具 / 模型上下文]',
      '工具: tool.weather-current',
    ].join('\n'))
  })

  it('does not invoke clipboard formatting side effects during pure text formatting', () => {
    const clipboardWriteText = vi.fn()
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: clipboardWriteText,
      },
    })

    const viewModel = buildErrorDetailOverlayViewModel(createCopilotErrorDetailSource({
      source: 'preflight',
      title: '发送失败',
      summaryMessage: '请输入消息内容后再发送。',
    }))

    expect(formatErrorDetailOverlayCopyText(viewModel)).toContain('[摘要]')
    expect(clipboardWriteText).not.toHaveBeenCalled()
  })
})
