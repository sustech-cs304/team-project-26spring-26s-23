import type { DesktopCapabilityBridgeRequest } from '../protocol'
import { DesktopCapabilityBridgeError } from '../errors'
import type { ElectronMcpRegistryService } from '../../mcp-registry/main-process'

export interface DesktopCapabilityMcpService {
  handle(request: DesktopCapabilityBridgeRequest): Promise<Record<string, unknown>>
}

export interface CreateDesktopCapabilityMcpServiceOptions {
  getMcpRegistryService?: () => ElectronMcpRegistryService
}

export function createDesktopCapabilityMcpService(
  options: CreateDesktopCapabilityMcpServiceOptions,
): DesktopCapabilityMcpService {
  return {
    async handle(request) {
      if (request.operation !== 'call_tool') {
        throw new DesktopCapabilityBridgeError(
          'unsupported_operation',
          `Operation '${request.operation}' is not supported for capability '${request.capability}'.`,
        )
      }

      const getMcpRegistryService = options.getMcpRegistryService
      if (getMcpRegistryService === undefined) {
        throw new DesktopCapabilityBridgeError(
          'internal_error',
          'The MCP execution bridge is not configured.',
        )
      }

      const result = await getMcpRegistryService().executeTool({
        toolId: request.toolId,
        serverId: String(request.payload.serverId ?? ''),
        remoteToolName: String(request.payload.remoteToolName ?? ''),
        arguments: request.payload.arguments as Record<string, unknown>,
        runId: request.runId,
        toolCallId: request.toolCallId,
        snapshotRevision: typeof request.payload.snapshotRevision === 'number'
          ? request.payload.snapshotRevision
          : null,
      })

      if (result.ok) {
        return {
          ok: true,
          toolId: result.toolId,
          serverId: result.serverId,
          remoteToolName: result.remoteToolName,
          content: [...result.content],
          ...(result.structuredContent === undefined ? {} : { structuredContent: result.structuredContent }),
          ...(result.snapshotRevision === undefined ? {} : { snapshotRevision: result.snapshotRevision }),
          ...(result.isError === undefined ? {} : { isError: result.isError }),
        }
      }

      return {
        ok: false,
        toolId: result.toolId,
        serverId: result.serverId,
        remoteToolName: result.remoteToolName,
        ...(result.snapshotRevision === undefined ? {} : { snapshotRevision: result.snapshotRevision }),
        error: {
          ...result.error,
          ...(result.error.details === undefined || result.error.details === null
            ? { details: result.error.details ?? null }
            : { details: { ...result.error.details } }),
        },
      }
    },
  }
}
