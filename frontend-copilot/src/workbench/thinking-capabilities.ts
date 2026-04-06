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
} from './types'

export type ThinkingCapabilityDeclarationMode = 'inherit' | 'unsupported' | 'supported'

type NormalizedSupportedThinkingCapabilityDeclaration = StructuredThinkingCapabilityDeclaration & {
  supported: true
  series: ThinkingCapabilitySeriesId
  input: ThinkingCapabilitySeriesInput
  defaultSelection: ThinkingCapabilityDefaultSelection
}

interface ThinkingSeriesPreset {
  id: ThinkingCapabilitySeriesId
  kind: ThinkingCapabilitySeriesInputKind
  label: string
  hint?: string
}

const DEFAULT_FIXED_SERIES_ID = 'compat-fixed-reasoning-v1'
const DEFAULT_BINARY_SERIES_ID = 'compat-binary-toggle-v1'
const DEFAULT_OFF_AUTO_SERIES_ID = 'compat-off-auto-v1'
const DEFAULT_DISCRETE_SERIES_ID = 'compat-discrete-levels-v1'
const DEFAULT_BUDGET_SERIES_ID = 'compat-budget-tokens-v1'
const DEFAULT_FIXED_LEVEL: PositiveThinkingLevelIntent = 'auto'
const DEFAULT_BINARY_LEVEL: PositiveThinkingLevelIntent = 'high'
const DEFAULT_DISCRETE_LEVELS: PositiveThinkingLevelIntent[] = ['auto', 'low', 'medium', 'high']
const DEFAULT_BUDGET_MIN_TOKENS = 0
const DEFAULT_BUDGET_MAX_TOKENS = 32768
const DEFAULT_BUDGET_STEP_TOKENS = 1024
const DEFAULT_BUDGET_SELECTION_TOKENS = 8192

const THINKING_SERIES_PRESETS: ThinkingSeriesPreset[] = [
  {
    id: DEFAULT_FIXED_SERIES_ID,
    kind: 'fixed',
    label: '固定推理',
    hint: '单一固定挡位',
  },
  {
    id: DEFAULT_BINARY_SERIES_ID,
    kind: 'binary',
    label: '二值开关',
    hint: '关闭 / 开启',
  },
  {
    id: DEFAULT_OFF_AUTO_SERIES_ID,
    kind: 'off-auto',
    label: '关闭 + 自动',
    hint: '关闭 / 自动',
  },
  {
    id: DEFAULT_DISCRETE_SERIES_ID,
    kind: 'discrete',
    label: '离散多档',
    hint: '多个预设挡位',
  },
  {
    id: DEFAULT_BUDGET_SERIES_ID,
    kind: 'budget',
    label: '推理预算',
    hint: '连续 Token 预算',
  },
]

const THINKING_SERIES_PRESET_BY_ID = new Map(THINKING_SERIES_PRESETS.map((preset) => [preset.id, preset]))
const THINKING_SERIES_PRESET_BY_KIND = new Map(THINKING_SERIES_PRESETS.map((preset) => [preset.kind, preset]))

const POSITIVE_THINKING_LEVEL_ORDER: PositiveThinkingLevelIntent[] = [
  'auto',
  'low',
  'medium',
  'high',
  'xhigh',
]

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

export const THINKING_SERIES_OPTIONS: SelectOption[] = THINKING_SERIES_PRESETS.map((preset) => ({
  value: preset.id,
  label: preset.label,
  hint: preset.hint,
}))

