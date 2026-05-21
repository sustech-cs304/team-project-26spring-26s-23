import { describe, expect, it, vi } from 'vitest'
import {
  requireBoolean,
  requireNonEmptyString,
  requireNonNegativeInteger,
  requireNullableBoolean,
  requireNullableNonNegativeInteger,
  requireNullableNumber,
  requireNullableString,
  requireNullableRuntimeCanonicalThinkingSelection,
  requireNullableRuntimeThinkingEditorType,
  requireNullableRuntimeThinkingValue,
  requireOptionalString,
  requireRecord,
  requireRuntimeInlineFormField,
  requireRuntimeInlineFormRequest,
  requireRuntimeModelRouteRef,
  requireRuntimeResolvedModelRoute,
  requireRuntimeRunEventType,
  requireRuntimeThinkingCapabilitySource,
  requireRuntimeThinkingCapabilityStatus,
  requireRuntimeThinkingControlKind,
  requireRuntimeThinkingSelectionKind,
  requireRuntimeThinkingValue,
  requireRuntimeToolEventApproval,
  requireRuntimeToolEventPhase,
  requireSequence,
  requireString,
  requireStringArray,
  requireThinkingLevel,
  requireOptionalThinkingLevel,
} from './validators'

// ── Mock formatThinkingTokenCount used by buildRuntimeThinkingValueFromLegacyRecord ──
vi.mock('../../../workbench/thinking-display', () => ({
  formatThinkingTokenCount: vi.fn((value: number) => `${value} tokens`),
}))

// ═══════════════════════════════════════════════════════════════════════════════
// Primitive validators
// ═══════════════════════════════════════════════════════════════════════════════

describe('requireRecord', () => {
  it('returns the plain object when valid', () => {
    const obj = { a: 1 }
    expect(requireRecord(obj, 'test')).toBe(obj)
  })

  it('rejects null', () => {
    expect(() => requireRecord(null, 'test')).toThrow('test must be an object.')
  })

  it('rejects undefined', () => {
    expect(() => requireRecord(undefined, 'test')).toThrow('test must be an object.')
  })

  it('rejects arrays', () => {
    expect(() => requireRecord([], 'test')).toThrow('test must be an object.')
  })

  it('rejects strings', () => {
    expect(() => requireRecord('hello', 'test')).toThrow('test must be an object.')
  })

  it('rejects numbers', () => {
    expect(() => requireRecord(42, 'test')).toThrow('test must be an object.')
  })
})

describe('requireString', () => {
  it('returns the string when valid', () => {
    expect(requireString('hello', 'test')).toBe('hello')
  })

  it('rejects numbers', () => {
    expect(() => requireString(42, 'test')).toThrow('test must be a string.')
  })

  it('rejects booleans', () => {
    expect(() => requireString(true, 'test')).toThrow('test must be a string.')
  })

  it('rejects null', () => {
    expect(() => requireString(null, 'test')).toThrow('test must be a string.')
  })

  it('rejects undefined', () => {
    expect(() => requireString(undefined, 'test')).toThrow('test must be a string.')
  })

  it('rejects objects', () => {
    expect(() => requireString({}, 'test')).toThrow('test must be a string.')
  })
})

describe('requireNonEmptyString', () => {
  it('returns a non-empty string', () => {
    expect(requireNonEmptyString('hello', 'test')).toBe('hello')
  })

  it('trims whitespace', () => {
    expect(requireNonEmptyString('  hello  ', 'test')).toBe('hello')
  })

  it('rejects empty string', () => {
    expect(() => requireNonEmptyString('', 'test')).toThrow('test must be a non-empty string.')
  })

  it('rejects whitespace-only string', () => {
    expect(() => requireNonEmptyString('   ', 'test')).toThrow('test must be a non-empty string.')
  })

  it('rejects non-strings', () => {
    expect(() => requireNonEmptyString(42, 'test')).toThrow('test must be a string.')
  })
})

