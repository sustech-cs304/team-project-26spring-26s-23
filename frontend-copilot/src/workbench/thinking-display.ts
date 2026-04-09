import type { ThinkingSeriesBudgetTemplate, ThinkingSeriesValue } from './types'

export const THINKING_BUDGET_FIXED_ANCHOR_TOKENS = [0, 4096, 32768, 131072, 1048576] as const
export const THINKING_BUDGET_DEFAULT_MIN_TOKENS = THINKING_BUDGET_FIXED_ANCHOR_TOKENS[0]
export const THINKING_BUDGET_DEFAULT_MAX_TOKENS = THINKING_BUDGET_FIXED_ANCHOR_TOKENS[THINKING_BUDGET_FIXED_ANCHOR_TOKENS.length - 1]
export const THINKING_BUDGET_DEFAULT_STEP_TOKENS = 1024
export const THINKING_BUDGET_DEFAULT_SELECTION_TOKENS = 32768

export interface ThinkingBudgetAnchor {
  tokens: number
  label: string
}

type SharedThinkingValue =
  | {
      valueType: 'code'
      code: string
      labelZh: string
    }
  | {
      valueType: 'budget'
      mode: 'off' | 'dynamic' | 'budget'
      budgetTokens: number | null
      labelZh: string
    }
  | {
      valueType: 'fixed'
      code: 'fixed'
      labelZh: string
    }

export const THINKING_BUDGET_FIXED_ANCHOR_PROGRESS = [0, 25, 50, 75, 100] as const
export const THINKING_BUDGET_FIXED_ANCHORS: ThinkingBudgetAnchor[] = THINKING_BUDGET_FIXED_ANCHOR_TOKENS.map((tokens) => ({
  tokens,
  label: formatThinkingTokenCount(tokens),
}))

const THINKING_BUDGET_PROGRESS_SNAP_DISTANCE = 1.5

export function clampThinkingBudgetTokens(value: number): number {
  if (!Number.isFinite(value)) {
    return THINKING_BUDGET_DEFAULT_SELECTION_TOKENS
  }

  return Math.min(
    THINKING_BUDGET_DEFAULT_MAX_TOKENS,
    Math.max(THINKING_BUDGET_DEFAULT_MIN_TOKENS, Math.trunc(value)),
  )
}

export function getThinkingBudgetTokensFromProgress(progress: number): number {
  const normalizedProgress = Math.min(100, Math.max(0, progress))

  for (let index = 0; index < THINKING_BUDGET_FIXED_ANCHOR_PROGRESS.length; index += 1) {
    if (Math.abs(normalizedProgress - THINKING_BUDGET_FIXED_ANCHOR_PROGRESS[index]) < THINKING_BUDGET_PROGRESS_SNAP_DISTANCE) {
      return THINKING_BUDGET_FIXED_ANCHOR_TOKENS[index]
    }
  }

  if (normalizedProgress <= 25) {
    return Math.round((normalizedProgress / 25) * THINKING_BUDGET_FIXED_ANCHOR_TOKENS[1])
  }

  if (normalizedProgress <= 50) {
    return Math.round(
      THINKING_BUDGET_FIXED_ANCHOR_TOKENS[1]
        + (((normalizedProgress - 25) / 25) * (THINKING_BUDGET_FIXED_ANCHOR_TOKENS[2] - THINKING_BUDGET_FIXED_ANCHOR_TOKENS[1])),
    )
  }

  if (normalizedProgress <= 75) {
    return Math.round(
      THINKING_BUDGET_FIXED_ANCHOR_TOKENS[2]
        + (((normalizedProgress - 50) / 25) * (THINKING_BUDGET_FIXED_ANCHOR_TOKENS[3] - THINKING_BUDGET_FIXED_ANCHOR_TOKENS[2])),
    )
  }

  return Math.round(
    THINKING_BUDGET_FIXED_ANCHOR_TOKENS[3]
      + (((normalizedProgress - 75) / 25) * (THINKING_BUDGET_FIXED_ANCHOR_TOKENS[4] - THINKING_BUDGET_FIXED_ANCHOR_TOKENS[3])),
  )
}

