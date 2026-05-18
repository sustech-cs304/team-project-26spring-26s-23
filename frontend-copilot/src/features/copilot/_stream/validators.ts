/** Runtime event validation helpers extracted from runtime-message-stream.ts. */

import { formatThinkingTokenCount } from '../../../workbench/thinking-display'
import type {
  RuntimeCanonicalThinkingSelection,
  RuntimeRunEvent,
  RuntimeInlineFormField,
  RuntimeInlineFormFieldOption,
  RuntimeInlineFormRequest,
  RuntimeReasoningSuppressionBasis,
  RuntimeResolvedModelRoute,
  RuntimeRunThinkingMetadata,
  RuntimeThinkingCapability,
  RuntimeThinkingCapabilityProvenance,
  RuntimeThinkingControlSpec,
  RuntimeThinkingLevel,
  RuntimeThinkingSelection,
  RuntimeThinkingSelectionResult,
  RuntimeThinkingVisibility,
  RuntimeToolEventApproval,
  RuntimeToolEventPhase,
} from '../thread-run-contract'

export function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

export function requireRuntimeResolvedModelRoute(value: unknown, label: string): RuntimeResolvedModelRoute {
  const record = requireRecord(value, label)
  const routeRef = requireRuntimeModelRouteRef(record.routeRef, `${label}.routeRef`)

  return {
    routeRef,
    providerProfileId: requireNonEmptyString(record.providerProfileId, `${label}.providerProfileId`),
    provider: requireNonEmptyString(record.provider, `${label}.provider`),
    providerId: requireNonEmptyString(record.providerId, `${label}.providerId`),
    adapterId: requireNonEmptyString(record.adapterId, `${label}.adapterId`),
    runtimeStatus: requireNonEmptyString(record.runtimeStatus, `${label}.runtimeStatus`),
    catalogRevision: requireString(record.catalogRevision, `${label}.catalogRevision`),
    endpointFamily: requireNonEmptyString(record.endpointFamily, `${label}.endpointFamily`),
    endpointType: requireNonEmptyString(record.endpointType, `${label}.endpointType`),
    baseUrl: requireNonEmptyString(record.baseUrl, `${label}.baseUrl`),
    modelId: requireNonEmptyString(record.modelId, `${label}.modelId`),
    authKind: requireNonEmptyString(record.authKind, `${label}.authKind`),
  }
}

export function requireRuntimeToolEventApproval(value: unknown, label: string): RuntimeToolEventApproval {
  const record = requireRecord(value, label)
  const mode = requireNonEmptyString(record.mode, `${label}.mode`)
  if (mode !== 'allow' && mode !== 'ask' && mode !== 'delay' && mode !== 'deny') {
    throw new Error(`Invalid tool approval mode: ${mode}`)
  }

  const timeoutAt = requireOptionalString(record.timeoutAt, `${label}.timeoutAt`)
  const timeoutSeconds = record.timeoutSeconds === undefined
    ? undefined
    : requireNullableNumber(record.timeoutSeconds, `${label}.timeoutSeconds`)
  const timeoutAction = record.timeoutAction
  if (
    timeoutAction !== undefined
    && timeoutAction !== null
    && timeoutAction !== 'approve'
    && timeoutAction !== 'deny'
  ) {
    throw new Error(`Invalid tool approval timeoutAction: ${timeoutAction}`)
  }

  return {
    mode,
    ...(timeoutAt === undefined ? {} : { timeoutAt }),
    ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
    ...(timeoutAction === undefined ? {} : { timeoutAction }),
  }
}

export function parseOptionalRuntimeInlineFormRequest(value: unknown): RuntimeInlineFormRequest | undefined {
  if (value === undefined || value === null) {
    return undefined
  }

  return requireRuntimeInlineFormRequest(value, 'runtime event payload.formRequest')
}