describe('requireBoolean', () => {
  it('returns true when true', () => {
    expect(requireBoolean(true, 'test')).toBe(true)
  })

  it('returns false when false', () => {
    expect(requireBoolean(false, 'test')).toBe(false)
  })

  it('rejects string "true"', () => {
    expect(() => requireBoolean('true', 'test')).toThrow('test must be a boolean.')
  })

  it('rejects number 1', () => {
    expect(() => requireBoolean(1, 'test')).toThrow('test must be a boolean.')
  })

  it('rejects null', () => {
    expect(() => requireBoolean(null, 'test')).toThrow('test must be a boolean.')
  })

  it('rejects undefined', () => {
    expect(() => requireBoolean(undefined, 'test')).toThrow('test must be a boolean.')
  })
})

describe('requireNonNegativeInteger', () => {
  it('returns 0', () => {
    expect(requireNonNegativeInteger(0, 'tokens')).toBe(0)
  })

  it('returns positive integer', () => {
    expect(requireNonNegativeInteger(100, 'tokens')).toBe(100)
  })

  it('rejects negative numbers', () => {
    expect(() => requireNonNegativeInteger(-1, 'tokens')).toThrow('tokens must be a non-negative integer.')
  })

  it('rejects floats', () => {
    expect(() => requireNonNegativeInteger(3.14, 'tokens')).toThrow('tokens must be a non-negative integer.')
  })

  it('rejects strings', () => {
    expect(() => requireNonNegativeInteger('100', 'tokens')).toThrow('tokens must be a non-negative integer.')
  })

  it('rejects null', () => {
    expect(() => requireNonNegativeInteger(null, 'tokens')).toThrow('tokens must be a non-negative integer.')
  })
})

describe('requireNullableBoolean', () => {
  it('returns true when true', () => {
    expect(requireNullableBoolean(true, 'test')).toBe(true)
  })

  it('returns null when null', () => {
    expect(requireNullableBoolean(null, 'test')).toBeNull()
  })

  it('returns null when undefined', () => {
    expect(requireNullableBoolean(undefined, 'test')).toBeNull()
  })

  it('rejects strings', () => {
    expect(() => requireNullableBoolean('true', 'test')).toThrow('test must be a boolean.')
  })
})

describe('requireNullableString', () => {
  it('returns the string', () => {
    expect(requireNullableString('hello', 'test')).toBe('hello')
  })

  it('returns null for null', () => {
    expect(requireNullableString(null, 'test')).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(requireNullableString(undefined, 'test')).toBeNull()
  })

  it('rejects numbers', () => {
    expect(() => requireNullableString(42, 'test')).toThrow('test must be a string.')
  })
})

describe('requireNullableNumber', () => {
  it('returns a number', () => {
    expect(requireNullableNumber(42, 'test')).toBe(42)
  })

  it('returns 0', () => {
    expect(requireNullableNumber(0, 'test')).toBe(0)
  })

  it('returns null for null', () => {
    expect(requireNullableNumber(null, 'test')).toBeNull()
  })

  it('rejects NaN', () => {
    expect(() => requireNullableNumber(NaN, 'test')).toThrow('test must be a number or null.')
  })

  it('rejects undefined', () => {
    expect(() => requireNullableNumber(undefined, 'test')).toThrow('test must be a number or null.')
  })

  it('rejects strings', () => {
    expect(() => requireNullableNumber('42', 'test')).toThrow('test must be a number or null.')
  })
})

describe('requireOptionalString', () => {
  it('returns a string', () => {
    expect(requireOptionalString('hello', 'test')).toBe('hello')
  })

  it('returns undefined for undefined', () => {
    expect(requireOptionalString(undefined, 'test')).toBeUndefined()
  })

  it('rejects null', () => {
    expect(() => requireOptionalString(null, 'test')).toThrow('test must be a string.')
  })

  it('rejects numbers', () => {
    expect(() => requireOptionalString(42, 'test')).toThrow('test must be a string.')
  })
})

