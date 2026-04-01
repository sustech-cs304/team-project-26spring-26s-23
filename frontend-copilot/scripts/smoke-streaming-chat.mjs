import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const frontendRoot = path.resolve(__dirname, '..')
const workspaceRoot = path.resolve(frontendRoot, '..')
const backendRoot = path.resolve(workspaceRoot, 'backend')

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_MESSAGE = '请仅回复“stream smoke ok”。'
const DEFAULT_USER_DATA_DIR = path.join(process.env.APPDATA ?? 'C:/Users/24352/AppData/Roaming', 'CanDue')
const DEFAULT_AGENT_ID = 'default'
const BRIDGE_PATH = '/host/private/provider-routes/resolve'
const BRIDGE_TOKEN_HEADER = 'X-Host-Model-Route-Token'
const SUPPORTED_STREAM_ENDPOINT_TYPES = new Set(['openai-compatible'])
const SUPPORTED_STREAM_ENDPOINT_TYPE_HINT = 'openai-compatible'

async function main() {
  const options = parseArgs(process.argv.slice(2))
  const workspaceState = await loadWorkspaceState(options.userDataDir)
  const candidates = workspaceState.providerProfiles.map((profile) => summarizeProviderProfile(profile, workspaceState.providerSecrets))

  console.log('=== streaming smoke provider candidates ===')
  console.table(candidates)
  console.log('=== workspace documents ===')
  console.log(JSON.stringify({
    stateDocument: workspaceState.stateDocument,
    secretsDocument: workspaceState.secretsDocument,
  }, null, 2))

  const selectedProfile = selectProviderProfile({
    providerProfiles: workspaceState.providerProfiles,
    providerSecrets: workspaceState.providerSecrets,
    preferredProfileId: options.providerProfileId,
  })

  if (selectedProfile === null) {
    throw new Error('No provider profile with a secret and a stream-supported endpoint type is available.')
  }

  const route = createRuntimeModelRoute(selectedProfile)
  console.log('=== selected provider route ===')
  console.log(JSON.stringify(route, null, 2))

  ensureStreamingRouteIsSupported(route)

  const resolvedRoute = resolveProviderRoute({
    providerProfiles: workspaceState.providerProfiles,
    providerSecrets: workspaceState.providerSecrets,
    request: route,
  })
  console.log('=== host route resolution preview ===')
  console.log(JSON.stringify(sanitizeRouteResolutionResult(resolvedRoute), null, 2))

  if (resolvedRoute.ok !== true) {
    throw new Error(`Route resolution failed before smoke run: ${JSON.stringify(resolvedRoute)}`)
  }

  const bridge = await createHostModelRouteBridge({
    host: DEFAULT_HOST,
    providerProfiles: workspaceState.providerProfiles,
    providerSecrets: workspaceState.providerSecrets,
  })
  const runtimePort = await allocateLoopbackPort(DEFAULT_HOST)
  const runtimeUrl = `http://${DEFAULT_HOST}:${runtimePort}`
  const backendProcess = spawn(
    process.platform === 'win32' ? 'uv.exe' : 'uv',
    [
      'run',
      'python',
      '-m',
      'app.desktop_runtime.server',
      '--host',
      DEFAULT_HOST,
      '--port',
      String(runtimePort),
      '--app-mode',
      'desktop',
      '--environment',
      'development',
      '--host-model-route-bridge-url',
      bridge.bootstrap.url,
      '--host-model-route-bridge-token',
      bridge.bootstrap.token,
    ],
    {
      cwd: backendRoot,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  )

  pipeChildOutput(backendProcess.stdout, '[backend:stdout] ')
  pipeChildOutput(backendProcess.stderr, '[backend:stderr] ')

  try {
    await waitForReady(`${runtimeUrl}/ready`)

    const sessionResponse = await postJson(`${runtimeUrl}/`, {
      method: 'session/create',
      body: { agentId: DEFAULT_AGENT_ID },
    })
    const sessionPayload = await readJson(sessionResponse)
    console.log('=== session/create response ===')
    console.log(JSON.stringify(sessionPayload, null, 2))

    if (sessionPayload?.ok !== true || typeof sessionPayload.sessionId !== 'string') {
      throw new Error(`Unexpected session/create response: ${JSON.stringify(sessionPayload)}`)
    }

    const abortController = options.cancelAfterFirstDelta ? new AbortController() : null
    const messageResponse = await fetch(`${runtimeUrl}/`, {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: 'message/send',
        body: {
          sessionId: sessionPayload.sessionId,
          message: {
            role: 'user',
            content: options.message,
          },
          policy: {
            modelRoute: route,
            enabledTools: [],
            requestOptions: {},
          },
        },
      }),
      signal: abortController?.signal,
    })

    if (!messageResponse.ok || messageResponse.body === null) {
      throw new Error(`message/send failed before streaming: HTTP ${messageResponse.status} ${await messageResponse.text()}`)
    }

    console.log('=== streamed runtime events ===')
    if (options.cancelAfterFirstDelta) {
      const cancelResult = await readRuntimeRunEventsUntilFirstDeltaAndAbort(messageResponse.body, abortController)
      for (const event of cancelResult.events) {
        console.log(JSON.stringify(summarizeRuntimeEvent(event), null, 2))
      }

      const textDeltaEvents = cancelResult.events.filter((event) => event.type === 'text_delta')
      if (!cancelResult.transportAborted) {
        throw new Error('Cancel smoke expected the client transport to abort after the first delta.')
      }
      if (!cancelResult.events.some((event) => event.type === 'run_started')) {
        throw new Error('Cancel smoke expected a run_started event before aborting the stream.')
      }
      if (textDeltaEvents.length !== 1) {
        throw new Error(`Cancel smoke expected exactly one text_delta before aborting, received ${textDeltaEvents.length}.`)
      }
      if (cancelResult.events.some((event) => event.type === 'run_completed')) {
        throw new Error('Cancel smoke must not observe a run_completed event after client abort.')
      }

      await delay(250)
      console.log('=== cancel smoke summary ===')
      console.log(JSON.stringify({
        runtimeUrl,
        providerProfileId: route.providerProfileId,
        modelId: route.snapshot.modelId,
        abortedByClient: cancelResult.transportAborted,
        eventTypes: cancelResult.events.map((event) => event.type),
        firstDelta: textDeltaEvents[0]?.payload?.delta ?? null,
      }, null, 2))
      return
    }

    const events = await readRuntimeRunEvents(messageResponse.body)
    for (const event of events) {
      console.log(JSON.stringify(summarizeRuntimeEvent(event), null, 2))
    }

    const terminalEvent = events.at(-1)
    if (terminalEvent === undefined) {
      throw new Error('The runtime stream completed without emitting any events.')
    }
    if (terminalEvent.type !== 'run_completed') {
      throw new Error(`Streaming run did not complete successfully: ${JSON.stringify(terminalEvent)}`)
    }

    console.log('=== smoke summary ===')
    console.log(JSON.stringify({
      runtimeUrl,
      providerProfileId: route.providerProfileId,
      modelId: route.snapshot.modelId,
      eventTypes: events.map((event) => event.type),
      assistantText: terminalEvent.payload?.assistantText ?? null,
    }, null, 2))
  } finally {
    await Promise.allSettled([
      stopChildProcess(backendProcess),
      bridge.stop(),
    ])
  }
}

