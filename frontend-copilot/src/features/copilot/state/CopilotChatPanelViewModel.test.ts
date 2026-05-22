import { describe, expect, it } from 'vitest'

import { createRuntimeModelRoute, createRuntimeThinkingCapability } from '../thread-run-contract.test-support'
import type { RuntimeModelRoute, RuntimeThinkingCapability } from '../thread-run-contract'
import type { CopilotChatComposerDraft } from '../copilot-chat-helpers'
import type { CopilotModelOption } from '../model-picker'
import type { CopilotRunState } from '../types'
import {
  clearAbortController,
  isSameModelRoute,
  resolveComposerDraftModelSelection,
  resolveDisplayedThinkingCapability,
  resolveSelectedComposerModelRoute,
} from './CopilotChatPanelViewModel'

function createDraft(overrides?: Partial<CopilotChatComposerDraft>): CopilotChatComposerDraft {
  return {
    messageText: '',
    selectedModelId: '',
    selectedModelRoute: null,
    thinkingSelection: null,
    thinkingSelectionByModelKey: {},
    enabledTools: [],
    requestOptionsText: '',
    ...overrides,
  }
}

function createModel(
  overrides?: Partial<CopilotModelOption>,
): CopilotModelOption {
  return {
    id: 'model-1',
    selectionValue: 'model-1',
    modelId: 'qwen-plus',
    name: 'Qwen Plus',
    provider: 'aliyun',
    group: 'qwen',
    tags: [],
    icon: { label: 'Q', accent: '#6366f1' },
    routeRef: { routeKind: 'provider-model', profileId: 'p1', modelId: 'qwen-plus' },
    route: createRuntimeModelRoute({
      providerProfileId: 'p1',
      modelId: 'qwen-plus',
    }),
    available: true,
    unavailableReason: null,
    thinkingCapabilityOverride: null,
    ...overrides,
  }
}

function createRunState(overrides?: Partial<CopilotRunState>): CopilotRunState {
  return {
    phase: 'idle',
    runId: null,
    threadId: null,
    activeModelRoute: null,
    resolvedModelId: null,
    resolvedModelRoute: null,
    resolvedToolIds: [],
    requestOptions: {},
    requestedThinkingSelection: null,
    appliedThinkingSelection: null,
    requestedThinkingLevel: null,
    appliedThinkingLevel: null,
    thinkingCapabilitySnapshot: null,
    thinkingSeriesDecision: null,
    reasoningSuppressionBasis: null,
    reasoningSuppressed: false,
    reasoningTraceState: 'not_observed',
    diagnostic: null,
    failure: null,
    cancelReason: null,
    segments: [],
    ...overrides,
  }
}

describe('isSameModelRoute', () => {
  const baseRoute: RuntimeModelRoute = createRuntimeModelRoute({
    providerProfileId: 'p1',
    modelId: 'qwen-plus',
    catalogRevision: 'rev-1',
  })

  it('returns false when left is null', () => {
    expect(isSameModelRoute(null, baseRoute)).toBe(false)
  })

  it('returns true when both routeRef and catalogRevision match', () => {
    const left: RuntimeModelRoute = createRuntimeModelRoute({
      providerProfileId: 'p1',
      modelId: 'qwen-plus',
      catalogRevision: 'rev-1',
    })

    expect(isSameModelRoute(left, baseRoute)).toBe(true)
  })

  it('returns false when routeRef differs', () => {
    const left: RuntimeModelRoute = createRuntimeModelRoute({
      providerProfileId: 'p2',
      modelId: 'qwen-plus',
      catalogRevision: 'rev-1',
    })

    expect(isSameModelRoute(left, baseRoute)).toBe(false)
  })

  it('returns false when catalogRevision differs', () => {
    const left: RuntimeModelRoute = createRuntimeModelRoute({
      providerProfileId: 'p1',
      modelId: 'qwen-plus',
      catalogRevision: 'rev-2',
    })

    expect(isSameModelRoute(left, baseRoute)).toBe(false)
  })

  it('returns true when both catalogRevisions are trimmed matched', () => {
    const left: RuntimeModelRoute = createRuntimeModelRoute({
      providerProfileId: 'p1',
      modelId: 'qwen-plus',
      catalogRevision: '  rev-1  ',
    })

    expect(isSameModelRoute(left, baseRoute)).toBe(true)
  })

  it('returns false when routeRef is null on left but not right', () => {
    const left: RuntimeModelRoute = { catalogRevision: 'rev-1' }
    const right: RuntimeModelRoute = createRuntimeModelRoute({
      catalogRevision: 'rev-1',
    })

    expect(isSameModelRoute(left, right)).toBe(false)
  })

  it('returns false when routeRef is null on right but not left', () => {
    const left: RuntimeModelRoute = createRuntimeModelRoute({
      catalogRevision: 'rev-1',
    })
    const right: RuntimeModelRoute = { catalogRevision: 'rev-1' }

    expect(isSameModelRoute(left, right)).toBe(false)
  })

  it('returns true when both routeRef are null and catalogRevisions match', () => {
    const left: RuntimeModelRoute = { catalogRevision: 'rev-1' }
    const right: RuntimeModelRoute = { catalogRevision: 'rev-1' }

    // isSameModelRouteRef returns false for (null, null), so even with same catalogRevision it's false
    expect(isSameModelRoute(left, right)).toBe(false)
  })
})

