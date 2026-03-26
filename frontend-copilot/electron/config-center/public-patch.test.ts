import { describe, expect, it } from 'vitest'

import { parseConfigCenterPublicPatch } from './public-patch'
import { UNIFIED_CONFIG_FIELD_REGISTRY } from './schema'

describe('parseConfigCenterPublicPatch', () => {
  it('normalizes supported public domains into a unified field patch', () => {
    expect(parseConfigCenterPublicPatch({
      domains: {
        assistantBehavior: {
          agentName: '  planner  ',
        },
        hostConfig: {
          runtimeUrl: '  http://127.0.0.1:4400  ',
        },
      },
    })).toEqual({
      agentName: 'planner',
      runtimeUrl: 'http://127.0.0.1:4400',
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

  it('rejects invalid field values', () => {
    expect(() => parseConfigCenterPublicPatch({
      domains: {
        assistantBehavior: {
          agentName: 42,
        },
      },
    })).toThrow('Invalid public config field "assistantBehavior.agentName": Expected a string or null.')
  })
})
