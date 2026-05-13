import { describe, expect, it } from 'vitest'

import { loadBootstrapFieldsFromConfigCenterPublicSnapshot } from './config'
import { createConfigCenterPublicSnapshot } from './config.test-support'

// Duplicate-string constants extracted for sonarjs/no-duplicate-string
const LABEL_HTTP_LOCALHOST_4400 = 'http://localhost:4400'


describe('loadBootstrapFieldsFromConfigCenterPublicSnapshot', () => {
  it('extracts bootstrap fields directly from the config center public snapshot shape', () => {
    expect(loadBootstrapFieldsFromConfigCenterPublicSnapshot(createConfigCenterPublicSnapshot({
      runtimeUrl: LABEL_HTTP_LOCALHOST_4400,
      agentName: 'planner',
      debugModeEnabled: true,
      theme: 'dark',
      model: null,
    }))).toEqual({
      ok: true,
      fields: {
        runtimeUrl: LABEL_HTTP_LOCALHOST_4400,
        agentName: 'planner',
        debugModeEnabled: true,
      },
      storageState: 'stored',
    })
  })

  it('uses runtime url as the only empty/stored readiness delimiter', () => {
    expect(loadBootstrapFieldsFromConfigCenterPublicSnapshot(createConfigCenterPublicSnapshot({
      runtimeUrl: null,
      agentName: 'planner',
      theme: 'dark',
      model: null,
    }))).toEqual({
      ok: true,
      fields: {
        runtimeUrl: null,
        agentName: 'planner',
        debugModeEnabled: false,
      },
      storageState: 'empty',
    })
  })

  it('ignores theme and model differences when deriving bootstrap readiness fields', () => {
    const withDarkTheme = loadBootstrapFieldsFromConfigCenterPublicSnapshot(createConfigCenterPublicSnapshot({
      runtimeUrl: LABEL_HTTP_LOCALHOST_4400,
      agentName: 'planner',
      theme: 'dark',
      model: null,
    }))

    const withLightThemeAndModel = loadBootstrapFieldsFromConfigCenterPublicSnapshot(createConfigCenterPublicSnapshot({
      runtimeUrl: LABEL_HTTP_LOCALHOST_4400,
      agentName: 'planner',
      theme: 'light',
      model: 'gpt-4.1-mini',
    }))

    expect(withLightThemeAndModel).toEqual(withDarkTheme)
  })
})
