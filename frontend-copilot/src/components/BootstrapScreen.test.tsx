/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'

import { primeStartupTheme } from '../startup-theme'

describe('startup theme bootstrap', () => {
  it('applies the dark theme to the document root before the loading shell continues rendering', async () => {
    document.documentElement.dataset.theme = 'light'

    await primeStartupTheme(async () => ({
      ok: true,
      snapshot: {
        version: 1,
        domains: {
          frontendPreferences: {
            theme: 'dark',
            animationsEnabled: true,
          },
          assistantBehavior: {
            agentName: null,
          },
          hostConfig: {
            runtimeUrl: null,
          },
          backendExposed: {
            model: null,
          },
        },
      },
    }))

    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
