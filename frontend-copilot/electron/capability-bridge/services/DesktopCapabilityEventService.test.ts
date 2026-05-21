import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DesktopCapabilityBridgeRequest } from '../protocol'
import type { CreateDesktopCapabilityBridgeServiceOptions } from '../types'
import { createDesktopCapabilityEventService } from '../services/DesktopCapabilityEventService'

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
    capability: 'event' as const,
    operation: operation as DesktopCapabilityBridgeRequest['operation'],
    toolId: 'event.test',
    runId: 'run-1',
    toolCallId: 'call-1',
    payload,
  }
}

describe('DesktopCapabilityEventService', () => {
  let service: ReturnType<typeof createDesktopCapabilityEventService>
  let options: CreateDesktopCapabilityBridgeServiceOptions

  beforeEach(() => {
    vi.clearAllMocks()
    options = createStubOptions()
    service = createDesktopCapabilityEventService(options)
  })

  describe('emit_event', () => {
    it('emits an event and returns empty result', async () => {
      const result = await service.handle(createRequest('emit_event', {
        eventType: 'info',
        message: 'Something happened',
      }))

      expect(result).toEqual({})
      expect(options.appendLog).toHaveBeenCalled()
    })

    it('emits an event with data payload', async () => {
      const result = await service.handle(createRequest('emit_event', {
        eventType: 'custom.event',
        data: { key: 'value' },
      }))

      expect(result).toEqual({})
      expect(options.appendLog).toHaveBeenCalled()
    })

    it('emits an event with minimal payload', async () => {
      const result = await service.handle(createRequest('emit_event', {
        eventType: 'done',
      }))

      expect(result).toEqual({})
    })

    it('resolves log level from data.level', async () => {
      await service.handle(createRequest('emit_event', {
        eventType: 'custom',
        data: { level: 'warn' },
      }))

      expect(options.appendLog).toHaveBeenCalledWith(
        'warn',
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
      )
    })

    it('resolves log level from data.severity', async () => {
      await service.handle(createRequest('emit_event', {
        eventType: 'custom',
        data: { severity: 'error' },
      }))

      expect(options.appendLog).toHaveBeenCalledWith(
        'error',
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
      )
    })

    it('resolves log level from eventType', async () => {
      await service.handle(createRequest('emit_event', {
        eventType: 'error',
      }))

      expect(options.appendLog).toHaveBeenCalledWith(
        'error',
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
      )
    })

    it('defaults to info when eventType is unrecognized', async () => {
      await service.handle(createRequest('emit_event', {
        eventType: 'custom.type',
      }))

      expect(options.appendLog).toHaveBeenCalledWith(
        'info',
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
      )
    })
  })

  describe('error handling', () => {
    it('throws for unsupported operation', async () => {
      await expect(
        service.handle(createRequest('unknown_op' as string))
      ).rejects.toThrow(/does not support operation/)
    })

    it('throws when eventType is missing', async () => {
      await expect(
        service.handle(createRequest('emit_event', {}))
      ).rejects.toThrow(/eventType must be a non-empty string/)
    })

    it('throws when eventType is empty', async () => {
      await expect(
        service.handle(createRequest('emit_event', { eventType: '' }))
      ).rejects.toThrow(/eventType must be a non-empty string/)
    })

    it('throws when data is an array instead of object', async () => {
      await expect(
        service.handle(createRequest('emit_event', {
          eventType: 'test',
          data: [1, 2, 3],
        }))
      ).rejects.toThrow(/data must be an object/)
    })
  })
})
