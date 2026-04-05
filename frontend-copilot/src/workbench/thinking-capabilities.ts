import type {
  ProviderModelProfile,
  ProviderProfile,
  ResolvedThinkingCapability,
  SelectOption,
  ThinkingCapabilityDeclaration,
  ThinkingLevelIntent,
} from './types'

export type ThinkingCapabilityDeclarationMode = 'inherit' | 'unsupported' | 'supported'

const POSITIVE_THINKING_LEVEL_ORDER: Array<Exclude<ThinkingLevelIntent, 'off'>> = [
  'auto',
  'low',
  'medium',
  'high',
  'max',
]

const POSITIVE_THINKING_LEVEL_SET = new Set<Exclude<ThinkingLevelIntent, 'off'>>(POSITIVE_THINKING_LEVEL_ORDER)

export const THINKING_LEVEL_ORDER: ThinkingLevelIntent[] = ['off', ...POSITIVE_THINKING_LEVEL_ORDER]

export const THINKING_LEVEL_LABELS: Record<ThinkingLevelIntent, string> = {
  off: '无',
  auto: '自动',
  low: '低',
  medium: '中',
  high: '高',
  max: '超高',
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

export function getThinkingCapabilityDeclarationMode(
  declaration: ThinkingCapabilityDeclaration | undefined,
): ThinkingCapabilityDeclarationMode {
  if (declaration === undefined) {
    return 'inherit'
  }

  return declaration.supported ? 'supported' : 'unsupported'
}

export function setThinkingCapabilityDeclarationMode(
  declaration: ThinkingCapabilityDeclaration | undefined,
  mode: ThinkingCapabilityDeclarationMode,
): ThinkingCapabilityDeclaration | undefined {
  switch (mode) {
    case 'inherit':
      return undefined
    case 'unsupported':
      return { supported: false }
    case 'supported':
      return initializeSupportedThinkingCapabilityDeclaration(declaration)
  }
}

export function initializeSupportedThinkingCapabilityDeclaration(
  declaration: Partial<ThinkingCapabilityDeclaration> | undefined,
): ThinkingCapabilityDeclaration & {
  supported: true
  levels: Array<Exclude<ThinkingLevelIntent, 'off'>>
  defaultLevel: ThinkingLevelIntent
} {
  const declaredLevels: Array<Exclude<ThinkingLevelIntent, 'off'>> = declaration?.levels === undefined
    ? ['auto']
    : normalizePositiveThinkingLevels(declaration.levels)

  return {
    supported: true,
    levels: declaredLevels,
    defaultLevel: resolveDeclarationDefaultLevel({
      levels: declaredLevels,
      defaultLevel: declaration?.defaultLevel,
    }),
  }
}

export function toggleThinkingCapabilityDeclarationLevel(
  declaration: ThinkingCapabilityDeclaration | undefined,
  level: Exclude<ThinkingLevelIntent, 'off'>,
): ThinkingCapabilityDeclaration {
  const supported = initializeSupportedThinkingCapabilityDeclaration(declaration)
  const currentLevels = normalizePositiveThinkingLevels(supported.levels)
  const nextLevels = currentLevels.includes(level)
    ? currentLevels.filter((item) => item !== level)
    : [...currentLevels, level]

  return {
    supported: true,
    levels: POSITIVE_THINKING_LEVEL_ORDER.filter((item) => nextLevels.includes(item)),
    defaultLevel: resolveDeclarationDefaultLevel({
      levels: nextLevels,
      defaultLevel: supported.defaultLevel,
    }),
  }
}

export function setThinkingCapabilityDeclarationDefaultLevel(
  declaration: ThinkingCapabilityDeclaration | undefined,
  defaultLevel: ThinkingLevelIntent,
): ThinkingCapabilityDeclaration {
  const supported = initializeSupportedThinkingCapabilityDeclaration(declaration)
  const levels = normalizePositiveThinkingLevels(supported.levels)

  return {
    supported: true,
    levels,
    defaultLevel: resolveDeclarationDefaultLevel({
      levels,
      defaultLevel,
    }),
  }
}

export function buildThinkingDeclarationDefaultLevelOptions(
  declaration: ThinkingCapabilityDeclaration | undefined,
): SelectOption[] {
  const supported = initializeSupportedThinkingCapabilityDeclaration(declaration)
  const levels = normalizePositiveThinkingLevels(supported.levels)
  const optionLevels: ThinkingLevelIntent[] = ['off', ...levels]

  return optionLevels.map((level) => ({
    value: level,
    label: THINKING_LEVEL_LABELS[level],
  }))
}

export function cloneThinkingCapabilityDeclaration(
  declaration: ThinkingCapabilityDeclaration | undefined,
): ThinkingCapabilityDeclaration | undefined {
  if (declaration === undefined) {
    return undefined
  }

  return {
    supported: declaration.supported,
    ...(declaration.levels === undefined ? {} : { levels: [...declaration.levels] }),
    ...(declaration.defaultLevel === undefined ? {} : { defaultLevel: declaration.defaultLevel }),
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

  if (record.supported === false) {
    return {
      supported: false,
    }
  }

  const levels = normalizePositiveThinkingLevels(record.levels)
  const defaultLevel = normalizeThinkingLevelIntent(record.defaultLevel)

  return {
    supported: true,
    ...(levels.length === 0 ? { levels: [] } : { levels }),
    ...(defaultLevel === undefined ? {} : { defaultLevel }),
  }
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

  const levels = normalizePositiveThinkingLevels(declaration.levels)
  if (levels.length === 0) {
    return {
      supported: false,
      levels: [],
      defaultLevel: null,
    }
  }

  return {
    supported: true,
    levels: ['off', ...levels],
    defaultLevel: resolveDeclarationDefaultLevel({
      levels,
      defaultLevel: declaration.defaultLevel,
    }),
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

function resolveDeclarationDefaultLevel(input: {
  levels: Array<Exclude<ThinkingLevelIntent, 'off'>>
  defaultLevel: ThinkingLevelIntent | undefined
}): ThinkingLevelIntent {
  if (input.levels.length === 0) {
    return 'off'
  }

  if (input.defaultLevel === 'off') {
    return 'off'
  }

  if (input.defaultLevel !== undefined && input.levels.includes(input.defaultLevel)) {
    return input.defaultLevel
  }

  if (input.levels.includes('auto')) {
    return 'auto'
  }

  return input.levels[0]
}

function normalizePositiveThinkingLevels(
  input: unknown,
): Array<Exclude<ThinkingLevelIntent, 'off'>> {
  if (!Array.isArray(input)) {
    return []
  }

  const normalized = input
    .map((value) => normalizeThinkingLevelIntent(value))
    .filter((value): value is Exclude<ThinkingLevelIntent, 'off'> => {
      return value !== undefined && value !== 'off' && POSITIVE_THINKING_LEVEL_SET.has(value)
    })

  return POSITIVE_THINKING_LEVEL_ORDER.filter((level) => normalized.includes(level))
}

function normalizeThinkingLevelIntent(value: unknown): ThinkingLevelIntent | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = normalizeIdentifier(value)
  return THINKING_LEVEL_ORDER.find((candidate) => candidate === normalized)
}

function normalizeIdentifier(value: string): string {
  return value.trim().toLowerCase()
}