describe('requireNullableNonNegativeInteger', () => {
  it('returns a positive integer', () => {
    expect(requireNullableNonNegativeInteger(100, 'test')).toBe(100)
  })

  it('returns 0', () => {
    expect(requireNullableNonNegativeInteger(0, 'test')).toBe(0)
  })

  it('returns null for null', () => {
    expect(requireNullableNonNegativeInteger(null, 'test')).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(requireNullableNonNegativeInteger(undefined, 'test')).toBeNull()
  })

  it('rejects negative numbers', () => {
    expect(() => requireNullableNonNegativeInteger(-1, 'test')).toThrow('test must be a non-negative integer.')
  })

  it('rejects floats', () => {
    expect(() => requireNullableNonNegativeInteger(1.5, 'test')).toThrow('test must be a non-negative integer.')
  })
})

describe('requireSequence', () => {
  it('returns a positive integer', () => {
    expect(requireSequence(1)).toBe(1)
  })

  it('returns a large sequence number', () => {
    expect(requireSequence(999999)).toBe(999999)
  })

  it('rejects 0', () => {
    expect(() => requireSequence(0)).toThrow('runtime event.sequence must be a positive integer.')
  })

  it('rejects negative numbers', () => {
    expect(() => requireSequence(-1)).toThrow('runtime event.sequence must be a positive integer.')
  })

  it('rejects floats', () => {
    expect(() => requireSequence(1.5)).toThrow('runtime event.sequence must be a positive integer.')
  })

  it('rejects strings', () => {
    expect(() => requireSequence('1')).toThrow('runtime event.sequence must be a positive integer.')
  })

  it('rejects null', () => {
    expect(() => requireSequence(null)).toThrow('runtime event.sequence must be a positive integer.')
  })
})