export function requireRuntimeInlineFormRequest(value: unknown, label: string): RuntimeInlineFormRequest {
  const record = requireRecord(value, label)
  const description = requireOptionalString(record.description, `${label}.description`)
  const submitLabel = requireOptionalString(record.submitLabel, `${label}.submitLabel`)
  if (!Array.isArray(record.fields)) {
    throw new Error(`${label}.fields must be an array`)
  }
  if (record.fields.length === 0) {
    throw new Error(`${label}.fields must contain at least one field`)
  }

  return {
    formId: requireNonEmptyString(record.formId, `${label}.formId`),
    title: requireNonEmptyString(record.title, `${label}.title`),
    ...(description === undefined ? {} : { description }),
    ...(submitLabel === undefined ? {} : { submitLabel }),
    fields: record.fields.map((field, index) => requireRuntimeInlineFormField(field, `${label}.fields[${index}]`)),
  }
}

export function requireRuntimeInlineFormField(value: unknown, label: string): RuntimeInlineFormField {
  const record = requireRecord(value, label)
  const type = requireNonEmptyString(record.type, `${label}.type`)
  if (type !== 'text' && type !== 'textarea' && type !== 'number' && type !== 'select' && type !== 'checkbox') {
    throw new Error(`${label}.type must be a supported inline form field type.`)
  }

  const description = requireOptionalString(record.description, `${label}.description`)
  const placeholder = requireOptionalString(record.placeholder, `${label}.placeholder`)
  const options = record.options === undefined
    ? undefined
    : requireRuntimeInlineFormFieldOptions(record.options, `${label}.options`)

  if (type === 'select' && (options === undefined || options.length === 0)) {
    throw new Error(`${label}.options must contain at least one option for select fields`)
  }

  if (type === 'checkbox' && options !== undefined) {
    throw new Error(`${label}.options is not supported for checkbox fields`)
  }

  return {
    name: requireNonEmptyString(record.name, `${label}.name`),
    label: requireNonEmptyString(record.label, `${label}.label`),
    type,
    ...(description === undefined ? {} : { description }),
    ...(placeholder === undefined ? {} : { placeholder }),
    ...(record.required === undefined ? {} : { required: requireBoolean(record.required, `${label}.required`) }),
    ...(options === undefined ? {} : { options }),
  }
}