export function getThinkingBudgetProgressFromTokens(tokens: number): number {
  const normalizedTokens = clampThinkingBudgetTokens(tokens)

  if (normalizedTokens <= THINKING_BUDGET_FIXED_ANCHOR_TOKENS[1]) {
    return (normalizedTokens / THINKING_BUDGET_FIXED_ANCHOR_TOKENS[1]) * 25
  }

  if (normalizedTokens <= THINKING_BUDGET_FIXED_ANCHOR_TOKENS[2]) {
    return 25 + (((normalizedTokens - THINKING_BUDGET_FIXED_ANCHOR_TOKENS[1])
      / (THINKING_BUDGET_FIXED_ANCHOR_TOKENS[2] - THINKING_BUDGET_FIXED_ANCHOR_TOKENS[1])) * 25)
  }

  if (normalizedTokens <= THINKING_BUDGET_FIXED_ANCHOR_TOKENS[3]) {
    return 50 + (((normalizedTokens - THINKING_BUDGET_FIXED_ANCHOR_TOKENS[2])
      / (THINKING_BUDGET_FIXED_ANCHOR_TOKENS[3] - THINKING_BUDGET_FIXED_ANCHOR_TOKENS[2])) * 25)
  }

  return 75 + (((normalizedTokens - THINKING_BUDGET_FIXED_ANCHOR_TOKENS[3])
    / (THINKING_BUDGET_FIXED_ANCHOR_TOKENS[4] - THINKING_BUDGET_FIXED_ANCHOR_TOKENS[3])) * 25)
}

export function formatThinkingTokenCount(value: number): string {
  if (value >= 1024 * 1024) {
    const megaValue = value / (1024 * 1024)
    return `${trimTrailingZero(megaValue.toFixed(Number.isInteger(megaValue) ? 0 : 1))}M`
  }

  if (value >= 1024) {
    const kiloValue = value / 1024
    return `${trimTrailingZero(kiloValue.toFixed(Number.isInteger(kiloValue) ? 0 : 1))}K`
  }

  return String(value)
}

export function normalizeThinkingBudgetAnchorTokens(anchorTokens: number[] | null | undefined): number[] {
  void anchorTokens
  return [...THINKING_BUDGET_FIXED_ANCHOR_TOKENS]
}

export function buildThinkingBudgetTemplate(
  overrides: Partial<ThinkingSeriesBudgetTemplate> = {},
): ThinkingSeriesBudgetTemplate {
  return {
    minTokens: overrides.minTokens ?? THINKING_BUDGET_DEFAULT_MIN_TOKENS,
    maxTokens: overrides.maxTokens ?? THINKING_BUDGET_DEFAULT_MAX_TOKENS,
    stepTokens: overrides.stepTokens ?? THINKING_BUDGET_DEFAULT_STEP_TOKENS,
    anchorTokens: normalizeThinkingBudgetAnchorTokens(overrides.anchorTokens),
  }
}

export function resolveThinkingValueLabel(value: SharedThinkingValue | ThinkingSeriesValue | null | undefined): string | null {
  if (value == null) {
    return null
  }

  if (value.valueType === 'budget' && value.mode === 'budget' && typeof value.budgetTokens === 'number') {
    return formatThinkingTokenCount(value.budgetTokens)
  }

  return value.labelZh
}

export function findThinkingCodeValue<T extends SharedThinkingValue>(
  values: readonly T[] | null | undefined,
  code: string | null | undefined,
): Extract<T, { valueType: 'code' }> | null {
  if (!Array.isArray(values) || typeof code !== 'string' || code.trim() === '') {
    return null
  }

  const normalizedCode = code.trim().toLowerCase()
  const exactMatch = values.find((value): value is Extract<T, { valueType: 'code' }> => {
    return value.valueType === 'code' && value.code === normalizedCode
  }) ?? null
  if (exactMatch !== null) {
    return exactMatch
  }

  if (normalizedCode === 'off' || normalizedCode === 'disabled') {
    return values.find((value): value is Extract<T, { valueType: 'code' }> => {
      return value.valueType === 'code' && value.code === 'none'
    }) ?? null
  }

  return null
}

export function isThinkingCodeDisabled(code: string): boolean {
  const normalized = code.trim().toLowerCase()
  return normalized === 'off'
    || normalized === 'none'
    || normalized === 'disabled'
    || normalized === 'false'
}

export function isThinkingValueActive(value: SharedThinkingValue | null | undefined): boolean {
  if (value == null) {
    return false
  }

  switch (value.valueType) {
    case 'fixed':
      return true
    case 'budget':
      return value.mode !== 'off'
    case 'code':
      return !isThinkingCodeDisabled(value.code)
  }
}

function trimTrailingZero(value: string): string {
  return value.replace(/\.0$/, '')
}