function parseArgs(argv) {
  const options = {
    userDataDir: DEFAULT_USER_DATA_DIR,
    providerProfileId: null,
    message: DEFAULT_MESSAGE,
    cancelAfterFirstDelta: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    const nextValue = argv[index + 1]

    if (token === '--user-data-dir' && typeof nextValue === 'string') {
      options.userDataDir = nextValue
      index += 1
      continue
    }

    if (token === '--provider-profile-id' && typeof nextValue === 'string') {
      options.providerProfileId = nextValue
      index += 1
      continue
    }

    if (token === '--message' && typeof nextValue === 'string') {
      options.message = nextValue
      index += 1
      continue
    }

    if (token === '--cancel-after-first-delta') {
      options.cancelAfterFirstDelta = true
      continue
    }

    throw new Error(`Unknown or incomplete argument: ${token}`)
  }

  return options
}

async function loadWorkspaceState(userDataDir) {
  const normalizedUserDataDir = path.resolve(userDataDir)
  const runtimeRootDir = path.join(normalizedUserDataDir, 'desktop-runtime')
  const configCenterDir = path.join(runtimeRootDir, 'config', 'config-center')
  const stateDocument = path.join(configCenterDir, 'settings-workspace-state.json')
  const secretsDocument = path.join(configCenterDir, 'settings-workspace-secrets.json')

  const [statePayload, secretsPayload] = await Promise.all([
    readJsonFile(stateDocument),
    readJsonFile(secretsDocument),
  ])

  const providerProfiles = Array.isArray(statePayload?.values?.providerProfiles)
    ? statePayload.values.providerProfiles.filter((profile) => isRecord(profile))
    : []
  const providerSecretsRecord = isRecord(secretsPayload?.values?.providerSecrets)
    ? secretsPayload.values.providerSecrets
    : {}

  return {
    stateDocument,
    secretsDocument,
    providerProfiles,
    providerSecrets: providerSecretsRecord,
  }
}

