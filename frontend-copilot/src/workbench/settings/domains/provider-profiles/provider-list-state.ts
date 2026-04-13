import {
  getDefaultProviderCatalogEntry,
  getProviderCatalogEntry,
} from '../../../../provider-catalog'
import type { ProviderProfile } from '../../../types'

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
