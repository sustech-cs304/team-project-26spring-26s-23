import { vi } from 'vitest'

import type { DesktopNotificationRequest } from './desktop-notification'

import type { ConfigCenterPublicPatchResult } from './config-center/public-patch'
import type { ConfigCenterPublicSnapshotLoadResult } from './config-center/public-snapshot'
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
    loadCopilotRuntime: vi.fn(async (): Promise<CopilotRuntimeLoadResult> => ({
      ok: true,
      snapshot: createCopilotRuntimeSnapshotFixture('ready', 'development'),
    })),
    retryCopilotRuntime: vi.fn(async (): Promise<CopilotRuntimeLoadResult> => ({
      ok: true,
      snapshot: createCopilotRuntimeSnapshotFixture('starting', null),
    })),
    notifyDesktopNotification: vi.fn(async (_request: DesktopNotificationRequest) => undefined),
    notifyBootstrapWindowReady: vi.fn(async () => undefined),
  }
}
