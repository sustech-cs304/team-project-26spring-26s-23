import type { HostedRuntimePaths } from '../runtime/runtime-paths'

export type DesktopCapabilityBridgeLogLevel = 'info' | 'warn' | 'error'

export interface DesktopCapabilityBridgeLogOptions {
  relayToRenderer?: boolean
}

export interface CreateDesktopCapabilityBridgeServiceOptions {
  prepareRuntimePaths: () => Promise<HostedRuntimePaths>
  appendLog?: (
    level: DesktopCapabilityBridgeLogLevel,
    message: string,
    context: Record<string, unknown> | null,
    options?: DesktopCapabilityBridgeLogOptions,
  ) => void | Promise<void>
}
