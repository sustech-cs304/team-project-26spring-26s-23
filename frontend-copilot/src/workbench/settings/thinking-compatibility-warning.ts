import { getProviderCatalogEntry } from '../../provider-catalog'
import { initializeSupportedThinkingCapabilityDeclaration } from '../thinking-capabilities'
import type { ProviderProfile, ThinkingCapabilityDeclaration, ThinkingCapabilitySeriesId } from '../types'

export const THINKING_COMPATIBILITY_WARNING_MESSAGE = '⚠ 当前模型可能不支持此类思考模式'

const SERIES_ID_ALIASES: Record<string, string> = {
  'openai-4-level-none-v1': 'unified-4-level-v1',
  'anthropic-adaptive-4-v1': 'unified-4-level-v1',
}

type ThinkingSeriesCategory = 'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'qwen' | 'generic' | 'unknown'
type ProviderStyle = 'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'qwen' | 'generic' | 'unknown'

type ThinkingCompatibilityWarningReason =
  | 'provider_missing'
  | 'thinking_not_supported'
  | 'generic_series'
  | 'matching_style'
  | 'cross_style'
  | 'unknown_series'
  | 'provider_style_unknown'

export interface ThinkingCompatibilityWarningResult {
  shouldWarn: boolean
  message: string | null
  reason: ThinkingCompatibilityWarningReason
  seriesCategory: ThinkingSeriesCategory
  providerStyle: ProviderStyle
}

export interface ResolveThinkingCompatibilityWarningInput {
  providerProfile?: ProviderProfile | null
  thinkingCapability?: ThinkingCapabilityDeclaration
}

function normalizeToken(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function normalizeSeriesId(series: ThinkingCapabilitySeriesId): string {
  const normalized = normalizeToken(series)
  return SERIES_ID_ALIASES[normalized] ?? normalized
}

function resolveSeriesCategory(series: ThinkingCapabilitySeriesId): ThinkingSeriesCategory {
  const normalizedSeries = normalizeSeriesId(series)

  if (normalizedSeries === 'unified-4-level-v1') {
    return 'generic'
  }

  if (normalizedSeries.startsWith('openai-')) {
    return 'openai'
  }

  if (normalizedSeries.startsWith('anthropic-')) {
    return 'anthropic'
  }

  if (normalizedSeries.startsWith('gemini-')) {
    return 'gemini'
  }

  if (normalizedSeries.startsWith('deepseek-')) {
    return 'deepseek'
  }

  if (normalizedSeries.startsWith('qwen-')) {
    return 'qwen'
  }

  return 'unknown'
}

function resolveProviderStyle(providerProfile?: ProviderProfile | null): ProviderStyle {
  const providerId = normalizeToken(providerProfile?.providerId ?? providerProfile?.protocol)

  switch (providerId) {
    case 'openai':
      return 'openai'
    case 'anthropic':
      return 'anthropic'
    case 'gemini':
    case 'google':
      return 'gemini'
    case 'deepseek':
      return 'deepseek'
    case 'qwen':
      return 'qwen'
    default:
      break
  }

  const endpointType = normalizeToken(providerId ? getProviderCatalogEntry(providerId)?.endpointType ?? '' : '')

  switch (endpointType) {
    case 'openai-compatible':
      return 'openai'
    case 'anthropic-native':
      return 'anthropic'
    case 'gemini-native':
      return 'gemini'
    case 'ollama-native':
      return 'generic'
    default:
      return 'unknown'
  }
}

function createNoWarningResult(
  reason: ThinkingCompatibilityWarningReason,
  seriesCategory: ThinkingSeriesCategory,
  providerStyle: ProviderStyle,
): ThinkingCompatibilityWarningResult {
  return {
    shouldWarn: false,
    message: null,
    reason,
    seriesCategory,
    providerStyle,
  }
}

function createWarningResult(
  reason: ThinkingCompatibilityWarningReason,
  seriesCategory: ThinkingSeriesCategory,
  providerStyle: ProviderStyle,
): ThinkingCompatibilityWarningResult {
  return {
    shouldWarn: true,
    message: THINKING_COMPATIBILITY_WARNING_MESSAGE,
    reason,
    seriesCategory,
    providerStyle,
  }
}

export function resolveThinkingCompatibilityWarning({
  providerProfile,
  thinkingCapability,
}: ResolveThinkingCompatibilityWarningInput): ThinkingCompatibilityWarningResult {
  const providerStyle = resolveProviderStyle(providerProfile)

  if (!providerProfile) {
    return createNoWarningResult('provider_missing', 'unknown', providerStyle)
  }

  if (thinkingCapability?.supported !== true) {
    return createNoWarningResult('thinking_not_supported', 'unknown', providerStyle)
  }

  const normalizedThinkingCapability = initializeSupportedThinkingCapabilityDeclaration(thinkingCapability)
  const seriesCategory = resolveSeriesCategory(normalizedThinkingCapability.series)

  if (seriesCategory === 'generic') {
    return createNoWarningResult('generic_series', seriesCategory, providerStyle)
  }

  if (seriesCategory === 'unknown') {
    return createWarningResult('unknown_series', seriesCategory, providerStyle)
  }

  if (seriesCategory === providerStyle) {
    return createNoWarningResult('matching_style', seriesCategory, providerStyle)
  }

  if (providerStyle === 'unknown' || providerStyle === 'generic') {
    return createWarningResult('provider_style_unknown', seriesCategory, providerStyle)
  }

  return createWarningResult('cross_style', seriesCategory, providerStyle)
}
