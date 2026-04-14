import type { HostedRuntimePaths } from '../runtime/runtime-paths'

export type DesktopCapabilityBridgeLogLevel = 'info' | 'warn' | 'error'

export interface CreateDesktopCapabilityBridgeServiceOptions {
  prepareRuntimePaths: () => Promise<HostedRuntimePaths>
  appendLog?: (
    level: DesktopCapabilityBridgeLogLevel,
    message: string,
    context: Record<string, unknown> | null,
  ) => void | Promise<void>
}
