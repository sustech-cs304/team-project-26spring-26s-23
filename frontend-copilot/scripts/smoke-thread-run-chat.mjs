import {
  assertWeatherToolClosure,
  createRuntimeSmokeHarness,
  DEFAULT_AGENT_ID,
  DEFAULT_CANCEL_MESSAGE,
  fetchEventStream,
  parseCommonArgs,
  postJson,
  readJson,
  readRuntimeRunEvents,
  resolveSmokeMessage,
  summarizeRuntimeEvent,
  WEATHER_TOOL_ID,
} from './smoke-runtime-shared.mjs'

async function main() {
  const options = parseCommonArgs(process.argv.slice(2))
  const harness = await createRuntimeSmokeHarness({
    label: 'thread run smoke',
    userDataDir: options.userDataDir,
    providerProfileId: options.providerProfileId,
    runtimeChainDebug: options.runtimeChainDebug,
  })

  try {
    const threadResponse = await postJson(`${harness.runtimeUrl}/`, {
      method: 'thread/create',
      body: { agentId: DEFAULT_AGENT_ID },
    })
    const threadPayload = await readJson(threadResponse)
    console.log('=== thread run smoke thread/create response ===')
    console.log(JSON.stringify(threadPayload, null, 2))

    if (threadPayload?.ok !== true || typeof threadPayload.threadId !== 'string') {
      throw new Error(`Unexpected thread/create response: ${JSON.stringify(threadPayload)}`)
    }

    const enabledTools = options.enableWeatherTool ? [WEATHER_TOOL_ID] : []
    const smokeMessage = resolveSmokeMessage(options, {
      cancelMessage: DEFAULT_CANCEL_MESSAGE,
    })
    const runStartResponse = await postJson(`${harness.runtimeUrl}/`, {
      method: 'run/start',
      body: {
        threadId: threadPayload.threadId,
        message: {
          role: 'user',
          content: smokeMessage,
        },
        policy: {
          modelRoute: harness.route,
          enabledTools,
          requestOptions: {},
        },
      },
    })
    const runStartPayload = await readJson(runStartResponse)
    console.log('=== thread run smoke run/start response ===')
    console.log(JSON.stringify(runStartPayload, null, 2))

    assertRunStartPayload(runStartPayload, threadPayload.threadId)

    const streamResponse = await fetchEventStream({
      runtimeUrl: harness.runtimeUrl,
      description: 'thread run stream',
      request: runStartPayload.stream,
    })

    console.log('=== thread run streamed runtime events ===')
    let cancelPayload = null
    let cancelRequested = false
    const events = await readRuntimeRunEvents(streamResponse.body, {
      onEvent: async (event) => {
        console.log(JSON.stringify(summarizeRuntimeEvent(event), null, 2))

        if (options.cancelAfterFirstDelta && !cancelRequested && event.type === 'text_delta') {
          cancelRequested = true
          const cancelResponse = await postJson(`${harness.runtimeUrl}/`, runStartPayload.cancel)
          cancelPayload = await readJson(cancelResponse)
          console.log('=== thread run smoke run/cancel response ===')
          console.log(JSON.stringify(cancelPayload, null, 2))
          assertCancelPayload(cancelPayload, runStartPayload.run.runId)
        }

        return { stop: false }
      },
    })

    assertEventStreamInvariants(events, {
      runId: runStartPayload.run.runId,
      threadId: threadPayload.threadId,
    })

    if (options.cancelAfterFirstDelta) {
      assertThreadRunCancelOutcome(events, {
        cancelRequested,
        cancelPayload,
        runId: runStartPayload.run.runId,
      })
      console.log('=== thread run cancel smoke summary ===')
      console.log(JSON.stringify({
        smokeType: 'thread-run',
        runtimeUrl: harness.runtimeUrl,
        providerProfileId: harness.route.routeRef.profileId,
        modelId: harness.route.routeRef.modelId,
        runId: runStartPayload.run.runId,
        threadId: threadPayload.threadId,
        cancelAccepted: cancelPayload?.cancelAccepted ?? null,
        eventTypes: events.map((event) => event.type),
        cancelTerminalReason: events.at(-1)?.payload?.reason ?? null,
        runtimeChainDebug: harness.runtimeChainDebug,
      }, null, 2))
      return
    }

    const terminalEvent = events.at(-1)
    if (terminalEvent?.type !== 'run_completed') {
      throw new Error(`Thread run did not complete successfully: ${JSON.stringify(terminalEvent)}`)
    }

    if (options.enableWeatherTool) {
      assertWeatherToolClosure(events)
    }

    console.log('=== thread run smoke summary ===')
    console.log(JSON.stringify({
      smokeType: 'thread-run',
      runtimeUrl: harness.runtimeUrl,
      providerProfileId: harness.route.routeRef.profileId,
      modelId: harness.route.routeRef.modelId,
      runId: runStartPayload.run.runId,
      threadId: threadPayload.threadId,
      enabledTools,
      eventTypes: events.map((event) => event.type),
      assistantText: terminalEvent.payload?.assistantText ?? null,
      runtimeChainDebug: harness.runtimeChainDebug,
    }, null, 2))
  } finally {
    await harness.stop()
  }
}

