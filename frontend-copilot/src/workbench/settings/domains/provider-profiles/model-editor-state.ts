import type {
  ModelCapability,
  ProviderModelProfile,
} from '../../../types'
import { createModelProfileId } from '../../config'

export type ModelEditorState = ProviderModelProfile & {
  index: number
  advancedOpen: boolean
  isNew: boolean
}

function titleCaseToken(value: string) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export function formatModelDisplayName(modelId: string) {
  const normalized = modelId.trim()

  if (!normalized) {
    return '未命名模型'
  }

  const leaf = normalized.split('/').pop() ?? normalized

  return titleCaseToken(leaf)
}

export function formatModelGroupName(modelId: string, providerName: string) {
  const normalized = modelId.trim()

  if (!normalized) {
    return providerName
  }

  const vendor = normalized.includes('/') ? normalized.split('/')[0] : providerName

  return titleCaseToken(vendor)
}

export function getDefaultModelCapabilities(modelId: string): ModelCapability[] {
  const normalized = modelId.toLowerCase()
  const capabilities: ModelCapability[] = []

  if (/(gpt|gemini|claude|vision|vl)/.test(normalized)) {
    capabilities.push('vision')
  }

  if (/(search|web)/.test(normalized)) {
    capabilities.push('search')
  }

  if (/(embed)/.test(normalized)) {
    capabilities.push('embedding')
  }

  if (/(rerank)/.test(normalized)) {
    capabilities.push('rerank')
  }

  if (/(reason|think|claude|gpt|gemini)/.test(normalized)) {
    capabilities.push('reasoning')
  }

  if (/(tool|agent|gpt|gemini|claude)/.test(normalized)) {
    capabilities.push('tools')
  }

  if (capabilities.length === 0) {
    capabilities.push('reasoning')
  }

  return Array.from(new Set(capabilities))
}

export function createProviderModelProfile(providerId: string, modelId: string, providerName: string): ProviderModelProfile {
  return {
    id: createModelProfileId(providerId, modelId),
    modelId,
    displayName: formatModelDisplayName(modelId),
    groupName: formatModelGroupName(modelId, providerName),
    capabilities: getDefaultModelCapabilities(modelId),
    thinkingCapability: undefined,
    supportsStreaming: true,
    currency: 'usd',
    inputPrice: '0.50',
    outputPrice: '3.00',
  }
}

export function createEmptyModelEditorState(providerName: string, index: number): ModelEditorState {
  return {
    id: '',
    index,
    modelId: '',
    displayName: '',
    groupName: providerName,
    capabilities: ['reasoning', 'tools'],
    thinkingCapability: undefined,
    supportsStreaming: true,
    currency: 'usd',
    inputPrice: '0.50',
    outputPrice: '3.00',
    advancedOpen: false,
    isNew: true,
  }
}

export function syncTrackedModelValue(currentValue: string, previousModelId: string | null, nextModelId: string | null) {
  if (!previousModelId || currentValue !== previousModelId) {
    return currentValue
  }

  return nextModelId ?? ''
}