export function requireRuntimeInlineFormFieldOptions(value: unknown, label: string): RuntimeInlineFormFieldOption[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`)
  }

  return value.map((item, index) => {
    const record = requireRecord(item, `${label}[${index}]`)
    return {
      value: requireString(record.value, `${label}[${index}].value`),
      label: requireString(record.label, `${label}[${index}].label`),
    }
  })
}

export function requireRuntimeModelRouteRef(value: unknown, label: string): RuntimeResolvedModelRoute['routeRef'] {
  const record = requireRecord(value, label)
  const routeKind = requireNonEmptyString(record.routeKind, `${label}.routeKind`)
  if (routeKind !== 'provider-model') {
    throw new Error(`${label}.routeKind must be 'provider-model'.`)
  }

  return {
    routeKind,
    profileId: requireNonEmptyString(record.profileId, `${label}.profileId`),
    modelId: requireNonEmptyString(record.modelId, `${label}.modelId`),
  }
}

export function requireRuntimeRunEventType(value: unknown): RuntimeRunEvent['type'] {
  const eventType = requireNonEmptyString(value, 'runtime event.type')
  switch (eventType) {
    case 'run_started':
    case 'run_metadata':
    case 'text_delta':
    case 'reasoning_delta':
    case 'run_completed':
    case 'run_failed':
    case 'run_cancelled':
    case 'run_diagnostic':
    case 'tool_event':
      return eventType
    default:
      throw new Error(`Unsupported runtime event type: ${eventType}`)
  }
}

export function requireNullableRuntimeThinkingSelection(
  value: unknown,
  label: string,
): RuntimeThinkingSelection | null {
  if (value === null || value === undefined) {
    return null
  }
  return requireRuntimeThinkingSelection(value, label)
}

export function requireRuntimeThinkingSelection(value: unknown, label: string): RuntimeThinkingSelection {
  const record = requireRecord(value, label)
  const series = requireNonEmptyString(record.series, `${label}.series`)
  const runtimeValue = record.value === undefined
    ? buildRuntimeThinkingValueFromLegacyRecord(record, label)
    : requireRuntimeThinkingValue(record.value, `${label}.value`)

  if (runtimeValue === null) {
    throw new Error(`${label}.value must describe a valid thinking series value.`)
  }

  return {
    series,
    value: runtimeValue,
    ...deriveLegacyRuntimeThinkingSelectionFields(runtimeValue),
  }
}

export function requireRuntimeRunThinkingMetadata(
  value: Record<string, unknown>,
  label: string,
): RuntimeRunThinkingMetadata {
  const thinkingSeriesDecision = requireNullableRuntimeThinkingSelectionResult(
    value.thinkingSeriesDecision ?? value.thinkingSelectionResult,
    `${label}.thinkingSeriesDecision`,
  )
  const requestedThinkingLevel = hasOwn(value, 'requestedThinkingLevel')
    ? requireOptionalThinkingLevel(value.requestedThinkingLevel, `${label}.requestedThinkingLevel`)
    : undefined
  const appliedThinkingLevel = hasOwn(value, 'appliedThinkingLevel')
    ? requireOptionalThinkingLevel(value.appliedThinkingLevel, `${label}.appliedThinkingLevel`)
    : undefined

  return {
    requestedThinkingSelection: requireNullableRuntimeThinkingSelection(
      value.requestedThinkingSelection,
      `${label}.requestedThinkingSelection`,
    ),
    appliedThinkingSelection: requireNullableRuntimeThinkingSelection(
      value.appliedThinkingSelection,
      `${label}.appliedThinkingSelection`,
    ),
    thinkingCapabilitySnapshot: requireNullableRuntimeThinkingCapability(
      value.thinkingCapabilitySnapshot,
      `${label}.thinkingCapabilitySnapshot`,
    ),
    thinkingSeriesDecision,
    ...(requestedThinkingLevel === undefined ? {} : { requestedThinkingLevel }),
    ...(appliedThinkingLevel === undefined ? {} : { appliedThinkingLevel }),
    reasoningSuppressionBasis: requireNullableRuntimeReasoningSuppressionBasis(
      value.reasoningSuppressionBasis,
      `${label}.reasoningSuppressionBasis`,
    ),
  }
}

export function parseOptionalRuntimeRunThinkingMetadata(
  value: Record<string, unknown>,
  label: string,
): Partial<RuntimeRunThinkingMetadata> {
  const partial: Partial<RuntimeRunThinkingMetadata> = {}
  if (hasOwn(value, 'requestedThinkingSelection')) {
    partial.requestedThinkingSelection = requireNullableRuntimeThinkingSelection(
      value.requestedThinkingSelection,
      `${label}.requestedThinkingSelection`,
    )
  }
  if (hasOwn(value, 'appliedThinkingSelection')) {
    partial.appliedThinkingSelection = requireNullableRuntimeThinkingSelection(
      value.appliedThinkingSelection,
      `${label}.appliedThinkingSelection`,
    )
  }
  if (hasOwn(value, 'requestedThinkingLevel')) {
    partial.requestedThinkingLevel = requireOptionalThinkingLevel(
      value.requestedThinkingLevel,
      `${label}.requestedThinkingLevel`,
    )
  }
  if (hasOwn(value, 'appliedThinkingLevel')) {
    partial.appliedThinkingLevel = requireOptionalThinkingLevel(
      value.appliedThinkingLevel,
      `${label}.appliedThinkingLevel`,
    )
  }
  if (hasOwn(value, 'thinkingCapabilitySnapshot')) {
    partial.thinkingCapabilitySnapshot = requireNullableRuntimeThinkingCapability(
      value.thinkingCapabilitySnapshot,
      `${label}.thinkingCapabilitySnapshot`,
    )
  }
  if (hasOwn(value, 'thinkingSeriesDecision') || hasOwn(value, 'thinkingSelectionResult')) {
    const thinkingSeriesDecision = requireNullableRuntimeThinkingSelectionResult(
      value.thinkingSeriesDecision ?? value.thinkingSelectionResult,
      `${label}.thinkingSeriesDecision`,
    )
    partial.thinkingSeriesDecision = thinkingSeriesDecision
  }
  if (hasOwn(value, 'reasoningSuppressionBasis')) {
    partial.reasoningSuppressionBasis = requireNullableRuntimeReasoningSuppressionBasis(
      value.reasoningSuppressionBasis,
      `${label}.reasoningSuppressionBasis`,
    )
  }
  return partial
}

export function requireNullableRuntimeThinkingCapability(
  value: unknown,
  label: string,
): RuntimeThinkingCapability | null {
  if (value === null || value === undefined) {
    return null
  }
  return requireRuntimeThinkingCapability(value, label)
}

export function requireRuntimeThinkingCapability(value: unknown, label: string): RuntimeThinkingCapability {
  const record = requireRecord(value, label)
  const routeFingerprint = requireRecord(record.routeFingerprint, `${label}.routeFingerprint`)

  return {
    status: requireRuntimeThinkingCapabilityStatus(record.status, `${label}.status`),
    source: requireRuntimeThinkingCapabilitySource(record.source, `${label}.source`),
    series: requireNullableString(record.series, `${label}.series`),
    seriesLabelZh: requireNullableString(record.seriesLabelZh, `${label}.seriesLabelZh`),
    editorType: requireNullableRuntimeThinkingEditorType(record.editorType, `${label}.editorType`),
    allowedValues: requireRuntimeThinkingValueArray(record.allowedValues, `${label}.allowedValues`),
    defaultValue: requireNullableRuntimeThinkingValue(record.defaultValue, `${label}.defaultValue`),
    providerBuilderKey: requireNullableString(record.providerBuilderKey, `${label}.providerBuilderKey`),
    reasonCode: requireNonEmptyString(record.reasonCode, `${label}.reasonCode`),
    routeFingerprint: {
      providerProfileId: requireNonEmptyString(routeFingerprint.providerProfileId, `${label}.routeFingerprint.providerProfileId`),
      provider: requireNonEmptyString(routeFingerprint.provider, `${label}.routeFingerprint.provider`),
      endpointType: requireNonEmptyString(routeFingerprint.endpointType, `${label}.routeFingerprint.endpointType`),
      baseUrl: requireNonEmptyString(routeFingerprint.baseUrl, `${label}.routeFingerprint.baseUrl`),
      modelId: requireNonEmptyString(routeFingerprint.modelId, `${label}.routeFingerprint.modelId`),
    },
    ...(hasOwn(record, 'supported') ? { supported: requireBoolean(record.supported, `${label}.supported`) } : {}),
    ...(hasOwn(record, 'controlSpec')
      ? { controlSpec: requireNullableRuntimeThinkingControlSpec(record.controlSpec, `${label}.controlSpec`) }
      : {}),
    ...(hasOwn(record, 'defaultSelection')
      ? {
          defaultSelection: requireNullableRuntimeCanonicalThinkingSelection(
            record.defaultSelection,
            `${label}.defaultSelection`,
          ),
        }
      : {}),
    ...(hasOwn(record, 'supportedLevels')
      ? { supportedLevels: requireThinkingLevelArray(record.supportedLevels, `${label}.supportedLevels`) }
      : {}),
    ...(hasOwn(record, 'defaultLevel')
      ? { defaultLevel: requireOptionalThinkingLevel(record.defaultLevel, `${label}.defaultLevel`) }
      : {}),
    ...(hasOwn(record, 'providerHint')
      ? { providerHint: requireNullableString(record.providerHint, `${label}.providerHint`) }
      : {}),
    ...(hasOwn(record, 'provenance')
      ? { provenance: requireNullableRuntimeThinkingCapabilityProvenance(record.provenance, `${label}.provenance`) }
      : {}),
    ...(hasOwn(record, 'visibility')
      ? { visibility: requireNullableRuntimeThinkingVisibility(record.visibility, `${label}.visibility`) }
      : {}),
    ...(hasOwn(record, 'overrideLevels')
      ? { overrideLevels: requireThinkingLevelArray(record.overrideLevels, `${label}.overrideLevels`) }
      : {}),
  }
}

export function requireNullableRuntimeThinkingEditorType(
  value: unknown,
  label: string,
): RuntimeThinkingCapability['editorType'] {
  if (value === null || value === undefined) {
    return null
  }
  const normalized = requireNonEmptyString(value, label)
  switch (normalized) {
    case 'discrete':
    case 'budget':
    case 'fixed':
      return normalized
    default:
      throw new Error(`${label} must be a supported thinking editor type.`)
  }
}

export function requireRuntimeThinkingValueArray(
  value: unknown,
  label: string,
): RuntimeThinkingCapability['allowedValues'] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`)
  }
  return value.map((item, index) => requireRuntimeThinkingValue(item, `${label}[${index}]`))
}

