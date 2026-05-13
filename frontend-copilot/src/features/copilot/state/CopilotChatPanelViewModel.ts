import type { MutableRefObject } from 'react'

import type { ModelRouteRef } from '../../../workbench/types'
import {
  applyModelSelectionToComposerDraft,
  syncComposerDraftThinkingSelection,
  type CopilotChatComposerDraft,
} from '../copilot-chat-helpers'
import {
  getCopilotModelById,
  type CopilotModelOption,
} from '../model-picker'
import type {
  RuntimeModelRoute,
  RuntimeThinkingCapability,
} from '../chat-contract'
import type { CopilotRunState } from '../types'

export function isSameModelRoute(left: RuntimeModelRoute | null, right: RuntimeModelRoute): boolean {
  if (left === null) {
    return false
  }

  return isSameModelRouteRef(left.routeRef ?? null, right.routeRef ?? null)
    && (left.catalogRevision?.trim() ?? '') === (right.catalogRevision?.trim() ?? '')
}

export function resolveComposerDraftModelSelection(
  draft: CopilotChatComposerDraft,
  models: CopilotModelOption[],
  thinkingCapability: RuntimeThinkingCapability | null,
): CopilotChatComposerDraft {
  if (draft.selectedModelId.trim() === '') {
    return clearUnmatchedModelSelection(draft)
  }

  const matchedModel = getCopilotModelById(draft.selectedModelId, models)
  if (matchedModel === null) {
    return clearUnmatchedModelSelection(draft)
  }

  if (!matchedModel.available) {
    return draft.selectedModelId === matchedModel.selectionValue
      && draft.selectedModelRoute === null
      && draft.thinkingSelection === null
      ? draft
      : {
          ...draft,
          selectedModelId: matchedModel.selectionValue,
          selectedModelRoute: null,
          thinkingSelection: null,
        }
  }

  if (
    draft.selectedModelId === matchedModel.selectionValue
    && isSameModelRoute(draft.selectedModelRoute, matchedModel.route)
  ) {
    return thinkingCapability === null
      ? draft
      : syncComposerDraftThinkingSelection(draft, {
          modelRoute: matchedModel.route,
          thinkingCapability,
        })
  }

  return applyModelSelectionToComposerDraft(draft, {
    modelId: matchedModel.selectionValue,
    modelRoute: matchedModel.route,
  })
}

function clearUnmatchedModelSelection(
  draft: CopilotChatComposerDraft,
): CopilotChatComposerDraft {
  return draft.selectedModelRoute === null && draft.thinkingSelection === null
    ? draft
    : { ...draft, selectedModelRoute: null, thinkingSelection: null }
}

export function resolveSelectedComposerModelRoute(
  draft: CopilotChatComposerDraft,
  models: CopilotModelOption[],
): RuntimeModelRoute | null {
  if (draft.selectedModelId.trim() === '') {
    return null
  }

  const matchedModel = getCopilotModelById(draft.selectedModelId, models)

  return matchedModel?.route ?? draft.selectedModelRoute
}

export function resolveDisplayedThinkingCapability(input: {
  queriedCapability: RuntimeThinkingCapability | null
  runState: CopilotRunState
  selectedModelRoute: RuntimeModelRoute | null
}): RuntimeThinkingCapability | null {
  if (
    input.selectedModelRoute !== null
    && input.runState.thinkingCapabilitySnapshot !== null
    && isSameModelRoute(input.runState.activeModelRoute, input.selectedModelRoute)
  ) {
    return input.runState.thinkingCapabilitySnapshot
  }

  return input.queriedCapability
}

export function isSameModelRouteRef(left: ModelRouteRef | null, right: ModelRouteRef | null): boolean {
  return left !== null
    && right !== null
    && left.routeKind === right.routeKind
    && left.profileId === right.profileId
    && left.modelId === right.modelId
}

export function clearAbortController(
  ref: MutableRefObject<AbortController | null>,
  controller: AbortController,
) {
  if (ref.current === controller) {
    ref.current = null
  }
}
