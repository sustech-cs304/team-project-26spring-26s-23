/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'

import type { ProviderProfile, ThinkingCapabilityDeclaration } from '../types'
import {
  resolveThinkingCompatibilityWarning,
  THINKING_COMPATIBILITY_WARNING_MESSAGE,
} from './thinking-compatibility-warning'

function createProviderProfile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'provider-1',
    profileId: 'provider-1',
    providerId: 'openai',
    name: 'Provider',
    displayName: 'Provider',
    protocol: 'openai',
    endpoint: 'https://api.openai.com/v1',
    baseUrl: 'https://api.openai.com/v1',
    hasApiKey: false,
    fastModel: '',
    fallbackModel: '',
    organization: '',
    region: '',
    notes: '',
    availableModels: [],
    ...overrides,
  }
}

function createSupportedThinkingCapability(series: string): ThinkingCapabilityDeclaration {
  return {
    supported: true,
    series,
    source: 'settings-page',
  }
}

describe('resolveThinkingCompatibilityWarning', () => {
  it('warns when an OpenAI-style provider uses an Anthropic-style series', () => {
    const result = resolveThinkingCompatibilityWarning({
      providerProfile: createProviderProfile({ providerId: 'openai', protocol: 'openai' }),
      thinkingCapability: createSupportedThinkingCapability('anthropic-adaptive-max-v1'),
    })

    expect(result).toMatchObject({
      shouldWarn: true,
      message: THINKING_COMPATIBILITY_WARNING_MESSAGE,
      reason: 'cross_style',
      seriesCategory: 'anthropic',
      providerStyle: 'openai',
    })
  })

  it('does not warn when an OpenAI-style provider uses an OpenAI-style series', () => {
    const result = resolveThinkingCompatibilityWarning({
      providerProfile: createProviderProfile({ providerId: 'openai', protocol: 'openai' }),
      thinkingCapability: createSupportedThinkingCapability('openai-6-level-superset-v1'),
    })

    expect(result).toMatchObject({
      shouldWarn: false,
      message: null,
      reason: 'matching_style',
      seriesCategory: 'openai',
      providerStyle: 'openai',
    })
  })

  it('does not warn for generic unified series', () => {
    const result = resolveThinkingCompatibilityWarning({
      providerProfile: createProviderProfile({ providerId: 'gemini', protocol: 'gemini' }),
      thinkingCapability: createSupportedThinkingCapability('unified-4-level-v1'),
    })

    expect(result).toMatchObject({
      shouldWarn: false,
      message: null,
      reason: 'generic_series',
      seriesCategory: 'generic',
      providerStyle: 'gemini',
    })
  })

  it('warns for unknown custom series on an unknown provider style', () => {
    const result = resolveThinkingCompatibilityWarning({
      providerProfile: createProviderProfile({
        providerId: 'custom-provider',
        protocol: 'custom-provider',
        endpoint: 'https://example.com/v1',
        baseUrl: 'https://example.com/v1',
      }),
      thinkingCapability: createSupportedThinkingCapability('custom-series-v1'),
    })

    expect(result).toMatchObject({
      shouldWarn: true,
      message: THINKING_COMPATIBILITY_WARNING_MESSAGE,
      reason: 'unknown_series',
      seriesCategory: 'unknown',
      providerStyle: 'unknown',
    })
  })

  it('does not warn when thinking is not explicitly supported', () => {
    const result = resolveThinkingCompatibilityWarning({
      providerProfile: createProviderProfile(),
      thinkingCapability: undefined,
    })

    expect(result).toMatchObject({
      shouldWarn: false,
      message: null,
      reason: 'thinking_not_supported',
    })
  })
})