describe('requireStringArray', () => {
  it('returns an array of strings', () => {
    expect(requireStringArray(['a', 'b'], 'test')).toEqual(['a', 'b'])
  })

  it('returns empty array', () => {
    expect(requireStringArray([], 'test')).toEqual([])
  })

  it('rejects non-array', () => {
    expect(() => requireStringArray('a', 'test')).toThrow('test must be an array of strings.')
  })

  it('rejects array with non-string elements', () => {
    expect(() => requireStringArray(['a', 42, 'c'], 'test')).toThrow('test[1] must be a string.')
  })

  it('rejects null', () => {
    expect(() => requireStringArray(null, 'test')).toThrow('test must be an array of strings.')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Event type validators
// ═══════════════════════════════════════════════════════════════════════════════

describe('requireRuntimeRunEventType', () => {
  const validTypes = [
    'run_started', 'run_metadata', 'text_delta', 'reasoning_delta',
    'run_completed', 'run_failed', 'run_cancelled', 'run_diagnostic', 'tool_event',
  ]

  it.each(validTypes)('accepts "%s"', (type) => {
    expect(() => requireRuntimeRunEventType(type)).not.toThrow()
    expect(requireRuntimeRunEventType(type)).toBe(type)
  })

  it('rejects invalid event type', () => {
    expect(() => requireRuntimeRunEventType('unknown_event'))
      .toThrow('Unsupported runtime event type: unknown_event')
  })

  it('rejects empty string', () => {
    expect(() => requireRuntimeRunEventType('')).toThrow()
  })

  it('rejects null', () => {
    expect(() => requireRuntimeRunEventType(null)).toThrow()
  })

  it('rejects number', () => {
    expect(() => requireRuntimeRunEventType(42)).toThrow()
  })
})

describe('requireRuntimeToolEventPhase', () => {
  const validPhases = ['started', 'waiting_approval', 'completed', 'failed', 'cancelled']

  it.each(validPhases)('accepts "%s"', (phase) => {
    expect(() => requireRuntimeToolEventPhase(phase)).not.toThrow()
    expect(requireRuntimeToolEventPhase(phase)).toBe(phase)
  })

  it('rejects invalid phase', () => {
    expect(() => requireRuntimeToolEventPhase('running'))
      .toThrow('Unsupported runtime tool event phase: running')
  })

  it('rejects empty string', () => {
    expect(() => requireRuntimeToolEventPhase('')).toThrow()
  })

  it('rejects null', () => {
    expect(() => requireRuntimeToolEventPhase(null)).toThrow()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Thinking domain validators
// ═══════════════════════════════════════════════════════════════════════════════

describe('requireThinkingLevel', () => {
  const validLevels = ['off', 'auto', 'low', 'medium', 'high', 'xhigh']

  it.each(validLevels)('accepts "%s"', (level) => {
    expect(() => requireThinkingLevel(level, 'test')).not.toThrow()
    expect(requireThinkingLevel(level, 'test')).toBe(level)
  })

  it('rejects invalid level', () => {
    expect(() => requireThinkingLevel('extreme', 'test'))
      .toThrow('test must be a supported thinking level.')
  })

  it('rejects empty string', () => {
    expect(() => requireThinkingLevel('', 'test')).toThrow()
  })

  it('rejects null', () => {
    expect(() => requireThinkingLevel(null, 'test')).toThrow()
  })
})

describe('requireOptionalThinkingLevel', () => {
  it('returns a valid level', () => {
    expect(requireOptionalThinkingLevel('high', 'test')).toBe('high')
  })

  it('returns null for null', () => {
    expect(requireOptionalThinkingLevel(null, 'test')).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(requireOptionalThinkingLevel(undefined, 'test')).toBeNull()
  })

  it('rejects invalid level', () => {
    expect(() => requireOptionalThinkingLevel('extreme', 'test'))
      .toThrow('test must be a supported thinking level.')
  })
})

describe('requireRuntimeThinkingCapabilityStatus', () => {
  const validStatuses = [
    'verified-supported', 'verified-unsupported',
    'unknown-without-override', 'unknown-with-override',
  ]

  it.each(validStatuses)('accepts "%s"', (status) => {
    expect(() => requireRuntimeThinkingCapabilityStatus(status, 'test')).not.toThrow()
    expect(requireRuntimeThinkingCapabilityStatus(status, 'test')).toBe(status)
  })

  it('rejects invalid status', () => {
    expect(() => requireRuntimeThinkingCapabilityStatus('unkown', 'test'))
      .toThrow('test must be a supported thinking capability status.')
  })

  it('rejects empty string', () => {
    expect(() => requireRuntimeThinkingCapabilityStatus('', 'test')).toThrow()
  })
})

describe('requireRuntimeThinkingCapabilitySource', () => {
  it.each(['verified', 'override', 'unknown'] as const)('accepts "%s"', (source) => {
    expect(() => requireRuntimeThinkingCapabilitySource(source, 'test')).not.toThrow()
    expect(requireRuntimeThinkingCapabilitySource(source, 'test')).toBe(source)
  })

  it('rejects invalid source', () => {
    expect(() => requireRuntimeThinkingCapabilitySource('guessed', 'test'))
      .toThrow('test must be a supported thinking capability source.')
  })
})

describe('requireRuntimeThinkingControlKind', () => {
  const kinds = ['fixed', 'binary', 'off-auto', 'discrete', 'budget']

  it.each(kinds)('accepts "%s"', (kind) => {
    expect(() => requireRuntimeThinkingControlKind(kind, 'test')).not.toThrow()
    expect(requireRuntimeThinkingControlKind(kind, 'test')).toBe(kind)
  })

  it('rejects invalid kind', () => {
    expect(() => requireRuntimeThinkingControlKind('unlimited', 'test'))
      .toThrow('test must be a supported thinking control kind.')
  })
})

describe('requireRuntimeThinkingSelectionKind', () => {
  it.each(['preset', 'budget'] as const)('accepts "%s"', (kind) => {
    expect(() => requireRuntimeThinkingSelectionKind(kind, 'test')).not.toThrow()
    expect(requireRuntimeThinkingSelectionKind(kind, 'test')).toBe(kind)
  })

  it('rejects invalid kind', () => {
    expect(() => requireRuntimeThinkingSelectionKind('custom', 'test'))
      .toThrow('test must be a supported thinking selection kind.')
  })
})

describe('requireNullableRuntimeThinkingEditorType', () => {
  it.each(['discrete', 'budget', 'fixed'] as const)('accepts "%s"', (editorType) => {
    expect(() => requireNullableRuntimeThinkingEditorType(editorType, 'test')).not.toThrow()
    expect(requireNullableRuntimeThinkingEditorType(editorType, 'test')).toBe(editorType)
  })

  it('returns null for null', () => {
    expect(requireNullableRuntimeThinkingEditorType(null, 'test')).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(requireNullableRuntimeThinkingEditorType(undefined, 'test')).toBeNull()
  })

  it('rejects invalid editor type', () => {
    expect(() => requireNullableRuntimeThinkingEditorType('slider', 'test'))
      .toThrow('test must be a supported thinking editor type.')
  })
})

describe('requireRuntimeThinkingValue', () => {
  describe('code value type', () => {
    it('returns a code thinking value', () => {
      const result = requireRuntimeThinkingValue({
        valueType: 'code',
        code: 'high',
        labelZh: '高',
      }, 'test')
      expect(result).toEqual({ valueType: 'code', code: 'high', labelZh: '高' })
    })
  })

  describe('budget value type', () => {
    it('returns a budget thinking value with tokens', () => {
      const result = requireRuntimeThinkingValue({
        valueType: 'budget',
        mode: 'budget',
        budgetTokens: 1024,
        labelZh: '1024 tokens',
      }, 'test')
      expect(result).toEqual({
        valueType: 'budget',
        mode: 'budget',
        budgetTokens: 1024,
        labelZh: '1024 tokens',
      })
    })

    it('accepts budget with mode off', () => {
      const result = requireRuntimeThinkingValue({
        valueType: 'budget',
        mode: 'off',
        budgetTokens: null,
        labelZh: '关闭',
      }, 'test')
      expect(result.valueType).toBe('budget')
      expect(result.mode).toBe('off')
    })

    it('accepts budget with mode dynamic', () => {
      const result = requireRuntimeThinkingValue({
        valueType: 'budget',
        mode: 'dynamic',
        budgetTokens: null,
        labelZh: '动态',
      }, 'test')
      expect(result.mode).toBe('dynamic')
    })

    it('rejects invalid budget mode', () => {
      expect(() => requireRuntimeThinkingValue({
        valueType: 'budget',
        mode: 'unlimited',
        budgetTokens: null,
        labelZh: 'x',
      }, 'test')).toThrow('test.mode must be off, dynamic, or budget.')
    })
  })

  describe('fixed value type', () => {
    it('returns a fixed thinking value', () => {
      const result = requireRuntimeThinkingValue({
        valueType: 'fixed',
        labelZh: '固定推理',
      }, 'test')
      expect(result.valueType).toBe('fixed')
      expect((result as { code: string }).code).toBe('fixed')
    })
  })

  it('rejects invalid valueType', () => {
    expect(() => requireRuntimeThinkingValue({
      valueType: 'unknown',
    }, 'test')).toThrow('test.valueType must be a supported thinking value type.')
  })

  it('rejects non-object', () => {
    expect(() => requireRuntimeThinkingValue('code', 'test')).toThrow('test must be an object.')
  })

  it('rejects null', () => {
    expect(() => requireRuntimeThinkingValue(null, 'test')).toThrow('test must be an object.')
  })
})

describe('requireNullableRuntimeThinkingValue', () => {
  it('returns the value for a valid code value', () => {
    const result = requireNullableRuntimeThinkingValue({
      valueType: 'code',
      code: 'low',
      labelZh: '低',
    }, 'test')
    expect(result).toEqual({ valueType: 'code', code: 'low', labelZh: '低' })
  })

  it('returns null for null', () => {
    expect(requireNullableRuntimeThinkingValue(null, 'test')).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(requireNullableRuntimeThinkingValue(undefined, 'test')).toBeNull()
  })

  it('rejects invalid input', () => {
    expect(() => requireNullableRuntimeThinkingValue('invalid', 'test')).toThrow()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Model route validators
// ═══════════════════════════════════════════════════════════════════════════════

describe('requireRuntimeModelRouteRef', () => {
  const validRouteRef = {
    routeKind: 'provider-model',
    profileId: 'prof-1',
    modelId: 'model-1',
  }

  it('returns a valid routeRef', () => {
    const result = requireRuntimeModelRouteRef(validRouteRef, 'route')
    expect(result.routeKind).toBe('provider-model')
    expect(result.profileId).toBe('prof-1')
    expect(result.modelId).toBe('model-1')
  })

  it('rejects wrong routeKind', () => {
    expect(() => requireRuntimeModelRouteRef({
      routeKind: 'custom',
      profileId: 'p',
      modelId: 'm',
    }, 'route')).toThrow("route.routeKind must be 'provider-model'.")
  })

  it('rejects missing profileId', () => {
    expect(() => requireRuntimeModelRouteRef({
      routeKind: 'provider-model',
      modelId: 'm',
      profileId: '',
    }, 'route')).toThrow('route.profileId must be a non-empty string.')
  })

  it('rejects non-object', () => {
    expect(() => requireRuntimeModelRouteRef('not-an-object', 'route')).toThrow('route must be an object.')
  })
})

describe('requireRuntimeResolvedModelRoute', () => {
  const validRoute = {
    routeRef: {
      routeKind: 'provider-model',
      profileId: 'prof-1',
      modelId: 'model-1',
    },
    providerProfileId: 'pp-1',
    provider: 'openai',
    providerId: 'pid-1',
    adapterId: 'ad-1',
    runtimeStatus: 'ready',
    catalogRevision: 'v1',
    endpointFamily: 'chat',
    endpointType: 'chat/completions',
    baseUrl: 'https://api.example.com',
    modelId: 'gpt-4',
    authKind: 'api-key',
  }

  it('returns a valid resolved model route', () => {
    const result = requireRuntimeResolvedModelRoute(validRoute, 'model')
    expect(result.provider).toBe('openai')
    expect(result.modelId).toBe('gpt-4')
    expect(result.routeRef.profileId).toBe('prof-1')
  })

  it('rejects empty providerProfileId', () => {
    expect(() => requireRuntimeResolvedModelRoute({ ...validRoute, providerProfileId: '' }, 'model'))
      .toThrow('model.providerProfileId must be a non-empty string.')
  })

  it('rejects empty baseUrl', () => {
    expect(() => requireRuntimeResolvedModelRoute({ ...validRoute, baseUrl: '' }, 'model'))
      .toThrow('model.baseUrl must be a non-empty string.')
  })

  it('rejects non-object', () => {
    expect(() => requireRuntimeResolvedModelRoute(null, 'model')).toThrow('model must be an object.')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Tool approval validator
// ═══════════════════════════════════════════════════════════════════════════════

describe('requireRuntimeToolEventApproval', () => {
  const validModes = ['allow', 'ask', 'delay', 'deny']

  it.each(validModes)('accepts mode "%s"', (mode) => {
    const result = requireRuntimeToolEventApproval({ mode }, 'approval')
    expect(result.mode).toBe(mode)
  })

  it('includes timeoutAt when provided', () => {
    const result = requireRuntimeToolEventApproval({
      mode: 'ask',
      timeoutAt: '2026-01-01T00:00:00Z',
    }, 'approval')
    expect(result.timeoutAt).toBe('2026-01-01T00:00:00Z')
  })

  it('includes timeoutSeconds when provided', () => {
    const result = requireRuntimeToolEventApproval({
      mode: 'delay',
      timeoutSeconds: 30,
    }, 'approval')
    expect(result.timeoutSeconds).toBe(30)
  })

  it('accepts null timeoutSeconds', () => {
    const result = requireRuntimeToolEventApproval({
      mode: 'delay',
      timeoutSeconds: null,
    }, 'approval')
    expect(result.timeoutSeconds).toBeUndefined()
  })

  it('includes timeoutAction approve', () => {
    const result = requireRuntimeToolEventApproval({
      mode: 'ask',
      timeoutAction: 'approve',
    }, 'approval')
    expect(result.timeoutAction).toBe('approve')
  })

  it('includes timeoutAction deny', () => {
    const result = requireRuntimeToolEventApproval({
      mode: 'ask',
      timeoutAction: 'deny',
    }, 'approval')
    expect(result.timeoutAction).toBe('deny')
  })

  it('strips null timeoutAction to undefined', () => {
    const result = requireRuntimeToolEventApproval({
      mode: 'ask',
      timeoutAction: null,
    }, 'approval')
    expect(result.timeoutAction).toBeUndefined()
  })

  it('rejects invalid mode', () => {
    expect(() => requireRuntimeToolEventApproval({ mode: 'block' }, 'approval'))
      .toThrow('Invalid tool approval mode: block')
  })

  it('rejects invalid timeoutAction', () => {
    expect(() => requireRuntimeToolEventApproval({
      mode: 'ask',
      timeoutAction: 'ignore',
    }, 'approval')).toThrow('Invalid tool approval timeoutAction: ignore')
  })

  it('rejects missing mode', () => {
    expect(() => requireRuntimeToolEventApproval({}, 'approval')).toThrow()
  })

  it('rejects non-object', () => {
    expect(() => requireRuntimeToolEventApproval('allow', 'approval')).toThrow()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Inline form validators
// ═══════════════════════════════════════════════════════════════════════════════

describe('requireRuntimeInlineFormField', () => {
  const baseField = {
    name: 'field1',
    label: 'Field 1',
    type: 'text',
  }

  it('accepts a text field', () => {
    const result = requireRuntimeInlineFormField(baseField, 'field')
    expect(result.name).toBe('field1')
    expect(result.type).toBe('text')
  })

  it('accepts a textarea field', () => {
    expect(() => requireRuntimeInlineFormField({ ...baseField, type: 'textarea' }, 'field')).not.toThrow()
  })

  it('accepts a number field', () => {
    expect(() => requireRuntimeInlineFormField({ ...baseField, type: 'number' }, 'field')).not.toThrow()
  })

  it('accepts a select field with options', () => {
    const result = requireRuntimeInlineFormField({
      ...baseField,
      type: 'select',
      options: [{ value: 'v1', label: 'Option 1' }],
    }, 'field')
    expect(result.type).toBe('select')
    expect(result.options).toHaveLength(1)
  })

  it('rejects select field without options', () => {
    expect(() => requireRuntimeInlineFormField({
      ...baseField,
      type: 'select',
    }, 'field')).toThrow('field.options must contain at least one option for select fields')
  })

  it('rejects select field with empty options', () => {
    expect(() => requireRuntimeInlineFormField({
      ...baseField,
      type: 'select',
      options: [],
    }, 'field')).toThrow()
  })

  it('accepts a checkbox field', () => {
    const result = requireRuntimeInlineFormField({
      ...baseField,
      type: 'checkbox',
    }, 'field')
    expect(result.type).toBe('checkbox')
  })

  it('rejects checkbox field with options', () => {
    expect(() => requireRuntimeInlineFormField({
      ...baseField,
      type: 'checkbox',
      options: [{ value: 'v1', label: 'O1' }],
    }, 'field')).toThrow('field.options is not supported for checkbox fields')
  })

  it('includes optional description and placeholder', () => {
    const result = requireRuntimeInlineFormField({
      ...baseField,
      description: 'desc',
      placeholder: 'ph',
    }, 'field')
    expect(result.description).toBe('desc')
    expect(result.placeholder).toBe('ph')
  })

  it('includes required boolean', () => {
    const result = requireRuntimeInlineFormField({ ...baseField, required: true }, 'field')
    expect(result.required).toBe(true)
  })

  it('rejects invalid field type', () => {
    expect(() => requireRuntimeInlineFormField({ ...baseField, type: 'date' }, 'field'))
      .toThrow('field.type must be a supported inline form field type.')
  })

  it('rejects missing name', () => {
    expect(() => requireRuntimeInlineFormField({ label: 'L', type: 'text' }, 'field'))
      .toThrow()
  })

  it('rejects non-object', () => {
    expect(() => requireRuntimeInlineFormField('text', 'field')).toThrow()
  })
})

describe('requireRuntimeInlineFormRequest', () => {
  const validRequest = {
    formId: 'form-1',
    title: 'Test Form',
    fields: [
      { name: 'f1', label: 'Field 1', type: 'text' },
    ],
  }

  it('returns a valid form request', () => {
    const result = requireRuntimeInlineFormRequest(validRequest, 'form')
    expect(result.formId).toBe('form-1')
    expect(result.title).toBe('Test Form')
    expect(result.fields).toHaveLength(1)
  })

  it('includes optional description and submitLabel', () => {
    const result = requireRuntimeInlineFormRequest({
      ...validRequest,
      description: 'desc',
      submitLabel: 'Submit',
    }, 'form')
    expect(result.description).toBe('desc')
    expect(result.submitLabel).toBe('Submit')
  })

  it('rejects empty formId', () => {
    expect(() => requireRuntimeInlineFormRequest({ ...validRequest, formId: '' }, 'form'))
      .toThrow('form.formId must be a non-empty string.')
  })

  it('rejects empty title', () => {
    expect(() => requireRuntimeInlineFormRequest({ ...validRequest, title: '' }, 'form'))
      .toThrow('form.title must be a non-empty string.')
  })

  it('rejects non-array fields', () => {
    expect(() => requireRuntimeInlineFormRequest({
      formId: 'f1',
      title: 'T',
      fields: 'not-an-array',
    }, 'form')).toThrow('form.fields must be an array')
  })

  it('rejects empty fields array', () => {
    expect(() => requireRuntimeInlineFormRequest({
      formId: 'f1',
      title: 'T',
      fields: [],
    }, 'form')).toThrow('form.fields must contain at least one field')
  })

  it('rejects invalid field in fields array', () => {
    expect(() => requireRuntimeInlineFormRequest({
      formId: 'f1',
      title: 'T',
      fields: [{ name: 'f1', label: 'F1', type: 'invalid' }],
    }, 'form')).toThrow()
  })

  it('rejects non-object', () => {
    expect(() => requireRuntimeInlineFormRequest(null, 'form')).toThrow()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// Canonical thinking selection
// ═══════════════════════════════════════════════════════════════════════════════

describe('requireNullableRuntimeCanonicalThinkingSelection', () => {
  it('returns a preset selection', () => {
    const result = requireNullableRuntimeCanonicalThinkingSelection({
      kind: 'preset',
      value: 'high',
    }, 'sel')
    expect(result).toEqual({ kind: 'preset', value: 'high' })
  })

  it('returns a budget selection', () => {
    const result = requireNullableRuntimeCanonicalThinkingSelection({
      kind: 'budget',
      budgetTokens: 2048,
    }, 'sel')
    expect(result).toEqual({ kind: 'budget', budgetTokens: 2048 })
  })

  it('returns null for null', () => {
    expect(requireNullableRuntimeCanonicalThinkingSelection(null, 'sel')).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(requireNullableRuntimeCanonicalThinkingSelection(undefined, 'sel')).toBeNull()
  })

  it('rejects invalid kind', () => {
    expect(() => requireNullableRuntimeCanonicalThinkingSelection({
      kind: 'custom',
    }, 'sel')).toThrow('sel.kind must be a supported thinking selection kind.')
  })

  it('rejects budget selection without budgetTokens', () => {
    expect(() => requireNullableRuntimeCanonicalThinkingSelection({
      kind: 'budget',
    }, 'sel')).toThrow('sel.budgetTokens must be a non-negative integer.')
  })

  it('rejects non-object', () => {
    expect(() => requireNullableRuntimeCanonicalThinkingSelection('preset', 'sel')).toThrow()
  })
})