export const THINKING_BUDGET_DEFAULT_MODE_OPTIONS: SelectOption[] = [
  { value: 'budget', label: '预算' },
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
  if (!currentSeries || THINKING_SERIES_PRESET_BY_ID.has(currentSeries)) {
    return THINKING_SERIES_OPTIONS
  }

  return [
    ...THINKING_SERIES_OPTIONS,
    {
      value: currentSeries,
      label: currentSeries,
      hint: '自定义系列',
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
  const supported = initializeSupportedThinkingCapabilityDeclaration(declaration)
  const nextDeclaration: NormalizedSupportedThinkingCapabilityDeclaration = {
    ...supported,
    series: resolveSeriesForInputKind(supported, 'fixed'),
    input: {
      kind: 'fixed',
      level,
    },
    defaultSelection: {
      mode: 'preset',
      level,
    },
  }

  return nextDeclaration
}

export function setThinkingCapabilityDeclarationBinaryLevel(
  declaration: ThinkingCapabilityDeclaration | undefined,
  level: Exclude<PositiveThinkingLevelIntent, 'auto'>,
): ThinkingCapabilityDeclaration {
  const supported = initializeSupportedThinkingCapabilityDeclaration(declaration)
  const nextInput: ThinkingCapabilitySeriesInput = {
    kind: 'binary',
    enabledLevel: level,
  }

  return {
    ...supported,
    series: resolveSeriesForInputKind(supported, 'binary'),
    input: nextInput,
    defaultSelection: normalizeDefaultSelectionForInput(supported.defaultSelection, nextInput),
  }
}

export function toggleThinkingCapabilityDeclarationLevel(
  declaration: ThinkingCapabilityDeclaration | undefined,
  level: PositiveThinkingLevelIntent,
): ThinkingCapabilityDeclaration {
  const supported = initializeSupportedThinkingCapabilityDeclaration(declaration)
  const currentInput = supported.input.kind === 'discrete'
    ? supported.input
    : {
      kind: 'discrete' as const,
      levels: [...DEFAULT_DISCRETE_LEVELS],
    }
  const currentLevels = normalizePositiveThinkingLevels(currentInput.levels)
  const nextLevels = currentLevels.includes(level)
    ? currentLevels.length === 1
      ? currentLevels
      : currentLevels.filter((item) => item !== level)
    : [...currentLevels, level]
  const nextInput: ThinkingCapabilitySeriesInput = {
    kind: 'discrete',
    levels: POSITIVE_THINKING_LEVEL_ORDER.filter((item) => nextLevels.includes(item)),
  }

  return {
    ...supported,
    series: resolveSeriesForInputKind(supported, 'discrete'),
    input: nextInput,
    defaultSelection: normalizeDefaultSelectionForInput(supported.defaultSelection, nextInput),
  }
}

export function setThinkingCapabilityDeclarationDefaultLevel(
  declaration: ThinkingCapabilityDeclaration | undefined,
  defaultLevel: ThinkingLevelIntent,
): ThinkingCapabilityDeclaration {
  const supported = initializeSupportedThinkingCapabilityDeclaration(declaration)
  if (supported.input.kind === 'budget') {
    return supported
  }

  const allowedLevels = getAllowedPresetLevelsForInput(supported.input)
  const nextLevel = allowedLevels.includes(defaultLevel)
    ? defaultLevel
    : resolveFallbackPresetLevel(supported.input)

  return {
    ...supported,
    defaultSelection: {
      mode: 'preset',
      level: nextLevel,
    },
  }
}

export function setThinkingCapabilityDeclarationBudgetConfig(
  declaration: ThinkingCapabilityDeclaration | undefined,
  patch: Partial<Pick<ThinkingCapabilityBudgetSeriesInput, 'minTokens' | 'maxTokens' | 'stepTokens'>>,
): ThinkingCapabilityDeclaration {
  const supported = initializeSupportedThinkingCapabilityDeclaration(declaration)
  const currentBudgetInput = supported.input.kind === 'budget'
    ? supported.input
    : createDefaultBudgetSeriesInput()
  const nextInput = normalizeBudgetSeriesInput({
    ...currentBudgetInput,
    ...patch,
  })

  return {
    ...supported,
    series: resolveSeriesForInputKind(supported, 'budget'),
    input: nextInput,
    defaultSelection: normalizeDefaultSelectionForInput(supported.defaultSelection, nextInput),
  }
}

export function setThinkingCapabilityDeclarationBudgetDefaultMode(
  declaration: ThinkingCapabilityDeclaration | undefined,
  mode: 'off' | 'budget',
): ThinkingCapabilityDeclaration {
  const supported = initializeSupportedThinkingCapabilityDeclaration(declaration)
  const currentBudgetInput = supported.input.kind === 'budget'
    ? supported.input
    : createDefaultBudgetSeriesInput()

  return {
    ...supported,
    series: resolveSeriesForInputKind(supported, 'budget'),
    input: currentBudgetInput,
    defaultSelection: mode === 'off'
      ? { mode: 'preset', level: 'off' }
      : {
        mode: 'budget',
        budgetTokens: clampBudgetTokens(DEFAULT_BUDGET_SELECTION_TOKENS, currentBudgetInput),
      },
  }
}

export function setThinkingCapabilityDeclarationBudgetTokens(
  declaration: ThinkingCapabilityDeclaration | undefined,
  budgetTokens: number,
): ThinkingCapabilityDeclaration {
  const supported = initializeSupportedThinkingCapabilityDeclaration(declaration)
  const currentBudgetInput = supported.input.kind === 'budget'
    ? supported.input
    : createDefaultBudgetSeriesInput()

  return {
    ...supported,
    series: resolveSeriesForInputKind(supported, 'budget'),
    input: currentBudgetInput,
    defaultSelection: {
      mode: 'budget',
      budgetTokens: clampBudgetTokens(budgetTokens, currentBudgetInput),
    },
  }
}

export function buildThinkingDeclarationDefaultLevelOptions(
  declaration: ThinkingCapabilityDeclaration | undefined,
): SelectOption[] {
  const supported = initializeSupportedThinkingCapabilityDeclaration(declaration)
  if (supported.input.kind === 'budget') {
    return [{ value: 'off', label: THINKING_LEVEL_LABELS.off }]
  }

  return getAllowedPresetLevelsForInput(supported.input).map((level) => ({
    value: level,
    label: THINKING_LEVEL_LABELS[level],
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
    input: cloneThinkingSeriesInput(supported.input),
    defaultSelection: cloneThinkingDefaultSelection(supported.defaultSelection),
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
    input: serializeThinkingSeriesInput(supported.input),
    defaultSelection: serializeThinkingDefaultSelection(supported.defaultSelection),
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

  const structured = normalizeStructuredThinkingCapabilityDeclaration(record, source)
  if (structured !== null) {
    return structured
  }

  return normalizeLegacyThinkingCapabilityDeclaration(record, source)
}

export function resolveThinkingCapability(input: {
  providerProfile: Pick<ProviderProfile, 'id' | 'protocol' | 'endpoint'>
  modelProfile: Pick<ProviderModelProfile, 'modelId' | 'thinkingCapability'>
}): ResolvedThinkingCapability {
  const explicit = resolveExplicitThinkingCapability(input.modelProfile.thinkingCapability)
  if (explicit !== null) {
    return explicit
  }

  return resolveBuiltInThinkingCapability(input)
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

function normalizeStructuredThinkingCapabilityDeclaration(
  record: Record<string, unknown>,
  source: string | undefined,
): NormalizedSupportedThinkingCapabilityDeclaration | null {
  const hasStructuredFields = record.series !== undefined
    || record.input !== undefined
    || record.defaultSelection !== undefined

  if (!hasStructuredFields) {
    return null
  }

  const declaredSeries = normalizeOptionalString(record.series)
  const input = normalizeThinkingSeriesInput(record.input, resolveSeriesKindFromSeriesId(declaredSeries))
  const series = declaredSeries ?? resolveDefaultSeriesId(input.kind)

  return {
    supported: true,
    series,
    input,
    defaultSelection: normalizeThinkingDefaultSelection(record.defaultSelection, input),
    ...(source === undefined ? {} : { source }),
  }
}

function normalizeLegacyThinkingCapabilityDeclaration(
  record: Record<string, unknown>,
  source: string | undefined,
): NormalizedSupportedThinkingCapabilityDeclaration {
  const legacyLevels = normalizePositiveThinkingLevels(record.levels)
  const input = createThinkingSeriesInputFromLegacyLevels(legacyLevels)

  return {
    supported: true,
    series: resolveDefaultSeriesId(input.kind),
    input,
    defaultSelection: normalizeThinkingDefaultSelection({
      mode: 'preset',
      level: normalizeThinkingLevelIntent(record.defaultLevel),
    }, input),
    ...(source === undefined ? {} : { source }),
  }
}

function createDefaultSupportedThinkingCapabilityDeclaration(
  series: ThinkingCapabilitySeriesId = DEFAULT_OFF_AUTO_SERIES_ID,
  source?: string,
): NormalizedSupportedThinkingCapabilityDeclaration {
  const input = createDefaultThinkingSeriesInput(resolveSeriesKindFromSeriesId(series) ?? 'off-auto')

  return {
    supported: true,
    series,
    input,
    defaultSelection: createDefaultThinkingDefaultSelection(input),
    ...(source === undefined ? {} : { source }),
  }
}

function createThinkingSeriesInputFromLegacyLevels(
  levels: PositiveThinkingLevelIntent[],
): ThinkingCapabilitySeriesInput {
  if (levels.length === 0 || (levels.length === 1 && levels[0] === 'auto')) {
    return {
      kind: 'off-auto',
    }
  }

  if (levels.length === 1) {
    return {
      kind: 'binary',
      enabledLevel: levels[0] === 'auto' ? DEFAULT_BINARY_LEVEL : levels[0],
    }
  }

  return {
    kind: 'discrete',
    levels,
  }
}

function createDefaultThinkingSeriesInput(kind: ThinkingCapabilitySeriesInputKind): ThinkingCapabilitySeriesInput {
  switch (kind) {
    case 'fixed':
      return {
        kind: 'fixed',
        level: DEFAULT_FIXED_LEVEL,
      }
    case 'binary':
      return {
        kind: 'binary',
        enabledLevel: DEFAULT_BINARY_LEVEL,
      }
    case 'off-auto':
      return {
        kind: 'off-auto',
      }
    case 'discrete':
      return {
        kind: 'discrete',
        levels: [...DEFAULT_DISCRETE_LEVELS],
      }
    case 'budget':
      return createDefaultBudgetSeriesInput()
  }
}

function createDefaultBudgetSeriesInput(): ThinkingCapabilityBudgetSeriesInput {
  return {
    kind: 'budget',
    minTokens: DEFAULT_BUDGET_MIN_TOKENS,
    maxTokens: DEFAULT_BUDGET_MAX_TOKENS,
    stepTokens: DEFAULT_BUDGET_STEP_TOKENS,
  }
}

function normalizeThinkingSeriesInput(
  value: unknown,
  fallbackKind: ThinkingCapabilitySeriesInputKind | null,
): ThinkingCapabilitySeriesInput {
  const record = asRecord(value)
  const normalizedKind = normalizeThinkingSeriesInputKind(record.kind)
    ?? fallbackKind
    ?? 'off-auto'

  switch (normalizedKind) {
    case 'fixed': {
      const level = normalizePositiveThinkingLevelIntent(record.level) ?? DEFAULT_FIXED_LEVEL
      return {
        kind: 'fixed',
        level,
      }
    }
    case 'binary': {
      const enabledLevel = normalizePositiveThinkingLevelIntent(record.enabledLevel)
      return {
        kind: 'binary',
        enabledLevel: enabledLevel !== undefined && enabledLevel !== 'auto'
          ? enabledLevel
          : DEFAULT_BINARY_LEVEL,
      }
    }
    case 'off-auto':
      return {
        kind: 'off-auto',
      }
    case 'discrete': {
      const levels = normalizePositiveThinkingLevels(record.levels)
      return {
        kind: 'discrete',
        levels: levels.length > 0 ? levels : [...DEFAULT_DISCRETE_LEVELS],
      }
    }
    case 'budget':
      return normalizeBudgetSeriesInput(record)
  }
}

function normalizeBudgetSeriesInput(value: unknown): ThinkingCapabilityBudgetSeriesInput {
  const record = asRecord(value)
  const minTokens = normalizeNonNegativeInteger(record.minTokens) ?? DEFAULT_BUDGET_MIN_TOKENS
  const maxCandidate = normalizeNonNegativeInteger(record.maxTokens) ?? DEFAULT_BUDGET_MAX_TOKENS
  const maxTokens = Math.max(minTokens, maxCandidate)
  const stepCandidate = normalizeNonNegativeInteger(record.stepTokens) ?? DEFAULT_BUDGET_STEP_TOKENS
  const stepTokens = stepCandidate > 0 ? stepCandidate : DEFAULT_BUDGET_STEP_TOKENS

  return {
    kind: 'budget',
    minTokens,
    maxTokens,
    stepTokens,
  }
}

function createDefaultThinkingDefaultSelection(
  input: ThinkingCapabilitySeriesInput,
): ThinkingCapabilityDefaultSelection {
  if (input.kind === 'budget') {
    return {
      mode: 'budget',
      budgetTokens: clampBudgetTokens(DEFAULT_BUDGET_SELECTION_TOKENS, input),
    }
  }

  return {
    mode: 'preset',
    level: resolveFallbackPresetLevel(input),
  }
}

function normalizeThinkingDefaultSelection(
  value: unknown,
  input: ThinkingCapabilitySeriesInput,
): ThinkingCapabilityDefaultSelection {
  const record = asRecord(value)
  const mode = normalizeIdentifier(
    typeof record.mode === 'string'
      ? record.mode
      : typeof record.kind === 'string'
        ? record.kind
        : '',
  )

  if (input.kind === 'budget') {
    if (mode === 'preset' || mode === 'off') {
      const level = normalizeThinkingLevelIntent(record.level ?? record.value)
      if (level === 'off') {
        return {
          mode: 'preset',
          level: 'off',
        }
      }
    }

    const budgetTokens = normalizeNonNegativeInteger(record.budgetTokens)
    return {
      mode: 'budget',
      budgetTokens: clampBudgetTokens(
        budgetTokens ?? DEFAULT_BUDGET_SELECTION_TOKENS,
        input,
      ),
    }
  }

  const candidateLevel = normalizeThinkingLevelIntent(record.level ?? record.value)
  const allowedLevels = getAllowedPresetLevelsForInput(input)

  if (candidateLevel !== undefined && allowedLevels.includes(candidateLevel)) {
    return {
      mode: 'preset',
      level: candidateLevel,
    }
  }

  return {
    mode: 'preset',
    level: resolveFallbackPresetLevel(input),
  }
}

function normalizeDefaultSelectionForInput(
  current: ThinkingCapabilityDefaultSelection,
  input: ThinkingCapabilitySeriesInput,
): ThinkingCapabilityDefaultSelection {
  return normalizeThinkingDefaultSelection(current, input)
}

function cloneThinkingSeriesInput(input: ThinkingCapabilitySeriesInput): ThinkingCapabilitySeriesInput {
  switch (input.kind) {
    case 'fixed':
      return { ...input }
    case 'binary':
      return { ...input }
    case 'off-auto':
      return { kind: 'off-auto' }
    case 'discrete':
      return {
        kind: 'discrete',
        levels: [...input.levels],
      }
    case 'budget':
      return { ...input }
  }
}

function cloneThinkingDefaultSelection(
  selection: ThinkingCapabilityDefaultSelection,
): ThinkingCapabilityDefaultSelection {
  return selection.mode === 'preset'
    ? { ...selection }
    : { ...selection }
}

function serializeThinkingSeriesInput(input: ThinkingCapabilitySeriesInput): Record<string, unknown> {
  switch (input.kind) {
    case 'fixed':
      return {
        kind: 'fixed',
        level: input.level,
      }
    case 'binary':
      return {
        kind: 'binary',
        enabledLevel: input.enabledLevel,
      }
    case 'off-auto':
      return {
        kind: 'off-auto',
      }
    case 'discrete':
      return {
        kind: 'discrete',
        levels: [...input.levels],
      }
    case 'budget':
      return {
        kind: 'budget',
        minTokens: input.minTokens,
        maxTokens: input.maxTokens,
        stepTokens: input.stepTokens,
      }
  }
}

function serializeThinkingDefaultSelection(
  selection: ThinkingCapabilityDefaultSelection,
): Record<string, unknown> {
  return selection.mode === 'preset'
    ? {
      mode: 'preset',
      level: selection.level,
    }
    : {
      mode: 'budget',
      budgetTokens: selection.budgetTokens,
    }
}

function resolveExplicitThinkingCapability(
  declaration: ThinkingCapabilityDeclaration | undefined,
): ResolvedThinkingCapability | null {
  if (declaration === undefined) {
    return null
  }

  if (declaration.supported === false) {
    return {
      supported: false,
      levels: [],
      defaultLevel: null,
    }
  }

  const supported = initializeSupportedThinkingCapabilityDeclaration(declaration)
  const positiveLevels = derivePositiveThinkingLevelsFromSeriesInput(supported.input)
  if (positiveLevels.length === 0) {
    return {
      supported: false,
      levels: [],
      defaultLevel: null,
    }
  }

  return {
    supported: true,
    levels: ['off', ...positiveLevels],
    defaultLevel: resolveLegacyDefaultLevel(supported.defaultSelection, supported.input),
  }
}

function resolveBuiltInThinkingCapability(input: {
  providerProfile: Pick<ProviderProfile, 'id' | 'protocol' | 'endpoint'>
  modelProfile: Pick<ProviderModelProfile, 'modelId' | 'thinkingCapability'>
}): ResolvedThinkingCapability {
  const protocol = normalizeIdentifier(input.providerProfile.protocol)
  const endpoint = normalizeIdentifier(input.providerProfile.endpoint)
  const modelId = normalizeIdentifier(input.modelProfile.modelId)

  if (
    protocol === 'openai'
    && matchesZaiGlmThinkingModel(modelId)
    && (endpoint === '' || endpoint.includes('z.ai') || endpoint.includes('bigmodel.cn'))
  ) {
    return {
      supported: true,
      levels: ['off', 'auto'],
      defaultLevel: 'auto',
    }
  }

  return {
    supported: false,
    levels: [],
    defaultLevel: null,
  }
}

function matchesZaiGlmThinkingModel(modelId: string): boolean {
  return modelId === 'glm-5'
    || modelId === 'glm-5-turbo'
    || modelId.endsWith('/glm-5')
    || modelId.endsWith('/glm-5-turbo')
}

function derivePositiveThinkingLevelsFromSeriesInput(
  input: ThinkingCapabilitySeriesInput,
): PositiveThinkingLevelIntent[] {
  switch (input.kind) {
    case 'fixed':
      return [input.level]
    case 'binary':
      return [input.enabledLevel]
    case 'off-auto':
      return ['auto']
    case 'discrete':
      return normalizePositiveThinkingLevels(input.levels)
    case 'budget':
      return []
  }
}

function getAllowedPresetLevelsForInput(input: ThinkingCapabilitySeriesInput): ThinkingLevelIntent[] {
  switch (input.kind) {
    case 'fixed':
      return [input.level]
    case 'binary':
      return ['off', input.enabledLevel]
    case 'off-auto':
      return ['off', 'auto']
    case 'discrete':
      return ['off', ...normalizePositiveThinkingLevels(input.levels)]
    case 'budget':
      return ['off']
  }
}

function resolveLegacyDefaultLevel(
  selection: ThinkingCapabilityDefaultSelection,
  input: ThinkingCapabilitySeriesInput,
): ThinkingLevelIntent {
  if (selection.mode === 'preset') {
    const allowedLevels = getAllowedPresetLevelsForInput(input)
    if (allowedLevels.includes(selection.level)) {
      return selection.level
    }
  }

  return resolveFallbackPresetLevel(input)
}

function resolveFallbackPresetLevel(input: ThinkingCapabilitySeriesInput): ThinkingLevelIntent {
  const allowedLevels = getAllowedPresetLevelsForInput(input)
  if (allowedLevels.includes('auto')) {
    return 'auto'
  }

  const firstPositiveLevel = allowedLevels.find((level) => level !== 'off')
  if (firstPositiveLevel !== undefined) {
    return firstPositiveLevel
  }

  return 'off'
}

function clampBudgetTokens(value: number, input: ThinkingCapabilityBudgetSeriesInput): number {
  const lowerBoundedValue = Math.max(input.minTokens, value)
  const upperBoundedValue = Math.min(input.maxTokens, lowerBoundedValue)
  const step = input.stepTokens > 0 ? input.stepTokens : 1
  const snappedValue = input.minTokens + Math.round((upperBoundedValue - input.minTokens) / step) * step

  return Math.min(input.maxTokens, Math.max(input.minTokens, snappedValue))
}

function resolveSeriesKindFromSeriesId(series: string | undefined): ThinkingCapabilitySeriesInputKind | null {
  if (!series) {
    return null
  }

  return THINKING_SERIES_PRESET_BY_ID.get(series)?.kind ?? null
}

function resolveDefaultSeriesId(kind: ThinkingCapabilitySeriesInputKind): ThinkingCapabilitySeriesId {
  return THINKING_SERIES_PRESET_BY_KIND.get(kind)?.id ?? DEFAULT_DISCRETE_SERIES_ID
}

function resolveSeriesForInputKind(
  declaration: NormalizedSupportedThinkingCapabilityDeclaration,
  kind: ThinkingCapabilitySeriesInputKind,
): ThinkingCapabilitySeriesId {
  return declaration.input.kind === kind
    ? declaration.series
    : resolveDefaultSeriesId(kind)
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

function normalizePositiveThinkingLevels(
  input: unknown,
): PositiveThinkingLevelIntent[] {
  if (!Array.isArray(input)) {
    return []
  }

  const normalized = input
    .map((value) => normalizePositiveThinkingLevelIntent(value))
    .filter((value): value is PositiveThinkingLevelIntent => {
      return value !== undefined && POSITIVE_THINKING_LEVEL_SET.has(value)
    })

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
