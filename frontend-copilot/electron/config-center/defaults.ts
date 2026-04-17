import {
  createUnifiedConfigDomainDocument,
  UNIFIED_CONFIG_DOCUMENT_VERSION,
  UNIFIED_CONFIG_DOMAIN_KEYS,
  type UnifiedConfigDomainDocument,
  type UnifiedConfigDomainKey,
  type UnifiedConfigSnapshot,
} from './domain-schema'
import { UNIFIED_CONFIG_FIELD_REGISTRY } from './field-registry'

export function createDefaultUnifiedConfigDomainDocument<TDomain extends UnifiedConfigDomainKey>(
  domain: TDomain,
): UnifiedConfigDomainDocument<TDomain> {
  switch (domain) {
    case UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES:
      return createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES,
        {
          theme: UNIFIED_CONFIG_FIELD_REGISTRY.theme.defaultValue,
          animationsEnabled: UNIFIED_CONFIG_FIELD_REGISTRY.animationsEnabled.defaultValue,
        },
      ) as UnifiedConfigDomainDocument<TDomain>

    case UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR:
      return createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR,
        {
          agentName: UNIFIED_CONFIG_FIELD_REGISTRY.agentName.defaultValue,
          debugModeEnabled: UNIFIED_CONFIG_FIELD_REGISTRY.debugModeEnabled.defaultValue,
        },
      ) as UnifiedConfigDomainDocument<TDomain>

    case UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG:
      return createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG,
        {
          runtimeUrl: UNIFIED_CONFIG_FIELD_REGISTRY.runtimeUrl.defaultValue,
        },
      ) as UnifiedConfigDomainDocument<TDomain>

    case UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED:
      return createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED,
        {
          model: UNIFIED_CONFIG_FIELD_REGISTRY.model.defaultValue,
        },
      ) as UnifiedConfigDomainDocument<TDomain>

    case UNIFIED_CONFIG_DOMAIN_KEYS.GENERAL:
      return createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.GENERAL,
        {
          language: 'zh-CN',
        },
      ) as UnifiedConfigDomainDocument<TDomain>
  }

  throw new Error(`Unsupported unified config domain: ${String(domain)}`)
}

export function createDefaultUnifiedConfigSnapshot(): UnifiedConfigSnapshot {
  return {
    version: UNIFIED_CONFIG_DOCUMENT_VERSION,
    documents: {
      [UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES]: createDefaultUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES,
      ),
      [UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR]: createDefaultUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR,
      ),
      [UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG]: createDefaultUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG,
      ),
      [UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED]: createDefaultUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED,
      ),
      [UNIFIED_CONFIG_DOMAIN_KEYS.GENERAL]: createDefaultUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.GENERAL,
      ),
    },
  }
}
