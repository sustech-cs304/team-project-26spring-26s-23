import type {
  PositiveThinkingLevelIntent,
  ProviderModelProfile,
  ProviderProfile,
  ResolvedThinkingCapability,
  SelectOption,
  StructuredThinkingCapabilityDeclaration,
  ThinkingCapabilityBudgetSeriesInput,
  ThinkingCapabilityDeclaration,
  ThinkingCapabilityDefaultSelection,
  ThinkingCapabilitySeriesId,
  ThinkingCapabilitySeriesInput,
  ThinkingCapabilitySeriesInputKind,
  ThinkingLevelIntent,
  ThinkingSeriesBudgetTemplate,
  ThinkingSeriesBudgetValue,
  ThinkingSeriesCodeValue,
  ThinkingSeriesEditorType,
  ThinkingSeriesFixedValue,
  ThinkingSeriesTemplate,
  ThinkingSeriesValue,
} from './types'
import {
  THINKING_BUDGET_DEFAULT_MAX_TOKENS,
  THINKING_BUDGET_DEFAULT_MIN_TOKENS,
  THINKING_BUDGET_DEFAULT_SELECTION_TOKENS,
  THINKING_BUDGET_DEFAULT_STEP_TOKENS,
  buildThinkingBudgetTemplate,
  normalizeThinkingBudgetAnchorTokens,
} from './thinking-display'

export type ThinkingCapabilityDeclarationMode = 'inherit' | 'unsupported' | 'supported'

type NormalizedSupportedThinkingCapabilityDeclaration = StructuredThinkingCapabilityDeclaration & {
  supported: true
  series: ThinkingCapabilitySeriesId
  template: ThinkingSeriesTemplate
  input: ThinkingCapabilitySeriesInput
  defaultSelection: ThinkingCapabilityDefaultSelection
}

interface ThinkingSeriesPreset {
  id: ThinkingCapabilitySeriesId
  label: string
  hint?: string
  editorType: ThinkingSeriesEditorType
  inputKind: ThinkingCapabilitySeriesInputKind
  template: ThinkingSeriesTemplate
}

const DEFAULT_SERIES_ID = 'openai-6-level-superset-v1'
const UNIFIED_4_LEVEL_SERIES_ID = 'unified-4-level-v1'
const DEFAULT_BUDGET_MIN_TOKENS = THINKING_BUDGET_DEFAULT_MIN_TOKENS
const DEFAULT_BUDGET_MAX_TOKENS = THINKING_BUDGET_DEFAULT_MAX_TOKENS
const DEFAULT_BUDGET_STEP_TOKENS = THINKING_BUDGET_DEFAULT_STEP_TOKENS
const DEFAULT_BUDGET_SELECTION_TOKENS = THINKING_BUDGET_DEFAULT_SELECTION_TOKENS
const DEFAULT_BUDGET_ANCHOR_TOKENS = normalizeThinkingBudgetAnchorTokens(undefined)
const UNIFIED_4_LEVEL_CODE_LABELS: Record<string, string> = {
  none: '无',
  low: '低',
  medium: '中',
  high: '高',
}
const SERIES_ID_ALIASES: Record<string, ThinkingCapabilitySeriesId> = {
  'openai-4-level-none-v1': UNIFIED_4_LEVEL_SERIES_ID,
  'anthropic-adaptive-4-v1': UNIFIED_4_LEVEL_SERIES_ID,
}

const POSITIVE_THINKING_LEVEL_ORDER: PositiveThinkingLevelIntent[] = ['auto', 'low', 'medium', 'high', 'xhigh']
const POSITIVE_THINKING_LEVEL_SET = new Set<PositiveThinkingLevelIntent>(POSITIVE_THINKING_LEVEL_ORDER)

export const THINKING_LEVEL_ORDER: ThinkingLevelIntent[] = ['off', ...POSITIVE_THINKING_LEVEL_ORDER]

export const THINKING_LEVEL_LABELS: Record<ThinkingLevelIntent, string> = {
  off: '无',
  auto: '自动',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
}

export const THINKING_DECLARATION_MODE_OPTIONS: SelectOption[] = [
  { value: 'inherit', label: '跟随内置规则' },
  { value: 'unsupported', label: '显式不支持' },
  { value: 'supported', label: '显式支持' },
]

export const THINKING_LEVEL_OPTIONS: SelectOption[] = THINKING_LEVEL_ORDER.map((level) => ({
  value: level,
  label: THINKING_LEVEL_LABELS[level],
}))

function createCodeValue(code: string, labelZh: string): ThinkingSeriesCodeValue {
  return {
    valueType: 'code',
    code,
    labelZh,
  }
}

function createBudgetValue(
  mode: 'off' | 'dynamic' | 'budget',
  labelZh: string,
  budgetTokens: number | null = null,
): ThinkingSeriesBudgetValue {
  return {
    valueType: 'budget',
    mode,
    budgetTokens,
    labelZh,
  }
}

function createFixedValue(labelZh: string): ThinkingSeriesFixedValue {
  return {
    valueType: 'fixed',
    code: 'fixed',
    labelZh,
  }
}

function createBudgetTemplate(overrides: Partial<ThinkingSeriesBudgetTemplate> = {}): ThinkingSeriesBudgetTemplate {
  return buildThinkingBudgetTemplate({
    minTokens: overrides.minTokens ?? DEFAULT_BUDGET_MIN_TOKENS,
    maxTokens: overrides.maxTokens ?? DEFAULT_BUDGET_MAX_TOKENS,
    stepTokens: overrides.stepTokens ?? DEFAULT_BUDGET_STEP_TOKENS,
    anchorTokens: overrides.anchorTokens ?? [...DEFAULT_BUDGET_ANCHOR_TOKENS],
  })
}

