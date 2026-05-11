import { describe, expect, it, vi } from 'vitest'

import {
  applyRuntimeRunEventToCopilotRunState,
  createIdleCopilotRunState,
  createStartingCopilotRunState,
  markCopilotRunCancelled,
} from './run-segment-reducer'
import {
  createRuntimeModelRoute,
  createRuntimeReasoningSuppressionBasis,
  createRuntimeRunCompletedEvent,
  createRuntimeRunMetadataEvent,
  createRuntimeThinkingCapability,
  createRuntimeToolEvent,
} from './thread-run-contract.test-support'

// Duplicate-string constants extracted for sonarjs/no-duplicate-string
const DESC_CN_003 = 'Shenzhen：晴 / 24°C / 湿度 60%'
const LABEL_2026_17T16 = '2026-04-17T16:00:30Z'
const LABEL_LOCATION_SHENZHEN = '{"location":"Shenzhen"}'
const LABEL_RUN_ASSISTANT = 'run-1:assistant'
const LABEL_TOOL_REMOTE_SEARCH = 'tool.remote-search'
const LABEL_TOOL_REMOTE_SEARCH_2 = 'tool.remote-search:call-1'


describe('run segment reducer', () => {
  describe('event merging', () => {
    it('merges compat events into a segment-ready run state with multiple assistant/tool segments', () => {
      const initialState = createStartingCopilotRunState({
        threadId: 'session-1',
        activeModelRoute: createRuntimeModelRoute(),
        requestOptions: { trace: true },
      })

      const stateAfterEvents = [
        {
          type: 'run_started' as const,
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 1,
          payload: {
            assistantMessageId: LABEL_RUN_ASSISTANT,
          },
        },
        {
          type: 'text_delta' as const,
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 2,
          payload: {
            assistantMessageId: LABEL_RUN_ASSISTANT,
            delta: '第一段',
          },
        },
        createRuntimeToolEvent({
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 3,
          payload: {
            toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
            toolId: LABEL_TOOL_REMOTE_SEARCH,
            phase: 'completed',
            title: '天气工具已返回结果',
            summary: DESC_CN_003,
            resultSummary: DESC_CN_003,
          },
        }),
        {
          type: 'text_delta' as const,
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 4,
          payload: {
            assistantMessageId: LABEL_RUN_ASSISTANT,
            delta: '第二段',
          },
        },
        createRuntimeRunCompletedEvent({
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 5,
          payload: {
            assistantMessageId: LABEL_RUN_ASSISTANT,
            assistantText: '第一段第二段',
            resolvedModelId: 'qwen-plus',
            resolvedModelRoute: createRuntimeModelRoute(),
            resolvedToolIds: [LABEL_TOOL_REMOTE_SEARCH],
            requestOptions: { trace: true },
          },
        }),
      ].reduce(applyRuntimeRunEventToCopilotRunState, initialState)

      expect(stateAfterEvents.phase).toBe('completed')
      expect(stateAfterEvents.threadId).toBe('session-1')
      expect(stateAfterEvents.runId).toBe('run-1')
      expect(stateAfterEvents.segments.map((segment) => segment.kind)).toEqual([
        'assistant',
        'tool',
        'assistant',
        'terminal',
      ])
      expect(stateAfterEvents.segments.filter((segment) => segment.kind === 'assistant')).toHaveLength(2)
      expect(stateAfterEvents.segments.find((segment) => segment.kind === 'tool')).toMatchObject({
        kind: 'tool',
        toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
        status: 'completed',
      })
      expect(stateAfterEvents.segments[stateAfterEvents.segments.length - 1]).toMatchObject({
        kind: 'terminal',
        terminalPhase: 'completed',
      })
    })
  })

  describe('failed tool steps', () => {
    it('keeps failed tool steps visible while still allowing the run to complete', () => {
      const initialState = createStartingCopilotRunState({
        threadId: 'session-1',
        activeModelRoute: createRuntimeModelRoute(),
        requestOptions: { trace: true },
      })

      const stateAfterEvents = [
        {
          type: 'run_started' as const,
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 1,
          payload: {
            assistantMessageId: LABEL_RUN_ASSISTANT,
          },
        },
        createRuntimeToolEvent({
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 2,
          payload: {
            toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
            toolId: LABEL_TOOL_REMOTE_SEARCH,
            phase: 'started',
            title: '调用天气工具',
            summary: '正在获取 Shenzhen 的天气。',
            inputSummary: LABEL_LOCATION_SHENZHEN,
          },
        }),
        createRuntimeToolEvent({
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 3,
          payload: {
            toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
            toolId: LABEL_TOOL_REMOTE_SEARCH,
            phase: 'failed',
            title: '工具调用失败',
            summary: '工具执行失败。',
            inputSummary: LABEL_LOCATION_SHENZHEN,
            errorSummary: 'boom',
          },
        }),
        {
          type: 'text_delta' as const,
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 4,
          payload: {
            assistantMessageId: LABEL_RUN_ASSISTANT,
            delta: '我可以解释失败并继续。',
          },
        },
        createRuntimeRunCompletedEvent({
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 5,
          payload: {
            assistantMessageId: LABEL_RUN_ASSISTANT,
            assistantText: '我可以解释失败并继续。',
            resolvedModelId: 'qwen-plus',
            resolvedModelRoute: createRuntimeModelRoute(),
            resolvedToolIds: [LABEL_TOOL_REMOTE_SEARCH],
            requestOptions: { trace: true },
          },
        }),
      ].reduce(applyRuntimeRunEventToCopilotRunState, initialState)

      expect(stateAfterEvents.phase).toBe('completed')
      expect(stateAfterEvents.failure).toBeNull()
      expect(stateAfterEvents.segments.map((segment) => segment.kind)).toEqual([
        'tool',
        'assistant',
        'terminal',
      ])
      expect(stateAfterEvents.segments[0]).toMatchObject({
        kind: 'tool',
        status: 'failed',
        toolPhase: 'failed',
        errorSummary: 'boom',
      })
      expect(stateAfterEvents.segments[1]).toMatchObject({
        kind: 'assistant',
        text: '我可以解释失败并继续。',
        status: 'completed',
      })
      expect(stateAfterEvents.segments[2]).toMatchObject({
        kind: 'terminal',
        terminalPhase: 'completed',
      })
    })
  })

  describe('skill index diagnostics', () => {
    it('keeps skill index diagnostics as diagnostics and renders skill tools as normal tool segments', () => {
      const initialState = createStartingCopilotRunState({
        threadId: 'session-1',
        activeModelRoute: createRuntimeModelRoute(),
        requestOptions: { trace: true },
      })

      const stateAfterEvents = [
        {
          type: 'run_started' as const,
          runId: 'run-skill',
          sessionId: 'session-1',
          sequence: 1,
          payload: {
            assistantMessageId: 'run-skill:assistant',
          },
        },
        {
          type: 'run_diagnostic' as const,
          runId: 'run-skill',
          sessionId: 'session-1',
          sequence: 2,
          payload: {
            code: 'skill_index_loaded',
            message: 'Skill index loaded for this run.',
            stage: 'load_skill_index',
            details: {
              source: 'snapshot-file',
              snapshotRevision: 8,
              registryRevision: 12,
              skillCount: 1,
            },
          },
        },
        createRuntimeToolEvent({
          runId: 'run-skill',
          sessionId: 'session-1',
          sequence: 3,
          payload: {
            toolCallId: 'skill.activate:call-1',
            toolId: 'skill.activate',
            phase: 'completed',
            title: '技能激活已返回结果',
            summary: '{"displayName":"清晰文档写作","entryContentLength":120,"ok":true,"resourceCount":1,"skillId":"writing-clear-docs","snapshotRevision":8}',
            inputSummary: '{"skill_id":"writing-clear-docs"}',
            resultSummary: '{"displayName":"清晰文档写作","entryContentLength":120,"ok":true,"resourceCount":1,"skillId":"writing-clear-docs","snapshotRevision":8}',
          },
        }),
        createRuntimeToolEvent({
          runId: 'run-skill',
          sessionId: 'session-1',
          sequence: 4,
          payload: {
            toolCallId: 'skill.read_resource:call-1',
            toolId: 'skill.read_resource',
            phase: 'failed',
            title: '技能资源读取调用失败',
            summary: '内部 Skill 控制工具调用失败。',
            inputSummary: '{"path":"resources/checklist.md","skill_id":"writing-clear-docs"}',
            errorSummary: '{"errorCode":"resource_not_found","message":"Skill resource was not found in the enabled skill snapshot resource index.","ok":false,"path":"resources/checklist.md","skillId":"writing-clear-docs","snapshotRevision":8}',
          },
        }),
      ].reduce(applyRuntimeRunEventToCopilotRunState, initialState)

      expect(stateAfterEvents.diagnostic).toMatchObject({
        code: 'skill_index_loaded',
        message: 'Skill index loaded for this run.',
      })
      expect(stateAfterEvents.segments.map((segment) => segment.kind)).toEqual([
        'diagnostic',
        'tool',
        'tool',
      ])
      expect(stateAfterEvents.segments[0]).toMatchObject({
        kind: 'diagnostic',
        status: 'completed',
        diagnostic: {
          code: 'skill_index_loaded',
        },
      })
      expect(stateAfterEvents.segments[1]).toMatchObject({
        kind: 'tool',
        toolId: 'skill.activate',
        status: 'completed',
        inputSummary: '{"skill_id":"writing-clear-docs"}',
        resultSummary: '{"displayName":"清晰文档写作","entryContentLength":120,"ok":true,"resourceCount":1,"skillId":"writing-clear-docs","snapshotRevision":8}',
      })
      expect(stateAfterEvents.segments[2]).toMatchObject({
        kind: 'tool',
        toolId: 'skill.read_resource',
        status: 'failed',
        inputSummary: '{"path":"resources/checklist.md","skill_id":"writing-clear-docs"}',
        errorSummary: '{"errorCode":"resource_not_found","message":"Skill resource was not found in the enabled skill snapshot resource index.","ok":false,"path":"resources/checklist.md","skillId":"writing-clear-docs","snapshotRevision":8}',
      })
      expect(stateAfterEvents.segments.every((segment) => segment.kind !== 'diagnostic' || segment.diagnostic.code === 'skill_index_loaded')).toBe(true)
    })
  })

  describe('fatal failures with tool steps', () => {
    it('keeps failed tool steps visible when a later non-tool fatal failure ends the run', () => {
      const initialState = createStartingCopilotRunState({
        threadId: 'session-1',
        activeModelRoute: createRuntimeModelRoute(),
        requestOptions: { trace: true },
      })

      const stateAfterEvents = [
        {
          type: 'run_started' as const,
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 1,
          payload: {
            assistantMessageId: LABEL_RUN_ASSISTANT,
          },
        },
        createRuntimeToolEvent({
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 2,
          payload: {
            toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
            toolId: LABEL_TOOL_REMOTE_SEARCH,
            phase: 'started',
            title: '调用天气工具',
            summary: '正在获取 Shenzhen 的天气。',
            inputSummary: LABEL_LOCATION_SHENZHEN,
          },
        }),
        createRuntimeToolEvent({
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 3,
          payload: {
            toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
            toolId: LABEL_TOOL_REMOTE_SEARCH,
            phase: 'failed',
            title: '工具调用失败',
            summary: '工具执行失败。',
            inputSummary: LABEL_LOCATION_SHENZHEN,
            errorSummary: 'boom',
          },
        }),
        {
          type: 'run_failed' as const,
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 4,
          payload: {
            code: 'agent_execution_failed',
            message: 'Model stream collapsed.',
            details: {
              stage: 'execute_model',
            },
          },
        },
      ].reduce(applyRuntimeRunEventToCopilotRunState, initialState)

      expect(stateAfterEvents.phase).toBe('failed')
      expect(stateAfterEvents.failure).toEqual({
        code: 'agent_execution_failed',
        message: 'Model stream collapsed.',
        details: {
          stage: 'execute_model',
        },
      })
      expect(stateAfterEvents.segments.map((segment) => segment.kind)).toEqual([
        'tool',
        'terminal',
      ])
      expect(stateAfterEvents.segments[0]).toMatchObject({
        kind: 'tool',
        status: 'failed',
        toolPhase: 'failed',
        errorSummary: 'boom',
      })
      expect(stateAfterEvents.segments[1]).toMatchObject({
        kind: 'terminal',
        status: 'failed',
        terminalPhase: 'failed',
        failure: {
          code: 'agent_execution_failed',
          message: 'Model stream collapsed.',
          details: {
            stage: 'execute_model',
          },
        },
      })
    })
  })

  describe('reasoning segments', () => {
    it('keeps reasoning segments distinct from tool and assistant content', () => {
      const initialState = createStartingCopilotRunState({
        threadId: 'session-1',
        activeModelRoute: createRuntimeModelRoute(),
        requestOptions: { trace: true },
      })

      const stateAfterEvents = [
        {
          type: 'run_started' as const,
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 1,
          payload: {
            assistantMessageId: LABEL_RUN_ASSISTANT,
          },
        },
        {
          type: 'reasoning_delta' as const,
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 2,
          payload: {
            delta: '先思考。',
          },
        },
        createRuntimeToolEvent({
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 3,
          payload: {
            toolCallId: LABEL_TOOL_REMOTE_SEARCH_2,
            toolId: LABEL_TOOL_REMOTE_SEARCH,
            phase: 'completed',
            title: '天气工具已返回结果',
            summary: DESC_CN_003,
            resultSummary: DESC_CN_003,
          },
        }),
        {
          type: 'reasoning_delta' as const,
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 4,
          payload: {
            delta: '再思考。',
          },
        },
        {
          type: 'text_delta' as const,
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 5,
          payload: {
            assistantMessageId: LABEL_RUN_ASSISTANT,
            delta: '最终回答',
          },
        },
        createRuntimeRunCompletedEvent({
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 6,
          payload: {
            assistantMessageId: LABEL_RUN_ASSISTANT,
            assistantText: '最终回答',
            resolvedModelId: 'qwen-plus',
            resolvedModelRoute: createRuntimeModelRoute(),
            resolvedToolIds: [LABEL_TOOL_REMOTE_SEARCH],
            requestOptions: { trace: true },
          },
        }),
      ].reduce(applyRuntimeRunEventToCopilotRunState, initialState)

      expect(stateAfterEvents.segments.map((segment) => segment.kind)).toEqual([
        'reasoning',
        'tool',
        'reasoning',
        'assistant',
        'terminal',
      ])
      expect(stateAfterEvents.segments[0]).toMatchObject({
        kind: 'reasoning',
        text: '先思考。',
        status: 'completed',
      })
      expect(stateAfterEvents.segments[2]).toMatchObject({
        kind: 'reasoning',
        text: '再思考。',
        status: 'completed',
      })
      expect(stateAfterEvents.segments[3]).toMatchObject({
        kind: 'assistant',
        text: '最终回答',
        status: 'completed',
      })
    })

    it('records reasoning observation start and finish times when the segment begins and completes', () => {
      const initialState = createStartingCopilotRunState({
        threadId: 'session-1',
        activeModelRoute: createRuntimeModelRoute(),
        requestOptions: { trace: true },
      })
      const nowSpy = vi.spyOn(Date, 'now')
        .mockReturnValueOnce(1_000)
        .mockReturnValueOnce(4_279)

      const stateAfterEvents = [
        {
          type: 'reasoning_delta' as const,
          runId: 'run-observed-reasoning',
          sessionId: 'session-1',
          sequence: 1,
          payload: {
            delta: '先分析。',
          },
        },
        {
          type: 'text_delta' as const,
          runId: 'run-observed-reasoning',
          sessionId: 'session-1',
          sequence: 2,
          payload: {
            assistantMessageId: 'run-observed-reasoning:assistant',
            delta: '最终答复。',
          },
        },
      ].reduce(applyRuntimeRunEventToCopilotRunState, initialState)

      expect(stateAfterEvents.segments[0]).toMatchObject({
        kind: 'reasoning',
        text: '先分析。',
        status: 'completed',
        observedStartedAt: 1_000,
        observedFinishedAt: 4_279,
      })
      expect(stateAfterEvents.segments[1]).toMatchObject({
        kind: 'assistant',
        text: '最终答复。',
        status: 'streaming',
      })

      nowSpy.mockRestore()
    })

    it('stores run metadata and suppresses reasoning segments when applied thinking is off', () => {
      const initialState = createStartingCopilotRunState({
        threadId: 'session-1',
        activeModelRoute: createRuntimeModelRoute(),
        requestOptions: { trace: true },
      })

      const capabilitySnapshot = createRuntimeThinkingCapability({
        supportedLevels: ['off', 'auto'],
        defaultLevel: 'off',
        reasonCode: 'verified_off_only',
      })

      const stateAfterEvents = [
        {
          type: 'run_started' as const,
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 1,
          payload: {
            assistantMessageId: LABEL_RUN_ASSISTANT,
          },
        },
        {
          type: 'reasoning_delta' as const,
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 2,
          payload: {
            delta: '这段推理不应保留。',
          },
        },
        createRuntimeRunMetadataEvent({
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 3,
          payload: {
            requestedThinkingSelection: null,
            appliedThinkingSelection: null,
            requestedThinkingLevel: 'high',
            appliedThinkingLevel: 'off',
            thinkingCapabilitySnapshot: capabilitySnapshot,
            reasoningSuppressionBasis: createRuntimeReasoningSuppressionBasis({
              shouldSuppress: true,
              source: 'applied-selection',
              reasonCode: 'applied_selection_off',
              appliedThinkingLevel: 'off',
            }),
          },
        }),
        {
          type: 'reasoning_delta' as const,
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 4,
          payload: {
            delta: '这段推理也不应显示。',
          },
        },
        {
          type: 'text_delta' as const,
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 5,
          payload: {
            assistantMessageId: LABEL_RUN_ASSISTANT,
            delta: '最终回答',
          },
        },
        createRuntimeRunCompletedEvent({
          runId: 'run-1',
          sessionId: 'session-1',
          sequence: 6,
          payload: {
            assistantMessageId: LABEL_RUN_ASSISTANT,
            assistantText: '最终回答',
            resolvedModelId: 'qwen-plus',
            resolvedModelRoute: createRuntimeModelRoute(),
            resolvedToolIds: [],
            requestOptions: { trace: true },
          },
        }),
      ].reduce(applyRuntimeRunEventToCopilotRunState, initialState)

      expect(stateAfterEvents.requestedThinkingLevel).toBe('high')
      expect(stateAfterEvents.appliedThinkingLevel).toBe('off')
      expect(stateAfterEvents.reasoningSuppressed).toBe(true)
      expect(stateAfterEvents.reasoningTraceState).toBe('suppressed')
      expect(stateAfterEvents.reasoningSuppressionBasis).toEqual(
        createRuntimeReasoningSuppressionBasis({
          shouldSuppress: true,
          source: 'applied-selection',
          reasonCode: 'applied_selection_off',
          appliedThinkingLevel: 'off',
        }),
      )
      expect(stateAfterEvents.thinkingCapabilitySnapshot).toEqual(capabilitySnapshot)
      expect(stateAfterEvents.segments.map((segment) => segment.kind)).toEqual([
        'assistant',
        'terminal',
      ])
    })

    it('keeps reasoning trace as not observed until a hidden reasoning delta is actually suppressed', () => {
      const initialState = createStartingCopilotRunState({
        threadId: 'session-1',
        activeModelRoute: createRuntimeModelRoute(),
        requestOptions: { trace: true },
      })

      const hiddenReasoningState = [
        {
          type: 'run_started' as const,
          runId: 'run-hidden-reasoning',
          sessionId: 'session-1',
          sequence: 1,
          payload: {
            assistantMessageId: 'run-hidden-reasoning:assistant',
          },
        },
        createRuntimeRunMetadataEvent({
          runId: 'run-hidden-reasoning',
          sessionId: 'session-1',
          sequence: 2,
          payload: {
            requestedThinkingSelection: null,
            appliedThinkingSelection: null,
            requestedThinkingLevel: 'auto',
            appliedThinkingLevel: 'auto',
            thinkingCapabilitySnapshot: createRuntimeThinkingCapability(),
            reasoningSuppressionBasis: createRuntimeReasoningSuppressionBasis({
              shouldSuppress: true,
              source: 'capability-visibility',
              reasonCode: 'capability_visibility_suppressed',
              appliedThinkingLevel: 'auto',
              reasoningVisibility: 'suppressed',
            }),
          },
        }),
      ].reduce(applyRuntimeRunEventToCopilotRunState, initialState)

      expect(hiddenReasoningState.reasoningSuppressed).toBe(true)
      expect(hiddenReasoningState.reasoningTraceState).toBe('not_observed')
      expect(hiddenReasoningState.segments).toEqual([])

      const suppressedReasoningState = applyRuntimeRunEventToCopilotRunState(hiddenReasoningState, {
        type: 'reasoning_delta',
        runId: 'run-hidden-reasoning',
        sessionId: 'session-1',
        sequence: 3,
        payload: {
          delta: '这段隐藏推理只能被记录为抑制。',
        },
      })

      expect(suppressedReasoningState.reasoningSuppressed).toBe(true)
      expect(suppressedReasoningState.reasoningTraceState).toBe('suppressed')
      expect(suppressedReasoningState.segments).toEqual([])
    })
  })

  describe('tool approval metadata', () => {
    it('stores waiting approval metadata on tool segments', () => {
      const initialState = createStartingCopilotRunState({
        threadId: 'session-1',
        activeModelRoute: createRuntimeModelRoute(),
        requestOptions: { trace: true },
      })

      const nextState = applyRuntimeRunEventToCopilotRunState(initialState, createRuntimeToolEvent({
        runId: 'run-approval',
        sessionId: 'session-1',
        sequence: 2,
        payload: {
          toolCallId: 'tool.remote-search:call-approval',
          toolId: LABEL_TOOL_REMOTE_SEARCH,
          phase: 'waiting_approval',
          title: '等待批准',
          summary: '需要人工批准。',
          security: {
            riskLevel: 'high',
            approvalMethod: 'accept_reject',
          },
          approval: {
            mode: 'delay',
            timeoutAt: LABEL_2026_17T16,
            timeoutSeconds: 30,
            timeoutAction: 'deny',
          },
        },
      }))

      expect(nextState.segments[0]).toMatchObject({
        kind: 'tool',
        toolPhase: 'waiting_approval',
        approval: {
          mode: 'delay',
          approvalMethod: 'accept_reject',
          riskLevel: 'high',
          timeoutAt: LABEL_2026_17T16,
          timeoutSeconds: 30,
          timeoutAction: 'deny',
        },
      })
    })

    it('preserves the last known approval metadata after later non-waiting tool events', () => {
      const initialState = createStartingCopilotRunState({
        threadId: 'session-1',
        activeModelRoute: createRuntimeModelRoute(),
        requestOptions: { trace: true },
      })

      const waitingApprovalState = applyRuntimeRunEventToCopilotRunState(initialState, createRuntimeToolEvent({
        runId: 'run-approval',
        sessionId: 'session-1',
        sequence: 2,
        payload: {
          toolCallId: 'tool.remote-search:call-approval',
          toolId: LABEL_TOOL_REMOTE_SEARCH,
          phase: 'waiting_approval',
          title: '等待批准',
          summary: '需要人工批准。',
          security: {
            riskLevel: 'high',
            approvalMethod: 'accept_reject',
          },
          approval: {
            mode: 'delay',
            timeoutAt: LABEL_2026_17T16,
            timeoutSeconds: 30,
            timeoutAction: 'deny',
          },
        },
      }))

      const completedState = applyRuntimeRunEventToCopilotRunState(waitingApprovalState, createRuntimeToolEvent({
        runId: 'run-approval',
        sessionId: 'session-1',
        sequence: 3,
        payload: {
          toolCallId: 'tool.remote-search:call-approval',
          toolId: LABEL_TOOL_REMOTE_SEARCH,
          phase: 'completed',
          title: '天气查询完成',
          summary: '已完成。',
          resultSummary: '{"temperature":28}',
        },
      }))

      expect(completedState.segments[0]).toMatchObject({
        kind: 'tool',
        toolPhase: 'completed',
        approval: {
          mode: 'delay',
          approvalMethod: 'accept_reject',
          riskLevel: 'high',
          timeoutAt: LABEL_2026_17T16,
          timeoutSeconds: 30,
          timeoutAction: 'deny',
        },
      })
    })
  })

  describe('cancellation', () => {
    it('marks streaming segments cancelled when transport abort happens before terminal event', () => {
      const streamingState = applyRuntimeRunEventToCopilotRunState(
        applyRuntimeRunEventToCopilotRunState(createIdleCopilotRunState(), {
          type: 'run_started',
          runId: 'run-cancel',
          sessionId: 'session-1',
          sequence: 1,
          payload: {
            assistantMessageId: 'run-cancel:assistant',
          },
        }),
        {
          type: 'text_delta',
          runId: 'run-cancel',
          sessionId: 'session-1',
          sequence: 2,
          payload: {
            assistantMessageId: 'run-cancel:assistant',
            delta: '第一段',
          },
        },
      )

      const cancelledState = markCopilotRunCancelled(streamingState, {
        reason: 'cancelled',
      })

      expect(cancelledState.phase).toBe('cancelled')
      expect(cancelledState.cancelReason).toBe('cancelled')
      expect(cancelledState.segments[cancelledState.segments.length - 1]).toMatchObject({
        kind: 'terminal',
        terminalPhase: 'cancelled',
      })
    })
  })
})
