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

export const DEFAULT_HOST = '127.0.0.1'
export const DEFAULT_MESSAGE = '请仅回复“stream smoke ok”。'
export const DEFAULT_CANCEL_MESSAGE = '请分三句话详细说明这次 thread run cancel smoke，每句话至少十个字。'
export const DEFAULT_WEATHER_TOOL_MESSAGE = '请先调用天气工具查询 Shenzhen 当前天气，再用一句话说明结果。'
export const WEATHER_TOOL_ID = 'tool.weather-current'
export const DEFAULT_USER_DATA_DIR = path.join(process.env.APPDATA ?? 'C:/Users/24352/AppData/Roaming', 'CanDue')
export const DEFAULT_AGENT_ID = 'default'

const PROVIDER_CATALOG_PATH = path.resolve(workspaceRoot, 'provider-catalog', 'registry.json')
const BRIDGE_PATH = '/host/private/provider-routes/resolve'
const BRIDGE_TOKEN_HEADER = 'X-Host-Model-Route-Token'

export function parseCommonArgs(argv) {
  const options = {
    userDataDir: DEFAULT_USER_DATA_DIR,
    providerProfileId: null,
    message: null,
    messageProvided: false,
    cancelAfterFirstDelta: false,
    enableWeatherTool: false,
    runtimeChainDebug: false,
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
      options.messageProvided = true
      index += 1
      continue
    }

    if (token === '--cancel-after-first-delta') {
      options.cancelAfterFirstDelta = true
      continue
    }

    if (token === '--enable-weather-tool') {
      options.enableWeatherTool = true
      continue
    }

    if (token === '--runtime-chain-debug') {
      options.runtimeChainDebug = true
      continue
    }

    throw new Error(`Unknown or incomplete argument: ${token}`)
  }

  return options
}

export function resolveSmokeMessage(
  options,
  input = {},
) {
  if (options.messageProvided && typeof options.message === 'string') {
    return options.message
  }

  if (options.cancelAfterFirstDelta && typeof input.cancelMessage === 'string' && input.cancelMessage.trim() !== '') {
    return input.cancelMessage
  }

  if (options.enableWeatherTool) {
    return input.weatherToolMessage ?? DEFAULT_WEATHER_TOOL_MESSAGE
  }

  return input.defaultMessage ?? DEFAULT_MESSAGE
}

export async function createRuntimeSmokeHarness(input) {
  const label = normalizeNonEmptyString(input.label) || 'smoke'
  const workspaceState = await loadWorkspaceState(input.userDataDir)
  const providerCatalog = await loadProviderCatalog()
  const candidates = workspaceState.providerProfiles.map((profile) => summarizeProviderProfile(
    profile,
    workspaceState.providerSecrets,
    providerCatalog,
  ))

  console.log(`=== ${label} provider candidates ===`)
  console.table(candidates)
  console.log(`=== ${label} workspace documents ===`)
  console.log(JSON.stringify({
    stateDocument: workspaceState.stateDocument,
    secretsDocument: workspaceState.secretsDocument,
  }, null, 2))

  const selectedProfile = selectProviderProfile({
    providerProfiles: workspaceState.providerProfiles,
    providerSecrets: workspaceState.providerSecrets,
    providerCatalog,
    preferredProfileId: input.providerProfileId ?? null,
  })

  if (selectedProfile === null) {
    throw new Error('No provider profile with a runtime-enabled streaming route and required auth is available.')
  }

  const route = createRuntimeModelRoute(selectedProfile, providerCatalog)
  console.log(`=== ${label} selected provider route ===`)
  console.log(JSON.stringify(route, null, 2))

  const resolvedRoute = resolveProviderRoute({
    providerProfiles: workspaceState.providerProfiles,
    providerSecrets: workspaceState.providerSecrets,
    providerCatalog,
    request: route,
  })
  console.log(`=== ${label} host route resolution preview ===`)
  console.log(JSON.stringify(sanitizeRouteResolutionResult(resolvedRoute), null, 2))

  if (resolvedRoute.ok !== true) {
    throw new Error(`Route resolution failed before smoke run: ${JSON.stringify(resolvedRoute)}`)
  }

  const backendEnv = {
    ...process.env,
    ...(input.runtimeChainDebug ? { COPILOT_RUNTIME_CHAIN_DEBUG: '1' } : {}),
  }
  if (input.runtimeChainDebug) {
    console.log(`=== ${label} runtime chain debug ===`)
    console.log(JSON.stringify({ COPILOT_RUNTIME_CHAIN_DEBUG: '1' }, null, 2))
  }

  let bridge = null
  let backendProcess = null
  try {
    bridge = await createHostModelRouteBridge({
      host: DEFAULT_HOST,
      providerProfiles: workspaceState.providerProfiles,
      providerSecrets: workspaceState.providerSecrets,
      providerCatalog,
    })
    const runtimePort = await allocateLoopbackPort(DEFAULT_HOST)
    const runtimeUrl = `http://${DEFAULT_HOST}:${runtimePort}`

    backendProcess = spawn(
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
        env: backendEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )

    pipeChildOutput(backendProcess.stdout, '[backend:stdout] ')
    pipeChildOutput(backendProcess.stderr, '[backend:stderr] ')

    await waitForReady(`${runtimeUrl}/ready`)

    return {
      workspaceState,
      route,
      runtimeUrl,
      runtimeChainDebug: input.runtimeChainDebug === true,
      stop: async () => {
        await Promise.allSettled([
          backendProcess === null ? Promise.resolve() : stopChildProcess(backendProcess),
          bridge === null ? Promise.resolve() : bridge.stop(),
        ])
      },
    }
  } catch (error) {
    await Promise.allSettled([
      backendProcess === null ? Promise.resolve() : stopChildProcess(backendProcess),
      bridge === null ? Promise.resolve() : bridge.stop(),
    ])
    throw error
  }
}