const THINKING_SERIES_PRESETS: ThinkingSeriesPreset[] = [
  {
    id: 'qwen-thinking-switch-v1',
    label: '思考开关',
    hint: '关闭 / 开启',
    editorType: 'discrete',
    inputKind: 'binary',
    template: {
      editorType: 'discrete',
      allowedValues: [
        createCodeValue('false', '关闭'),
        createCodeValue('true', '开启'),
      ],
      defaultValue: createCodeValue('true', '开启'),
    },
  },
  {
    id: 'deepseek-fixed-reasoning-v1',
    label: '固定思考',
    hint: '固定思考，不可调整',
    editorType: 'fixed',
    inputKind: 'fixed',
    template: {
      editorType: 'fixed',
      allowedValues: [createFixedValue('固定推理')],
      defaultValue: createFixedValue('固定推理'),
    },
  },
  {
    id: 'openai-6-level-superset-v1',
    label: '六档思考',
    hint: '无 / 极简 / 低 / 中 / 高 / 超高',
    editorType: 'discrete',
    inputKind: 'discrete',
    template: {
      editorType: 'discrete',
      allowedValues: [
        createCodeValue('none', '无'),
        createCodeValue('minimal', '极简'),
        createCodeValue('low', '低'),
        createCodeValue('medium', '中'),
        createCodeValue('high', '高'),
        createCodeValue('xhigh', '超高'),
      ],
      defaultValue: createCodeValue('medium', '中'),
    },
  },
  {
    id: 'anthropic-adaptive-max-v1',
    label: '五档思考',
    hint: '关闭 / 低 / 中 / 高 / 最大',
    editorType: 'discrete',
    inputKind: 'discrete',
    template: {
      editorType: 'discrete',
      allowedValues: [
        createCodeValue('disabled', '关闭'),
        createCodeValue('low', '低'),
        createCodeValue('medium', '中'),
        createCodeValue('high', '高'),
        createCodeValue('max', '最大'),
      ],
      defaultValue: createCodeValue('medium', '中'),
    },
  },
  {
    id: 'openai-4-level-minimal-v1',
    label: '四档思考（扩展）',
    hint: '极简 / 低 / 中 / 高',
    editorType: 'discrete',
    inputKind: 'discrete',
    template: {
      editorType: 'discrete',
      allowedValues: [
        createCodeValue('minimal', '极简'),
        createCodeValue('low', '低'),
        createCodeValue('medium', '中'),
        createCodeValue('high', '高'),
      ],
      defaultValue: createCodeValue('medium', '中'),
    },
  },
  {
    id: UNIFIED_4_LEVEL_SERIES_ID,
    label: '四档思考',
    hint: '无 / 低 / 中 / 高',
    editorType: 'discrete',
    inputKind: 'discrete',
    template: {
      editorType: 'discrete',
      allowedValues: [
        createCodeValue('none', '无'),
        createCodeValue('low', '低'),
        createCodeValue('medium', '中'),
        createCodeValue('high', '高'),
      ],
      defaultValue: createCodeValue('medium', '中'),
    },
  },
  {
    id: 'openai-3-level-classic-v1',
    label: '三档思考',
    hint: '低 / 中 / 高',
    editorType: 'discrete',
    inputKind: 'discrete',
    template: {
      editorType: 'discrete',
      allowedValues: [
        createCodeValue('low', '低'),
        createCodeValue('medium', '中'),
        createCodeValue('high', '高'),
      ],
      defaultValue: createCodeValue('medium', '中'),
    },
  },
  {
    id: 'anthropic-budget-v1',
    label: '思考预算',
    hint: '关闭 / 预算',
    editorType: 'budget',
    inputKind: 'budget',
    template: {
      editorType: 'budget',
      allowedValues: [
        createBudgetValue('off', '关闭'),
      ],
      defaultValue: createBudgetValue('off', '关闭'),
      budget: createBudgetTemplate(),
    },
  },
  {
    id: 'gemini-2.5-budget-v1',
    label: '动态思考预算',
    hint: '关闭 / 动态 / 预算',
    editorType: 'budget',
    inputKind: 'budget',
    template: {
      editorType: 'budget',
      allowedValues: [
        createBudgetValue('off', '关闭'),
        createBudgetValue('dynamic', '动态'),
      ],
      defaultValue: createBudgetValue('dynamic', '动态'),
      budget: createBudgetTemplate(),
    },
  },
]

const THINKING_SERIES_PRESET_BY_ID = new Map(THINKING_SERIES_PRESETS.map((preset) => [preset.id, preset]))

export const THINKING_SERIES_OPTIONS: SelectOption[] = THINKING_SERIES_PRESETS.map((preset) => ({
  value: preset.id,
  label: preset.label,
  hint: preset.hint,
}))

export const THINKING_BUDGET_DEFAULT_MODE_OPTIONS: SelectOption[] = [
  { value: 'budget', label: '预算' },
  { value: 'dynamic', label: '动态' },
  { value: 'off', label: '关闭' },
]

export function getThinkingCapabilityDeclarationMode(
  declaration: ThinkingCapabilityDeclaration | undefined,
): ThinkingCapabilityDeclarationMode {
  if (declaration === undefined) {
    return 'inherit'
  }

  return declaration.supported ? 'supported' : 'unsupported'
}

export function buildThinkingDeclarationSeriesOptions(currentSeries: string | undefined): SelectOption[] {
  const normalizedCurrentSeries = currentSeries === undefined
    ? undefined
    : normalizeThinkingCapabilitySeries(currentSeries)

  if (!normalizedCurrentSeries || THINKING_SERIES_PRESET_BY_ID.has(normalizedCurrentSeries)) {
    return THINKING_SERIES_OPTIONS
  }

  return [
    ...THINKING_SERIES_OPTIONS,
    {
      value: normalizedCurrentSeries,
      label: '自定义方案',
      hint: '按当前模型设置',
    },
  ]
}

export function getThinkingCapabilityDeclarationSeries(
  declaration: ThinkingCapabilityDeclaration | undefined,
): ThinkingCapabilitySeriesId {
  return initializeSupportedThinkingCapabilityDeclaration(declaration).series
}

export function getThinkingCapabilityDeclarationInputKind(
  declaration: ThinkingCapabilityDeclaration | undefined,
): ThinkingCapabilitySeriesInputKind | null {
  if (declaration?.supported !== true) {
    return null
  }

  return initializeSupportedThinkingCapabilityDeclaration(declaration).input.kind
}

export function getThinkingCapabilityDeclarationTemplate(
  declaration: ThinkingCapabilityDeclaration | undefined,
): ThinkingSeriesTemplate | null {
  if (declaration?.supported !== true) {
    return null
  }

  return cloneThinkingSeriesTemplate(initializeSupportedThinkingCapabilityDeclaration(declaration).template)
}

export function buildThinkingDeclarationDiscreteValueOptions(
  declaration: ThinkingCapabilityDeclaration | undefined,
): SelectOption[] {
  const supported = initializeSupportedThinkingCapabilityDeclaration(declaration)
  return getDiscreteCodeValues(supported.template).map((value) => ({
    value: value.code,
    label: `${value.labelZh}（${value.code}）`,
  }))
}

