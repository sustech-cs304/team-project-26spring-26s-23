import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DesktopCapabilityBridgeRequest } from '../protocol'
import type { CreateDesktopCapabilityBridgeServiceOptions } from '../types'
import { createDesktopCapabilityDatabaseService } from '../services/DesktopCapabilityDatabaseService'

vi.mock('../paths', () => ({
  createDesktopCapabilityBridgePaths: vi.fn(() => ({
    workspaceRootDir: '/tmp/test/workspace',
    databaseRootDir: '/tmp/test/database',
    artifactsDir: '/tmp/test/artifacts',
    artifactIndexFile: '/tmp/test/state/artifact-index.json',
    stateFile: '/tmp/test/state/state.json',
  })),
}))

function createStubOptions(): CreateDesktopCapabilityBridgeServiceOptions {
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
  }
}

function createRequest(operation: string, payload: Record<string, unknown> = {}): DesktopCapabilityBridgeRequest {
  return {
    requestId: 'req-1',
    capability: 'database' as const,
    operation: operation as DesktopCapabilityBridgeRequest['operation'],
    toolId: 'db.test',
    runId: 'run-1',
    toolCallId: 'call-1',
    payload,
  }
}

describe('DesktopCapabilityDatabaseService', () => {
  let service: ReturnType<typeof createDesktopCapabilityDatabaseService>

  beforeEach(() => {
    vi.clearAllMocks()
    service = createDesktopCapabilityDatabaseService(createStubOptions())
  })

  describe('resolve_path', () => {
    it('resolves a relative path inside the database root', async () => {
      const result = await service.handle(createRequest('resolve_path', {
        relativePath: 'data.db',
      }))

      expect(result.path).toBeTruthy()
      expect(typeof result.path).toBe('string')
    })

    it('returns database root when no relativePath provided', async () => {
      const result = await service.handle(createRequest('resolve_path'))

      expect(result.path).toBeTruthy()
      expect(typeof result.path).toBe('string')
    })

    it('returns database root when relativePath is undefined', async () => {
      const result = await service.handle(createRequest('resolve_path', {}))

      expect(result.path).toBeTruthy()
    })

    it('rejects absolute paths', async () => {
      await expect(
        service.handle(createRequest('resolve_path', { relativePath: '/etc/passwd' }))
      ).rejects.toThrow(/must be a relative path/)
    })

    it('rejects path traversal attempts', async () => {
      await expect(
        service.handle(createRequest('resolve_path', { relativePath: '../outside' }))
      ).rejects.toThrow(/must resolve inside/)
    })
  })

  describe('error handling', () => {
    it('throws for unsupported operation', async () => {
      await expect(
        service.handle(createRequest('unknown_op' as string))
      ).rejects.toThrow(/does not support operation/)
    })

    it('throws when relativePath is not a string', async () => {
      await expect(
        service.handle(createRequest('resolve_path', { relativePath: 123 }))
      ).rejects.toThrow(/must be a string/)
    })

    it('handles empty string as no relative path', async () => {
      const result = await service.handle(createRequest('resolve_path', { relativePath: '' }))

      expect(result.path).toBeTruthy()
    })
  })
})
