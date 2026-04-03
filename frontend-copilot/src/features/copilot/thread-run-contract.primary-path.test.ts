import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  startRuntimeRun,
  streamRuntimeRun,
  type RuntimeRunEvent,
} from './thread-run-contract'
import {
  agentId,
  createFetchFn,
  createRuntimeModelRoute,
  createRuntimeRunCompletedEvent,
  createRuntimeRunStartResponse,
  createSseEventStream,
  createUserMessage,
  runtimeUrl,
  sessionId,
} from './thread-run-contract.test-support'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const frontendRoot = path.resolve(__dirname, '..', '..', '..')

describe('thread run primary path', () => {
  it('posts run/start with thread-first payload and returns stream plus cancel descriptors', async () => {
    const fetchFn = createFetchFn(createRuntimeRunStartResponse({
      run: {
        runId: 'run-1',
        threadId: sessionId,
        status: 'pending',
        createdAt: '2026-03-27T10:00:00Z',
        updatedAt: '2026-03-27T10:00:00Z',
        startedAt: null,
        terminalAt: null,
        cancelRequested: false,
      },
      assistantMessageId: 'run-1:assistant',
    }), {
      headers: {
        'content-type': 'application/json',
      },
    })

    const response = await startRuntimeRun({
      runtimeUrl,
      threadId: sessionId,
      agent: agentId,
      message: createUserMessage(),
      modelRoute: createRuntimeModelRoute(),
      enabledTools: ['tool.file-convert'],
      debugModeEnabled: true,
      requestOptions: {
        trace: true,
      },
      fetchFn,
    })

    expect(fetchFn).toHaveBeenCalledWith('http://127.0.0.1:8765/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: 'run/start',
        body: {
          threadId: 'session-1',
          agent: 'general',
          message: {
            role: 'user',
            content: '请总结这份文档',
          },
          policy: {
            modelRoute: createRuntimeModelRoute(),
            enabledTools: ['tool.file-convert'],
            debugModeEnabled: true,
            requestOptions: {
              trace: true,
            },
          },
        },
      }),
      signal: undefined,
    })
    expect(response.stream).toEqual({
      method: 'run/stream',
      body: {
        runId: 'run-1',
      },
    })
    expect(response.cancel).toEqual({
      method: 'run/cancel',
      body: {
        runId: 'run-1',
      },
    })
  })

  it('streams ordered runtime events from run/stream', async () => {
    const events: RuntimeRunEvent[] = [
      {
        type: 'run_started',
        runId: 'run-1',
        sessionId,
        sequence: 1,
        payload: {
          assistantMessageId: 'run-1:assistant',
        },
      },
      {
        type: 'text_delta',
        runId: 'run-1',
        sessionId,
        sequence: 2,
        payload: {
          assistantMessageId: 'run-1:assistant',
          delta: '这是总结结果。',
        },
      },
      createRuntimeRunCompletedEvent({
        runId: 'run-1',
        sessionId,
        sequence: 3,
      }),
    ]
    const fetchFn = createFetchFn({}, {
      headers: {
        'content-type': 'text/event-stream',
      },
      body: createSseEventStream(events),
    })

    const streamedEvents = await collectEvents(streamRuntimeRun({
      runtimeUrl,
      runId: 'run-1',
      fetchFn,
    }))

    expect(fetchFn).toHaveBeenCalledWith('http://127.0.0.1:8765/', {
      method: 'POST',
      headers: {
        Accept: 'text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        method: 'run/stream',
        body: {
          runId: 'run-1',
        },
      }),
      signal: undefined,
    })
    expect(streamedEvents.map((event) => event.type)).toEqual([
      'run_started',
      'text_delta',
      'run_completed',
    ])
  })

  it('rejects sequence regression in the run/stream event flow', async () => {
    const fetchFn = createFetchFn({}, {
      headers: {
        'content-type': 'text/event-stream',
      },
      body: createSseEventStream([
        {
          type: 'run_started',
          runId: 'run-1',
          sessionId,
          sequence: 1,
          payload: {
            assistantMessageId: 'run-1:assistant',
          },
        },
        {
          type: 'text_delta',
          runId: 'run-1',
          sessionId,
          sequence: 1,
          payload: {
            assistantMessageId: 'run-1:assistant',
            delta: '重复序号',
          },
        },
        createRuntimeRunCompletedEvent({
          runId: 'run-1',
          sessionId,
          sequence: 2,
        }),
      ]),
    })

    await expect(collectEvents(streamRuntimeRun({
      runtimeUrl,
      runId: 'run-1',
      fetchFn,
    }))).rejects.toThrow('Runtime event sequence regressed from 1 to 1.')
  })

  it('keeps dual smoke entry points with explicit compat versus mainline boundaries', async () => {
    const [legacyCompatSmoke, threadRunSmoke] = await Promise.all([
      readSmokeScript('smoke-streaming-chat.mjs'),
      readSmokeScript('smoke-thread-run-chat.mjs'),
    ])

    expect(legacyCompatSmoke).toContain("legacy compat smoke")
    expect(legacyCompatSmoke).toContain("method: 'message/send'")
    expect(legacyCompatSmoke).toContain("smokeType: 'legacy-compat'")

    expect(threadRunSmoke).toContain("thread run smoke")
    expect(threadRunSmoke).toContain("method: 'thread/create'")
    expect(threadRunSmoke).toContain("method: 'run/start'")
    expect(threadRunSmoke).toContain("'run/cancel'")
    expect(threadRunSmoke).toContain("smokeType: 'thread-run'")
  })
})

async function collectEvents(iterator: AsyncGenerator<RuntimeRunEvent>) {
  const events: RuntimeRunEvent[] = []
  for await (const event of iterator) {
    events.push(event)
  }
  return events
}

async function readSmokeScript(fileName: string) {
  return readFile(path.join(frontendRoot, 'scripts', fileName), 'utf8')
}