export function setThinkingCapabilityDeclarationMode(
  declaration: ThinkingCapabilityDeclaration | undefined,
  mode: ThinkingCapabilityDeclarationMode,
): ThinkingCapabilityDeclaration | undefined {
  switch (mode) {
    case 'inherit':
      return undefined
    case 'unsupported': {
      const source = normalizeOptionalString((declaration as StructuredThinkingCapabilityDeclaration | undefined)?.source)
      return {
        supported: false,
        ...(source === undefined ? {} : { source }),
      }
    }
    case 'supported':
      return initializeSupportedThinkingCapabilityDeclaration(declaration)
  }
}

export function initializeSupportedThinkingCapabilityDeclaration(
  declaration: Partial<ThinkingCapabilityDeclaration> | undefined,
): NormalizedSupportedThinkingCapabilityDeclaration {
  const normalized = normalizeThinkingCapabilityDeclaration(declaration)
  if (normalized?.supported === true) {
    return normalized as NormalizedSupportedThinkingCapabilityDeclaration
  }

  return createDefaultSupportedThinkingCapabilityDeclaration()
}

export function setThinkingCapabilityDeclarationSeries(
  declaration: ThinkingCapabilityDeclaration | undefined,
  series: ThinkingCapabilitySeriesId,
): ThinkingCapabilityDeclaration {
  const supported = initializeSupportedThinkingCapabilityDeclaration(declaration)
  return createDefaultSupportedThinkingCapabilityDeclaration(series, supported.source)
}

export function setThinkingCapabilityDeclarationFixedLevel(
  declaration: ThinkingCapabilityDeclaration | undefined,
  level: PositiveThinkingLevelIntent,
): ThinkingCapabilityDeclaration {
  return setThinkingCapabilityDeclarationDefaultLevel(declaration, level)
}

export function setThinkingCapabilityDeclarationBinaryLevel(
  declaration: ThinkingCapabilityDeclaration | undefined,
  level: Exclude<PositiveThinkingLevelIntent, 'auto'>,
): ThinkingCapabilityDeclaration {
  return setThinkingCapabilityDeclarationDefaultLevel(declaration, level)
}

export function toggleThinkingCapabilityDeclarationLevel(
  declaration: ThinkingCapabilityDeclaration | undefined,
  level: PositiveThinkingLevelIntent,
): ThinkingCapabilityDeclaration {
  const supported = initializeSupportedThinkingCapabilityDeclaration(declaration)
  const code = mapLegacyLevelToSeriesCode(level, supported.series)
  if (code === null) {
    return supported
  }

  return toggleThinkingCapabilityDeclarationCodeValue(supported, code)
}

export function toggleThinkingCapabilityDeclarationCodeValue(
  declaration: ThinkingCapabilityDeclaration | undefined,
  code: string,
): ThinkingCapabilityDeclaration {
  const supported = initializeSupportedThinkingCapabilityDeclaration(declaration)
  const normalizedCode = normalizeSeriesCode(supported.series, code)
  const preset = resolveThinkingSeriesPreset(supported.series)
  const presetValues = getDiscreteCodeValues(preset.template)
  const currentValues = getDiscreteCodeValues(supported.template)
  const hasCode = currentValues.some((value) => value.code === normalizedCode)
  const nextValues = hasCode
    ? currentValues.filter((value) => value.code !== normalizedCode)
    : presetValues.filter((value) => currentValues.some((candidate) => candidate.code === value.code) || value.code === normalizedCode)

  const normalizedValues = presetValues.filter((value) => nextValues.some((candidate) => candidate.code === value.code))
  const safeValues = normalizedValues.length > 0 ? normalizedValues : presetValues
  const currentDefaultCode = supported.template.defaultValue?.valueType === 'code'
    ? supported.template.defaultValue.code
    : null
  const nextDefaultValue = safeValues.find((value) => value.code === currentDefaultCode) ?? safeValues[0]

  return buildSupportedDeclaration(
    supported.series,
    {
      ...supported.template,
      editorType: preset.editorType,
      allowedValues: safeValues.map((value) => cloneThinkingSeriesValue(value)!),
      defaultValue: cloneThinkingSeriesValue(nextDefaultValue),
    },
    supported.source,
  )
}

export function setThinkingCapabilityDeclarationDefaultLevel(
  declaration: ThinkingCapabilityDeclaration | undefined,
  defaultLevel: ThinkingLevelIntent,
): ThinkingCapabilityDeclaration {
  const supported = initializeSupportedThinkingCapabilityDeclaration(declaration)
  if (supported.template.editorType === 'budget') {
    return supported
  }

  const code = mapLegacyLevelToSeriesCode(defaultLevel, supported.series)
  if (code === null) {
    return supported
  }

  return setThinkingCapabilityDeclarationDefaultCodeValue(supported, code)
}

export function setThinkingCapabilityDeclarationDefaultCodeValue(
  declaration: ThinkingCapabilityDeclaration | undefined,
  code: string,
): ThinkingCapabilityDeclaration {
  const supported = initializeSupportedThinkingCapabilityDeclaration(declaration)
  const normalizedCode = normalizeSeriesCode(supported.series, code)
  const allowedValues = getDiscreteCodeValues(supported.template)
  const nextDefaultValue = allowedValues.find((value) => value.code === normalizedCode)
  if (!nextDefaultValue) {
    return supported
  }

  return buildSupportedDeclaration(
    supported.series,
    {
      ...supported.template,
      defaultValue: cloneThinkingSeriesValue(nextDefaultValue),
    },
    supported.source,
  )
}

export function setThinkingCapabilityDeclarationBudgetConfig(
  declaration: ThinkingCapabilityDeclaration | undefined,
  patch: Partial<Pick<ThinkingCapabilityBudgetSeriesInput, 'minTokens' | 'maxTokens' | 'stepTokens'>>,
): ThinkingCapabilityDeclaration {
  const supported = initializeSupportedThinkingCapabilityDeclaration(declaration)
  const preset = resolveThinkingSeriesPreset(supported.series)
  const currentBudget = normalizeBudgetTemplate(supported.template.budget ?? preset.template.budget)
  const nextBudget = normalizeBudgetTemplate({
    ...currentBudget,
    ...patch,
  })

  return buildSupportedDeclaration(
    supported.series,
    {
      ...supported.template,
      editorType: 'budget',
      budget: nextBudget,
      defaultValue: normalizeBudgetDefaultValue(supported.template.defaultValue, nextBudget),
    },
    supported.source,
  )
}

