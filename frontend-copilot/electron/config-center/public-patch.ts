import type { ConfigCenterPublicSnapshot } from './public-snapshot'
import {
  UNIFIED_CONFIG_FIELD_REGISTRY,
  type UnifiedConfigFieldKey,
  type UnifiedConfigFieldPatch,
} from './schema'

export const CONFIG_CENTER_PUBLIC_PATCH_CHANNEL = 'config-center:apply-public-patch'

export interface ConfigCenterPublicPatch {
  domains?: {
    frontendPreferences?: {
      theme?: 'light' | 'dark'
    }
    assistantBehavior?: {
      agentName?: string | null
    }
    hostConfig?: {
      runtimeUrl?: string | null
    }
  }
}

export interface ConfigCenterPublicPatchSuccess {
  ok: true
  snapshot: ConfigCenterPublicSnapshot
}

export interface ConfigCenterPublicPatchFailure {
  ok: false
  error: string
}

export type ConfigCenterPublicPatchResult =
  | ConfigCenterPublicPatchSuccess
  | ConfigCenterPublicPatchFailure

export interface ConfigCenterPublicPatchApi {
  apply: (patch: ConfigCenterPublicPatch) => Promise<ConfigCenterPublicPatchResult>
}

interface ConfigCenterPublicPatchDomainDefinition {
  fields: Record<string, UnifiedConfigFieldKey>
}

const CONFIG_CENTER_PUBLIC_PATCH_DOMAIN_REGISTRY: Record<string, ConfigCenterPublicPatchDomainDefinition> = {
  frontendPreferences: {
    fields: {
      theme: 'theme',
    },
  },
  assistantBehavior: {
    fields: {
      agentName: 'agentName',
    },
  },
  hostConfig: {
    fields: {
      runtimeUrl: 'runtimeUrl',
    },
  },
}

export function parseConfigCenterPublicPatch(input: unknown): UnifiedConfigFieldPatch {
  const patchRecord = asPlainRecord(input, 'Config center public patch must be an object.')
  const domainsRecord = asPlainRecord(
    patchRecord.domains,
    'Config center public patch must include a domains object.',
  )
  const fieldPatch: UnifiedConfigFieldPatch = {}
  let touchedFields = 0

  for (const [publicDomainKey, domainPatchInput] of Object.entries(domainsRecord)) {
    const domainDefinition = CONFIG_CENTER_PUBLIC_PATCH_DOMAIN_REGISTRY[publicDomainKey]

    if (domainDefinition === undefined) {
      throw new Error(`Unknown public config domain: "${publicDomainKey}".`)
    }

    const domainPatchRecord = asPlainRecord(
      domainPatchInput,
      `Public config domain "${publicDomainKey}" patch must be an object.`,
    )

    for (const [publicFieldKey, rawValue] of Object.entries(domainPatchRecord)) {
      const unifiedFieldKey = domainDefinition.fields[publicFieldKey]

      if (unifiedFieldKey === undefined) {
        throw new Error(`Unknown public config field: "${publicDomainKey}.${publicFieldKey}".`)
      }

      const fieldDefinition = UNIFIED_CONFIG_FIELD_REGISTRY[unifiedFieldKey]

      if (!fieldDefinition.rendererEditable) {
        throw new Error(`Public config field "${publicDomainKey}.${publicFieldKey}" is not editable.`)
      }

      try {
        fieldPatch[unifiedFieldKey] = fieldDefinition.parsePatchValue(rawValue)
      } catch (error) {
        throw new Error(
          `Invalid public config field "${publicDomainKey}.${publicFieldKey}": ${formatUnknownError(error)}`,
        )
      }

      touchedFields += 1
    }
  }

  if (touchedFields === 0) {
    throw new Error('Config center public patch must include at least one editable field.')
  }

  return fieldPatch
}

function asPlainRecord(value: unknown, errorMessage: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(errorMessage)
  }

  return value as Record<string, unknown>
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}
