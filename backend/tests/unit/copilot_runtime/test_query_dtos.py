from __future__ import annotations

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from app.copilot_runtime.persistence.query_dtos import (
    PersistedRunEventDTO,
    PersistedRunReplayResponse,
    PersistedRunSummaryDTO,
    PersistedThreadDetailResponse,
    PersistedThreadSummaryDTO,
)


def test_persisted_thread_detail_response_models_timeline_items_and_configuration_snapshot() -> (
    None
):
    response = PersistedThreadDetailResponse(
        ok=True,
        thread=_build_thread_summary(),
        timelineItems=(
            {
                "kind": "user_message",
                "runId": "run-1",
                "threadId": "thread-1",
                "sequenceStart": 0,
                "sequenceEnd": 0,
                "createdAt": "2026-04-19T14:00:00Z",
                "role": "user",
                "text": "Hello history",
            },
            {
                "kind": "tool_call_block",
                "runId": "run-1",
                "threadId": "thread-1",
                "toolCallId": "tool.weather-current:call-1",
                "toolId": "tool.weather-current",
                "sequenceStart": 2,
                "sequenceEnd": 3,
                "createdAt": "2026-04-19T14:00:02Z",
                "summary": "Weather tool finished",
                "phases": [
                    {
                        "phase": "completed",
                        "sequence": 3,
                        "createdAt": "2026-04-19T14:00:03Z",
                        "resultSummary": "Shenzhen: sunny",
                    }
                ],
            },
            {
                "kind": "terminal_block",
                "runId": "run-1",
                "threadId": "thread-1",
                "sequenceStart": 4,
                "sequenceEnd": 4,
                "createdAt": "2026-04-19T14:00:04Z",
                "status": "completed",
                "eventType": "run_completed",
                "assistantText": "Persistent reply",
                "payload": {"assistantText": "Persistent reply"},
                "endedAt": "2026-04-19T14:00:04Z",
            },
        ),
        runSummaries=(_build_run_summary(),),
        latestConfigurationSnapshot={
            "runId": "run-1",
            "modelSnapshot": {
                "selectedModelRoute": {"providerProfileId": "provider-1"},
                "resolvedModelRoute": {"provider": "openai"},
                "debugModeEnabled": None,
            },
            "toolsSnapshot": {
                "enabledToolIds": ["tool.weather-current"],
                "resolvedToolIds": ["tool.weather-current"],
            },
        },
    )

    assert response.timelineItems[0]["kind"] == "user_message"
    assert response.timelineItems[1]["toolCallId"] == "tool.weather-current:call-1"
    assert response.timelineItems[1].phases[0]["phase"] == "completed"
    assert response.timelineItems[2]["status"] == "completed"
    assert response.latestConfigurationSnapshot is not None
    assert response.latestConfigurationSnapshot.modelSnapshot is not None
    assert response.latestConfigurationSnapshot.modelSnapshot.debugModeEnabled is None
    assert (
        response.to_dict()["timelineItems"][1]["phases"][0]["resultSummary"]
        == "Shenzhen: sunny"
    )


def test_persisted_run_replay_response_rejects_extra_fields_in_structured_blocks() -> (
    None
):
    with pytest.raises(ValidationError, match="extra"):
        PersistedRunReplayResponse(
            ok=True,
            run=_build_run_summary(),
            historicalSnapshot={
                "requestMessage": {"role": "user", "content": "Hello history"},
                "selectedModelRoute": {},
                "resolvedModelRoute": {},
                "debugModeEnabled": None,
            },
            orderedEvents=(
                PersistedRunEventDTO(
                    sequence=1,
                    eventType="run_completed",
                    createdAt=datetime(2026, 4, 19, 14, 0, tzinfo=UTC),
                    payload={"assistantText": "Persistent reply"},
                ),
            ),
            toolCallBlocks=(
                {
                    "kind": "tool_call_block",
                    "runId": "run-1",
                    "threadId": "thread-1",
                    "toolCallId": "tool.weather-current:call-1",
                    "sequenceStart": 2,
                    "sequenceEnd": 3,
                    "createdAt": "2026-04-19T14:00:02Z",
                    "phases": [],
                    "extra": True,
                },
            ),
        )


def _build_thread_summary() -> PersistedThreadSummaryDTO:
    return PersistedThreadSummaryDTO(
        threadId="thread-1",
        boundAgentId="default",
        title="Persistent history",
        titleSource="deterministic",
        summary="Persistent reply",
        summarySource="deterministic",
        createdAt=datetime(2026, 4, 19, 14, 0, tzinfo=UTC),
        updatedAt=datetime(2026, 4, 19, 14, 0, tzinfo=UTC),
    )


def _build_run_summary() -> PersistedRunSummaryDTO:
    return PersistedRunSummaryDTO(
        runId="run-1",
        threadId="thread-1",
        status="completed",
        createdAt=datetime(2026, 4, 19, 14, 0, tzinfo=UTC),
        updatedAt=datetime(2026, 4, 19, 14, 0, tzinfo=UTC),
        assistantText="Persistent reply",
    )