export function setThinkingCapabilityDeclarationBudgetDefaultMode(
  declaration: ThinkingCapabilityDeclaration | undefined,
  mode: 'off' | 'budget' | 'dynamic',
): ThinkingCapabilityDeclaration {
  const supported = initializeSupportedThinkingCapabilityDeclaration(declaration)
  const budget = normalizeBudgetTemplate(supported.template.budget)
  let nextDefaultValue: ThinkingSeriesValue

  if (mode === 'budget') {
    nextDefaultValue = createBudgetValue('budget', `${DEFAULT_BUDGET_SELECTION_TOKENS} Tokens`, clampBudgetTokens(DEFAULT_BUDGET_SELECTION_TOKENS, budget))
  } else {
    nextDefaultValue = createBudgetValue(mode, mode === 'dynamic' ? '动态' : '关闭')
  }

  return buildSupportedDeclaration(
    supported.series,
    {
      ...supported.template,
      editorType: 'budget',
      budget,
      defaultValue: nextDefaultValue,
    },
    supported.source,
  )
}

export function setThinkingCapabilityDeclarationBudgetTokens(
  declaration: ThinkingCapabilityDeclaration | undefined,
  budgetTokens: number,
): ThinkingCapabilityDeclaration {
  const supported = initializeSupportedThinkingCapabilityDeclaration(declaration)
  const budget = normalizeBudgetTemplate(supported.template.budget)
  const nextTokens = clampBudgetTokens(budgetTokens, budget)

  return buildSupportedDeclaration(
    supported.series,
    {
      ...supported.template,
      editorType: 'budget',
      budget,
      defaultValue: createBudgetValue('budget', `${nextTokens} Tokens`, nextTokens),
    },
    supported.source,
  )
}

export function buildThinkingDeclarationDefaultLevelOptions(
  declaration: ThinkingCapabilityDeclaration | undefined,
): SelectOption[] {
  return buildThinkingDeclarationDiscreteValueOptions(declaration).map((option) => ({
    value: option.value,
    label: option.label,
  }))
}

export function cloneThinkingCapabilityDeclaration(
  declaration: ThinkingCapabilityDeclaration | undefined,
): ThinkingCapabilityDeclaration | undefined {
  const normalized = normalizeThinkingCapabilityDeclaration(declaration)
  if (normalized === undefined) {
    return undefined
  }

  if (normalized.supported === false) {
    return {
      supported: false,
      ...(normalized.source === undefined ? {} : { source: normalized.source }),
    }
  }

  const supported = normalized as NormalizedSupportedThinkingCapabilityDeclaration
  return {
    supported: true,
    series: supported.series,
    template: cloneThinkingSeriesTemplate(supported.template),
    ...(supported.source === undefined ? {} : { source: supported.source }),
  }
}

export function serializeThinkingCapabilityOverrideInput(
  declaration: ThinkingCapabilityDeclaration | undefined,
): Record<string, unknown> | null {
  const normalized = normalizeThinkingCapabilityDeclaration(declaration)
  if (normalized === undefined) {
    return null
  }

  if (normalized.supported === false) {
    return {
      supported: false,
      ...(normalized.source === undefined ? {} : { source: normalized.source }),
    }
  }

  const supported = normalized as NormalizedSupportedThinkingCapabilityDeclaration

  return {
    supported: true,
    series: supported.series,
    template: serializeThinkingSeriesTemplate(supported.template),
    ...(supported.source === undefined ? {} : { source: supported.source }),
  }
}

export function normalizeThinkingCapabilityDeclaration(
  input: unknown,
): ThinkingCapabilityDeclaration | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return undefined
  }

  const record = input as Record<string, unknown>
  if (typeof record.supported !== 'boolean') {
    return undefined
  }

  const source = normalizeOptionalString(record.source)
  if (record.supported === false) {
    return {
      supported: false,
      ...(source === undefined ? {} : { source }),
    }
  }

  const series = normalizeThinkingCapabilitySeries(normalizeOptionalString(record.series) ?? DEFAULT_SERIES_ID)
  const preset = resolveThinkingSeriesPreset(series)
  const template = record.template !== undefined
    ? normalizeThinkingSeriesTemplate(record.template, preset, series)
    : hydrateThinkingSeriesTemplate(record, preset, series)

  return buildSupportedDeclaration(series, template, source)
}

export function resolveThinkingCapability(input: {
  providerProfile: Pick<ProviderProfile, 'id' | 'protocol' | 'endpoint'>
  modelProfile: Pick<ProviderModelProfile, 'modelId' | 'thinkingCapability'>
}): ResolvedThinkingCapability {
  void input.providerProfile
  void input.modelProfile.modelId

  return resolveExplicitThinkingCapability(input.modelProfile.thinkingCapability) ?? {
    supported: false,
    levels: [],
    defaultLevel: null,
  }
}

export function resolveThinkingLevelIntent(
  capability: ResolvedThinkingCapability,
  value: ThinkingLevelIntent | null | undefined,
): ThinkingLevelIntent | null {
  if (!capability.supported || capability.levels.length === 0) {
    return null
  }

  if (value !== null && value !== undefined && capability.levels.includes(value)) {
    return value
  }

  return capability.defaultLevel
}

export function buildThinkingLevelOptions(capability: ResolvedThinkingCapability): SelectOption[] {
  return capability.levels.map((level) => ({
    value: level,
    label: THINKING_LEVEL_LABELS[level],
  }))
}

function createDefaultSupportedThinkingCapabilityDeclaration(
  series: ThinkingCapabilitySeriesId = DEFAULT_SERIES_ID,
  source?: string,
): NormalizedSupportedThinkingCapabilityDeclaration {
  const normalizedSeries = normalizeThinkingCapabilitySeries(series)
  const preset = resolveThinkingSeriesPreset(normalizedSeries)
  return buildSupportedDeclaration(normalizedSeries, preset.template, source)
}

function buildSupportedDeclaration(
  series: ThinkingCapabilitySeriesId,
  template: ThinkingSeriesTemplate,
  source?: string,
): NormalizedSupportedThinkingCapabilityDeclaration {
  const normalizedSeries = normalizeThinkingCapabilitySeries(series)
  const normalizedTemplate = normalizeThinkingSeriesTemplate(
    template,
    resolveThinkingSeriesPreset(normalizedSeries),
    normalizedSeries,
  )
  return {
    supported: true,
    series: normalizedSeries,
    template: normalizedTemplate,
    input: deriveLegacyInputFromTemplate(normalizedSeries, normalizedTemplate),
    defaultSelection: deriveLegacyDefaultSelectionFromTemplate(normalizedTemplate),
    ...(source === undefined ? {} : { source }),
  }
}