export async function fetchEventStream(input) {
  const response = await fetch(`${input.runtimeUrl}/`, {
    method: 'POST',
    headers: {
      Accept: 'text/event-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input.request),
    signal: input.signal,
  })

  if (!response.ok || response.body === null) {
    throw new Error(`${input.description} failed before streaming: HTTP ${response.status} ${await response.text()}`)
  }

  return response
}

export async function postJson(url, payload, signal) {
  return fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal,
  })
}

export async function readJson(response) {
  const text = await response.text()
  return text.trim() === '' ? null : JSON.parse(text)
}

export async function readRuntimeRunEvents(stream, input = {}) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let stoppedEarly = false
  const events = []

  try {
    outer: while (true) {
      const chunk = await reader.read()
      if (chunk.done) {
        buffer += decoder.decode()
        break
      }

      buffer += decoder.decode(chunk.value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n')

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
        const outcome = await input.onEvent?.(parsed, events)
        if (outcome?.stop === true) {
          stoppedEarly = true
          break outer
        }
      }
    }

    if (!stoppedEarly) {
      const trailingEvent = parseSseEventBlock(buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n'))
      if (trailingEvent !== null) {
        events.push(trailingEvent)
        await input.onEvent?.(trailingEvent, events)
      }
    }
  } finally {
    reader.releaseLock()
  }

  return events
}

export function summarizeRuntimeEvent(event) {
  if (event.type === 'text_delta') {
    return {
      type: event.type,
      sequence: event.sequence,
      delta: event.payload?.delta ?? '',
    }
  }

  if (event.type === 'tool_event') {
    return {
      type: event.type,
      sequence: event.sequence,
      toolCallId: event.payload?.toolCallId ?? null,
      toolId: event.payload?.toolId ?? null,
      phase: event.payload?.phase ?? null,
      title: event.payload?.title ?? null,
      summary: event.payload?.summary ?? null,
      inputSummary: event.payload?.inputSummary ?? null,
      resultSummary: event.payload?.resultSummary ?? null,
      errorSummary: event.payload?.errorSummary ?? null,
    }
  }

  return event
}