export function requireNullableRuntimeThinkingValue(
  value: unknown,
  label: string,
): NonNullable<RuntimeThinkingSelection['value']> | null {
  if (value === null || value === undefined) {
    return null
  }
  return requireRuntimeThinkingValue(value, label)
}

export function requireRuntimeThinkingValue(
  value: unknown,
  label: string,
): NonNullable<RuntimeThinkingSelection['value']> {
  const record = requireRecord(value, label)
  const valueType = requireNonEmptyString(record.valueType, `${label}.valueType`)
  switch (valueType) {
    case 'code':
      return {
        valueType: 'code',
        code: requireNonEmptyString(record.code, `${label}.code`),
        labelZh: requireNonEmptyString(record.labelZh, `${label}.labelZh`),
      }
    case 'budget': {
      const mode = requireNonEmptyString(record.mode, `${label}.mode`)
      if (mode !== 'off' && mode !== 'dynamic' && mode !== 'budget') {
        throw new Error(`${label}.mode must be off, dynamic, or budget.`)
      }
      return {
        valueType: 'budget',
        mode,
        budgetTokens: requireNullableNonNegativeInteger(record.budgetTokens, `${label}.budgetTokens`),
        labelZh: requireNonEmptyString(record.labelZh, `${label}.labelZh`),
      }
    }
    case 'fixed':
      return {
        valueType: 'fixed',
        code: 'fixed',
        labelZh: requireNonEmptyString(record.labelZh, `${label}.labelZh`),
      }
    default:
      throw new Error(`${label}.valueType must be a supported thinking value type.`)
  }
}

