import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DesktopCapabilityBridgeRequest } from '../protocol'
import type { CreateDesktopCapabilityBridgeServiceOptions } from '../types'
import { createDesktopCapabilityArtifactService } from '../services/DesktopCapabilityArtifactService'

const mockFsPromises = vi.hoisted(() => {
  const store = new Map<string, string>()
  return {
    _store: store,
    mkdir: vi.fn(async () => undefined),
    readFile: vi.fn(async (filePath: string) => {
      const content = store.get(filePath)
      if (content === undefined) {
        const error = new Error('ENOENT: no such file')
        ;(error as any).code = 'ENOENT'
        throw error
      }
      return content
    }),
    writeFile: vi.fn(async (filePath: string, content: string | Buffer) => {
      store.set(filePath, typeof content === 'string' ? content : content.toString())
    }),
  }
})

vi.mock('node:fs/promises', () => mockFsPromises)

vi.mock('node:crypto', () => ({
  createHash: vi.fn((_algo: string) => ({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn(() => 'abc123digest'),
  })),
  randomBytes: vi.fn((_size: number) => Buffer.alloc(12, 0xAB)),
}))

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
    capability: 'artifact' as const,
    operation: operation as DesktopCapabilityBridgeRequest['operation'],
    toolId: 'artifact.test',
    runId: 'run-1',
    toolCallId: 'call-1',
    payload,
  }
}

describe('DesktopCapabilityArtifactService', () => {
  let service: ReturnType<typeof createDesktopCapabilityArtifactService>

  beforeEach(() => {
    vi.clearAllMocks()
    mockFsPromises._store.clear()
    service = createDesktopCapabilityArtifactService(createStubOptions())
  })

  describe('save_text', () => {
    it('saves text artifact and returns descriptor', async () => {
      const result = await service.handle(createRequest('save_text', {
        name: 'test.txt',
        text: 'Hello, world!',
      }))

      expect(result.artifactId).toMatch(/^artifact-/)
      expect(result.uri).toMatch(/^artifact:\/\/desktop\/artifact-/)
      expect(result.name).toBe('test.txt')
      expect(result.contentType).toBe('text/plain')
      expect(result.metadata).toHaveProperty('__desktopCapabilityArtifact')
    })

    it('saves text artifact with custom contentType', async () => {
      const result = await service.handle(createRequest('save_text', {
        name: 'data.json',
        text: '{"key":"value"}',
        contentType: 'application/json',
      }))

      expect(result.contentType).toBe('application/json')
    })

    it('throws for missing name', async () => {
      await expect(
        service.handle(createRequest('save_text', { text: 'content' }))
      ).rejects.toThrow(/name must be a non-empty string/)
    })
  })

  describe('save_bytes', () => {
    it('saves bytes artifact from valid base64', async () => {
      const base64Content = Buffer.from('binary payload').toString('base64')

      const result = await service.handle(createRequest('save_bytes', {
        name: 'data.bin',
        contentBase64: base64Content,
      }))

      expect(result.artifactId).toMatch(/^artifact-/)
      expect(result.contentType).toBe('application/octet-stream')
    })

    it('throws for invalid base64 content', async () => {
      await expect(
        service.handle(createRequest('save_bytes', {
          name: 'data.bin',
          contentBase64: '!!!invalid!!!',
        }))
      ).rejects.toThrow(/contentBase64 must be valid base64/)
    })
  })

  describe('describe_artifact', () => {
    it('returns artifact descriptor when found', async () => {
      const saved = await service.handle(createRequest('save_text', {
        name: 'test.txt',
        text: 'content',
      }))

      const result = await service.handle(createRequest('describe_artifact', {
        artifactId: saved.artifactId,
      }))

      expect(result.artifactId).toBe(saved.artifactId)
      expect(result.name).toBe('test.txt')
    })

    it('throws not_found for unknown artifactId', async () => {
      await expect(
        service.handle(createRequest('describe_artifact', { artifactId: 'nonexistent' }))
      ).rejects.toThrow(/was not found/)
    })

    it('throws for empty artifactId', async () => {
      await expect(
        service.handle(createRequest('describe_artifact', { artifactId: '' }))
      ).rejects.toThrow(/must be a non-empty string/)
    })
  })

  describe('error handling', () => {
    it('throws for unsupported operation', async () => {
      await expect(
        service.handle(createRequest('unknown_op' as string))
      ).rejects.toThrow(/does not support operation/)
    })
  })

  describe('index resilience', () => {
    it('creates new index when index file does not exist', async () => {
      mockFsPromises.readFile.mockRejectedValueOnce(
        Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
      )

      const result = await service.handle(createRequest('save_text', {
        name: 'first-artifact.txt',
        text: 'initial content',
      }))

      expect(result.artifactId).toMatch(/^artifact-/)
    })
  })
})
