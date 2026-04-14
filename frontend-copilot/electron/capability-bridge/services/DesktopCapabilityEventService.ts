import type { DesktopCapabilityBridgeRequest } from '../protocol'
import { DesktopCapabilityBridgeError } from '../errors'
import type { CreateDesktopCapabilityBridgeServiceOptions } from '../types'

export interface DesktopCapabilityEventService {
  handle(request: DesktopCapabilityBridgeRequest): Promise<Record<string, unknown>>
}

export function createDesktopCapabilityEventService(
  options: CreateDesktopCapabilityBridgeServiceOptions,
): DesktopCapabilityEventService {
  return {
    async handle(request) {
      if (request.operation !== 'emit_event') {
        throw new DesktopCapabilityBridgeError(
          'unsupported_operation',
          `Event capability does not support operation '${request.operation}'.`,
          {
            details: {
              capability: request.capability,
              operation: request.operation,
            },
          },
        )
      }

      await options.appendLog?.('info', '[capability-bridge] Event emitted.', {
        capability: request.capability,
        operation: request.operation,
        toolId: request.toolId,
        runId: request.runId,
        toolCallId: request.toolCallId,
        eventType: request.payload.eventType,
        message: request.payload.message,
        data: request.payload.data,
      })

      return {}
    },
  }
}