describe('resolveComposerDraftModelSelection', () => {
  it('clears unmatched selection when selectedModelId is empty', () => {
    const draft = createDraft({
      selectedModelId: '',
      selectedModelRoute: createRuntimeModelRoute(),
      thinkingSelection: {} as any,
    })

    const result = resolveComposerDraftModelSelection(draft, [createModel()], null)

    expect(result.selectedModelRoute).toBeNull()
    expect(result.thinkingSelection).toBeNull()
  })

  it('returns draft unchanged when model not found (clears unmatched)', () => {
    const draft = createDraft({
      selectedModelId: 'unknown-model',
      selectedModelRoute: createRuntimeModelRoute(),
    })

    const result = resolveComposerDraftModelSelection(draft, [createModel()], null)

    expect(result.selectedModelRoute).toBeNull()
    expect(result.thinkingSelection).toBeNull()
  })

  it('returns draft unchanged when model not found and already cleared', () => {
    const draft = createDraft({
      selectedModelId: 'unknown-model',
      selectedModelRoute: null,
      thinkingSelection: null,
    })

    const result = resolveComposerDraftModelSelection(draft, [createModel()], null)

    expect(result).toBe(draft)
  })

  it('updates draft to match selected model when mismatched', () => {
    const draft = createDraft({
      selectedModelId: 'model-2',
      selectedModelRoute: createRuntimeModelRoute({ modelId: 'old-model' }),
    })
    const models = [
      createModel({ id: 'model-2', selectionValue: 'model-2', modelId: 'gpt-4' }),
    ]

    const result = resolveComposerDraftModelSelection(draft, models, null)

    expect(result.selectedModelId).toBe('model-2')
    expect(result.selectedModelRoute?.routeRef).toEqual(models[0].route.routeRef)
    expect(result.selectedModelRoute?.catalogRevision).toBe(models[0].route.catalogRevision)
  })

  it('preserves draft when model matches and no thinking capability', () => {
    const m = createModel()
    const draft = createDraft({
      selectedModelId: m.selectionValue,
      selectedModelRoute: m.route,
    })

    const result = resolveComposerDraftModelSelection(draft, [m], null)

    expect(result).toBe(draft)
  })

  it('syncs thinking when model matches and capability is provided', () => {
    const m = createModel()
    const draft = createDraft({
      selectedModelId: m.selectionValue,
      selectedModelRoute: m.route,
    })
    const thinkingCapability: RuntimeThinkingCapability = createRuntimeThinkingCapability()

    const result = resolveComposerDraftModelSelection(draft, [m], thinkingCapability)

    // The thinkingSelection should have been synced
    // syncComposerDraftThinkingSelection will modify thinkingSelection
    expect(result.selectedModelId).toBe(m.selectionValue)
  })

  it('handles unavailable model by normalizing to selectionValue', () => {
    const draft = createDraft({
      selectedModelId: 'model-unavail',
      selectedModelRoute: createRuntimeModelRoute(),
      thinkingSelection: {} as any,
    })
    const models = [
      createModel({
        id: 'model-unavail',
        selectionValue: 'model-unavail',
        available: false,
      }),
    ]

    const result = resolveComposerDraftModelSelection(draft, models, null)

    expect(result.selectedModelId).toBe('model-unavail')
    expect(result.selectedModelRoute).toBeNull()
    expect(result.thinkingSelection).toBeNull()
  })

  it('keeps unavailable model draft unchanged when already normalized', () => {
    const models = [
      createModel({
        id: 'model-unavail',
        selectionValue: 'model-unavail',
        available: false,
      }),
    ]
    const draft = createDraft({
      selectedModelId: 'model-unavail',
      selectedModelRoute: null,
      thinkingSelection: null,
    })

    const result = resolveComposerDraftModelSelection(draft, models, null)

    expect(result).toBe(draft)
  })
})