function hydrateThinkingSeriesTemplate(
  record: Record<string, unknown>,
  preset: ThinkingSeriesPreset,
  series: ThinkingCapabilitySeriesId,
): ThinkingSeriesTemplate {
  void series
  if (record.input === undefined && record.defaultSelection === undefined && record.levels === undefined) {
    return cloneThinkingSeriesTemplate(preset.template)
  }

  if (preset.editorType === 'budget') {
    const inputRecord = asRecord(record.input)
    const budget = normalizeBudgetTemplate({
      minTokens: normalizeNonNegativeInteger(inputRecord.minTokens) ?? preset.template.budget?.minTokens,
      maxTokens: normalizeNonNegativeInteger(inputRecord.maxTokens) ?? preset.template.budget?.maxTokens,
      stepTokens: normalizeNonNegativeInteger(inputRecord.stepTokens) ?? preset.template.budget?.stepTokens,
      anchorTokens: preset.template.budget?.anchorTokens,
    })
    const defaultSelection = asRecord(record.defaultSelection)
    const defaultMode = normalizeOptionalString(defaultSelection.mode)
    if (defaultMode === 'budget') {
      const budgetTokens = clampBudgetTokens(
        normalizeNonNegativeInteger(defaultSelection.budgetTokens) ?? DEFAULT_BUDGET_SELECTION_TOKENS,
        budget,
      )
      return {
        editorType: 'budget',
        allowedValues: cloneThinkingSeriesValues(preset.template.allowedValues),
        defaultValue: createBudgetValue('budget', `${budgetTokens} Tokens`, budgetTokens),
        budget,
      }
    }
    if (defaultMode === 'dynamic') {
      return {
        editorType: 'budget',
        allowedValues: cloneThinkingSeriesValues(preset.template.allowedValues),
        defaultValue: createBudgetValue('dynamic', '动态'),
        budget,
      }
    }
    return {
      editorType: 'budget',
      allowedValues: cloneThinkingSeriesValues(preset.template.allowedValues),
      defaultValue: createBudgetValue('off', '关闭'),
      budget,
    }
  }

  const allowedLevels = normalizeLegacyLevelsFromRecord(record)
  const discretePresetValues = getDiscreteCodeValues(preset.template)
  const nextAllowedValues = allowedLevels.length === 0
    ? discretePresetValues
    : discretePresetValues.filter((value) => {
      const mapped = mapSeriesCodeToLegacyLevel(value.code)
      return mapped !== null && allowedLevels.includes(mapped)
    })
  const safeAllowedValues = nextAllowedValues.length > 0 ? nextAllowedValues : discretePresetValues
  const defaultSelection = asRecord(record.defaultSelection)
  const defaultLevel = normalizeThinkingLevelIntent(defaultSelection.level ?? record.defaultLevel)
  const nextDefaultValue = defaultLevel === undefined
    ? safeAllowedValues[0] ?? discretePresetValues[0] ?? preset.template.defaultValue
    : safeAllowedValues.find((value) => mapSeriesCodeToLegacyLevel(value.code) === defaultLevel)
      ?? safeAllowedValues[0]
      ?? discretePresetValues[0]
      ?? preset.template.defaultValue

  return {
    editorType: preset.editorType,
    allowedValues: safeAllowedValues.map((value) => cloneThinkingSeriesValue(value)!),
    defaultValue: cloneThinkingSeriesValue(nextDefaultValue),
  }
}

function normalizeLegacyLevelsFromRecord(record: Record<string, unknown>): ThinkingLevelIntent[] {
  const inputRecord = asRecord(record.input)
  const inputKind = normalizeThinkingSeriesInputKind(inputRecord.kind)
  switch (inputKind) {
    case 'fixed': {
      const level = normalizePositiveThinkingLevelIntent(inputRecord.level)
      return level === undefined ? [] : [level]
    }
    case 'binary': {
      const level = normalizePositiveThinkingLevelIntent(inputRecord.enabledLevel)
      return level === undefined ? ['off'] : ['off', level]
    }
    case 'off-auto':
      return ['off', 'auto']
    case 'discrete':
      return ['off', ...normalizePositiveThinkingLevels(inputRecord.levels)]
    case 'budget':
      return ['off']
    default:
      return ['off', ...normalizePositiveThinkingLevels(record.levels)]
  }
}

function normalizeThinkingSeriesTemplate(
  value: unknown,
  preset: ThinkingSeriesPreset,
  series: ThinkingCapabilitySeriesId,
): ThinkingSeriesTemplate {
  const record = asRecord(value)
  const editorType = normalizeThinkingSeriesEditorType(record.editorType) ?? preset.editorType
  if (editorType === 'budget') {
    const budget = normalizeBudgetTemplate(record.budget ?? preset.template.budget)
    const allowedValues = normalizeBudgetAllowedValues(record.allowedValues, preset.template.allowedValues)
    const defaultValue = normalizeBudgetTemplateDefaultValue(record.defaultValue, budget, allowedValues)
    return {
      editorType,
      allowedValues,
      defaultValue,
      budget,
    }
  }

  if (editorType === 'fixed') {
    const fixedValue = normalizeFixedValue(record.defaultValue) ?? normalizeFixedValue(preset.template.defaultValue) ?? createFixedValue('固定推理')
    return {
      editorType,
      allowedValues: [fixedValue],
      defaultValue: fixedValue,
    }
  }

  const allowedValues = normalizeDiscreteAllowedValues(record.allowedValues, preset.template.allowedValues, series)
  const defaultValue = normalizeDiscreteDefaultValue(record.defaultValue, allowedValues, series)
  return {
    editorType,
    allowedValues,
    defaultValue,
  }
}

function normalizeDiscreteAllowedValues(
  value: unknown,
  fallback: ThinkingSeriesTemplate['allowedValues'],
  series: ThinkingCapabilitySeriesId,
): ThinkingSeriesValue[] {
  const fallbackValues = normalizeDiscreteSeriesValues(
    series,
    getDiscreteCodeValues({ allowedValues: fallback, defaultValue: null }),
  )
  if (!Array.isArray(value)) {
    return fallbackValues.map((item) => cloneThinkingSeriesValue(item)!)
  }

  const parsed = normalizeDiscreteSeriesValues(
    series,
    value
      .map((entry) => normalizeCodeValue(entry))
      .filter((entry): entry is Extract<ThinkingSeriesValue, { valueType: 'code' }> => entry !== null),
  )

  return parsed.length > 0 ? parsed : fallbackValues.map((item) => cloneThinkingSeriesValue(item)!)
}

