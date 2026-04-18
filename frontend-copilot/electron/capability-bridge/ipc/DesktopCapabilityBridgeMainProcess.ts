import type { ElectronSettingsWorkspaceService } from '../../settings-workspace/main-process'
import {
  createDesktopCapabilityBridgeFailureResponse,
  createDesktopCapabilityBridgeSuccessResponse,
  isSupportedDesktopCapabilityOperation,
  type DesktopCapabilityBridgeRequest,
  type DesktopCapabilityBridgeResponse,
} from '../protocol'
import { DesktopCapabilityBridgeError } from '../errors'
import type { CreateDesktopCapabilityBridgeServiceOptions } from '../types'
import { createDesktopCapabilityDispatcher } from '../services/DesktopCapabilityDispatcher'

export interface ElectronDesktopCapabilityBridgeService {
  handleRequest: (request: DesktopCapabilityBridgeRequest) => Promise<DesktopCapabilityBridgeResponse>
}

export interface CreateElectronDesktopCapabilityBridgeServiceOptions extends CreateDesktopCapabilityBridgeServiceOptions {
  getSettingsWorkspaceService?: () => ElectronSettingsWorkspaceService
}

export function createElectronDesktopCapabilityBridgeService(
  options: CreateElectronDesktopCapabilityBridgeServiceOptions,
): ElectronDesktopCapabilityBridgeService {
  const dispatcher = createDesktopCapabilityDispatcher(options)

  return {
    async handleRequest(request) {
      if (!isSupportedDesktopCapabilityOperation(request.capability, request.operation)) {
        return createDesktopCapabilityBridgeFailureResponse({
          requestId: request.requestId,
          errorCode: 'unsupported_operation',
          errorMessage: `Operation '${request.operation}' is not supported for capability '${request.capability}'.`,
          details: {
            capability: request.capability,
            operation: request.operation,
          },
        })
      }

      try {
        const result = await dispatcher.handle(request)
        return createDesktopCapabilityBridgeSuccessResponse(request.requestId, result)
      } catch (error) {
        const normalizedError = normalizeCapabilityBridgeError(error)
        if (!(error instanceof DesktopCapabilityBridgeError)) {
          await options.appendLog?.('error', '[capability-bridge] Unhandled capability bridge error.', {
            capability: request.capability,
            operation: request.operation,
            requestId: request.requestId,
            detail: error instanceof Error ? error.message : String(error),
          })
        }

        return createDesktopCapabilityBridgeFailureResponse({
          requestId: request.requestId,
          ...normalizedError,
        })
      }
    },
  }
}

function normalizeCapabilityBridgeError(error: unknown): {
  errorCode: DesktopCapabilityBridgeError['code']
  errorMessage: string
  errorRetryable: boolean
  details: Record<string, unknown>
} {
  if (error instanceof DesktopCapabilityBridgeError) {
    return {
      errorCode: error.code,
      errorMessage: error.message,
      errorRetryable: error.retryable,
      details: { ...error.details },
    }
  }

  return {
    errorCode: 'internal_error',
    errorMessage: 'Desktop capability bridge failed to process the request.',
    errorRetryable: false,
    details: {},
  }
}
