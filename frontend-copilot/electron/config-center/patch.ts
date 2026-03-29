import {
  createUnifiedConfigDomainDocument,
  UNIFIED_CONFIG_DOCUMENT_VERSION,
  UNIFIED_CONFIG_DOMAIN_KEYS,
  type UnifiedConfigSnapshot,
} from './domain-schema'
import { UNIFIED_CONFIG_FIELD_REGISTRY, type UnifiedConfigFieldPatch } from './field-registry'

export function applyUnifiedConfigFieldPatch(
  snapshot: UnifiedConfigSnapshot,
  patch: UnifiedConfigFieldPatch,
): UnifiedConfigSnapshot {
  const nextFrontendValues = {
    ...snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES].values,
  }
  const nextAssistantValues = {
    ...snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR].values,
  }
  const nextHostValues = {
    ...snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG].values,
  }
  const nextBackendExposedValues = {
    ...snapshot.documents[UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED].values,
  }

  if ('theme' in patch) {
    nextFrontendValues.theme = UNIFIED_CONFIG_FIELD_REGISTRY.theme.normalize(patch.theme)
  }

  if ('animationsEnabled' in patch) {
    nextFrontendValues.animationsEnabled = UNIFIED_CONFIG_FIELD_REGISTRY.animationsEnabled.normalize(patch.animationsEnabled)
  }

  if ('agentName' in patch) {
    nextAssistantValues.agentName = UNIFIED_CONFIG_FIELD_REGISTRY.agentName.normalize(patch.agentName)
  }

  if ('runtimeUrl' in patch) {
    nextHostValues.runtimeUrl = UNIFIED_CONFIG_FIELD_REGISTRY.runtimeUrl.normalize(patch.runtimeUrl)
  }

  if ('model' in patch) {
    nextBackendExposedValues.model = UNIFIED_CONFIG_FIELD_REGISTRY.model.normalize(patch.model)
  }

  return {
    version: UNIFIED_CONFIG_DOCUMENT_VERSION,
    documents: {
      ...snapshot.documents,
      [UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES]: createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.FRONTEND_PREFERENCES,
        nextFrontendValues,
      ),
      [UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR]: createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.ASSISTANT_BEHAVIOR,
        nextAssistantValues,
      ),
      [UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG]: createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.HOST_CONFIG,
        nextHostValues,
      ),
      [UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED]: createUnifiedConfigDomainDocument(
        UNIFIED_CONFIG_DOMAIN_KEYS.BACKEND_EXPOSED,
        nextBackendExposedValues,
      ),
    },
  }
}
