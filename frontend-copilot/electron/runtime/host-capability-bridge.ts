import { randomBytes } from 'node:crypto'
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http'
import {
  createDesktopCapabilityBridgeFailureResponse,
  normalizeDesktopCapabilityBridgeRequest,
  type DesktopCapabilityBridgeRequest,
  type DesktopCapabilityBridgeResponse,
} from '../capability-bridge/protocol'
import { formatRuntimeBaseUrl } from './runtime-launch-config'
import { allocateLoopbackPort } from './runtime-network'
import { DEFAULT_RUNTIME_HOST } from './runtime-config-flags'

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8'
const INVALID_REQUEST_ID = 'invalid-request'
const UNAUTHORIZED_REQUEST_ID = 'unauthorized'

export const HOST_CAPABILITY_BRIDGE_TOKEN_HEADER = 'X-Host-Capability-Bridge-Token'
export const HOST_CAPABILITY_BRIDGE_PATH = '/host/private/capability-bridge'

export interface HostCapabilityBridgeBootstrap {
  url: string
  token: string
  headerName: typeof HOST_CAPABILITY_BRIDGE_TOKEN_HEADER
}

export interface HostCapabilityBridge {
  bootstrap: HostCapabilityBridgeBootstrap
  stop: () => Promise<void>
}

export interface CreateHostCapabilityBridgeOptions {
  handleRequest: (
    request: DesktopCapabilityBridgeRequest,
  ) => Promise<DesktopCapabilityBridgeResponse> | DesktopCapabilityBridgeResponse
  host?: string
  token?: string
  port?: number
}

export function createHostCapabilityBridgeToken(): string {
  return randomBytes(24).toString('hex')
}

export async function createHostCapabilityBridge(
  options: CreateHostCapabilityBridgeOptions,
): Promise<HostCapabilityBridge> {
  const host = options.host ?? DEFAULT_RUNTIME_HOST
  const token = options.token ?? createHostCapabilityBridgeToken()
  const port = options.port ?? await allocateLoopbackPort(host)
  const server = createServer(async (request, response) => {
    await handleHostCapabilityBridgeRequest(request, response, {
      token,
      handleRequest: options.handleRequest,
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
      url: `${baseUrl}${HOST_CAPABILITY_BRIDGE_PATH}`,
      token,
      headerName: HOST_CAPABILITY_BRIDGE_TOKEN_HEADER,
    },
    stop: async () => {
      await closeServer(server)
    },
  }
}

async function handleHostCapabilityBridgeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: {
    token: string
    handleRequest: CreateHostCapabilityBridgeOptions['handleRequest']
  },
): Promise<void> {
  if (request.method !== 'POST' || request.url !== HOST_CAPABILITY_BRIDGE_PATH) {
    response.statusCode = 404
    response.end()
    return
  }

  if (!isValidHostCapabilityBridgeToken(request, options.token)) {
    writeJsonResponse(response, 401, createDesktopCapabilityBridgeFailureResponse({
      requestId: UNAUTHORIZED_REQUEST_ID,
      errorCode: 'permission_denied',
      errorMessage: 'Missing or invalid host capability bridge token.',
      details: {
        headerName: HOST_CAPABILITY_BRIDGE_TOKEN_HEADER,
      },
    }))
    return
  }

  let requestBody: unknown
  try {
    requestBody = await readJsonBody(request)
  } catch {
    writeJsonResponse(response, 400, createDesktopCapabilityBridgeFailureResponse({
      requestId: INVALID_REQUEST_ID,
      errorCode: 'invalid_request',
      errorMessage: 'Host capability bridge request body must be valid JSON.',
      details: {},
    }))
    return
  }

  let normalizedRequest: DesktopCapabilityBridgeRequest
  try {
    normalizedRequest = normalizeDesktopCapabilityBridgeRequest(requestBody)
  } catch (error) {
    writeJsonResponse(response, 400, createDesktopCapabilityBridgeFailureResponse({
      requestId: resolveRequestIdCandidate(requestBody),
      errorCode: 'invalid_request',
      errorMessage: error instanceof Error ? error.message : String(error),
      details: {},
    }))
    return
  }

  try {
    const bridgeResponse = await options.handleRequest(normalizedRequest)
    writeJsonResponse(response, 200, bridgeResponse)
  } catch (error) {
    writeJsonResponse(response, 200, createDesktopCapabilityBridgeFailureResponse({
      requestId: normalizedRequest.requestId,
      errorCode: 'internal_error',
      errorMessage: error instanceof Error ? error.message : String(error),
      details: {},
    }))
  }
}

function isValidHostCapabilityBridgeToken(request: IncomingMessage, token: string): boolean {
  const rawHeader = request.headers[HOST_CAPABILITY_BRIDGE_TOKEN_HEADER.toLowerCase()]
  if (rawHeader === undefined) {
    return false
  }

  const headerValues = (Array.isArray(rawHeader) ? rawHeader : [rawHeader])
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value !== '')

  return headerValues.length > 0 && headerValues.every((value) => value === token)
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }

  const rawBody = Buffer.concat(chunks).toString('utf8')
  return rawBody.trim() === '' ? null : JSON.parse(rawBody) as unknown
}

function resolveRequestIdCandidate(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return INVALID_REQUEST_ID
  }

  const requestId = (value as { requestId?: unknown }).requestId
  if (typeof requestId !== 'string' || requestId.trim() === '') {
    return INVALID_REQUEST_ID
  }

  return requestId.trim()
}

function writeJsonResponse(
  response: ServerResponse,
  statusCode: number,
  payload: DesktopCapabilityBridgeResponse,
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
