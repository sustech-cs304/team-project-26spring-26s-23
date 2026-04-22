import type { HostedRuntimePaths } from '../runtime/runtime-paths'
import { createManagedRuntimeService } from '../managed-runtime/ManagedRuntimeService'
import { createMcpCapabilitySnapshotSink } from './snapshot'
import { createMcpRegistryApiFailure } from './ipc'
import { createMcpRegistryService, type McpRegistryService } from './service'
import { createMcpRegistryPaths, createMcpRegistryStore } from './store'
import type {
  McpDeleteServerResult,
  McpRefreshCatalogRequest,
  McpRefreshCatalogResult,
  McpRegistryLoadRequest,
  McpRegistryLoadResult,
  McpSaveServerResult,
  McpSetServerEnabledRequest,
  McpSetServerEnabledResult,
  McpTestConnectionRequest,
  McpTestConnectionResult,
} from './ipc'
import type {
  McpRegistrySubscriptionEvent,
  McpServerDraft,
  McpToolCallFailure,
  McpToolCallRequest,
  McpToolCallResult,
} from './types'

export interface ElectronMcpRegistryLogger {
  (
    level: 'info' | 'warn' | 'error',
    message: string,
    context: Record<string, unknown> | null,
  ): void | Promise<void>
}

export interface CreateElectronMcpRegistryServiceOptions {
  prepareRuntimePaths: () => Promise<HostedRuntimePaths>
  appendLog?: ElectronMcpRegistryLogger
  publishRegistryEvent?: (event: McpRegistrySubscriptionEvent) => void | Promise<void>
  now?: () => string
}

export interface ElectronMcpRegistryService {
  loadRegistry: (request?: McpRegistryLoadRequest) => Promise<McpRegistryLoadResult>
  saveServer: (draft: McpServerDraft) => Promise<McpSaveServerResult>
  deleteServer: (serverId: string) => Promise<McpDeleteServerResult>
  setServerEnabled: (request: McpSetServerEnabledRequest) => Promise<McpSetServerEnabledResult>
  testConnection: (request: McpTestConnectionRequest) => Promise<McpTestConnectionResult>
  refreshCatalog: (request?: McpRefreshCatalogRequest) => Promise<McpRefreshCatalogResult>
  warmupEnabledServersOnStartup: () => Promise<void>
  executeTool: (request: McpToolCallRequest) => Promise<McpToolCallResult>
}

export function createElectronMcpRegistryService(
  options: CreateElectronMcpRegistryServiceOptions,
): ElectronMcpRegistryService {
  let servicePromise: Promise<McpRegistryService> | null = null

  const getService = async (): Promise<McpRegistryService> => {
    if (servicePromise === null) {
      const nextServicePromise = (async () => {
        const runtimePaths = await options.prepareRuntimePaths()
        return createMcpRegistryService({
          store: createMcpRegistryStore({
            paths: createMcpRegistryPaths(runtimePaths),
          }),
          managedRuntimeService: createManagedRuntimeService({
            userDataPath: runtimePaths.userDataDir,
            hostedRuntimePaths: runtimePaths,
          }),
          snapshotSink: createMcpCapabilitySnapshotSink({
            runtimePaths,
          }),
          now: options.now,
          publishEvent: options.publishRegistryEvent,
          appendLog: options.appendLog,
        })
      })()

      servicePromise = nextServicePromise
      void nextServicePromise.catch(() => {
        if (servicePromise === nextServicePromise) {
          servicePromise = null
        }
      })
    }

    return await servicePromise
  }

  return {
    async loadRegistry(request) {
      return await wrapOperation('load the MCP registry', options.appendLog, async () => {
        return await (await getService()).loadRegistry(request)
      })
    },
    async saveServer(draft) {
      return await wrapOperation('save the MCP server draft', options.appendLog, async () => {
        return await (await getService()).saveServer(draft)
      })
    },
    async deleteServer(serverId) {
      return await wrapOperation('delete the MCP server', options.appendLog, async () => {
        return await (await getService()).deleteServer(serverId)
      })
    },
    async setServerEnabled(request) {
      return await wrapOperation('toggle the MCP server enabled flag', options.appendLog, async () => {
        return await (await getService()).setServerEnabled(request)
      })
    },
    async testConnection(request) {
      return await wrapOperation('test the MCP server connection', options.appendLog, async () => {
        return await (await getService()).testConnection(request)
      })
    },
    async refreshCatalog(request) {
      return await wrapOperation('refresh the MCP server catalog', options.appendLog, async () => {
        return await (await getService()).refreshCatalog(request)
      })
    },
    async warmupEnabledServersOnStartup() {
      await wrapOperation('warm enabled MCP servers during application startup', options.appendLog, async () => {
        await (await getService()).warmupEnabledServersOnStartup()
        return null
      })
    },
    async executeTool(request) {
      try {
        return await (await getService()).executeTool(request)
      } catch (error) {
        const detail = formatUnknownError(error)
        await options.appendLog?.('error', '[mcp-registry] Failed to execute the MCP tool.', {
          detail,
          toolId: request.toolId,
          serverId: request.serverId,
          remoteToolName: request.remoteToolName,
          snapshotRevision: request.snapshotRevision ?? null,
          runId: request.runId,
          toolCallId: request.toolCallId,
        })

        const failure: McpToolCallFailure = {
          ok: false,
          toolId: request.toolId,
          serverId: request.serverId,
          remoteToolName: request.remoteToolName,
          snapshotRevision: request.snapshotRevision ?? null,
          error: {
            code: 'internal_error',
            message: `Failed to execute the MCP tool: ${detail}`,
            retryable: false,
            details: {
              toolId: request.toolId,
              serverId: request.serverId,
              remoteToolName: request.remoteToolName,
              snapshotRevision: request.snapshotRevision ?? null,
              runId: request.runId,
              toolCallId: request.toolCallId,
            },
          },
        }

        return failure
      }
    },
  }
}

async function wrapOperation<TResult>(
  action: string,
  appendLog: ElectronMcpRegistryLogger | undefined,
  run: () => Promise<TResult>,
): Promise<TResult> {
  try {
    return await run()
  } catch (error) {
    const detail = formatUnknownError(error)
    await appendLog?.('error', `[mcp-registry] Failed to ${action}.`, { detail })
    return createMcpRegistryApiFailure(`Failed to ${action}: ${detail}`, 'internal_error') as TResult
  }
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
