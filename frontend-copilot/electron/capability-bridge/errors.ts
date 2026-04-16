import type { DesktopCapabilityBridgeErrorCode } from './protocol'

export interface DesktopCapabilityBridgeErrorOptions {
  details?: Record<string, unknown>
  retryable?: boolean
}

export class DesktopCapabilityBridgeError extends Error {
  readonly code: DesktopCapabilityBridgeErrorCode
  readonly details: Record<string, unknown>
  readonly retryable: boolean

  constructor(
    code: DesktopCapabilityBridgeErrorCode,
    message: string,
    options: DesktopCapabilityBridgeErrorOptions = {},
  ) {
    super(message)
    this.name = 'DesktopCapabilityBridgeError'
    this.code = code
    this.details = { ...(options.details ?? {}) }
    this.retryable = options.retryable ?? false
  }
}
