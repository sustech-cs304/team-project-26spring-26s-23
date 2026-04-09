import providerCatalogRegistryJson from '../../provider-catalog/registry.json'

export type ProviderRuntimeStatus = 'enabled' | 'catalog-only' | 'legacy-unsupported'
export type ProviderAuthKind = 'api-key' | 'none'

export interface ProviderCatalogAuthSchema {
  defaultKind: ProviderAuthKind
  supportedKinds: ProviderAuthKind[]
  secretFields: string[]
  helpText?: string
}

export interface ProviderCatalogBaseUrlPolicy {
  mode: 'fixed' | 'optional' | 'required'
  defaultBaseUrl?: string
}

export interface ProviderCatalogModelConfigPolicy {
  mode: 'user-defined' | 'catalog-seeded' | 'read-only'
  allowCustomModels: boolean
  defaultModelRequired: boolean
  allowModelDisplayNameOverride?: boolean
}

export interface ProviderCatalogCapabilityHints {
  streaming?: boolean
  tools?: boolean
  vision?: boolean
  reasoning?: boolean
  search?: boolean
}

export interface ProviderCatalogEntry {
  providerId: string
  displayName: string
  endpointType: string
  runtimeStatus: ProviderRuntimeStatus
  adapterId: string
  authSchema: ProviderCatalogAuthSchema
  baseUrlPolicy: ProviderCatalogBaseUrlPolicy
  modelConfigPolicy: ProviderCatalogModelConfigPolicy
  capabilityHints: ProviderCatalogCapabilityHints
  aliases?: string[]
  notes?: string
}

export interface ProviderCatalog {
  catalogRevision: string
  providers: ProviderCatalogEntry[]
}

interface ProviderSelectOption {
  value: string
  label: string
  hint?: string
}

const providerCatalog = parseProviderCatalog(providerCatalogRegistryJson)
const providerCatalogEntryMap = buildProviderCatalogEntryMap(providerCatalog.providers)

export function getProviderCatalog(): ProviderCatalog {
  return {
    catalogRevision: providerCatalog.catalogRevision,
    providers: providerCatalog.providers.map(cloneProviderCatalogEntry),
  }
}

export function getProviderCatalogRevision(): string {
  return providerCatalog.catalogRevision
}

export function listProviderCatalogEntries(): ProviderCatalogEntry[] {
  return providerCatalog.providers.map(cloneProviderCatalogEntry)
}

export function listProviderCatalogEntriesByStatus(runtimeStatus?: ProviderRuntimeStatus): ProviderCatalogEntry[] {
  if (runtimeStatus === undefined) {
    return listProviderCatalogEntries()
  }

  return providerCatalog.providers
    .filter((entry) => entry.runtimeStatus === runtimeStatus)
    .map(cloneProviderCatalogEntry)
}

export function getProviderCatalogEntry(providerId: string): ProviderCatalogEntry | null {
  const normalizedProviderId = normalizeProviderCatalogIdentifier(providerId)
  if (normalizedProviderId === '') {
    return null
  }

  const entry = providerCatalogEntryMap.get(normalizedProviderId)
  return entry === undefined ? null : cloneProviderCatalogEntry(entry)
}

export function requireProviderCatalogEntry(providerId: string): ProviderCatalogEntry {
  const entry = getProviderCatalogEntry(providerId)
  if (entry === null) {
    throw new Error(`Unknown provider catalog entry '${providerId}'.`)
  }

  return entry
}

export function getDefaultProviderCatalogEntry(): ProviderCatalogEntry {
  const enabledProvider = providerCatalog.providers.find((entry) => entry.runtimeStatus === 'enabled')
  return cloneProviderCatalogEntry(enabledProvider ?? providerCatalog.providers[0]!)
}

export function createProviderSelectOptions(): ProviderSelectOption[] {
  return providerCatalog.providers.map((entry) => ({
    value: entry.providerId,
    label: entry.displayName,
    ...(describeProviderRuntimeStatus(entry.runtimeStatus) === null
      ? {}
      : { hint: describeProviderRuntimeStatus(entry.runtimeStatus) ?? undefined }),
  }))
}