export function assertWeatherToolClosure(events) {
  const toolEvents = events.filter((event) => event?.type === 'tool_event' && event.payload?.toolId === WEATHER_TOOL_ID)
  if (toolEvents.length < 2) {
    throw new Error(`Expected at least two ${WEATHER_TOOL_ID} tool_event entries, received ${toolEvents.length}.`)
  }

  const phases = toolEvents.map((event) => event.payload?.phase)
  if (phases[0] !== 'started') {
    throw new Error(`Expected first ${WEATHER_TOOL_ID} tool_event to be started, received ${String(phases[0])}.`)
  }
  if (!phases.includes('completed')) {
    throw new Error(`Expected ${WEATHER_TOOL_ID} tool_event sequence to include completed, received ${JSON.stringify(phases)}.`)
  }

  const completedIndex = toolEvents.findIndex((event) => event.payload?.phase === 'completed')
  const completedSequence = toolEvents[completedIndex]?.sequence ?? Number.POSITIVE_INFINITY
  const postToolTextEvent = events.find((event) => event.type === 'text_delta' && event.sequence > completedSequence)
  if (postToolTextEvent === undefined) {
    throw new Error(`Expected ${WEATHER_TOOL_ID} completed tool_event to be followed by assistant text, received completed sequence ${completedSequence} without any later text_delta.`)
  }
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

function summarizeProviderProfile(profile, providerSecrets, providerCatalog) {
  const profileId = resolveProfileId(profile)
  const providerId = resolveProviderId(profile)
  const catalogEntry = getProviderCatalogEntry(providerCatalog, providerId)
  const route = createRuntimeModelRoute(profile, providerCatalog)
  return {
    id: profileId,
    providerId,
    runtimeStatus: normalizeNonEmptyString(catalogEntry?.runtimeStatus),
    endpointType: normalizeNonEmptyString(catalogEntry?.endpointType),
    modelId: route.routeRef.modelId,
    hasSecret: hasProviderSecret(providerSecrets, profileId),
    supported: canUseProfileForSmoke({
      profile,
      providerSecrets,
      providerCatalog,
    }),
  }
}

function selectProviderProfile(input) {
  if (input.preferredProfileId !== null) {
    return input.providerProfiles.find((profile) => {
      return normalizeIdentifier(resolveProfileId(profile)) === normalizeIdentifier(input.preferredProfileId)
    }) ?? null
  }

  return input.providerProfiles.find((profile) => {
    return canUseProfileForSmoke({
      profile,
      providerSecrets: input.providerSecrets,
      providerCatalog: input.providerCatalog,
    })
  }) ?? null
}

function createRuntimeModelRoute(profile, providerCatalog) {
  const profileId = resolveProfileId(profile)
  const modelId = pickProfileModelId(profile)
  const catalogRevision = readProviderCatalogRevision(providerCatalog)
  return {
    routeRef: {
      routeKind: 'provider-model',
      profileId,
      modelId,
    },
    ...(catalogRevision === '' ? {} : { catalogRevision }),
  }
}

function pickProfileModelId(profile) {
  for (const candidate of Array.isArray(profile.availableModels)
    ? profile.availableModels.map((model) => model?.modelId)
    : []) {
    const normalized = normalizeNonEmptyString(candidate)
    if (normalized !== '') {
      return normalized
    }
  }

  return ''
}


function resolveProviderRoute(input) {
  if (!isRuntimeModelRouteRequest(input.request)) {
    return {
      ok: false,
      error: {
        code: 'invalid_provider_route_request',
        message: 'Provider route request must include only routeRef and optional catalogRevision.',
        details: {},
      },
    }
  }

  const requestedRouteRef = input.request.routeRef
  const providerProfileId = normalizeNonEmptyString(requestedRouteRef.profileId)
  const providerProfile = input.providerProfiles.find((profile) => {
    return normalizeIdentifier(resolveProfileId(profile)) === normalizeIdentifier(providerProfileId)
  })

  if (providerProfile === undefined) {
    return {
      ok: false,
      error: {
        code: 'provider_profile_not_found',
        message: `Provider profile '${providerProfileId}' does not exist.`,
        details: {
          providerProfileId,
          routeRef: requestedRouteRef,
        },
      },
    }
  }

  const providerId = resolveProviderId(providerProfile)
  const providerCatalogEntry = getProviderCatalogEntry(input.providerCatalog, providerId)
  if (providerCatalogEntry === null) {
    return {
      ok: false,
      error: {
        code: 'provider_catalog_entry_not_found',
        message: `Provider '${providerId}' is not defined in provider catalog.`,
        details: {
          providerProfileId,
          providerId,
          routeRef: requestedRouteRef,
        },
      },
    }
  }

  const catalogRevision = readProviderCatalogRevision(input.providerCatalog)
  const requestedCatalogRevision = normalizeNonEmptyString(input.request.catalogRevision)
  if (requestedCatalogRevision !== '' && requestedCatalogRevision !== catalogRevision) {
    return {
      ok: false,
      error: {
        code: 'provider_catalog_revision_mismatch',
        message: `Requested provider catalog revision '${requestedCatalogRevision}' does not match current revision '${catalogRevision}'.`,
        details: {
          providerProfileId,
          providerId: providerCatalogEntry.providerId,
          routeRef: requestedRouteRef,
          expectedCatalogRevision: requestedCatalogRevision,
          actualCatalogRevision: catalogRevision,
        },
      },
    }
  }

  if (normalizeNonEmptyString(providerCatalogEntry.runtimeStatus) === 'catalog-only') {
    return {
      ok: false,
      error: {
        code: 'provider_runtime_catalog_only',
        message: `Provider '${providerCatalogEntry.providerId}' is catalog-only and cannot be resolved for runtime execution.`,
        details: {
          providerProfileId,
          providerId: providerCatalogEntry.providerId,
          routeRef: requestedRouteRef,
          runtimeStatus: providerCatalogEntry.runtimeStatus,
        },
      },
    }
  }

  if (normalizeNonEmptyString(providerCatalogEntry.runtimeStatus) === 'legacy-unsupported') {
    return {
      ok: false,
      error: {
        code: 'provider_runtime_legacy_unsupported',
        message: `Provider '${providerCatalogEntry.providerId}' is marked as legacy-unsupported in provider catalog.`,
        details: {
          providerProfileId,
          providerId: providerCatalogEntry.providerId,
          routeRef: requestedRouteRef,
          runtimeStatus: providerCatalogEntry.runtimeStatus,
        },
      },
    }
  }

  const normalizedModelId = normalizeNonEmptyString(requestedRouteRef.modelId)
  if (!providerProfileSupportsModel(providerProfile, normalizedModelId)) {
    return {
      ok: false,
      error: {
        code: 'provider_model_not_found',
        message: `Provider profile '${providerProfileId}' does not define model '${normalizedModelId}'.`,
        details: {
          providerProfileId,
          providerId: providerCatalogEntry.providerId,
          routeRef: requestedRouteRef,
          modelId: normalizedModelId,
          supportedModelIds: buildSupportedModelIds(providerProfile),
        },
      },
    }
  }

  const authKind = normalizeNonEmptyString(providerCatalogEntry.authSchema?.defaultKind) || 'api-key'
  const apiKey = getProviderSecret(input.providerSecrets, providerProfileId)
  if (authKind !== 'none' && apiKey === '') {
    return {
      ok: false,
      error: {
        code: 'provider_secret_missing',
        message: `Provider profile '${providerProfileId}' is missing an API key.`,
        details: {
          providerProfileId,
          providerId: providerCatalogEntry.providerId,
          routeRef: requestedRouteRef,
          authKind,
        },
      },
    }
  }

  return {
    ok: true,
    resolvedRoute: {
      routeRef: {
        routeKind: 'provider-model',
        profileId: providerProfileId,
        modelId: normalizedModelId,
      },
      providerProfileId,
      provider: normalizeNonEmptyString(providerCatalogEntry.providerId),
      providerId: normalizeNonEmptyString(providerCatalogEntry.providerId),
      adapterId: normalizeNonEmptyString(providerCatalogEntry.adapterId),
      runtimeStatus: normalizeNonEmptyString(providerCatalogEntry.runtimeStatus),
      catalogRevision,
      endpointFamily: resolveEndpointFamily(providerCatalogEntry.endpointType),
      endpointType: normalizeNonEmptyString(providerCatalogEntry.endpointType),
      baseUrl: resolveExpectedBaseUrl(providerProfile, providerCatalogEntry),
      modelId: normalizedModelId,
      authKind,
    },
    privateAuth: {
      authKind,
      authPayload: apiKey === '' ? {} : { apiKey },
      apiKey,
    },
  }
}

function providerProfileSupportsModel(profile, modelId) {
  return buildSupportedModelIds(profile).includes(modelId)
}

function buildSupportedModelIds(profile) {
  return Array.from(new Set(
    (Array.isArray(profile.availableModels) ? profile.availableModels : [])
      .map((model) => normalizeNonEmptyString(model?.modelId))
      .filter((candidate) => candidate !== ''),
  ))
}

async function loadProviderCatalog() {
  const providerCatalog = await readJsonFile(PROVIDER_CATALOG_PATH)
  if (!isRecord(providerCatalog)) {
    throw new Error('Provider catalog JSON must be an object.')
  }
  return providerCatalog
}

function canUseProfileForSmoke(input) {
  const profileId = resolveProfileId(input.profile)
  const catalogEntry = getProviderCatalogEntry(input.providerCatalog, resolveProviderId(input.profile))
  const route = createRuntimeModelRoute(input.profile, input.providerCatalog)
  const authKind = normalizeNonEmptyString(catalogEntry?.authSchema?.defaultKind) || 'api-key'

  return catalogEntry !== null
    && normalizeNonEmptyString(catalogEntry.runtimeStatus) === 'enabled'
    && catalogEntry.capabilityHints?.streaming === true
    && route.routeRef.modelId !== ''
    && (authKind === 'none' || hasProviderSecret(input.providerSecrets, profileId))
}

function resolveProfileId(profile) {
  return normalizeNonEmptyString(profile.profileId) || normalizeNonEmptyString(profile.id)
}

function resolveProviderId(profile) {
  return normalizeIdentifier(profile.providerId ?? profile.protocol)
}

function getProviderCatalogEntry(providerCatalog, providerId) {
  const normalizedProviderId = normalizeIdentifier(providerId)
  const providerEntries = Array.isArray(providerCatalog?.providers) ? providerCatalog.providers : []
  return providerEntries.find((entry) => {
    if (!isRecord(entry)) {
      return false
    }

    const aliases = Array.isArray(entry.aliases) ? entry.aliases : []
    return [entry.providerId, ...aliases].some((candidate) => normalizeIdentifier(candidate) === normalizedProviderId)
  }) ?? null
}

function readProviderCatalogRevision(providerCatalog) {
  return normalizeNonEmptyString(providerCatalog?.catalogRevision)
}

function resolveExpectedBaseUrl(profile, providerCatalogEntry) {
  return normalizeBaseUrl(
    profile.baseUrl
      ?? profile.endpoint
      ?? providerCatalogEntry?.baseUrlPolicy?.defaultBaseUrl
      ?? '',
  )
}

function resolveEndpointFamily(endpointType) {
  const normalizedEndpointType = normalizeIdentifier(endpointType)
  if (normalizedEndpointType === '') {
    return ''
  }

  const separatorIndex = normalizedEndpointType.indexOf('-')
  return separatorIndex < 0 ? normalizedEndpointType : normalizedEndpointType.slice(0, separatorIndex)
}

function isRuntimeModelRouteRequest(value) {
  if (!isRecord(value)) {
    return false
  }

  const allowedKeys = new Set(['routeRef', 'catalogRevision'])
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    return false
  }

  if (!isRuntimeModelRouteRef(value.routeRef)) {
    return false
  }

  return value.catalogRevision === undefined || typeof value.catalogRevision === 'string'
}

function isRuntimeModelRouteRef(value) {
  return isRecord(value)
    && value.routeKind === 'provider-model'
    && normalizeNonEmptyString(value.profileId) !== ''
    && normalizeNonEmptyString(value.modelId) !== ''
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

    if (!isRuntimeModelRouteRequest(requestBody)) {
      writeJsonResponse(response, 400, {
        ok: false,
        error: {
          code: 'invalid_host_model_route_bridge_request',
          message: 'Host model route bridge request body is invalid.',
          details: {},
        },
      })
      return
    }

    const resolution = resolveProviderRoute({
      providerProfiles: input.providerProfiles,
      providerSecrets: input.providerSecrets,
      providerCatalog: input.providerCatalog,
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
      resolvedRoute: result.resolvedRoute,
      privateAuth: {
        authKind: result.privateAuth.authKind,
        authPayload: result.privateAuth.apiKey === '' ? {} : { apiKey: '[redacted]' },
        apiKey: result.privateAuth.apiKey === '' ? '' : '[redacted]',
      },
    }
  }

  return result
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
