import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DesktopCapabilityBridgeRequest } from '../protocol'
import { createDesktopCapabilityMcpService } from '../services/DesktopCapabilityMcpService'
import type { ElectronMcpRegistryService } from '../../mcp-registry/main-process'

function createMockMcpRegistry(
  executeToolImpl?: (req: Record<string, unknown>) => Promise<Record<string, unknown>>,
): ElectronMcpRegistryService {
  return {
    loadRegistry: vi.fn(),
    saveServer: vi.fn(),
    deleteServer: vi.fn(),
    setServerEnabled: vi.fn(),
    testConnection: vi.fn(),
    refreshCatalog: vi.fn(),
    warmupEnabledServersOnStartup: vi.fn(),
    executeTool: vi.fn(executeToolImpl ?? (async () => ({
      ok: true,
      toolId: 'test.tool',
      serverId: 'mock-server',
      remoteToolName: 'mockTool',
      content: [{ type: 'text', text: 'result' }],
    }))) as any,
  }
}

function createRequest(operation: string, payload: Record<string, unknown> = {}): DesktopCapabilityBridgeRequest {
  return {
    requestId: 'req-1',
    capability: 'mcp' as const,
    operation: operation as DesktopCapabilityBridgeRequest['operation'],
    toolId: 'mcp.test',
    runId: 'run-1',
    toolCallId: 'call-1',
    payload,
  }
}

describe('DesktopCapabilityMcpService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('call_tool', () => {
    it('executes a tool call and returns a success result', async () => {
      const mockRegistry = createMockMcpRegistry()

      const service = createDesktopCapabilityMcpService({
        getMcpRegistryService: () => mockRegistry,
      })

      const result = await service.handle(createRequest('call_tool', {
        serverId: 'test-server',
        remoteToolName: 'testTool',
        arguments: { param: 'value' },
      }))

      expect(result.ok).toBe(true)
      expect(result.toolId).toBe('test.tool')
      expect(result.serverId).toBe('mock-server')
      expect(result.content).toEqual([{ type: 'text', text: 'result' }])
    })

    it('returns failure result when executeTool reports error', async () => {
      const mockRegistry = createMockMcpRegistry(async () => ({
        ok: false,
        toolId: 'test.tool',
        serverId: 'error-server',
        remoteToolName: 'failingTool',
        error: {
          code: 'EXECUTION_FAILED',
          message: 'Tool execution failed',
          details: { reason: 'timeout' },
        },
      }))

      const service = createDesktopCapabilityMcpService({
        getMcpRegistryService: () => mockRegistry,
      })

      const result = await service.handle(createRequest('call_tool', {
        serverId: 'error-server',
        remoteToolName: 'failingTool',
        arguments: {},
      }))

      expect(result.ok).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('includes structuredContent in result when present', async () => {
      const mockRegistry = createMockMcpRegistry(async () => ({
        ok: true,
        toolId: 'test.tool',
        serverId: 's',
        remoteToolName: 't',
        content: [],
        structuredContent: { count: 42 },
      }))

      const service = createDesktopCapabilityMcpService({
        getMcpRegistryService: () => mockRegistry,
      })

      const result = await service.handle(createRequest('call_tool', {
        serverId: 's',
        remoteToolName: 't',
        arguments: {},
      }))

      expect(result.structuredContent).toEqual({ count: 42 })
    })

    it('includes snapshotRevision in result when present', async () => {
      const mockRegistry = createMockMcpRegistry(async () => ({
        ok: true,
        toolId: 'test.tool',
        serverId: 's',
        remoteToolName: 't',
        content: [],
        snapshotRevision: 5,
      }))

      const service = createDesktopCapabilityMcpService({
        getMcpRegistryService: () => mockRegistry,
      })

      const result = await service.handle(createRequest('call_tool', {
        serverId: 's',
        remoteToolName: 't',
        arguments: {},
      }))

      expect(result.snapshotRevision).toBe(5)
    })

    it('passes snapshotRevision from payload to executeTool', async () => {
      let capturedRequest: Record<string, unknown> | undefined
      const mockRegistry = createMockMcpRegistry(async (req) => {
        capturedRequest = req
        return {
          ok: true,
          toolId: 'test.tool',
          serverId: 's',
          remoteToolName: 't',
          content: [],
        }
      })

      const service = createDesktopCapabilityMcpService({
        getMcpRegistryService: () => mockRegistry,
      })

      await service.handle(createRequest('call_tool', {
        serverId: 's',
        remoteToolName: 't',
        arguments: {},
        snapshotRevision: 10,
      }))

      expect(capturedRequest?.snapshotRevision).toBe(10)
    })
  })

  describe('error handling', () => {
    it('throws for unsupported operation', async () => {
      const mockRegistry = createMockMcpRegistry()

      const service = createDesktopCapabilityMcpService({
        getMcpRegistryService: () => mockRegistry,
      })

      await expect(
        service.handle(createRequest('unknown_op' as string))
      ).rejects.toThrow(/not supported/)
    })

    it('throws when mcp registry service is not configured', async () => {
      const service = createDesktopCapabilityMcpService({})

      await expect(
        service.handle(createRequest('call_tool', {
          serverId: 's',
          remoteToolName: 't',
          arguments: {},
        }))
      ).rejects.toThrow(/not configured/)
    })
  })
})