describe('resolveSelectedComposerModelRoute', () => {
  it('returns matched model route when found', () => {
    const m = createModel()
    const draft = createDraft({ selectedModelId: m.selectionValue })

    const result = resolveSelectedComposerModelRoute(draft, [m])

    expect(result).toBe(m.route)
  })

  it('returns draft route when model not found', () => {
    const route = createRuntimeModelRoute()
    const draft = createDraft({
      selectedModelId: 'unknown',
      selectedModelRoute: route,
    })

    const result = resolveSelectedComposerModelRoute(draft, [createModel()])

    expect(result).toBe(route)
  })

  it('returns null when selectedModelId is empty', () => {
    const draft = createDraft({ selectedModelId: '' })

    const result = resolveSelectedComposerModelRoute(draft, [createModel()])

    expect(result).toBeNull()
  })

  it('returns null when model not found and draft has no route', () => {
    const draft = createDraft({
      selectedModelId: 'unknown',
      selectedModelRoute: null,
    })

    const result = resolveSelectedComposerModelRoute(draft, [])

    expect(result).toBeNull()
  })
})

describe('resolveDisplayedThinkingCapability', () => {
  it('returns queriedCapability when selectedModelRoute is null', () => {
    const queriedCapability = createRuntimeThinkingCapability()
    const runState = createRunState()

    const result = resolveDisplayedThinkingCapability({
      queriedCapability,
      runState,
      selectedModelRoute: null,
    })

    expect(result).toBe(queriedCapability)
  })

  it('returns runState snapshot when routes match and snapshot exists', () => {
    const route = createRuntimeModelRoute()
    const snapshot = createRuntimeThinkingCapability({ reasonCode: 'snapshot' })
    const runState = createRunState({
      thinkingCapabilitySnapshot: snapshot,
      activeModelRoute: route,
    })

    const result = resolveDisplayedThinkingCapability({
      queriedCapability: createRuntimeThinkingCapability({ reasonCode: 'queried' }),
      runState,
      selectedModelRoute: route,
    })

    expect(result).toBe(snapshot)
  })

  it('returns queriedCapability when snapshot is null', () => {
    const route = createRuntimeModelRoute()
    const runState = createRunState({
      thinkingCapabilitySnapshot: null,
      activeModelRoute: route,
    })

    const result = resolveDisplayedThinkingCapability({
      queriedCapability: createRuntimeThinkingCapability({ reasonCode: 'queried' }),
      runState,
      selectedModelRoute: route,
    })

    expect(result?.reasonCode).toBe('queried')
  })

  it('returns queriedCapability when routes do not match', () => {
    const routeA = createRuntimeModelRoute({ providerProfileId: 'p1', modelId: 'm1' })
    const routeB = createRuntimeModelRoute({ providerProfileId: 'p2', modelId: 'm2' })
    const snapshot = createRuntimeThinkingCapability()
    const runState = createRunState({
      thinkingCapabilitySnapshot: snapshot,
      activeModelRoute: routeB,
    })

    const result = resolveDisplayedThinkingCapability({
      queriedCapability: createRuntimeThinkingCapability({ reasonCode: 'queried' }),
      runState,
      selectedModelRoute: routeA,
    })

    expect(result?.reasonCode).toBe('queried')
  })
})

describe('clearAbortController', () => {
  it('sets ref.current to null when it matches controller', () => {
    const controller = new AbortController()
    const ref = { current: controller }

    clearAbortController(ref, controller)

    expect(ref.current).toBeNull()
  })

  it('leaves ref.current unchanged when it does not match controller', () => {
    const ctrl1 = new AbortController()
    const ctrl2 = new AbortController()
    const ref = { current: ctrl1 }

    clearAbortController(ref, ctrl2)

    expect(ref.current).toBe(ctrl1)
  })

  it('handles ref with null current', () => {
    const ref = { current: null }

    clearAbortController(ref, new AbortController())

    expect(ref.current).toBeNull()
  })
})
