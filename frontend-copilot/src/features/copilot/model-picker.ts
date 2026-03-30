import type { ModelCapability, ProviderProfile } from '../../workbench/types'

export interface CopilotModelIconSpec {
  label: string
  accent: string
}

export interface CopilotModelOption {
  id: string
  name: string
  provider: string
  group: string
  tags: string[]
  icon: CopilotModelIconSpec
}

export interface CopilotModelGroup {
  key: string
  title: string
  models: CopilotModelOption[]
}

export interface CopilotModelCatalog {
  groups: CopilotModelGroup[]
  models: CopilotModelOption[]
}

export const DEFAULT_COPILOT_MODEL_ID = 'openrouter/gemini-2.5-pro-preview'

export const COPILOT_SAMPLE_MODELS: CopilotModelOption[] = [
  {
    id: 'openrouter/gemini-2.5-pro-preview',
    name: 'Gemini 2.5 Pro Preview',
    provider: 'OpenRouter',
    group: 'OpenRouter',
    tags: ['推理', '工具', '联网'],
    icon: {
      label: 'G',
      accent: '#60a5fa',
    },
  },
  {
    id: 'moonshot/kimi-k2.5',
    name: 'Kimi K2.5',
    provider: 'Moonshot',
    group: 'Moonshot',
    tags: ['推理', '联网'],
    icon: {
      label: 'K',
      accent: '#a78bfa',
    },
  },
  {
    id: 'baililigemini/gemini-2.0-flash-vision',
    name: 'Gemini 2.0 Flash Vision',
    provider: 'BaililiGemini',
    group: 'BaililiGemini',
    tags: ['视觉', '免费'],
    icon: {
      label: 'V',
      accent: '#34d399',
    },
  },
  {
    id: 'anthropic/claude-opus-4.1',
    name: 'Claude Opus 4.1',
    provider: 'FoxCodeAnthropic',
    group: 'FoxCodeAnthropic',
    tags: ['推理', '工具'],
    icon: {
      label: 'C',
      accent: '#fb923c',
    },
  },
  {
    id: 'tuzi/gemini-2.0-image-preview',
    name: 'Gemini 2.0 Image Preview',
    provider: 'TuziOpenAI',
    group: 'TuziOpenAI',
    tags: ['视觉', '联网'],
    icon: {
      label: 'I',
      accent: '#f472b6',
    },
  },
  {
    id: 'cherry/qwen-free',
    name: 'Qwen Free',
    provider: 'CherryAI',
    group: 'CherryAI',
    tags: ['免费', '工具'],
    icon: {
      label: 'Q',
      accent: '#facc15',
    },
  },
]

export const COPILOT_SAMPLE_MODEL_CATALOG: CopilotModelCatalog = createCopilotModelCatalogFromOptions(COPILOT_SAMPLE_MODELS)

export function getCopilotDefaultModel(models: CopilotModelOption[] = COPILOT_SAMPLE_MODELS): CopilotModelOption {
  return models.find((model) => model.id === DEFAULT_COPILOT_MODEL_ID) ?? models[0]
}

export function getCopilotModelById(
  modelId: string,
  models: CopilotModelOption[] = COPILOT_SAMPLE_MODELS,
): CopilotModelOption | null {
  return models.find((model) => model.id === modelId) ?? null
}

export function createFallbackCopilotModel(modelId: string): CopilotModelOption {
  const trimmedModelId = modelId.trim()

  return {
    id: trimmedModelId,
    name: trimmedModelId === '' ? '未选择模型' : trimmedModelId,
    provider: 'Custom',
    group: 'Custom',
    tags: [],
    icon: {
      label: trimmedModelId === '' ? '?' : trimmedModelId.slice(0, 1).toUpperCase(),
      accent: '#94a3b8',
    },
  }
}

export function createCopilotModelCatalog(providerProfiles: ProviderProfile[]): CopilotModelCatalog {
  const groups = providerProfiles.map((profile) => ({
    key: profile.id,
    title: resolveProviderTitle(profile.name, profile.id),
    models: profile.availableModels.map((model) => createCopilotModelOption(profile, model.modelId, model.displayName, model.capabilities)),
  }))

  return {
    groups,
    models: groups.flatMap((group) => group.models),
  }
}

