import { describe, expect, it } from 'vitest'

import { parseConfigCenterPublicPatch } from './public-patch'
import { UNIFIED_CONFIG_FIELD_REGISTRY } from './field-registry'

describe('parseConfigCenterPublicPatch', () => {
  it('normalizes supported public domains into a unified field patch', () => {
    expect(parseConfigCenterPublicPatch({
      domains: {
        frontendPreferences: {
          theme: 'dark',
          animationsEnabled: false,
        },
        assistantBehavior: {
          agentName: '  planner  ',
        },
        hostConfig: {
          runtimeUrl: '  http://127.0.0.1:4400  ',
        },
        backendExposed: {
          model: '  qwen-plus  ',
        },
      },
    })).toEqual({
      theme: 'dark',
      animationsEnabled: false,
      agentName: 'planner',
      runtimeUrl: 'http://127.0.0.1:4400',
      model: 'qwen-plus',
    })
  })

  it('rejects unknown public fields', () => {
    expect(() => parseConfigCenterPublicPatch({
      domains: {
        assistantBehavior: {
          theme: 'dark',
        },
      },
    })).toThrow('Unknown public config field: "assistantBehavior.theme".')
  })

  it('rejects non-editable public fields', () => {
    const previousEditable = UNIFIED_CONFIG_FIELD_REGISTRY.runtimeUrl.rendererEditable
    UNIFIED_CONFIG_FIELD_REGISTRY.runtimeUrl.rendererEditable = false

    try {
      expect(() => parseConfigCenterPublicPatch({
        domains: {
          hostConfig: {
            runtimeUrl: 'http://127.0.0.1:4400',
          },
        },
      })).toThrow('Public config field "hostConfig.runtimeUrl" is not editable.')
    } finally {
      UNIFIED_CONFIG_FIELD_REGISTRY.runtimeUrl.rendererEditable = previousEditable
    }
  })

  it('rejects invalid theme values', () => {
    expect(() => parseConfigCenterPublicPatch({
      domains: {
        frontendPreferences: {
          theme: 'system',
        },
      },
    })).toThrow('Invalid public config field "frontendPreferences.theme": Expected "light" or "dark".')
  })

  it('rejects invalid boolean values', () => {
    expect(() => parseConfigCenterPublicPatch({
      domains: {
        frontendPreferences: {
          animationsEnabled: 'nope',
        },
      },
    })).toThrow('Invalid public config field "frontendPreferences.animationsEnabled": Expected a boolean.')
  })
})