function assertRunStartPayload(payload, threadId) {
  if (payload?.ok !== true || typeof payload.run?.runId !== 'string') {
    throw new Error(`Unexpected run/start response: ${JSON.stringify(payload)}`)
  }
  if (payload.run.threadId !== threadId) {
    throw new Error(`run/start returned unexpected threadId '${payload.run.threadId}', expected '${threadId}'.`)
  }
  if (payload.stream?.method !== 'run/stream') {
    throw new Error(`run/start must advertise run/stream, received ${JSON.stringify(payload.stream)}.`)
  }
  if (payload.stream.body?.runId !== payload.run.runId) {
    throw new Error(`run/start stream descriptor mismatched runId: ${JSON.stringify(payload.stream)}.`)
  }
  if (payload.cancel?.method !== 'run/cancel') {
    throw new Error(`run/start must advertise run/cancel, received ${JSON.stringify(payload.cancel)}.`)
  }
  if (payload.cancel.body?.runId !== payload.run.runId) {
    throw new Error(`run/start cancel descriptor mismatched runId: ${JSON.stringify(payload.cancel)}.`)
  }
}

function assertCancelPayload(payload, runId) {
  if (payload?.ok !== true) {
    throw new Error(`Unexpected run/cancel response: ${JSON.stringify(payload)}`)
  }
  if (payload.run?.runId !== runId) {
    throw new Error(`run/cancel acknowledged unexpected runId '${payload.run?.runId}', expected '${runId}'.`)
  }
  if (payload.cancelAccepted !== true) {
    throw new Error(`run/cancel was not accepted: ${JSON.stringify(payload)}`)
  }
}

function assertEventStreamInvariants(events, input) {
  if (events.length === 0) {
    throw new Error('Thread run stream completed without emitting any events.')
  }

  if (events[0]?.type !== 'run_started') {
    throw new Error(`Thread run stream must begin with run_started, received ${events[0]?.type ?? 'none'}.`)
  }

  let previousSequence = 0
  for (const event of events) {
    if (typeof event.sequence !== 'number' || event.sequence <= previousSequence) {
      throw new Error(`Thread run stream sequence regressed from ${previousSequence} to ${String(event.sequence)}.`)
    }
    if (event.runId !== input.runId) {
      throw new Error(`Thread run stream changed runId from ${input.runId} to ${event.runId}.`)
    }
    if (event.sessionId !== input.threadId) {
      throw new Error(`Thread run stream changed sessionId from ${input.threadId} to ${event.sessionId}.`)
    }
    previousSequence = event.sequence
  }

  const terminalEvent = events.at(-1)
  if (terminalEvent === undefined || !['run_completed', 'run_failed', 'run_cancelled'].includes(terminalEvent.type)) {
    throw new Error(`Thread run stream must end with a terminal event, received ${JSON.stringify(terminalEvent)}.`)
  }
}

function assertThreadRunCancelOutcome(events, input) {
  if (!input.cancelRequested) {
    throw new Error('Thread run cancel smoke never issued run/cancel after the first text_delta.')
  }
  if (input.cancelPayload === null) {
    throw new Error('Thread run cancel smoke expected a run/cancel response payload.')
  }

  const textDeltaEvents = events.filter((event) => event.type === 'text_delta')
  if (textDeltaEvents.length < 1) {
    throw new Error('Thread run cancel smoke expected at least one text_delta before cancellation.')
  }
  if (events.some((event) => event.type === 'run_completed')) {
    throw new Error('Thread run cancel smoke must not observe run_completed after run/cancel.')
  }

  const terminalEvent = events.at(-1)
  if (terminalEvent?.type !== 'run_cancelled') {
    throw new Error(`Thread run cancel smoke expected run_cancelled terminal event, received ${JSON.stringify(terminalEvent)}.`)
  }
  if (terminalEvent.runId !== input.runId) {
    throw new Error(`Thread run cancel terminal event mismatched runId '${terminalEvent.runId}', expected '${input.runId}'.`)
  }
}

main().catch((error) => {
  console.error('thread run smoke failed')
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
