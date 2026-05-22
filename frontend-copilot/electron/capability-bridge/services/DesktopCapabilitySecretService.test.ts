import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DesktopCapabilityBridgeRequest } from '../protocol'
import { createDesktopCapabilitySecretService } from '../services/DesktopCapabilitySecretService'
import type { ElectronSettingsWorkspaceService } from '../../settings-workspace/main-process'

function createMockSettingsWorkspaceService(
  overrides: Partial<Record<string, unknown>> = {},
): ElectronSettingsWorkspaceService {
  return {
    loadState: vi.fn(async () => ({
      ok: true,
      state: {
        sustech: {
          email: 'user@sustech.edu.cn',
          studentId: '12345678',
          ...(overrides.sustech as Record<string, unknown> ?? {}),
        },
      },
    })),
    loadSustechCasSecret: vi.fn(async () => ({
      ok: true,
      state: {
        password: 'test-password',
        ...(overrides.casSecret as Record<string, unknown> ?? {}),
      },
    })),
    loadSecretStates: vi.fn(async () => ({
      ok: true,
      states: {
        default: { apiKey: 'sk-test-key' },
        ...(overrides.secretStates as Record<string, unknown> ?? {}),
      },
    })),
    saveState: vi.fn(),
    saveSecrets: vi.fn(),
  } as unknown as ElectronSettingsWorkspaceService
}

function createStubOptions(settingsService?: ElectronSettingsWorkspaceService) {
  return {
    prepareRuntimePaths: vi.fn(async () => ({
      userDataDir: '/tmp/candue-test',
      runtimeRootDir: '/tmp/candue-test',
      configDir: '/tmp/candue-test/config',
      logsDir: '/tmp/candue-test/logs',
      databaseDir: '/tmp/candue-test/database',
      stateDir: '/tmp/candue-test/state',
      copilotSettingsFile: '/tmp/candue-test/config/settings.json',
      legacyCopilotSettingsFile: '/tmp/candue-test/config/legacy.json',
      hostLogFile: '/tmp/candue-test/logs/host.log',
      backendStdoutLogFile: '/tmp/candue-test/logs/backend-stdout.log',
      backendStderrLogFile: '/tmp/candue-test/logs/backend-stderr.log',
      runtimeSnapshotFile: '/tmp/candue-test/state/runtime-snapshot.json',
      lastFailureFile: '/tmp/candue-test/state/last-failure.json',
    })),
    appendLog: vi.fn(),
    getSettingsWorkspaceService: settingsService ? () => settingsService : undefined,
  }
}

function createRequest(operation: string, payload: Record<string, unknown> = {}): DesktopCapabilityBridgeRequest {
  return {
    requestId: 'req-1',
    capability: 'secret' as const,
    operation: operation as DesktopCapabilityBridgeRequest['operation'],
    toolId: 'secret.test',
    runId: 'run-1',
    toolCallId: 'call-1',
    payload,
  }
}

describe('DesktopCapabilitySecretService', () => {
  let settingsService: ElectronSettingsWorkspaceService

  beforeEach(() => {
    vi.clearAllMocks()
    settingsService = createMockSettingsWorkspaceService()
  })

  describe('get_secret', () => {
    it('returns username for sustech.username', async () => {
      const service = createDesktopCapabilitySecretService(createStubOptions(settingsService))

      const result = await service.handle(createRequest('get_secret', {
        secretName: 'sustech.username',
      }))

      expect(result.value).toBe('user@sustech.edu.cn')
    })

    it('returns password for sustech.password', async () => {
      const service = createDesktopCapabilitySecretService(createStubOptions(settingsService))

      const result = await service.handle(createRequest('get_secret', {
        secretName: 'sustech.password',
      }))

      expect(result.value).toBe('test-password')
    })

    it('returns provider api key for provider.<profileId>.apiKey', async () => {
      const service = createDesktopCapabilitySecretService(createStubOptions(settingsService))

      const result = await service.handle(createRequest('get_secret', {
        secretName: 'provider.default.apiKey',
      }))

      expect(result.value).toBe('sk-test-key')
    })

    it('returns null for unknown secret name', async () => {
      const service = createDesktopCapabilitySecretService(createStubOptions(settingsService))

      const result = await service.handle(createRequest('get_secret', {
        secretName: 'unknown.secret',
      }))

      expect(result.value).toBeNull()
    })

    it('returns null when secretName is empty', async () => {
      const service = createDesktopCapabilitySecretService(createStubOptions(settingsService))

      const result = await service.handle(createRequest('get_secret', {
        secretName: '',
      }))

      expect(result.value).toBeNull()
    })
  })

  describe('has_secret', () => {
    it('returns present: true for known secret', async () => {
      const service = createDesktopCapabilitySecretService(createStubOptions(settingsService))

      const result = await service.handle(createRequest('has_secret', {
        secretName: 'sustech.username',
      }))

      expect(result.present).toBe(true)
    })

    it('returns present: false for unknown secret', async () => {
      const service = createDesktopCapabilitySecretService(createStubOptions(settingsService))

      const result = await service.handle(createRequest('has_secret', {
        secretName: 'unknown.secret',
      }))

      expect(result.present).toBe(false)
    })
  })

  describe('secret name resolution', () => {
    it('recognizes blackboard variations as username secrets', async () => {
      const service = createDesktopCapabilitySecretService(createStubOptions(settingsService))

      const result = await service.handle(createRequest('get_secret', {
        secretName: 'bb.username',
      }))

      expect(result.value).toBe('user@sustech.edu.cn')
    })

    it('recognizes cas password secret', async () => {
      const service = createDesktopCapabilitySecretService(createStubOptions(settingsService))

      const result = await service.handle(createRequest('get_secret', {
        secretName: 'sustech.casPassword',
      }))

      expect(result.value).toBe('test-password')
    })

    it('rejects empty profileId in provider api key pattern', async () => {
      const service = createDesktopCapabilitySecretService(createStubOptions(settingsService))

      const result = await service.handle(createRequest('get_secret', {
        secretName: 'provider..apiKey',
      }))

      expect(result.value).toBeNull()
    })
  })

  describe('error handling', () => {
    it('throws for unsupported operation', async () => {
      const service = createDesktopCapabilitySecretService(createStubOptions(settingsService))

      await expect(
        service.handle(createRequest('unknown_op' as string))
      ).rejects.toThrow(/does not support operation/)
    })
  })
})
