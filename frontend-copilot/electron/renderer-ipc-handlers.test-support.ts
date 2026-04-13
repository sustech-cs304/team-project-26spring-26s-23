import { vi } from 'vitest'

import type { ConfigCenterPublicPatchResult } from './config-center/public-patch'
import type { ConfigCenterPublicSnapshotLoadResult } from './config-center/public-snapshot'
import type {
  CopilotHistoryListThreadsResult,
  CopilotHistoryRunReplayResult,
  CopilotHistoryThreadDetailResult,
} from './copilot-history'
import type { CopilotRuntimeLoadResult } from './copilot-runtime'
import type { RendererIpcHandlers } from './renderer-ipc-registration'
import {
  createConfigCenterPublicSnapshotFixture,
  createCopilotRuntimeSnapshotFixture,
  createSettingsWorkspaceStateFixture,
} from './renderer-ipc-domain-fixtures.test-support'
import type {
  SettingsWorkspaceProfileSecretMutationResult,
  SettingsWorkspaceSecretsLoadStatusesResult,
  SettingsWorkspaceStateLoadResult,
  SettingsWorkspaceStateSaveResult,
  SettingsWorkspaceSustechCasSecretLoadResult,
  SettingsWorkspaceSustechCasSecretMutationResult,
} from './settings-workspace/ipc'

export function createRendererIpcHandlers(): RendererIpcHandlers {
  return {
    loadConfigCenterPublicSnapshot: vi.fn(async (): Promise<ConfigCenterPublicSnapshotLoadResult> => ({
      ok: true,
      snapshot: createConfigCenterPublicSnapshotFixture({
        theme: 'light',
        model: null,
      }),
    })),
    applyConfigCenterPublicPatch: vi.fn(async (): Promise<ConfigCenterPublicPatchResult> => ({
      ok: true,
      snapshot: createConfigCenterPublicSnapshotFixture({
        theme: 'dark',
        model: 'qwen-plus',
      }),
    })),
    loadSettingsWorkspaceState: vi.fn(async (): Promise<SettingsWorkspaceStateLoadResult> => ({
      ok: true,
      source: 'stored',
      state: createSettingsWorkspaceStateFixture(),
    })),
    saveSettingsWorkspaceState: vi.fn(async (): Promise<SettingsWorkspaceStateSaveResult> => ({
      ok: true,
      state: createSettingsWorkspaceStateFixture(),
    })),
    loadSettingsWorkspaceSecretStates: vi.fn(async (): Promise<SettingsWorkspaceSecretsLoadStatusesResult> => ({
      ok: true,
      states: {
        openrouter: {
          hasApiKey: true,
          apiKey: 'persisted-secret',
        },
      },
    })),
    loadSettingsWorkspaceSustechCasSecret: vi.fn(async (): Promise<SettingsWorkspaceSustechCasSecretLoadResult> => ({
      ok: true,
      state: {
        hasPassword: true,
        password: 'persisted-cas-secret',
      },
    })),
    saveSettingsWorkspaceProfileSecret: vi.fn(async (): Promise<SettingsWorkspaceProfileSecretMutationResult> => ({
      ok: true,
      profileId: 'openrouter',
      state: {
        hasApiKey: true,
        apiKey: 'persisted-secret',
      },
    })),
    clearSettingsWorkspaceProfileSecret: vi.fn(async (): Promise<SettingsWorkspaceProfileSecretMutationResult> => ({
      ok: true,
      profileId: 'openrouter',
      state: {
        hasApiKey: false,
        apiKey: '',
      },
    })),
    saveSettingsWorkspaceSustechCasSecret: vi.fn(async (): Promise<SettingsWorkspaceSustechCasSecretMutationResult> => ({
      ok: true,
      state: {
        hasPassword: true,
        password: 'persisted-cas-secret',
      },
    })),
    clearSettingsWorkspaceSustechCasSecret: vi.fn(async (): Promise<SettingsWorkspaceSustechCasSecretMutationResult> => ({
      ok: true,
      state: {
        hasPassword: false,
        password: '',
      },
    })),
    listCopilotHistoryThreads: vi.fn(async (): Promise<CopilotHistoryListThreadsResult> => ({
      ok: true,
      version: 'chat-history-v1',
      threads: [],
    })),
    getCopilotHistoryThreadDetail: vi.fn(async (): Promise<CopilotHistoryThreadDetailResult> => ({
      ok: true,
      version: 'chat-history-v1',
      thread: {
        threadId: 'thread-1',
        boundAgentId: 'default',
        title: '历史线程',
        titleSource: 'deterministic',
        summary: '已持久化回复',
        summarySource: 'deterministic',
        createdAt: '2026-04-13T14:00:00Z',
        updatedAt: '2026-04-13T14:05:00Z',
        lastActivityAt: '2026-04-13T14:05:00Z',
        lastRunId: 'run-1',
        lastRunStatus: 'completed',
        lastUserMessagePreview: '你好',
        lastAssistantMessagePreview: '已持久化回复',
        driftSummary: {
          status: 'not_evaluated',
        },
      },
      timelineItems: [],
      runSummaries: [],
      latestConfigurationSnapshot: null,
      availabilityDrift: null,
    })),
    getCopilotHistoryRunReplay: vi.fn(async (): Promise<CopilotHistoryRunReplayResult> => ({
      ok: true,
      version: 'chat-history-v1',
      run: {
        runId: 'run-1',
        threadId: 'thread-1',
        status: 'completed',
        createdAt: '2026-04-13T14:00:00Z',
        updatedAt: '2026-04-13T14:05:00Z',
        startedAt: '2026-04-13T14:00:01Z',
        terminalAt: '2026-04-13T14:05:00Z',
        resolvedModelId: 'gpt-4.1',
        requestedMessageText: '你好',
        assistantText: '已持久化回复',
      },
      historicalSnapshot: null,
      orderedEvents: [],
      toolCallBlocks: [],
      diagnosticBlocks: [],
      terminalState: null,
      availabilityInterpretation: null,
    })),
    loadCopilotRuntime: vi.fn(async (): Promise<CopilotRuntimeLoadResult> => ({
      ok: true,
      snapshot: createCopilotRuntimeSnapshotFixture('ready', 'development'),
    })),
    retryCopilotRuntime: vi.fn(async (): Promise<CopilotRuntimeLoadResult> => ({
      ok: true,
      snapshot: createCopilotRuntimeSnapshotFixture('starting', null),
    })),
    notifyBootstrapWindowReady: vi.fn(async () => undefined),
  }
}