export function buildRuntimeThinkingValueFromLegacyRecord(
  record: Record<string, unknown>,
  label: string,
): NonNullable<RuntimeThinkingSelection['value']> | null {
  const mode = requireNullableString(record.mode, `${label}.mode`)
  const level = requireNullableString(record.level, `${label}.level`)
  const budgetTokens = requireNullableNonNegativeInteger(record.budgetTokens, `${label}.budgetTokens`)

  if (mode === 'budget' && budgetTokens !== null) {
    return {
      valueType: 'budget',
      mode: 'budget',
      budgetTokens,
      labelZh: formatThinkingTokenCount(budgetTokens),
    }
  }

  if (level === null) {
    return null
  }

  if (level === 'fixed') {
    return {
      valueType: 'fixed',
      code: 'fixed',
      labelZh: '固定推理',
    }
  }

  const normalizedLevel = requireThinkingLevel(level, `${label}.level`)
  return {
    valueType: 'code',
    code: normalizedLevel,
    labelZh: normalizedLevel,
  }
}

export function deriveLegacyRuntimeThinkingSelectionFields(
  value: NonNullable<RuntimeThinkingSelection['value']>,
): Pick<RuntimeThinkingSelection, 'mode' | 'level' | 'budgetTokens'> {
  switch (value.valueType) {
    case 'budget':
      return {
        mode: 'budget',
        level: null,
        budgetTokens: value.mode === 'budget' ? value.budgetTokens : null,
      }
    case 'fixed':
      return {
        mode: 'preset',
        level: 'fixed',
        budgetTokens: null,
      }
    case 'code':
      return {
        mode: 'preset',
        level: value.code,
        budgetTokens: null,
      }
  }
}

export function requireNullableRuntimeCanonicalThinkingSelection(
  value: unknown,
  label: string,
): RuntimeCanonicalThinkingSelection | null {
  if (value === null || value === undefined) {
    return null
  }
  return requireRuntimeCanonicalThinkingSelection(value, label)
}

