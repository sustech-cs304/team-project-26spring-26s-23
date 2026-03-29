import {
  createUnifiedConfigDomainDocument,
  UNIFIED_CONFIG_DOMAIN_KEYS,
  type UnifiedConfigDomainDocument,
  type UnifiedConfigDomainKey,
} from './domain-schema'
import { UNIFIED_CONFIG_FIELD_REGISTRY } from './field-registry'

export function normalizeUnifiedConfigDomainDocument<TDomain extends UnifiedConfigDomainKey>(
  domain: TDomain,
  input: unknown,
): UnifiedConfigDomainDocument<TDomain> {
  const record = asRecord(input)
  const values = asRecord(record.values)

  switch (domain) {
    case UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES:
      return createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES,
        {
          theme: UNIFIED_CONFIG_FIELD_REGISTRY.theme.normalize(values.theme),
          animationsEnabled: UNIFIED_CONFIG_FIELD_REGISTRY.animationsEnabled.normalize(values.animationsEnabled),
        },
      ) as UnifiedConfigDomainDocument<TDomain>

    case UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR:
      return createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR,
        {
          agentName: UNIFIED_CONFIG_FIELD_REGISTRY.agentName.normalize(values.agentName),
        },
      ) as UnifiedConfigDomainDocument<TDomain>

    case UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG:
      return createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG,
        {
          runtimeUrl: UNIFIED_CONFIG_FIELD_REGISTRY.runtimeUrl.normalize(values.runtimeUrl),
        },
      ) as UnifiedConfigDomainDocument<TDomain>

    case UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED:
      return createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED,
        {
          model: UNIFIED_CONFIG_FIELD_REGISTRY.model.normalize(values.model),
        },
      ) as UnifiedConfigDomainDocument<TDomain>
  }

  throw new Error(`Unsupported unified config domain: ${String(domain)}`)
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {}
}
