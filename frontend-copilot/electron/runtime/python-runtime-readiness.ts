import { summarizeUnknownError } from './runtime-diagnostics'

export interface ReadinessProbeResult {
  ready: boolean
  detail: string | null
}

export async function probeRuntimeReadiness(
  url: string,
  requestTimeoutMs: number,
): Promise<ReadinessProbeResult> {
  const controller = new AbortController()
  const timeoutHandle = setTimeout(() => {
    controller.abort()
  }, requestTimeoutMs)

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    })
    const responseText = await response.text()

    if (!response.ok) {
      return {
        ready: false,
        detail: `Readiness probe returned HTTP ${response.status}${responseText.trim() === '' ? '' : `: ${truncateText(responseText)}`}`,
      }
    }

    const payload = parseJsonResponse(responseText)
    if (isRuntimeReadyPayload(payload)) {
      return { ready: true, detail: null }
    }

    return {
      ready: false,
      detail: payload === null
        ? 'Readiness probe returned an empty response body.'
        : `Runtime reported not ready yet: ${truncateText(JSON.stringify(payload))}`,
    }
  } catch (error) {
    return {
      ready: false,
      detail: error instanceof Error && error.name === 'AbortError'
        ? `Readiness probe timed out after ${requestTimeoutMs}ms.`
        : `Readiness probe failed: ${summarizeUnknownError(error)}`,
    }
  } finally {
    clearTimeout(timeoutHandle)
  }
}

function parseJsonResponse(text: string): unknown | null {
  const normalizedText = text.trim()
  if (normalizedText === '') {
    return null
  }

  try {
    return JSON.parse(normalizedText) as unknown
  } catch {
    return normalizedText
  }
}

function isRuntimeReadyPayload(payload: unknown): payload is { ready: true } {
  return typeof payload === 'object'
    && payload !== null
    && 'ready' in payload
    && payload.ready === true
}

function truncateText(text: string): string {
  const normalizedText = text.replace(/\s+/g, ' ').trim()
  if (normalizedText.length <= 300) {
    return normalizedText
  }

  return `${normalizedText.slice(0, 297)}...`
}