export function requireRuntimeCanonicalThinkingSelection(
  value: unknown,
  label: string,
): RuntimeCanonicalThinkingSelection {
  const record = requireRecord(value, label)
  const kind = requireRuntimeThinkingSelectionKind(record.kind, `${label}.kind`)
  if (kind === 'budget') {
    return {
      kind,
      budgetTokens: requireNonNegativeInteger(record.budgetTokens, `${label}.budgetTokens`),
    }
  }
  return {
    kind,
    value: requireThinkingLevel(record.value, `${label}.value`),
  }
}

export function requireNullableRuntimeThinkingControlSpec(
  value: unknown,
  label: string,
): RuntimeThinkingControlSpec | null {
  if (value === null || value === undefined) {
    return null
  }
  const record = requireRecord(value, label)
  return {
    kind: requireRuntimeThinkingControlKind(record.kind, `${label}.kind`),
    selectionKind: requireRuntimeThinkingSelectionKind(record.selectionKind, `${label}.selectionKind`),
    ...(record.presetOptions === undefined
      ? {}
      : {
          presetOptions: requireRuntimeCanonicalThinkingSelectionArray(
            record.presetOptions,
            `${label}.presetOptions`,
          ),
        }),
    ...(record.fixedSelection === undefined
      ? {}
      : {
          fixedSelection: requireNullableRuntimeCanonicalThinkingSelection(
            record.fixedSelection,
            `${label}.fixedSelection`,
          ),
        }),
    ...(record.budget === undefined
      ? {}
      : {
          budget: requireNullableRuntimeThinkingControlBudgetSpec(record.budget, `${label}.budget`),
        }),
  }
}