export function describeProviderRuntimeStatus(runtimeStatus: ProviderRuntimeStatus): string | null {
  switch (runtimeStatus) {
    case 'enabled':
      return null
    case 'catalog-only':
      return '仅数据层兼容'
    case 'legacy-unsupported':
      return '历史兼容 / 当前未启用'
    default:
      return null
  }
}

export function normalizeProviderCatalogIdentifier(value: string): string {
  return value.trim().toLowerCase()
}

function buildProviderCatalogEntryMap(entries: ProviderCatalogEntry[]): Map<string, ProviderCatalogEntry> {
  const entryMap = new Map<string, ProviderCatalogEntry>()

  for (const entry of entries) {
    entryMap.set(normalizeProviderCatalogIdentifier(entry.providerId), entry)

    for (const alias of entry.aliases ?? []) {
      entryMap.set(normalizeProviderCatalogIdentifier(alias), entry)
    }
  }

  return entryMap
}

function parseProviderCatalog(input: unknown): ProviderCatalog {
  const record = asRecord(input)
  const catalogRevision = requireNonEmptyString(record.catalogRevision, 'provider catalog revision')
  const providers = Array.isArray(record.providers)
    ? record.providers.map((provider, index) => parseProviderCatalogEntry(provider, index))
    : []

  if (providers.length === 0) {
    throw new Error('Provider catalog must define at least one provider entry.')
  }

  return {
    catalogRevision,
    providers,
  }
}

function parseProviderCatalogEntry(input: unknown, index: number): ProviderCatalogEntry {
  const record = asRecord(input)
  const providerId = requireIdentifier(record.providerId, `provider[${index}].providerId`)
  const displayName = requireNonEmptyString(record.displayName, `provider[${index}].displayName`)
  const endpointType = requireIdentifier(record.endpointType, `provider[${index}].endpointType`)
  const runtimeStatus = requireRuntimeStatus(record.runtimeStatus, `provider[${index}].runtimeStatus`)
  const adapterId = requireIdentifier(record.adapterId, `provider[${index}].adapterId`)
  const authSchema = parseAuthSchema(record.authSchema, index)
  const baseUrlPolicy = parseBaseUrlPolicy(record.baseUrlPolicy, index)
  const modelConfigPolicy = parseModelConfigPolicy(record.modelConfigPolicy, index)
  const capabilityHints = parseCapabilityHints(record.capabilityHints)
  const aliases = parseAliases(record.aliases, index)
  const notes = optionalString(record.notes)

  return {
    providerId,
    displayName,
    endpointType,
    runtimeStatus,
    adapterId,
    authSchema,
    baseUrlPolicy,
    modelConfigPolicy,
    capabilityHints,
    ...(aliases.length === 0 ? {} : { aliases }),
    ...(notes === null ? {} : { notes }),
  }
}

function parseAuthSchema(input: unknown, index: number): ProviderCatalogAuthSchema {
  const record = asRecord(input)
  const defaultKind = requireAuthKind(record.defaultKind, `provider[${index}].authSchema.defaultKind`)
  const supportedKinds = Array.isArray(record.supportedKinds)
    ? record.supportedKinds.map((value, supportedIndex) => requireAuthKind(value, `provider[${index}].authSchema.supportedKinds[${supportedIndex}]`))
    : []

  if (supportedKinds.length === 0) {
    throw new Error(`provider[${index}].authSchema.supportedKinds must contain at least one auth kind.`)
  }

  if (!supportedKinds.includes(defaultKind)) {
    throw new Error(`provider[${index}].authSchema.defaultKind must exist in supportedKinds.`)
  }

  const secretFields = Array.isArray(record.secretFields)
    ? record.secretFields.map((value, fieldIndex) => requireNonEmptyString(value, `provider[${index}].authSchema.secretFields[${fieldIndex}]`))
    : []

  const helpText = optionalString(record.helpText)

  return {
    defaultKind,
    supportedKinds: uniqueProviderAuthKinds(supportedKinds),
    secretFields: uniqueStrings(secretFields),
    ...(helpText === null ? {} : { helpText }),
  }
}

