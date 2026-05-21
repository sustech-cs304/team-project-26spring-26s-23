import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DesktopCapabilityBridgeRequest } from '../protocol'
import type { CreateDesktopCapabilityBridgeServiceOptions } from '../types'
import { createDesktopCapabilityWorkspaceService } from '../services/DesktopCapabilityWorkspaceService'

const mockFsPromises = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
}))

vi.mock('node:fs/promises', () => mockFsPromises)

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
    capability: 'workspace' as const,
    operation: operation as DesktopCapabilityBridgeRequest['operation'],
    toolId: 'ws.test',
    runId: 'run-1',
    toolCallId: 'call-1',
    payload,
  }
}

describe('DesktopCapabilityWorkspaceService', () => {
  let service: ReturnType<typeof createDesktopCapabilityWorkspaceService>

  beforeEach(() => {
    vi.clearAllMocks()
    service = createDesktopCapabilityWorkspaceService(createStubOptions())
  })

  describe('resolve_path', () => {
    it('resolves a relative path inside the workspace root', async () => {
      const result = await service.handle(createRequest('resolve_path', {
        relativePath: 'subdir/file.txt',
      }))

      expect(result.path).toBeTruthy()
      expect(typeof result.path).toBe('string')
    })

    it('returns workspace root when no relativePath provided', async () => {
      const result = await service.handle(createRequest('resolve_path'))

      expect(result.path).toBeTruthy()
    })

    it('returns workspace root when relativePath is omitted', async () => {
      const result = await service.handle(createRequest('resolve_path', {}))

      expect(result.path).toBeTruthy()
    })
  })

  describe('ensure_directory', () => {
    it('resolves and creates a directory', async () => {
      const result = await service.handle(createRequest('ensure_directory', {
        relativePath: 'new-dir',
      }))

      expect(result.path).toBeTruthy()
      expect(mockFsPromises.mkdir).toHaveBeenCalled()
    })

    it('requires relativePath for ensure_directory', async () => {
      await expect(
        service.handle(createRequest('ensure_directory'))
      ).rejects.toThrow(/must be a non-empty relative path/)
    })

    it('rejects empty relativePath for ensure_directory', async () => {
      await expect(
        service.handle(createRequest('ensure_directory', { relativePath: '' }))
      ).rejects.toThrow(/must be a non-empty relative path/)
    })
  })

  describe('path validation', () => {
    it('rejects absolute paths for resolve_path', async () => {
      await expect(
        service.handle(createRequest('resolve_path', { relativePath: '/etc/passwd' }))
      ).rejects.toThrow(/must be a relative path/)
    })

    it('rejects path traversal attempts', async () => {
      await expect(
        service.handle(createRequest('resolve_path', { relativePath: '../../../outside' }))
      ).rejects.toThrow(/must resolve inside/)
    })

    it('rejects path traversal for ensure_directory', async () => {
      await expect(
        service.handle(createRequest('ensure_directory', { relativePath: '../outside' }))
      ).rejects.toThrow(/must resolve inside/)
    })

    it('throws when relativePath is not a string', async () => {
      await expect(
        service.handle(createRequest('resolve_path', { relativePath: 456 }))
      ).rejects.toThrow(/must be a string/)
    })
  })

  describe('error handling', () => {
    it('throws for unsupported operation', async () => {
      await expect(
        service.handle(createRequest('unknown_op' as string))
      ).rejects.toThrow(/does not support operation/)
    })
  })
})