export function requireRuntimeCanonicalThinkingSelectionArray(
  value: unknown,
  label: string,
): RuntimeCanonicalThinkingSelection[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`)
  }
  return value.map((item, index) => requireRuntimeCanonicalThinkingSelection(item, `${label}[${index}]`))
}

export function requireNullableRuntimeThinkingControlBudgetSpec(
  value: unknown,
  label: string,
): RuntimeThinkingControlSpec['budget'] {
  if (value === null || value === undefined) {
    return null
  }
  const record = requireRecord(value, label)
  return {
    ...(record.minTokens === undefined ? {} : { minTokens: requireNonNegativeInteger(record.minTokens, `${label}.minTokens`) }),
    ...(record.maxTokens === undefined ? {} : { maxTokens: requireNonNegativeInteger(record.maxTokens, `${label}.maxTokens`) }),
    ...(record.stepTokens === undefined ? {} : { stepTokens: requireNonNegativeInteger(record.stepTokens, `${label}.stepTokens`) }),
  }
}

export function requireNullableRuntimeThinkingCapabilityProvenance(
  value: unknown,
  label: string,
): RuntimeThinkingCapabilityProvenance | null {
  if (value === null || value === undefined) {
    return null
  }
  const record = requireRecord(value, label)
  const override = requireRecord(record.override, `${label}.override`)
  return {
    routeStatus: requireNonEmptyString(record.routeStatus, `${label}.routeStatus`),
    override: {
      present: requireBoolean(override.present, `${label}.override.present`),
      applied: requireBoolean(override.applied, `${label}.override.applied`),
      source: requireNullableString(override.source, `${label}.override.source`),
      format: requireNullableString(override.format, `${label}.override.format`),
    },
  }
}

export function requireNullableRuntimeThinkingVisibility(
  value: unknown,
  label: string,
): RuntimeThinkingVisibility | null {
  if (value === null || value === undefined) {
    return null
  }
  const record = requireRecord(value, label)
  return {
    reasoning: requireNonEmptyString(record.reasoning, `${label}.reasoning`),
    supportsSuppression: requireBoolean(record.supportsSuppression, `${label}.supportsSuppression`),
  }
}

export function requireNullableRuntimeThinkingSelectionResult(
  value: unknown,
  label: string,
): RuntimeThinkingSelectionResult | null {
  if (value === null || value === undefined) {
    return null
  }
  const record = requireRecord(value, label)
  return {
    requestedSelection: requireNullableRuntimeThinkingSelection(record.requestedSelection, `${label}.requestedSelection`),
    appliedSelection: requireNullableRuntimeThinkingSelection(record.appliedSelection, `${label}.appliedSelection`),
    applied: requireBoolean(record.applied, `${label}.applied`),
    reasonCode: requireNonEmptyString(record.reasonCode, `${label}.reasonCode`),
    errorCode: requireNullableString(record.errorCode, `${label}.errorCode`),
    providerBuilderKey: requireNullableString(record.providerBuilderKey, `${label}.providerBuilderKey`),
    mappingReasonCode: requireNullableString(record.mappingReasonCode, `${label}.mappingReasonCode`),
    capabilityStatus: requireRuntimeThinkingCapabilityStatus(record.capabilityStatus, `${label}.capabilityStatus`),
    capabilitySource: requireRuntimeThinkingCapabilitySource(record.capabilitySource, `${label}.capabilitySource`),
    capabilitySeries: requireNullableString(record.capabilitySeries, `${label}.capabilitySeries`),
    capabilitySeriesLabelZh: requireNullableString(record.capabilitySeriesLabelZh, `${label}.capabilitySeriesLabelZh`),
    capabilityReasonCode: requireNullableString(record.capabilityReasonCode, `${label}.capabilityReasonCode`),
    ...(hasOwn(record, 'requestedThinkingLevel')
      ? { requestedThinkingLevel: requireOptionalThinkingLevel(record.requestedThinkingLevel, `${label}.requestedThinkingLevel`) }
      : {}),
    ...(hasOwn(record, 'appliedThinkingLevel')
      ? { appliedThinkingLevel: requireOptionalThinkingLevel(record.appliedThinkingLevel, `${label}.appliedThinkingLevel`) }
      : {}),
    ...(hasOwn(record, 'providerMapping')
      ? { providerMapping: requireNullableString(record.providerMapping, `${label}.providerMapping`) }
      : {}),
    ...(hasOwn(record, 'overridePresent')
      ? { overridePresent: requireBoolean(record.overridePresent, `${label}.overridePresent`) }
      : {}),
    ...(hasOwn(record, 'overrideApplied')
      ? { overrideApplied: requireBoolean(record.overrideApplied, `${label}.overrideApplied`) }
      : {}),
    ...(hasOwn(record, 'overrideSource')
      ? { overrideSource: requireNullableString(record.overrideSource, `${label}.overrideSource`) }
      : {}),
    ...(hasOwn(record, 'reasoningVisibility')
      ? { reasoningVisibility: requireNullableString(record.reasoningVisibility, `${label}.reasoningVisibility`) }
      : {}),
    ...(hasOwn(record, 'supportsSuppression')
      ? { supportsSuppression: requireNullableBoolean(record.supportsSuppression, `${label}.supportsSuppression`) }
      : {}),
    ...(record.modelSettings === undefined
      ? {}
      : { modelSettings: requireRecord(record.modelSettings, `${label}.modelSettings`) }),
  }
}

export function requireNullableRuntimeReasoningSuppressionBasis(
  value: unknown,
  label: string,
): RuntimeReasoningSuppressionBasis | null {
  if (value === null || value === undefined) {
    return null
  }
  const record = requireRecord(value, label)
  const appliedThinkingLevel = hasOwn(record, 'appliedThinkingLevel')
    ? requireOptionalThinkingLevel(record.appliedThinkingLevel, `${label}.appliedThinkingLevel`)
    : undefined
  const appliedThinkingSelection = hasOwn(record, 'appliedThinkingSelection')
    ? requireNullableRuntimeThinkingSelection(record.appliedThinkingSelection, `${label}.appliedThinkingSelection`)
    : null

  return {
    shouldSuppress: requireBoolean(record.shouldSuppress, `${label}.shouldSuppress`),
    source: requireNonEmptyString(record.source, `${label}.source`),
    reasonCode: requireNullableString(record.reasonCode, `${label}.reasonCode`),
    appliedThinkingSelection,
    reasoningVisibility: requireNullableString(record.reasoningVisibility, `${label}.reasoningVisibility`),
    supportsSuppression: requireBoolean(record.supportsSuppression, `${label}.supportsSuppression`),
    capabilitySource: record.capabilitySource === null || record.capabilitySource === undefined
      ? null
      : requireRuntimeThinkingCapabilitySource(record.capabilitySource, `${label}.capabilitySource`),
    capabilitySeries: requireNullableString(record.capabilitySeries, `${label}.capabilitySeries`),
    ...(appliedThinkingLevel === undefined ? {} : { appliedThinkingLevel }),
  }
}

export function requireRuntimeThinkingCapabilityStatus(
  value: unknown,
  label: string,
): RuntimeThinkingCapability['status'] {
  const normalized = requireNonEmptyString(value, label)
  switch (normalized) {
    case 'verified-supported':
    case 'verified-unsupported':
    case 'unknown-without-override':
    case 'unknown-with-override':
      return normalized
    default:
      throw new Error(`${label} must be a supported thinking capability status.`)
  }
}

export function requireRuntimeThinkingCapabilitySource(
  value: unknown,
  label: string,
): RuntimeThinkingCapability['source'] {
  const normalized = requireNonEmptyString(value, label)
  switch (normalized) {
    case 'verified':
    case 'override':
    case 'unknown':
      return normalized
    default:
      throw new Error(`${label} must be a supported thinking capability source.`)
  }
}

export function requireThinkingLevelArray(
  value: unknown,
  label: string,
): RuntimeThinkingLevel[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of thinking levels.`)
  }

  return value.map((item, index) => requireThinkingLevel(item, `${label}[${index}]`))
}

