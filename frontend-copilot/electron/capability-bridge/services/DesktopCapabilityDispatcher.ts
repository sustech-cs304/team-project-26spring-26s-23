import type { DesktopCapabilityBridgeRequest } from '../protocol'
import { DesktopCapabilityBridgeError } from '../errors'
import type { CreateDesktopCapabilityBridgeServiceOptions } from '../types'
import { createDesktopCapabilitySecretService } from './DesktopCapabilitySecretService'
import type { ElectronSettingsWorkspaceService } from '../../settings-workspace/main-process'
import { createDesktopCapabilityWorkspaceService } from './DesktopCapabilityWorkspaceService'
import { createDesktopCapabilityDatabaseService } from './DesktopCapabilityDatabaseService'
import { createDesktopCapabilityArtifactService } from './DesktopCapabilityArtifactService'
import { createDesktopCapabilityStateService } from './DesktopCapabilityStateService'
import { createDesktopCapabilityEventService } from './DesktopCapabilityEventService'
import { createDesktopCapabilityMcpService } from './DesktopCapabilityMcpService'
import type { ElectronMcpRegistryService } from '../../mcp-registry/main-process'
import { createDesktopCapabilityBrowserService } from './DesktopCapabilityBrowserService'

export interface DesktopCapabilityDispatcher {
  handle(request: DesktopCapabilityBridgeRequest): Promise<Record<string, unknown>>
}

export interface CreateDesktopCapabilityDispatcherOptions extends CreateDesktopCapabilityBridgeServiceOptions {
  getSettingsWorkspaceService?: () => ElectronSettingsWorkspaceService
  getMcpRegistryService?: () => ElectronMcpRegistryService
}

export function createDesktopCapabilityDispatcher(
  options: CreateDesktopCapabilityDispatcherOptions,
): DesktopCapabilityDispatcher {
  const secretService = createDesktopCapabilitySecretService(options)
  const workspaceService = createDesktopCapabilityWorkspaceService(options)
  const databaseService = createDesktopCapabilityDatabaseService(options)
  const artifactService = createDesktopCapabilityArtifactService(options)
  const stateService = createDesktopCapabilityStateService(options)
  const eventService = createDesktopCapabilityEventService(options)
  const mcpService = createDesktopCapabilityMcpService(options)
  const browserService = createDesktopCapabilityBrowserService(options)

  return {
    async handle(request) {
      switch (request.capability) {
        case 'secret':
          return await secretService.handle(request)
        case 'workspace':
          return await workspaceService.handle(request)
        case 'database':
          return await databaseService.handle(request)
        case 'artifact':
          return await artifactService.handle(request)
        case 'state':
          return await stateService.handle(request)
        case 'event':
          return await eventService.handle(request)
        case 'mcp':
          return await mcpService.handle(request)
        case 'browser':
          return await browserService.handle(request)
        default:
          throw new DesktopCapabilityBridgeError(
            'unsupported_capability',
            `Capability '${String((request as { capability?: unknown }).capability ?? '')}' is not supported.`,
            {
              details: {
                capability: (request as { capability?: unknown }).capability,
              },
            },
          )
      }
    },
  }
}
