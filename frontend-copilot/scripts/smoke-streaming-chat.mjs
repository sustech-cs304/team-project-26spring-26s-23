import {
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
  assertWeatherToolClosure,
  WEATHER_TOOL_ID,
} from './smoke-runtime-shared.mjs'

async function main() {
  const options = parseCommonArgs(process.argv.slice(2))
  const harness = await createRuntimeSmokeHarness({
    label: 'legacy compat smoke',
    userDataDir: options.userDataDir,
    providerProfileId: options.providerProfileId,
  })

  try {
    const sessionResponse = await postJson(`${harness.runtimeUrl}/`, {
      method: 'session/create',
      body: { agentId: DEFAULT_AGENT_ID },
    })
    const sessionPayload = await readJson(sessionResponse)
    console.log('=== legacy compat smoke session/create response ===')
    console.log(JSON.stringify(sessionPayload, null, 2))

    if (sessionPayload?.ok !== true || typeof sessionPayload.sessionId !== 'string') {
      throw new Error(`Unexpected session/create response: ${JSON.stringify(sessionPayload)}`)
    }

    const abortController = options.cancelAfterFirstDelta ? new AbortController() : null
    const enabledTools = options.enableWeatherTool ? [WEATHER_TOOL_ID] : []
    const smokeMessage = resolveSmokeMessage(options, {
      cancelMessage: DEFAULT_CANCEL_MESSAGE,
    })
    const messageResponse = await fetchEventStream({
      runtimeUrl: harness.runtimeUrl,
      description: 'legacy compat message/send',
      signal: abortController?.signal,
      request: {
        method: 'message/send',
        body: {
          sessionId: sessionPayload.sessionId,
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
      },
    })

    console.log('=== legacy compat streamed runtime events ===')
    const events = await readRuntimeRunEvents(messageResponse.body, {
      onEvent: async (event) => {
        console.log(JSON.stringify(summarizeRuntimeEvent(event), null, 2))
        if (options.cancelAfterFirstDelta && event.type === 'text_delta') {
          abortController?.abort()
          return { stop: true }
        }
        return { stop: false }
      },
    })

    if (options.cancelAfterFirstDelta) {
      assertCompatCancelOutcome(events, abortController)
      console.log('=== legacy compat cancel smoke summary ===')
      console.log(JSON.stringify({
        smokeType: 'legacy-compat',
        runtimeUrl: harness.runtimeUrl,
        providerProfileId: harness.route.providerProfileId,
        modelId: harness.route.snapshot.modelId,
        abortedByClient: abortController?.signal.aborted === true,
        eventTypes: events.map((event) => event.type),
        firstDelta: events.find((event) => event.type === 'text_delta')?.payload?.delta ?? null,
      }, null, 2))
      return
    }

    const terminalEvent = events.at(-1)
    if (terminalEvent === undefined) {
      throw new Error('The runtime stream completed without emitting any events.')
    }
    if (terminalEvent.type !== 'run_completed') {
      throw new Error(`Streaming run did not complete successfully: ${JSON.stringify(terminalEvent)}`)
    }

    if (options.enableWeatherTool) {
      assertWeatherToolClosure(events)
    }

    console.log('=== legacy compat smoke summary ===')
    console.log(JSON.stringify({
      smokeType: 'legacy-compat',
      runtimeUrl: harness.runtimeUrl,
      providerProfileId: harness.route.providerProfileId,
      modelId: harness.route.snapshot.modelId,
      enabledTools,
      eventTypes: events.map((event) => event.type),
      assistantText: terminalEvent.payload?.assistantText ?? null,
    }, null, 2))
  } finally {
    await harness.stop()
  }
}

function assertCompatCancelOutcome(events, abortController) {
  const textDeltaEvents = events.filter((event) => event.type === 'text_delta')
  if (abortController?.signal.aborted !== true) {
    throw new Error('Cancel smoke expected the client transport to abort after the first delta.')
  }
  if (!events.some((event) => event.type === 'run_started')) {
    throw new Error('Cancel smoke expected a run_started event before aborting the stream.')
  }
  if (textDeltaEvents.length !== 1) {
    throw new Error(`Cancel smoke expected exactly one text_delta before aborting, received ${textDeltaEvents.length}.`)
  }
  if (events.some((event) => event.type === 'run_completed')) {
    throw new Error('Cancel smoke must not observe a run_completed event after client abort.')
  }
}

main().catch((error) => {
  console.error('legacy compat streaming smoke failed')
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