function summarizeProviderProfile(profile, providerSecrets) {
  const route = createRuntimeModelRoute(profile)
  return {
    id: normalizeNonEmptyString(profile.id),
    protocol: normalizeNonEmptyString(profile.protocol),
    endpointType: route.snapshot.endpointType,
    modelId: route.snapshot.modelId,
    hasSecret: hasProviderSecret(providerSecrets, profile.id),
    supported: SUPPORTED_STREAM_ENDPOINT_TYPES.has(route.snapshot.endpointType),
  }
}

function selectProviderProfile(input) {
  if (input.preferredProfileId !== null) {
    return input.providerProfiles.find((profile) => normalizeIdentifier(profile.id) === normalizeIdentifier(input.preferredProfileId)) ?? null
  }

  return input.providerProfiles.find((profile) => {
    const route = createRuntimeModelRoute(profile)
    return hasProviderSecret(input.providerSecrets, profile.id)
      && route.snapshot.modelId !== ''
      && SUPPORTED_STREAM_ENDPOINT_TYPES.has(route.snapshot.endpointType)
  }) ?? null
}

function createRuntimeModelRoute(profile) {
  const provider = normalizeIdentifier(profile.protocol)
  return {
    providerProfileId: normalizeNonEmptyString(profile.id),
    snapshot: {
      provider,
      endpointType: provider === 'openai' ? 'openai-compatible' : provider,
      baseUrl: normalizeBaseUrl(profile.endpoint),
      modelId: pickProfileModelId(profile),
    },
  }
}

function pickProfileModelId(profile) {
  for (const candidate of [
    profile.defaultModel,
    profile.fastModel,
    profile.fallbackModel,
    ...(Array.isArray(profile.availableModels) ? profile.availableModels.map((model) => model?.modelId) : []),
  ]) {
    const normalized = normalizeNonEmptyString(candidate)
    if (normalized !== '') {
      return normalized
    }
  }

  return ''
}

function ensureStreamingRouteIsSupported(route) {
  if (SUPPORTED_STREAM_ENDPOINT_TYPES.has(route.snapshot.endpointType)) {
    return
  }

  throw new Error(
    `Provider profile '${route.providerProfileId}' uses unsupported streamed endpoint type '${route.snapshot.endpointType}'. Current smoke only supports ${SUPPORTED_STREAM_ENDPOINT_TYPE_HINT}.`,
  )
}

function resolveProviderRoute(input) {
  const normalizedProviderProfileId = normalizeIdentifier(input.request.providerProfileId)
  const providerProfile = input.providerProfiles.find((profile) => normalizeIdentifier(profile.id) === normalizedProviderProfileId)

  if (providerProfile === undefined) {
    return {
      ok: false,
      error: {
        code: 'provider_profile_not_found',
        message: `Provider profile '${input.request.providerProfileId}' does not exist.`,
        details: {
          providerProfileId: input.request.providerProfileId,
        },
      },
    }
  }

  const mismatches = collectSnapshotMismatches(providerProfile, input.request.snapshot)
  if (mismatches.length > 0) {
    return {
      ok: false,
      error: {
        code: 'route_snapshot_mismatch',
        message: `Provider profile '${providerProfile.id}' no longer matches the requested route snapshot.`,
        details: {
          providerProfileId: providerProfile.id,
          mismatches,
        },
      },
    }
  }

  const apiKey = getProviderSecret(input.providerSecrets, providerProfile.id)
  if (apiKey === '') {
    return {
      ok: false,
      error: {
        code: 'provider_secret_missing',
        message: `Provider profile '${providerProfile.id}' is missing an API key.`,
        details: {
          providerProfileId: providerProfile.id,
        },
      },
    }
  }

  return {
    ok: true,
    route: {
      providerProfileId: providerProfile.id,
      provider: normalizeIdentifier(providerProfile.protocol),
      endpointType: normalizeIdentifier(providerProfile.protocol) === 'openai' ? 'openai-compatible' : normalizeIdentifier(providerProfile.protocol),
      baseUrl: normalizeBaseUrl(providerProfile.endpoint),
      modelId: normalizeNonEmptyString(input.request.snapshot.modelId),
      auth: {
        apiKey,
      },
    },
  }
}