export function createCopilotModelCatalogFromOptions(models: CopilotModelOption[]): CopilotModelCatalog {
  const groups = groupCopilotModels(models)

  return {
    groups,
    models,
  }
}

export function resolveCopilotPreferredModelId(input: {
  preferredModelId: string
  models: CopilotModelOption[]
}): string {
  const preferredModel = getCopilotModelById(input.preferredModelId, input.models)

  return preferredModel?.id ?? input.models[0]?.id ?? ''
}

export function getCopilotModelTags(models: CopilotModelOption[] = COPILOT_SAMPLE_MODELS): string[] {
  const seen = new Set<string>()

  for (const model of models) {
    for (const tag of model.tags) {
      seen.add(tag)
    }
  }

  return [...seen]
}

export function filterCopilotModels(input: {
  models?: CopilotModelOption[]
  query: string
  tags: string[]
}): CopilotModelOption[] {
  const models = input.models ?? COPILOT_SAMPLE_MODELS
  const normalizedQuery = input.query.trim().toLowerCase()

  return models.filter((model) => {
    const matchesTag = input.tags.length === 0 || input.tags.every((tag) => model.tags.includes(tag))
    if (!matchesTag) {
      return false
    }

    if (normalizedQuery === '') {
      return true
    }

    const searchableText = [
      model.id,
      model.name,
      model.provider,
      model.group,
      ...model.tags,
    ].join(' ').toLowerCase()

    return searchableText.includes(normalizedQuery)
  })
}

export function filterCopilotModelGroups(input: {
  groups: CopilotModelGroup[]
  query: string
  tags: string[]
}): CopilotModelGroup[] {
  return input.groups.map((group) => ({
    ...group,
    models: filterCopilotModels({
      models: group.models,
      query: input.query,
      tags: input.tags,
    }),
  }))
}

export function groupCopilotModels(models: CopilotModelOption[]): CopilotModelGroup[] {
  const groups = new Map<string, CopilotModelOption[]>()

  for (const model of models) {
    const currentGroup = groups.get(model.group) ?? []
    currentGroup.push(model)
    groups.set(model.group, currentGroup)
  }

  return [...groups.entries()].map(([key, groupedModels]) => ({
    key,
    title: key,
    models: groupedModels,
  }))
}

function createCopilotModelOption(
  profile: ProviderProfile,
  modelId: string,
  displayName: string,
  capabilities: ModelCapability[],
): CopilotModelOption {
  const providerTitle = resolveProviderTitle(profile.name, profile.id)
  const trimmedModelId = modelId.trim()
  const trimmedDisplayName = displayName.trim()
  const modelName = trimmedDisplayName === ''
    ? (trimmedModelId === '' ? '未命名模型' : trimmedModelId)
    : trimmedDisplayName

  return {
    id: trimmedModelId,
    name: modelName,
    provider: providerTitle,
    group: providerTitle,
    tags: mapCapabilitiesToTags(capabilities),
    icon: createProviderIconSpec(profile.id, providerTitle, modelName),
  }
}

function mapCapabilitiesToTags(capabilities: ModelCapability[]): string[] {
  const tags = capabilities.flatMap((capability) => {
    switch (capability) {
      case 'vision':
        return ['视觉']
      case 'search':
        return ['联网']
      case 'reasoning':
        return ['推理']
      case 'tools':
        return ['工具']
      default:
        return []
    }
  })

  return Array.from(new Set(tags))
}

function createProviderIconSpec(providerId: string, providerTitle: string, modelName: string): CopilotModelIconSpec {
  const palette = ['#60a5fa', '#a78bfa', '#34d399', '#fb923c', '#f472b6', '#facc15', '#38bdf8', '#c084fc']
  const hashSource = `${providerId}:${providerTitle}`
  let hash = 0

  for (const char of hashSource) {
    hash = (hash * 31) + char.charCodeAt(0)
  }

  const iconLabelSource = providerTitle.trim() || modelName.trim()

  return {
    label: iconLabelSource.slice(0, 1).toUpperCase() || '?',
    accent: palette[Math.abs(hash) % palette.length] ?? '#94a3b8',
  }
}

function resolveProviderTitle(name: string, fallbackId: string): string {
  return name.trim() || fallbackId.trim() || '未命名服务商'
}