export function requireOptionalThinkingLevel(
  value: unknown,
  label: string,
): RuntimeThinkingLevel | null {
  if (value === null || value === undefined) {
    return null
  }
  return requireThinkingLevel(value, label)
}

export function requireThinkingLevel(
  value: unknown,
  label: string,
): RuntimeThinkingLevel {
  const normalized = requireNonEmptyString(value, label)
  switch (normalized) {
    case 'off':
    case 'auto':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return normalized
    default:
      throw new Error(`${label} must be a supported thinking level.`)
  }
}

export function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean.`)
  }
  return value
}

export function requireNullableBoolean(value: unknown, label: string): boolean | null {
  if (value === null || value === undefined) {
    return null
  }
  return requireBoolean(value, label)
}

export function requireNonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`)
  }
  return value
}

export function requireNullableString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) {
    return null
  }
  return requireString(value, label)
}

export function requireNullableNonNegativeInteger(value: unknown, label: string): number | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer.`)
  }
  return value
}

export function requireRuntimeThinkingControlKind(
  value: unknown,
  label: string,
): RuntimeThinkingControlSpec['kind'] {
  const normalized = requireNonEmptyString(value, label)
  switch (normalized) {
    case 'fixed':
    case 'binary':
    case 'off-auto':
    case 'discrete':
    case 'budget':
      return normalized
    default:
      throw new Error(`${label} must be a supported thinking control kind.`)
  }
}

export function requireRuntimeThinkingSelectionKind(
  value: unknown,
  label: string,
): RuntimeCanonicalThinkingSelection['kind'] {
  const normalized = requireNonEmptyString(value, label)
  switch (normalized) {
    case 'preset':
    case 'budget':
      return normalized
    default:
      throw new Error(`${label} must be a supported thinking selection kind.`)
  }
}

export function requireRuntimeToolEventPhase(value: unknown): RuntimeToolEventPhase {
  const phase = requireNonEmptyString(value, 'runtime event payload.phase')
  switch (phase) {
    case 'started':
    case 'waiting_approval':
    case 'completed':
    case 'failed':
    case 'cancelled':
      return phase
    default:
      throw new Error(`Unsupported runtime tool event phase: ${phase}`)
  }
}

export function requireSequence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error('runtime event.sequence must be a positive integer.')
  }

  return value
}

export function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of strings.`)
  }

  return value.map((item, index) => requireString(item, `${label}[${index}]`))
}

export function requireOptionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined
  }

  return requireString(value, label)
}

export function requireNullableNumber(value: unknown, label: string): number | null {
  if (value === null) {
    return null
  }

  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`${label} must be a number or null.`)
  }

  return value
}

export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }

  return value as Record<string, unknown>
}

export function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`)
  }

  return value
}

export function requireNonEmptyString(value: unknown, label: string): string {
  const normalizedValue = requireString(value, label).trim()
  if (normalizedValue === '') {
    throw new Error(`${label} must be a non-empty string.`)
  }

  return normalizedValue
}