function collectSnapshotMismatches(profile, snapshot) {
  const mismatches = []
  const expectedProvider = normalizeIdentifier(profile.protocol)
  const actualProvider = normalizeIdentifier(snapshot.provider)
  if (expectedProvider !== actualProvider) {
    mismatches.push({
      field: 'provider',
      expected: expectedProvider,
      actual: actualProvider,
    })
  }

  const expectedEndpointType = expectedProvider === 'openai' ? 'openai-compatible' : expectedProvider
  const actualEndpointType = normalizeIdentifier(snapshot.endpointType)
  if (expectedEndpointType !== actualEndpointType) {
    mismatches.push({
      field: 'endpointType',
      expected: expectedEndpointType,
      actual: actualEndpointType,
    })
  }

  const expectedBaseUrl = normalizeBaseUrl(profile.endpoint)
  const actualBaseUrl = normalizeBaseUrl(snapshot.baseUrl)
  if (expectedBaseUrl !== actualBaseUrl) {
    mismatches.push({
      field: 'baseUrl',
      expected: expectedBaseUrl,
      actual: actualBaseUrl,
    })
  }

  const normalizedModelId = normalizeNonEmptyString(snapshot.modelId)
  if (!providerProfileSupportsModel(profile, normalizedModelId)) {
    mismatches.push({
      field: 'modelId',
      expected: buildSupportedModelSummary(profile),
      actual: normalizedModelId,
    })
  }

  return mismatches
}

function providerProfileSupportsModel(profile, modelId) {
  const supportedModelIds = new Set()

  for (const candidate of [
    ...(Array.isArray(profile.availableModels) ? profile.availableModels.map((model) => model?.modelId) : []),
    profile.defaultModel,
    profile.fastModel,
    profile.fallbackModel,
  ]) {
    const normalized = normalizeNonEmptyString(candidate)
    if (normalized !== '') {
      supportedModelIds.add(normalized)
    }
  }

  return supportedModelIds.has(modelId)
}

function buildSupportedModelSummary(profile) {
  return Array.from(new Set([
    ...(Array.isArray(profile.availableModels) ? profile.availableModels.map((model) => normalizeNonEmptyString(model?.modelId)) : []),
    normalizeNonEmptyString(profile.defaultModel),
    normalizeNonEmptyString(profile.fastModel),
    normalizeNonEmptyString(profile.fallbackModel),
  ].filter((modelId) => modelId !== ''))).join(', ')
}

async function createHostModelRouteBridge(input) {
  const token = randomBytes(24).toString('hex')
  const port = await allocateLoopbackPort(input.host)
  const server = createHttpServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== BRIDGE_PATH) {
      response.statusCode = 404
      response.end()
      return
    }

    if (request.headers[BRIDGE_TOKEN_HEADER.toLowerCase()] !== token) {
      writeJsonResponse(response, 401, {
        ok: false,
        error: {
          code: 'invalid_host_model_route_bridge_token',
          message: 'Missing or invalid host model route bridge token.',
          details: {
            headerName: BRIDGE_TOKEN_HEADER,
          },
        },
      })
      return
    }

    let requestBody
    try {
      requestBody = await readRequestJson(request)
    } catch {
      writeJsonResponse(response, 400, {
        ok: false,
        error: {
          code: 'invalid_host_model_route_bridge_request',
          message: 'Host model route bridge request body must be valid JSON.',
          details: {},
        },
      })
      return
    }

    const resolution = resolveProviderRoute({
      providerProfiles: input.providerProfiles,
      providerSecrets: input.providerSecrets,
      request: requestBody,
    })
    writeJsonResponse(response, 200, resolution)
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, input.host, () => {
      server.off('error', reject)
      resolve()
    })
  })

  return {
    bootstrap: {
      url: `http://${input.host}:${port}${BRIDGE_PATH}`,
      token,
      headerName: BRIDGE_TOKEN_HEADER,
    },
    stop: async () => {
      await closeServer(server)
    },
  }
}

function sanitizeRouteResolutionResult(result) {
  if (result.ok === true) {
    return {
      ok: true,
      route: {
        providerProfileId: result.route.providerProfileId,
        provider: result.route.provider,
        endpointType: result.route.endpointType,
        baseUrl: result.route.baseUrl,
        modelId: result.route.modelId,
        auth: { apiKey: '[redacted]' },
      },
    }
  }

  return result
}

function summarizeRuntimeEvent(event) {
  if (event.type === 'text_delta') {
    return {
      type: event.type,
      sequence: event.sequence,
      delta: event.payload?.delta ?? '',
    }
  }

  return event
}

async function waitForReady(readyUrl) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 30_000) {
    try {
      const response = await fetch(readyUrl)
      if (response.ok) {
        return
      }
    } catch {
      // Keep polling until timeout.
    }
    await delay(250)
  }

  throw new Error(`Timed out while waiting for runtime readiness: ${readyUrl}`)
}