function normalizeBudgetAllowedValues(
  value: unknown,
  fallback: ThinkingSeriesTemplate['allowedValues'],
): ThinkingSeriesValue[] {
  const fallbackValues = Array.isArray(fallback)
    ? fallback.map((item) => cloneThinkingSeriesValue(item)).filter((item): item is ThinkingSeriesValue => item !== null)
    : []
  if (!Array.isArray(value)) {
    return fallbackValues
  }

  const parsed = value
    .map((entry) => normalizeBudgetModeValue(entry))
    .filter((entry): entry is Extract<ThinkingSeriesValue, { valueType: 'budget' }> => entry !== null)

  return parsed.length > 0 ? parsed : fallbackValues
}

function normalizeDiscreteDefaultValue(
  value: unknown,
  allowedValues: ThinkingSeriesValue[],
  series: ThinkingCapabilitySeriesId,
): ThinkingSeriesValue {
  const parsed = normalizeCodeValueForSeries(series, normalizeCodeValue(value))
  if (parsed !== null && allowedValues.some((candidate) => candidate.valueType === 'code' && candidate.code === parsed.code)) {
    return parsed
  }

  return cloneThinkingSeriesValue(allowedValues[0]) ?? createCodeValue('medium', '中')
}

function normalizeBudgetTemplateDefaultValue(
  value: unknown,
  budget: ThinkingSeriesBudgetTemplate,
  allowedValues: ThinkingSeriesValue[],
): ThinkingSeriesValue {
  const parsed = normalizeBudgetTemplateDefaultValueInternal(value, budget)
  if (parsed !== null) {
    return parsed
  }

  const preferred = allowedValues.find((candidate) => candidate.valueType === 'budget' && candidate.mode === 'dynamic')
    ?? allowedValues.find((candidate) => candidate.valueType === 'budget' && candidate.mode === 'off')
  return cloneThinkingSeriesValue(preferred) ?? createBudgetValue('off', '关闭')
}

function normalizeBudgetTemplateDefaultValueInternal(
  value: unknown,
  budget: ThinkingSeriesBudgetTemplate,
): ThinkingSeriesValue | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  if (record.valueType === 'budget') {
    const mode = normalizeBudgetMode(record.mode)
    if (mode === null) {
      return null
    }
    if (mode === 'budget') {
      const budgetTokens = normalizeNonNegativeInteger(record.budgetTokens)
      if (budgetTokens === undefined) {
        return null
      }
      const clamped = clampBudgetTokens(budgetTokens, budget)
      return createBudgetValue('budget', `${clamped} Tokens`, clamped)
    }
    return createBudgetValue(mode, mode === 'dynamic' ? '动态' : '关闭')
  }

  const mode = normalizeOptionalString(record.mode)
  if (mode === 'budget') {
    const budgetTokens = normalizeNonNegativeInteger(record.budgetTokens)
    if (budgetTokens === undefined) {
      return null
    }
    const clamped = clampBudgetTokens(budgetTokens, budget)
    return createBudgetValue('budget', `${clamped} Tokens`, clamped)
  }
  if (mode === 'dynamic' || mode === 'off') {
    return createBudgetValue(mode, mode === 'dynamic' ? '动态' : '关闭')
  }

  return null
}

function normalizeBudgetDefaultValue(
  value: ThinkingSeriesValue | null | undefined,
  budget: ThinkingSeriesBudgetTemplate,
): ThinkingSeriesValue {
  if (value?.valueType === 'budget') {
    if (value.mode === 'budget') {
      const nextTokens = clampBudgetTokens(value.budgetTokens ?? DEFAULT_BUDGET_SELECTION_TOKENS, budget)
      return createBudgetValue('budget', `${nextTokens} Tokens`, nextTokens)
    }
    return cloneThinkingSeriesValue(value) ?? createBudgetValue('off', '关闭')
  }

  return createBudgetValue('off', '关闭')
}

function normalizeBudgetTemplate(value: unknown): ThinkingSeriesBudgetTemplate {
  const record = asRecord(value)
  const minTokens = normalizeNonNegativeInteger(record.minTokens) ?? DEFAULT_BUDGET_MIN_TOKENS
  const maxCandidate = normalizeNonNegativeInteger(record.maxTokens) ?? DEFAULT_BUDGET_MAX_TOKENS
  const maxTokens = Math.max(minTokens, maxCandidate)
  const stepCandidate = normalizeNonNegativeInteger(record.stepTokens) ?? DEFAULT_BUDGET_STEP_TOKENS
  const stepTokens = stepCandidate > 0 ? stepCandidate : DEFAULT_BUDGET_STEP_TOKENS

  return buildThinkingBudgetTemplate({
    minTokens,
    maxTokens,
    stepTokens,
    anchorTokens: Array.isArray(record.anchorTokens)
      ? record.anchorTokens
          .map((entry) => normalizeNonNegativeInteger(entry))
          .filter((entry): entry is number => entry !== undefined)
      : [...DEFAULT_BUDGET_ANCHOR_TOKENS],
  })
}

function resolveExplicitThinkingCapability(
  declaration: ThinkingCapabilityDeclaration | undefined,
): ResolvedThinkingCapability | null {
  const normalized = normalizeThinkingCapabilityDeclaration(declaration)
  if (normalized === undefined) {
    return null
  }

  if (normalized.supported === false) {
    return {
      supported: false,
      levels: [],
      defaultLevel: null,
    }
  }

  const supported = normalized as NormalizedSupportedThinkingCapabilityDeclaration
  const levels = deriveLegacyLevelsFromTemplate(supported.template)
  if (levels.length === 0) {
    return {
      supported: false,
      levels: [],
      defaultLevel: null,
    }
  }

  return {
    supported: true,
    levels,
    defaultLevel: deriveLegacyDefaultLevelFromTemplate(supported.template),
  }
}

function deriveLegacyLevelsFromTemplate(template: ThinkingSeriesTemplate): ThinkingLevelIntent[] {
  if (template.editorType === 'budget') {
    return ['off']
  }

  if (template.editorType === 'fixed') {
    return ['high']
  }

  const mappedLevels = getDiscreteCodeValues(template)
    .map((value) => mapSeriesCodeToLegacyLevel(value.code))
    .filter((value): value is ThinkingLevelIntent => value !== null)

  return THINKING_LEVEL_ORDER.filter((level) => mappedLevels.includes(level))
}

