import {
  getDefaultProviderCatalogEntry,
  getProviderCatalogEntry,
} from '../../provider-catalog'
import type {
  ModelCapability,
  ProviderModelProfile,
  ProviderProfile,
} from '../types'
import { createModelProfileId } from './config'

export type ModelEditorState = ProviderModelProfile & {
  index: number
  advancedOpen: boolean
  isNew: boolean
}

export interface ProviderContextMenuState {
  providerId: string
  providerName: string
  x: number
  y: number
}

export interface ProviderDragState {
  draggingProviderId: string
  previewIndex: number
}

let nextProviderSequence = 0

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

export function createCustomProvider(index: number, providerTypeId?: string): ProviderProfile {
  const catalogEntry = getProviderCatalogEntry(providerTypeId ?? '') ?? getDefaultProviderCatalogEntry()
  const providerId = `${catalogEntry.providerId}-${index}`
  const providerName = index > 1 ? `${catalogEntry.displayName} ${index}` : catalogEntry.displayName

  return {
    id: providerId,
    profileId: providerId,
    providerId: catalogEntry.providerId,
    name: providerName,
    displayName: providerName,
    protocol: catalogEntry.providerId,
    endpoint: '',
    baseUrl: '',
    hasApiKey: false,
    fastModel: '',
    fallbackModel: '',
    organization: '',
    region: '',
    notes: '',
    compatibility: buildCatalogBackedProviderCompatibility(catalogEntry.providerId),
    extensions: {},
    availableModels: [],
  }
}

export function createPlaceholderProviderProfile(): ProviderProfile {
  const catalogEntry = getDefaultProviderCatalogEntry()

  return {
    id: '',
    profileId: '',
    providerId: catalogEntry.providerId,
    name: '',
    displayName: '',
    protocol: catalogEntry.providerId,
    endpoint: '',
    baseUrl: '',
    hasApiKey: false,
    fastModel: '',
    fallbackModel: '',
    organization: '',
    region: '',
    notes: '',
    compatibility: buildCatalogBackedProviderCompatibility(catalogEntry.providerId),
    extensions: {},
    availableModels: [],
  }
}

export function createProviderId(baseName: string): string {
  const normalizedBaseName = baseName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  nextProviderSequence += 1

  return `${normalizedBaseName || 'provider'}-${nextProviderSequence}`
}

export function computeProviderPreviewIndex(listElement: HTMLUListElement, clientY: number): number {
  const orderedItems = Array.from(
    listElement.querySelectorAll<HTMLElement>('[data-provider-order-index]'),
  )
  let nextPreviewIndex = orderedItems.length

  for (const orderedItem of orderedItems) {
    const itemIndex = Number(orderedItem.dataset.providerOrderIndex)
    if (Number.isNaN(itemIndex)) {
      continue
    }

    const { top, height } = orderedItem.getBoundingClientRect()
    if (clientY < top + (height / 2)) {
      nextPreviewIndex = itemIndex
      break
    }
  }

  return nextPreviewIndex
}

function buildCatalogBackedProviderCompatibility(providerId: string): ProviderProfile['compatibility'] {
  const catalogEntry = getProviderCatalogEntry(providerId)

  if (catalogEntry === null) {
    return {
      status: 'unsupported',
      reason: `Provider '${providerId}' is not defined in the current provider catalog.`,
    }
  }

  if (catalogEntry.runtimeStatus === 'legacy-unsupported') {
    return {
      status: 'legacy',
      reason: `Provider '${providerId}' is marked as legacy / unsupported in the provider catalog.`,
    }
  }

  return {
    status: 'active',
    reason: '',
  }
}