async function postJson(url, payload) {
  return fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

async function readJson(response) {
  const text = await response.text()
  return text.trim() === '' ? null : JSON.parse(text)
}

async function readRuntimeRunEvents(stream) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const events = []

  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) {
        buffer += decoder.decode()
        break
      }

      buffer += decoder.decode(chunk.value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n')

      while (true) {
        const boundaryIndex = buffer.indexOf('\n\n')
        if (boundaryIndex < 0) {
          break
        }

        const block = buffer.slice(0, boundaryIndex)
        buffer = buffer.slice(boundaryIndex + 2)
        const parsed = parseSseEventBlock(block)
        if (parsed !== null) {
          events.push(parsed)
        }
      }
    }

    const trailingEvent = parseSseEventBlock(buffer.replace(/\r\n/g, '\n'))
    if (trailingEvent !== null) {
      events.push(trailingEvent)
    }
  } finally {
    reader.releaseLock()
  }

  return events
}

async function readRuntimeRunEventsUntilFirstDeltaAndAbort(stream, abortController) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const events = []

  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) {
        buffer += decoder.decode()
        break
      }

      buffer += decoder.decode(chunk.value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n')

      while (true) {
        const boundaryIndex = buffer.indexOf('\n\n')
        if (boundaryIndex < 0) {
          break
        }

        const block = buffer.slice(0, boundaryIndex)
        buffer = buffer.slice(boundaryIndex + 2)
        const parsed = parseSseEventBlock(block)
        if (parsed === null) {
          continue
        }

        events.push(parsed)
        if (parsed.type === 'text_delta') {
          abortController?.abort()
          return {
            events,
            transportAborted: abortController?.signal.aborted === true,
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  return {
    events,
    transportAborted: abortController?.signal.aborted === true,
  }
}

function parseSseEventBlock(block) {
  const trimmed = block.trim()
  if (trimmed === '') {
    return null
  }

  const dataLines = trimmed
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())

  if (dataLines.length === 0) {
    return null
  }

  return JSON.parse(dataLines.join('\n'))
}

async function readJsonFile(filePath) {
  const content = await readFile(filePath, 'utf8')
  return JSON.parse(content)
}

function pipeChildOutput(stream, prefix) {
  if (stream === null) {
    return
  }

  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    const normalized = String(chunk).replace(/\r\n/g, '\n')
    for (const line of normalized.split('\n')) {
      if (line !== '') {
        console.log(`${prefix}${line}`)
      }
    }
  })
}

async function stopChildProcess(child) {
  if (child.exitCode !== null) {
    return
  }

  child.kill('SIGTERM')
  const startedAt = Date.now()
  while (child.exitCode === null && Date.now() - startedAt < 5_000) {
    await delay(100)
  }

  if (child.exitCode === null) {
    child.kill('SIGKILL')
    await delay(100)
  }
}

async function allocateLoopbackPort(host) {
  return new Promise((resolve, reject) => {
    const server = createNetServer()
    server.once('error', reject)
    server.listen(0, host, () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to allocate a loopback port.')))
        return
      }

      const { port } = address
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve(port)
      })
    })
  })
}

async function readRequestJson(request) {
  const chunks = []
  for await (const chunk of request) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
  }
  const rawBody = Buffer.concat(chunks).toString('utf8')
  return rawBody.trim() === '' ? null : JSON.parse(rawBody)
}

function writeJsonResponse(response, statusCode, payload) {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(`${JSON.stringify(payload)}\n`)
}

async function closeServer(server) {
  if (!server.listening) {
    return
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

function hasProviderSecret(providerSecrets, providerId) {
  return getProviderSecret(providerSecrets, providerId) !== ''
}

function getProviderSecret(providerSecrets, providerId) {
  if (!isRecord(providerSecrets)) {
    return ''
  }

  const normalizedProviderId = normalizeNonEmptyString(providerId)
  const secretRecord = providerSecrets[normalizedProviderId]
  return isRecord(secretRecord) ? normalizeNonEmptyString(secretRecord.apiKey) : ''
}

function isRecord(value) {
  return typeof value === 'object' && value !== null
}

function normalizeIdentifier(value) {
  return normalizeNonEmptyString(value).toLowerCase()
}

function normalizeBaseUrl(value) {
  return normalizeNonEmptyString(value).replace(/\/+$/, '')
}

function normalizeNonEmptyString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

main().catch((error) => {
  console.error('streaming smoke failed')
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