function deriveLegacyDefaultLevelFromTemplate(template: ThinkingSeriesTemplate): ThinkingLevelIntent | null {
  if (template.defaultValue?.valueType === 'code') {
    return mapSeriesCodeToLegacyLevel(template.defaultValue.code)
  }
  if (template.defaultValue?.valueType === 'budget') {
    return template.defaultValue.mode === 'off' ? 'off' : 'auto'
  }
  if (template.defaultValue?.valueType === 'fixed') {
    return 'high'
  }
  return null
}

function deriveLegacyInputFromTemplate(
  series: ThinkingCapabilitySeriesId,
  template: ThinkingSeriesTemplate,
): ThinkingCapabilitySeriesInput {
  if (template.editorType === 'budget') {
    const budget = normalizeBudgetTemplate(template.budget)
    return {
      kind: 'budget',
      minTokens: budget.minTokens,
      maxTokens: budget.maxTokens,
      stepTokens: budget.stepTokens,
    }
  }

  if (template.editorType === 'fixed') {
    return {
      kind: 'fixed',
      level: 'high',
    }
  }

  const preset = resolveThinkingSeriesPreset(series)
  const legacyLevels = deriveLegacyLevelsFromTemplate(template)
  if (preset.inputKind === 'binary') {
    return {
      kind: 'binary',
      enabledLevel: legacyLevels.find((level) => level !== 'off' && level !== 'auto') as Exclude<PositiveThinkingLevelIntent, 'auto'> ?? 'high',
    }
  }
  if (legacyLevels.length === 2 && legacyLevels[0] === 'off' && legacyLevels[1] === 'auto') {
    return { kind: 'off-auto' }
  }
  const positiveLevels = legacyLevels.filter((level): level is PositiveThinkingLevelIntent => level !== 'off')
  return {
    kind: 'discrete',
    levels: positiveLevels.length > 0 ? positiveLevels : ['auto', 'low', 'medium', 'high'],
  }
}

function deriveLegacyDefaultSelectionFromTemplate(template: ThinkingSeriesTemplate): ThinkingCapabilityDefaultSelection {
  if (template.defaultValue?.valueType === 'budget' && template.defaultValue.mode === 'budget') {
    return {
      mode: 'budget',
      budgetTokens: template.defaultValue.budgetTokens ?? DEFAULT_BUDGET_SELECTION_TOKENS,
    }
  }

  return {
    mode: 'preset',
    level: deriveLegacyDefaultLevelFromTemplate(template) ?? 'off',
  }
}

function getDiscreteCodeValues(template: Pick<ThinkingSeriesTemplate, 'allowedValues' | 'defaultValue'>): Extract<ThinkingSeriesValue, { valueType: 'code' }>[] {
  const allowedValues = Array.isArray(template.allowedValues) ? template.allowedValues : []
  const codeValues = allowedValues.filter((value): value is Extract<ThinkingSeriesValue, { valueType: 'code' }> => value.valueType === 'code')
  if (codeValues.length > 0) {
    return codeValues
  }

  return template.defaultValue?.valueType === 'code' ? [template.defaultValue] : []
}

function normalizeCodeValue(value: unknown): Extract<ThinkingSeriesValue, { valueType: 'code' }> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const code = normalizeOptionalString(record.code)
  const labelZh = normalizeOptionalString(record.labelZh)
  if (record.valueType !== 'code' || code === undefined || labelZh === undefined) {
    return null
  }

  return createCodeValue(code, labelZh)
}

function normalizeBudgetModeValue(value: unknown): Extract<ThinkingSeriesValue, { valueType: 'budget' }> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const mode = normalizeBudgetMode(record.mode)
  const labelZh = normalizeOptionalString(record.labelZh)
  if (record.valueType !== 'budget' || mode === null || labelZh === undefined) {
    return null
  }
  if (mode === 'budget') {
    const budgetTokens = normalizeNonNegativeInteger(record.budgetTokens)
    if (budgetTokens === undefined) {
      return null
    }
    return createBudgetValue('budget', labelZh, budgetTokens)
  }
  return createBudgetValue(mode, labelZh)
}

function normalizeFixedValue(value: unknown): Extract<ThinkingSeriesValue, { valueType: 'fixed' }> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const labelZh = normalizeOptionalString(record.labelZh)
  if (record.valueType !== 'fixed' || record.code !== 'fixed' || labelZh === undefined) {
    return null
  }

  return createFixedValue(labelZh)
}

function serializeThinkingSeriesTemplate(template: ThinkingSeriesTemplate): Record<string, unknown> {
  return {
    ...(template.editorType === undefined ? {} : { editorType: template.editorType }),
    defaultValue: serializeThinkingSeriesValue(template.defaultValue),
    ...(template.allowedValues === undefined
      ? {}
      : {
          allowedValues: template.allowedValues.map((value) => serializeThinkingSeriesValue(value)),
        }),
    ...(template.budget === undefined ? {} : {
      budget: {
        minTokens: template.budget.minTokens,
        maxTokens: template.budget.maxTokens,
        stepTokens: template.budget.stepTokens,
        anchorTokens: [...template.budget.anchorTokens],
      },
    }),
  }
}

function serializeThinkingSeriesValue(value: ThinkingSeriesValue | null): Record<string, unknown> | null {
  if (value === null) {
    return null
  }

  switch (value.valueType) {
    case 'code':
      return {
        valueType: 'code',
        code: value.code,
        labelZh: value.labelZh,
      }
    case 'budget':
      return {
        valueType: 'budget',
        mode: value.mode,
        budgetTokens: value.budgetTokens,
        labelZh: value.labelZh,
      }
    case 'fixed':
      return {
        valueType: 'fixed',
        code: 'fixed',
        labelZh: value.labelZh,
      }
  }
}

function resolveThinkingSeriesPreset(series: ThinkingCapabilitySeriesId): ThinkingSeriesPreset {
  const normalizedSeries = normalizeThinkingCapabilitySeries(series)
  return THINKING_SERIES_PRESET_BY_ID.get(normalizedSeries) ?? THINKING_SERIES_PRESET_BY_ID.get(DEFAULT_SERIES_ID)!
}

function normalizeThinkingSeriesEditorType(value: unknown): ThinkingSeriesEditorType | undefined {
  if (value === 'discrete' || value === 'budget' || value === 'fixed') {
    return value
  }
  return undefined
}

