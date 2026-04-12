import { describe, expect, it } from 'vitest'

import {
  createProviderSelectOptions,
  getProviderCatalog,
  getProviderCatalogEntry,
  getProviderCatalogRevision,
  listProviderCatalogEntriesByStatus,
} from './provider-catalog'

describe('provider catalog', () => {
  it('loads a shared catalog revision with first-batch enabled providers', () => {
    const catalog = getProviderCatalog()

    expect(catalog.catalogRevision).toBe(getProviderCatalogRevision())
    expect(catalog.providers.length).toBeGreaterThan(6)

    const enabledProviders = listProviderCatalogEntriesByStatus('enabled').map((entry) => entry.providerId)
    expect(enabledProviders).toEqual(expect.arrayContaining([
      'openai',
      'anthropic',
      'gemini',
      'ollama',
      'groq',
      'mistral',
    ]))
  })

  it('distinguishes enabled, catalog-only, and legacy-unsupported providers', () => {
    expect(getProviderCatalogEntry('openai')).toMatchObject({
      providerId: 'openai',
      runtimeStatus: 'enabled',
      endpointType: 'openai-compatible',
      adapterId: 'openai',
      authSchema: {
        defaultKind: 'api-key',
      },
    })

    expect(getProviderCatalogEntry('openrouter')).toMatchObject({
      providerId: 'openrouter',
      runtimeStatus: 'catalog-only',
      endpointType: 'openai-compatible',
      adapterId: 'openrouter',
    })

    expect(getProviderCatalogEntry('openai-response')).toMatchObject({
      providerId: 'openai-response',
      runtimeStatus: 'legacy-unsupported',
      endpointType: 'openai-response',
      adapterId: 'openai-response',
    })
  })

  it('resolves aliases and no-auth providers correctly', () => {
    expect(getProviderCatalogEntry('google')).toMatchObject({
      providerId: 'gemini',
      endpointType: 'gemini-native',
    })

    expect(getProviderCatalogEntry('grok')).toMatchObject({
      providerId: 'xai',
      endpointType: 'xai-native',
    })

    expect(getProviderCatalogEntry('ollama')).toMatchObject({
      providerId: 'ollama',
      authSchema: {
        defaultKind: 'none',
        supportedKinds: ['none', 'api-key'],
      },
      baseUrlPolicy: {
        mode: 'optional',
        defaultBaseUrl: 'http://127.0.0.1:11434/v1',
      },
    })
  })

  it('projects provider select options from the shared catalog', () => {
    const options = createProviderSelectOptions()

    expect(options).toEqual(expect.arrayContaining([
      { value: 'openai', label: 'OpenAI' },
      { value: 'anthropic', label: 'Anthropic' },
      { value: 'gemini', label: 'Gemini' },
      { value: 'ollama', label: 'Ollama' },
      { value: 'openrouter', label: 'OpenRouter', hint: '仅数据层兼容' },
      { value: 'openai-response', label: 'OpenAI-Response', hint: '历史兼容 / 当前未启用' },
    ]))
  })
})
