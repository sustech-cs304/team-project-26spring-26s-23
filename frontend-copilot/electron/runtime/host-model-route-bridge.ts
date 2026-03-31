import { randomBytes } from 'node:crypto'
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import type {
  SettingsWorkspaceProviderRouteResolveRequest,
  SettingsWorkspaceProviderRouteResolveResult,
} from '../settings-workspace/provider-route-resolver'
import { formatRuntimeBaseUrl } from './runtime-launch-config'
import { allocateLoopbackPort } from './runtime-network'
import { DEFAULT_RUNTIME_HOST } from './runtime-config-flags'

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8'

export const HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER = 'X-Host-Model-Route-Token'
export const HOST_MODEL_ROUTE_BRIDGE_RESOLVE_PATH = '/host/private/provider-routes/resolve'
export const HOST_MODEL_ROUTE_BRIDGE_ERROR_CODES = {
  INVALID_TOKEN: 'invalid_host_model_route_bridge_token',
  INVALID_REQUEST: 'invalid_host_model_route_bridge_request',
} as const

export type HostModelRouteBridgeErrorCode =
  (typeof HOST_MODEL_ROUTE_BRIDGE_ERROR_CODES)[keyof typeof HOST_MODEL_ROUTE_BRIDGE_ERROR_CODES]

export interface HostModelRouteBridgeError {
  code: HostModelRouteBridgeErrorCode
  message: string
  details: Record<string, unknown>
}

export type HostModelRouteBridgeResolveResponse =
  | SettingsWorkspaceProviderRouteResolveResult
  | {
    ok: false
    error: HostModelRouteBridgeError
  }

export interface HostModelRouteBridgeBootstrap {
  url: string
  token: string
  headerName: typeof HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER
}

export interface HostModelRouteBridge {
  bootstrap: HostModelRouteBridgeBootstrap
  stop: () => Promise<void>
}

export interface CreateHostModelRouteBridgeOptions {
  resolveProviderRoute: (
    request: SettingsWorkspaceProviderRouteResolveRequest,
  ) => Promise<SettingsWorkspaceProviderRouteResolveResult> | SettingsWorkspaceProviderRouteResolveResult
  host?: string
  token?: string
  port?: number
}

export function createHostModelRouteBridgeToken(): string {
  return randomBytes(24).toString('hex')
}

export async function createHostModelRouteBridge(
  options: CreateHostModelRouteBridgeOptions,
): Promise<HostModelRouteBridge> {
  const host = options.host ?? DEFAULT_RUNTIME_HOST
  const token = options.token ?? createHostModelRouteBridgeToken()
  const port = options.port ?? await allocateLoopbackPort(host)
  const server = createServer(async (request, response) => {
    await handleHostModelRouteBridgeRequest(request, response, {
      token,
      resolveProviderRoute: options.resolveProviderRoute,
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve()
    })
  })

  const baseUrl = formatRuntimeBaseUrl(host, port)

  return {
    bootstrap: {
      url: `${baseUrl}${HOST_MODEL_ROUTE_BRIDGE_RESOLVE_PATH}`,
      token,
      headerName: HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER,
    },
    stop: async () => {
      await closeServer(server)
    },
  }
}

async function handleHostModelRouteBridgeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: {
    token: string
    resolveProviderRoute: CreateHostModelRouteBridgeOptions['resolveProviderRoute']
  },
): Promise<void> {
  if (request.method !== 'POST' || request.url !== HOST_MODEL_ROUTE_BRIDGE_RESOLVE_PATH) {
    response.statusCode = 404
    response.end()
    return
  }

  if (request.headers[HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER.toLowerCase()] !== options.token) {
    writeJsonResponse(response, 401, {
      ok: false,
      error: {
        code: HOST_MODEL_ROUTE_BRIDGE_ERROR_CODES.INVALID_TOKEN,
        message: 'Missing or invalid host model route bridge token.',
        details: {
          headerName: HOST_MODEL_ROUTE_BRIDGE_TOKEN_HEADER,
        },
      },
    })
    return
  }

  let requestBody: unknown
  try {
    requestBody = await readJsonBody(request)
  } catch {
    writeJsonResponse(response, 400, {
      ok: false,
      error: {
        code: HOST_MODEL_ROUTE_BRIDGE_ERROR_CODES.INVALID_REQUEST,
        message: 'Host model route bridge request body must be valid JSON.',
        details: {},
      },
    })
    return
  }

  if (!isProviderRouteResolveRequest(requestBody)) {
    writeJsonResponse(response, 400, {
      ok: false,
      error: {
        code: HOST_MODEL_ROUTE_BRIDGE_ERROR_CODES.INVALID_REQUEST,
        message: 'Host model route bridge request body is invalid.',
        details: {},
      },
    })
    return
  }

  const result = await options.resolveProviderRoute(requestBody)
  writeJsonResponse(response, 200, result)
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }

  const rawBody = Buffer.concat(chunks).toString('utf8')
  return rawBody.trim() === '' ? null : JSON.parse(rawBody) as unknown
}

function isProviderRouteResolveRequest(value: unknown): value is SettingsWorkspaceProviderRouteResolveRequest {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const record = value as Record<string, unknown>
  const snapshot = record.snapshot
  if (typeof record.providerProfileId !== 'string' || typeof snapshot !== 'object' || snapshot === null) {
    return false
  }

  const snapshotRecord = snapshot as Record<string, unknown>
  return typeof snapshotRecord.provider === 'string'
    && typeof snapshotRecord.endpointType === 'string'
    && typeof snapshotRecord.baseUrl === 'string'
    && typeof snapshotRecord.modelId === 'string'
}

function writeJsonResponse(
  response: ServerResponse,
  statusCode: number,
  payload: HostModelRouteBridgeResolveResponse,
): void {
  response.statusCode = statusCode
  response.setHeader('content-type', JSON_CONTENT_TYPE)
  response.end(`${JSON.stringify(payload)}\n`)
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })
}