function parseBaseUrlPolicy(input: unknown, index: number): ProviderCatalogBaseUrlPolicy {
  const record = asRecord(input)
  const mode = requireStringEnum(record.mode, ['fixed', 'optional', 'required'] as const, `provider[${index}].baseUrlPolicy.mode`)
  const defaultBaseUrl = optionalString(record.defaultBaseUrl)

  return {
    mode,
    ...(defaultBaseUrl === null ? {} : { defaultBaseUrl }),
  }
}

function parseModelConfigPolicy(input: unknown, index: number): ProviderCatalogModelConfigPolicy {
  const record = asRecord(input)
  const mode = requireStringEnum(record.mode, ['user-defined', 'catalog-seeded', 'read-only'] as const, `provider[${index}].modelConfigPolicy.mode`)

  return {
    mode,
    allowCustomModels: requireBoolean(record.allowCustomModels, `provider[${index}].modelConfigPolicy.allowCustomModels`),
    defaultModelRequired: requireBoolean(record.defaultModelRequired, `provider[${index}].modelConfigPolicy.defaultModelRequired`),
    ...(typeof record.allowModelDisplayNameOverride === 'boolean'
      ? { allowModelDisplayNameOverride: record.allowModelDisplayNameOverride }
      : {}),
  }
}

function parseCapabilityHints(input: unknown): ProviderCatalogCapabilityHints {
  const record = asRecord(input)
  return {
    ...(typeof record.streaming === 'boolean' ? { streaming: record.streaming } : {}),
    ...(typeof record.tools === 'boolean' ? { tools: record.tools } : {}),
    ...(typeof record.vision === 'boolean' ? { vision: record.vision } : {}),
    ...(typeof record.reasoning === 'boolean' ? { reasoning: record.reasoning } : {}),
    ...(typeof record.search === 'boolean' ? { search: record.search } : {}),
  }
}

function parseAliases(input: unknown, index: number): string[] {
  if (!Array.isArray(input)) {
    return []
  }

  return uniqueStrings(input.map((value, aliasIndex) => requireIdentifier(value, `provider[${index}].aliases[${aliasIndex}]`)))
}

function cloneProviderCatalogEntry(entry: ProviderCatalogEntry): ProviderCatalogEntry {
  return {
    ...entry,
    authSchema: {
      ...entry.authSchema,
      supportedKinds: [...entry.authSchema.supportedKinds],
      secretFields: [...entry.authSchema.secretFields],
    },
    baseUrlPolicy: { ...entry.baseUrlPolicy },
    modelConfigPolicy: { ...entry.modelConfigPolicy },
    capabilityHints: { ...entry.capabilityHints },
    ...(entry.aliases === undefined ? {} : { aliases: [...entry.aliases] }),
  }
}

function requireRuntimeStatus(value: unknown, label: string): ProviderRuntimeStatus {
  return requireStringEnum(value, ['enabled', 'catalog-only', 'legacy-unsupported'] as const, label)
}

function requireAuthKind(value: unknown, label: string): ProviderAuthKind {
  return requireStringEnum(value, ['api-key', 'none'] as const, label)
}

function requireIdentifier(value: unknown, label: string): string {
  const normalized = requireNonEmptyString(value, label)
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)) {
    throw new Error(`${label} must match ^[a-z0-9]+(?:-[a-z0-9]+)*$.`)
  }
  return normalized
}

function requireBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${label} must be a boolean.`)
  }
  return value
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`)
  }

  const normalized = value.trim()
  if (normalized === '') {
    throw new Error(`${label} must not be empty.`)
  }

  return normalized
}

function optionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized === '' ? null : normalized
}

function uniqueStrings<TValue extends string>(values: TValue[]): TValue[] {
  return Array.from(new Set(values))
}

function uniqueProviderAuthKinds(values: ProviderAuthKind[]): ProviderAuthKind[] {
  return uniqueStrings(values)
}

function requireStringEnum<const TAllowed extends readonly string[]>(
  value: unknown,
  allowed: TAllowed,
  label: string,
): TAllowed[number] {
  const normalized = requireNonEmptyString(value, label)
  if (!allowed.includes(normalized as TAllowed[number])) {
    throw new Error(`${label} must be one of: ${allowed.join(', ')}.`)
  }
  return normalized as TAllowed[number]
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Provider catalog payload must be an object.')
  }

  return value as Record<string, unknown>
}