function cloneThinkingSeriesTemplate(template: ThinkingSeriesTemplate): ThinkingSeriesTemplate {
  return {
    ...(template.editorType === undefined ? {} : { editorType: template.editorType }),
    defaultValue: cloneThinkingSeriesValue(template.defaultValue),
    ...(template.allowedValues === undefined ? {} : { allowedValues: cloneThinkingSeriesValues(template.allowedValues) }),
    ...(template.budget === undefined ? {} : {
      budget: {
        minTokens: template.budget.minTokens,
        maxTokens: template.budget.maxTokens,
        stepTokens: template.budget.stepTokens,
        anchorTokens: [...template.budget.anchorTokens],
      },
    }),
  }
}

function cloneThinkingSeriesValues(values: ThinkingSeriesValue[] | undefined): ThinkingSeriesValue[] | undefined {
  return values?.map((value) => cloneThinkingSeriesValue(value)).filter((value): value is ThinkingSeriesValue => value !== null)
}

function cloneThinkingSeriesValue(value: ThinkingSeriesValue | null | undefined): ThinkingSeriesValue | null {
  if (value == null) {
    return null
  }

  switch (value.valueType) {
    case 'code':
      return createCodeValue(value.code, value.labelZh)
    case 'budget':
      return createBudgetValue(value.mode, value.labelZh, value.budgetTokens)
    case 'fixed':
      return createFixedValue(value.labelZh)
  }
}

function normalizeThinkingCapabilitySeries(series: ThinkingCapabilitySeriesId): ThinkingCapabilitySeriesId {
  return SERIES_ID_ALIASES[series] ?? series
}

function normalizeSeriesCode(series: ThinkingCapabilitySeriesId, code: string): string {
  const normalizedSeries = normalizeThinkingCapabilitySeries(series)
  const normalizedCode = normalizeIdentifier(code)
  if (normalizedSeries === UNIFIED_4_LEVEL_SERIES_ID && (normalizedCode === 'disabled' || normalizedCode === 'off')) {
    return 'none'
  }
  return normalizedCode
}

function normalizeCodeValueForSeries(
  series: ThinkingCapabilitySeriesId,
  value: Extract<ThinkingSeriesValue, { valueType: 'code' }> | null,
): Extract<ThinkingSeriesValue, { valueType: 'code' }> | null {
  if (value === null) {
    return null
  }

  const normalizedSeries = normalizeThinkingCapabilitySeries(series)
  const normalizedCode = normalizeSeriesCode(normalizedSeries, value.code)
  if (normalizedSeries !== UNIFIED_4_LEVEL_SERIES_ID) {
    return createCodeValue(normalizedCode, value.labelZh)
  }

  return createCodeValue(
    normalizedCode,
    UNIFIED_4_LEVEL_CODE_LABELS[normalizedCode] ?? value.labelZh,
  )
}

function normalizeDiscreteSeriesValues(
  series: ThinkingCapabilitySeriesId,
  values: Extract<ThinkingSeriesValue, { valueType: 'code' }>[],
): Extract<ThinkingSeriesValue, { valueType: 'code' }>[] {
  const normalizedValues = values
    .map((value) => normalizeCodeValueForSeries(series, value))
    .filter((value): value is Extract<ThinkingSeriesValue, { valueType: 'code' }> => value !== null)

  if (normalizeThinkingCapabilitySeries(series) !== UNIFIED_4_LEVEL_SERIES_ID) {
    return normalizedValues
  }

  const deduped = new Map<string, Extract<ThinkingSeriesValue, { valueType: 'code' }>>()
  normalizedValues.forEach((value) => {
    if (!deduped.has(value.code)) {
      deduped.set(value.code, value)
    }
  })
  return Array.from(deduped.values())
}

function mapSeriesCodeToLegacyLevel(code: string): ThinkingLevelIntent | null {
  switch (normalizeIdentifier(code)) {
    case 'none':
    case 'off':
    case 'disabled':
    case 'false':
      return 'off'
    case 'minimal':
    case 'dynamic':
      return 'auto'
    case 'low':
      return 'low'
    case 'medium':
      return 'medium'
    case 'high':
    case 'true':
    case 'enabled':
      return 'high'
    case 'max':
    case 'xhigh':
      return 'xhigh'
    default:
      return null
  }
}

function mapLegacyLevelToSeriesCode(
  level: ThinkingLevelIntent,
  series: ThinkingCapabilitySeriesId,
): string | null {
  const preset = resolveThinkingSeriesPreset(series)
  const discreteValues = getDiscreteCodeValues(preset.template)
  const exact = discreteValues.find((value) => mapSeriesCodeToLegacyLevel(value.code) === level)
  return exact?.code ?? null
}

function normalizeBudgetMode(value: unknown): 'off' | 'dynamic' | 'budget' | null {
  return value === 'off' || value === 'dynamic' || value === 'budget' ? value : null
}

function normalizeThinkingSeriesInputKind(value: unknown): ThinkingCapabilitySeriesInputKind | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = normalizeIdentifier(value)
  switch (normalized) {
    case 'fixed':
    case 'binary':
    case 'off-auto':
    case 'discrete':
    case 'budget':
      return normalized
    default:
      return undefined
  }
}

function normalizePositiveThinkingLevels(input: unknown): PositiveThinkingLevelIntent[] {
  if (!Array.isArray(input)) {
    return []
  }

  const normalized = input
    .map((value) => normalizePositiveThinkingLevelIntent(value))
    .filter((value): value is PositiveThinkingLevelIntent => value !== undefined && POSITIVE_THINKING_LEVEL_SET.has(value))

  return POSITIVE_THINKING_LEVEL_ORDER.filter((level) => normalized.includes(level))
}

function normalizePositiveThinkingLevelIntent(value: unknown): PositiveThinkingLevelIntent | undefined {
  const normalized = normalizeThinkingLevelIntent(value)
  if (normalized === undefined || normalized === 'off') {
    return undefined
  }
  return normalized
}

function normalizeThinkingLevelIntent(value: unknown): ThinkingLevelIntent | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = normalizeIdentifier(value)
  return THINKING_LEVEL_ORDER.find((candidate) => candidate === normalized)
}

function clampBudgetTokens(value: number, budget: ThinkingSeriesBudgetTemplate): number {
  const lowerBoundedValue = Math.max(budget.minTokens, Math.trunc(value))
  const upperBoundedValue = Math.min(budget.maxTokens, lowerBoundedValue)
  const step = budget.stepTokens > 0 ? budget.stepTokens : 1
  const snappedValue = budget.minTokens + Math.round((upperBoundedValue - budget.minTokens) / step) * step
  return Math.min(budget.maxTokens, Math.max(budget.minTokens, snappedValue))
}

function normalizeNonNegativeInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim()
  return normalized === '' ? undefined : normalized
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase()
}
