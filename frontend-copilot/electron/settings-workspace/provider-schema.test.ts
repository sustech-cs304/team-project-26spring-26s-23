import { describe, expect, it } from 'vitest'

import type { ProviderModelProfile, ProviderProfile } from '../../src/workbench/types'
import {
  cloneProviderModelProfile,
  cloneStoredProviderProfile,
  createDefaultStoredProviderProfiles,
  normalizeStoredProviderProfiles,
  projectEditableProviderProfile,
  projectStoredProviderProfile,
  type SettingsWorkspaceStoredProviderProfile,
} from './provider-schema'

function makeProviderProfile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'test-profile',
    name: 'Test Profile',
    protocol: 'openai',
    endpoint: 'https://api.openai.com/v1',
    hasApiKey: false,
    fastModel: '',
    fallbackModel: '',
    organization: '',
    region: '',
    notes: '',
    availableModels: [
      {
        id: 'test-model-1',
        modelId: 'gpt-4.1',
        displayName: 'GPT-4.1',
        groupName: 'Test Group',
        capabilities: ['reasoning'],
        supportsStreaming: true,
        currency: 'usd',
        inputPrice: '0.50',
        outputPrice: '3.00',
      },
    ],
    ...overrides,
  }
}

function makeStoredProviderProfile(
  overrides: Partial<SettingsWorkspaceStoredProviderProfile> = {},
): SettingsWorkspaceStoredProviderProfile {
  return {
    profileId: 'test-profile',
    providerId: 'openai',
    displayName: 'Test Profile',
    baseUrl: 'https://api.openai.com/v1',
    models: [
      {
        id: 'test-model-1',
        modelId: 'gpt-4.1',
        displayName: 'GPT-4.1',
        groupName: 'Test Group',
        capabilities: ['reasoning'],
        thinkingCapability: undefined,
        supportsStreaming: true,
        currency: 'usd',
        inputPrice: '0.50',
        outputPrice: '3.00',
      },
    ],
    compatibility: { status: 'active' as const, reason: '' },
    extensions: {},
    ...overrides,
  }
}

describe('createDefaultStoredProviderProfiles', () => {
  it('returns an array', () => {
    const result = createDefaultStoredProviderProfiles()
    expect(Array.isArray(result)).toBe(true)
  })

  it('each stored profile has required shape when defaults exist', () => {
    const result = createDefaultStoredProviderProfiles()
    for (const profile of result) {
      expect(typeof profile.profileId).toBe('string')
      expect(typeof profile.providerId).toBe('string')
      expect(typeof profile.displayName).toBe('string')
      expect(typeof profile.baseUrl).toBe('string')
      expect(Array.isArray(profile.models)).toBe(true)
      expect(profile.compatibility).toBeDefined()
      expect(profile.extensions).toBeDefined()
    }
  })
})

describe('projectStoredProviderProfile', () => {
  it('maps profileId from profileId or falls back to id', () => {
    const result = projectStoredProviderProfile(makeProviderProfile({ profileId: 'my-id', id: 'other-id' }))
    expect(result.profileId).toBe('my-id')
  })

  it('falls back profileId to id when profileId is missing', () => {
    const result = projectStoredProviderProfile(
      makeProviderProfile({ id: 'only-id', profileId: undefined }),
    )
    expect(result.profileId).toBe('only-id')
  })

  it('resolves providerId from known provider', () => {
    const result = projectStoredProviderProfile(makeProviderProfile({ providerId: 'openai', protocol: '' }))
    expect(result.providerId).toBe('openai')
  })

  it('resolves providerId from protocol when providerId is missing', () => {
    const result = projectStoredProviderProfile(
      makeProviderProfile({ providerId: undefined, protocol: 'openai' }),
    )
    expect(result.providerId).toBe('openai')
  })

  it('falls back to unknown-provider when all identifiers are empty', () => {
    const result = projectStoredProviderProfile(
      makeProviderProfile({ providerId: undefined, protocol: '', profileId: undefined, id: '' }),
    )
    expect(result.providerId).toBe('unknown-provider')
  })

  it('normalizes displayName from name', () => {
    const result = projectStoredProviderProfile(
      makeProviderProfile({ name: '  Display Name  ', displayName: undefined }),
    )
    expect(result.displayName).toBe('Display Name')
  })

  it('prefers name over displayName when both are provided', () => {
    const result = projectStoredProviderProfile(
      makeProviderProfile({ displayName: 'Preferred Name', name: 'Name Takes Priority' }),
    )
    expect(result.displayName).toBe('Name Takes Priority')
  })

  it('falls back to displayName when name is empty', () => {
    const result = projectStoredProviderProfile(
      makeProviderProfile({ displayName: 'Fallback Display Name', name: '' }),
    )
    expect(result.displayName).toBe('Fallback Display Name')
  })

  it('uses endpoint as baseUrl when baseUrl is undefined (fallback IS trimmed)', () => {
    const result = projectStoredProviderProfile(
      makeProviderProfile({ baseUrl: undefined, endpoint: '   https://endpoint.com/v1  ' }),
    )
    expect(result.baseUrl).toBe('https://endpoint.com/v1')
  })

  it('uses baseUrl when defined', () => {
    const result = projectStoredProviderProfile(
      makeProviderProfile({ baseUrl: 'https://custom.example.com', endpoint: 'https://ignored.example.com' }),
    )
    expect(result.baseUrl).toBe('https://custom.example.com')
  })

  it('normalizes empty availableModels to empty array', () => {
    const profile = makeProviderProfile({ availableModels: undefined as unknown as ProviderModelProfile[] })
    const result = projectStoredProviderProfile(profile)
    expect(result.models).toEqual([])
  })

  it('normalizes model capabilities with defaults', () => {
    const noCapsModel: ProviderModelProfile = {
      id: 'no-caps',
      modelId: 'model-no-caps',
      displayName: 'No Caps',
      groupName: 'Group',
      capabilities: undefined as unknown as [],
      supportsStreaming: false,
      currency: '',
      inputPrice: '',
      outputPrice: '',
    }
    const result = projectStoredProviderProfile(
      makeProviderProfile({ availableModels: [noCapsModel] }),
    )
    expect(result.models[0]!.capabilities).toEqual(['reasoning'])
  })

  it('preserves known model capabilities', () => {
    const result = projectStoredProviderProfile(
      makeProviderProfile({
        availableModels: [{
          id: 'multi-cap',
          modelId: 'multi-model',
          displayName: 'Multi',
          groupName: 'Group',
          capabilities: ['vision', 'tools', 'search'],
          supportsStreaming: true,
          currency: 'cny',
          inputPrice: '1.00',
          outputPrice: '5.00',
        }],
      }),
    )
    expect(result.models[0]!.capabilities).toEqual(['vision', 'tools', 'search'])
  })

  it('marks known providers with active compatibility', () => {
    const result = projectStoredProviderProfile(
      makeProviderProfile({ providerId: 'openai', protocol: 'openai' }),
    )
    expect(result.compatibility).toEqual({ status: 'active', reason: '' })
  })

  it('marks unknown providers as unsupported', () => {
    const result = projectStoredProviderProfile(
      makeProviderProfile({ providerId: 'not-a-known-provider-xyz', protocol: '', id: 'unknown-id' }),
    )
    expect(result.compatibility.status).toBe('unsupported')
    expect(result.compatibility.reason).toContain('not defined in the current provider catalog')
  })

  it('marks legacy unsupported providers', () => {
    const result = projectStoredProviderProfile(
      makeProviderProfile({ providerId: 'openai-response', protocol: 'openai-response' }),
    )
    expect(result.compatibility.status).toBe('legacy')
    expect(result.compatibility.reason).toContain('legacy / unsupported')
  })

  it('propagates fastModel and fallbackModel into extensions', () => {
    const result = projectStoredProviderProfile(
      makeProviderProfile({ fastModel: 'gpt-4.1-mini', fallbackModel: 'gpt-3.5-turbo' }),
    )
    expect(result.extensions.fastModel).toBe('gpt-4.1-mini')
    expect(result.extensions.fallbackModel).toBe('gpt-3.5-turbo')
  })

  it('propagates organization, region, notes into extensions', () => {
    const result = projectStoredProviderProfile(
      makeProviderProfile({ organization: 'my-org', region: 'us-east', notes: 'test notes' }),
    )
    expect(result.extensions.organization).toBe('my-org')
    expect(result.extensions.region).toBe('us-east')
    expect(result.extensions.notes).toBe('test notes')
  })

  it('includes legacyProtocol extension when protocol differs from resolved providerId', () => {
    const result = projectStoredProviderProfile(
      makeProviderProfile({ providerId: 'openai', protocol: 'my-custom-protocol' }),
    )
    expect(result.extensions.legacyProtocol).toBe('my-custom-protocol')
  })

  it('model defaults currency to usd when not provided', () => {
    const model: ProviderModelProfile = {
      id: 'minimal',
      modelId: 'minimal-model',
      displayName: 'Min',
      groupName: 'G',
      capabilities: ['reasoning'],
      supportsStreaming: true,
      currency: '',
      inputPrice: '',
      outputPrice: '',
    }
    const result = projectStoredProviderProfile(makeProviderProfile({ availableModels: [model] }))
    expect(result.models[0]!.currency).toBe('usd')
  })

  it('model defaults prices when not provided', () => {
    const model: ProviderModelProfile = {
      id: 'minimal',
      modelId: 'minimal-model',
      displayName: 'Min',
      groupName: 'G',
      capabilities: ['reasoning'],
      supportsStreaming: true,
      currency: '',
      inputPrice: '',
      outputPrice: '',
    }
    const result = projectStoredProviderProfile(makeProviderProfile({ availableModels: [model] }))
    expect(result.models[0]!.inputPrice).toBe('0.50')
    expect(result.models[0]!.outputPrice).toBe('3.00')
  })
})

describe('projectEditableProviderProfile', () => {
  it('maps stored profile to editable ProviderProfile', () => {
    const stored = makeStoredProviderProfile({
      extensions: {
        fastModel: 'fast-model',
        fallbackModel: 'fallback-model',
        organization: 'org',
        region: 'region',
        notes: 'notes',
        legacyProtocol: 'google',
      },
    })
    const result = projectEditableProviderProfile(stored, true)
    expect(result.id).toBe('test-profile')
    expect(result.profileId).toBe('test-profile')
    expect(result.providerId).toBe('openai')
    expect(result.name).toBe('Test Profile')
    expect(result.displayName).toBe('Test Profile')
    expect(result.protocol).toBe('google')
    expect(result.endpoint).toBe('https://api.openai.com/v1')
    expect(result.baseUrl).toBe('https://api.openai.com/v1')
    expect(result.hasApiKey).toBe(true)
    expect(result.fastModel).toBe('fast-model')
    expect(result.fallbackModel).toBe('fallback-model')
    expect(result.organization).toBe('org')
    expect(result.region).toBe('region')
    expect(result.notes).toBe('notes')
  })

  it('maps hasApiKey from parameter', () => {
    const stored = makeStoredProviderProfile()
    expect(projectEditableProviderProfile(stored, true).hasApiKey).toBe(true)
    expect(projectEditableProviderProfile(stored, false).hasApiKey).toBe(false)
  })

  it('uses providerId as protocol when legacyProtocol is not in extensions', () => {
    const stored = makeStoredProviderProfile({ extensions: {} })
    const result = projectEditableProviderProfile(stored, false)
    expect(result.protocol).toBe('openai')
  })

  it('maps models to availableModels', () => {
    const stored = makeStoredProviderProfile()
    const result = projectEditableProviderProfile(stored, false)
    expect(result.availableModels).toHaveLength(1)
    expect(result.availableModels[0]!.modelId).toBe('gpt-4.1')
  })

  it('preserves compatibility info', () => {
    const stored = makeStoredProviderProfile({
      compatibility: { status: 'legacy', reason: 'old provider' },
    })
    const result = projectEditableProviderProfile(stored, false)
    expect(result.compatibility).toEqual({ status: 'legacy', reason: 'old provider' })
  })
})

describe('cloneStoredProviderProfile', () => {
  it('returns a deep clone, not the same reference', () => {
    const stored = makeStoredProviderProfile()
    const cloned = cloneStoredProviderProfile(stored)
    expect(cloned).toEqual(stored)
    expect(cloned).not.toBe(stored)
    expect(cloned.models).not.toBe(stored.models)
    expect(cloned.models[0]!.capabilities).not.toBe(stored.models[0]!.capabilities)
  })

  it('clones compatibility separately', () => {
    const stored = makeStoredProviderProfile({
      compatibility: { status: 'active', reason: 'ok' },
    })
    const cloned = cloneStoredProviderProfile(stored)
    expect(cloned.compatibility).toEqual(stored.compatibility)
    expect(cloned.compatibility).not.toBe(stored.compatibility)
  })

  it('clones extensions separately', () => {
    const stored = makeStoredProviderProfile({ extensions: { key: 'value' } })
    const cloned = cloneStoredProviderProfile(stored)
    expect(cloned.extensions).toEqual(stored.extensions)
    expect(cloned.extensions).not.toBe(stored.extensions)
  })
})

describe('cloneProviderModelProfile', () => {
  it('returns a deep clone, not the same reference', () => {
    const model: ProviderModelProfile = {
      id: 'm1',
      modelId: 'gpt-4.1',
      displayName: 'GPT',
      groupName: 'G',
      capabilities: ['reasoning'],
      supportsStreaming: true,
      currency: 'usd',
      inputPrice: '0.50',
      outputPrice: '3.00',
    }
    const cloned = cloneProviderModelProfile(model)
    expect(cloned).toEqual(model)
    expect(cloned).not.toBe(model)
    expect(cloned.capabilities).not.toBe(model.capabilities)
  })
})

describe('normalizeStoredProviderProfiles', () => {
  it('returns defaults when input is not an array', () => {
    const result = normalizeStoredProviderProfiles(null)
    expect(result).toEqual(createDefaultStoredProviderProfiles())
  })

  it('returns defaults for undefined input', () => {
    const result = normalizeStoredProviderProfiles(undefined)
    expect(result).toEqual(createDefaultStoredProviderProfiles())
  })

  it('returns defaults for string input', () => {
    const result = normalizeStoredProviderProfiles('invalid')
    expect(result).toEqual(createDefaultStoredProviderProfiles())
  })

  it('returns defaults for empty array', () => {
    const result = normalizeStoredProviderProfiles([])
    expect(result).toEqual(createDefaultStoredProviderProfiles())
  })

  it('generates fallback profiles when input objects lack id/profileId', () => {
    // When neither profileId nor id is provided, the normalizer generates default values
    // (provider-N fallback) and creates a valid profile rather than filtering it out.
    // Only empty array input triggers the default-profiles fallback.
    const result = normalizeStoredProviderProfiles([{ invalid: true }])
    expect(result).toHaveLength(1)
    expect(result[0]!.profileId).toBe('provider-1')
  })

  it('normalizes a valid profile with known provider', () => {
    const result = normalizeStoredProviderProfiles([
      {
        id: 'my-openai',
        name: 'My OpenAI',
        providerId: 'openai',
        baseUrl: 'https://my-openai.example.com/v1',
        models: [{ modelId: 'gpt-4.1', displayName: 'GPT-4.1' }],
      },
    ])
    expect(result).toHaveLength(1)
    expect(result[0]!.profileId).toBe('my-openai')
    expect(result[0]!.providerId).toBe('openai')
    expect(result[0]!.displayName).toBe('My OpenAI')
    expect(result[0]!.baseUrl).toBe('https://my-openai.example.com/v1')
    expect(result[0]!.compatibility.status).toBe('active')
  })

  it('handles legacy profile with protocol instead of providerId', () => {
    const result = normalizeStoredProviderProfiles([
      {
        id: 'legacy-google',
        name: 'Legacy Google',
        protocol: 'google',
        baseUrl: 'https://google.example.com',
        models: [{ modelId: 'gemini-pro' }],
      },
    ])
    expect(result).toHaveLength(1)
    // 'google' is not a catalog identifier but normalizes; unknown providers get unsupported
  })

  it('defaults profileId from id when profileId not set', () => {
    const result = normalizeStoredProviderProfiles([
      { id: 'my-profile', name: 'My Profile', providerId: 'openai', models: [] },
    ])
    expect(result[0]!.profileId).toBe('my-profile')
  })

  it('defaults displayName from name', () => {
    const result = normalizeStoredProviderProfiles([
      { id: 'p1', name: 'Named Provider', providerId: 'openai', models: [] },
    ])
    expect(result[0]!.displayName).toBe('Named Provider')
  })

  it('uses endpoint as baseUrl when baseUrl is not set', () => {
    const result = normalizeStoredProviderProfiles([
      { id: 'p1', name: 'P1', providerId: 'openai', endpoint: 'https://endpoint.com', models: [] },
    ])
    expect(result[0]!.baseUrl).toBe('https://endpoint.com')
  })

  it('normalizes availableModels as models field', () => {
    const result = normalizeStoredProviderProfiles([
      {
        id: 'p1',
        name: 'P1',
        providerId: 'openai',
        availableModels: [{ modelId: 'gpt-4.1' }, { modelId: 'gpt-4.1-mini' }],
      },
    ])
    expect(result[0]!.models).toHaveLength(2)
    expect(result[0]!.models.map((m) => m.modelId)).toEqual(['gpt-4.1', 'gpt-4.1-mini'])
  })

  it('prefers models over availableModels', () => {
    const result = normalizeStoredProviderProfiles([
      {
        id: 'p1',
        name: 'P1',
        providerId: 'openai',
        models: [{ modelId: 'preferred-model' }],
        availableModels: [{ modelId: 'ignored-model' }],
      },
    ])
    expect(result[0]!.models).toHaveLength(1)
    expect(result[0]!.models[0]!.modelId).toBe('preferred-model')
  })

  it('preserves explicit compatibility status', () => {
    const result = normalizeStoredProviderProfiles([
      {
        id: 'p1',
        name: 'P1',
        providerId: 'openai',
        compatibility: { status: 'legacy', reason: 'migrated' },
        models: [],
      },
    ])
    expect(result[0]!.compatibility).toEqual({ status: 'legacy', reason: 'migrated' })
  })

  it('preserves explicit unsupported compatibility', () => {
    const result = normalizeStoredProviderProfiles([
      {
        id: 'p1',
        name: 'P1',
        providerId: 'openai',
        compatibility: { status: 'unsupported' as const, reason: 'blocked' },
        models: [],
      },
    ])
    expect(result[0]!.compatibility).toEqual({ status: 'unsupported', reason: 'blocked' })
  })

  it('marks unknown providers as unsupported', () => {
    const result = normalizeStoredProviderProfiles([
      { id: 'p1', name: 'P1', providerId: 'definitely-not-real-provider-12345', models: [] },
    ])
    expect(result[0]!.compatibility.status).toBe('unsupported')
  })

  it('normalizes model capabilities from array', () => {
    const result = normalizeStoredProviderProfiles([
      {
        id: 'p1',
        name: 'P1',
        providerId: 'openai',
        models: [{ modelId: 'm1', capabilities: ['vision', 'tools'] }],
      },
    ])
    expect(result[0]!.models[0]!.capabilities).toEqual(['vision', 'tools'])
  })

  it('deduplicates model capabilities', () => {
    const result = normalizeStoredProviderProfiles([
      {
        id: 'p1',
        name: 'P1',
        providerId: 'openai',
        models: [{ modelId: 'm1', capabilities: ['vision', 'vision', 'tools'] }],
      },
    ])
    expect(result[0]!.models[0]!.capabilities).toEqual(['vision', 'tools'])
  })

  it('skips models with empty modelId', () => {
    const result = normalizeStoredProviderProfiles([
      {
        id: 'p1',
        name: 'P1',
        providerId: 'openai',
        models: [{ modelId: '' }, { modelId: 'valid-model' }],
      },
    ])
    expect(result[0]!.models).toHaveLength(1)
    expect(result[0]!.models[0]!.modelId).toBe('valid-model')
  })

  it('normalizes extension values with fastModel and fallbackModel', () => {
    const result = normalizeStoredProviderProfiles([
      {
        id: 'p1',
        name: 'P1',
        providerId: 'openai',
        fastModel: 'fast-one',
        fallbackModel: 'backup-one',
        models: [],
      },
    ])
    expect(result[0]!.extensions.fastModel).toBe('fast-one')
    expect(result[0]!.extensions.fallbackModel).toBe('backup-one')
  })

  it('filters extension values that are empty strings', () => {
    const result = normalizeStoredProviderProfiles([
      {
        id: 'p1',
        name: 'P1',
        providerId: 'openai',
        fastModel: '   ',
        fallbackModel: '',
        models: [],
      },
    ])
    expect(result[0]!.extensions.fastModel).toBeUndefined()
    expect(result[0]!.extensions.fallbackModel).toBeUndefined()
  })

  it('preserves numeric and boolean extension values', () => {
    const result = normalizeStoredProviderProfiles([
      {
        id: 'p1',
        name: 'P1',
        providerId: 'openai',
        extensions: { numKey: 42, boolKey: true, nullKey: null },
        models: [],
      },
    ])
    expect(result[0]!.extensions.numKey).toBe(42)
    expect(result[0]!.extensions.boolKey).toBe(true)
    expect(result[0]!.extensions.nullKey).toBeNull()
  })

  it('filters NaN and Infinity from extension values', () => {
    const result = normalizeStoredProviderProfiles([
      {
        id: 'p1',
        name: 'P1',
        providerId: 'openai',
        extensions: { nanKey: NaN, infKey: Infinity },
        models: [],
      },
    ])
    expect(result[0]!.extensions.nanKey).toBeUndefined()
    expect(result[0]!.extensions.infKey).toBeUndefined()
  })

  it('normalizes multiple profiles', () => {
    const result = normalizeStoredProviderProfiles([
      { id: 'openai-p', name: 'OpenAI', providerId: 'openai', models: [{ modelId: 'gpt-4' }] },
      { id: 'gemini-p', name: 'Gemini', providerId: 'gemini', models: [{ modelId: 'gemini-pro' }] },
    ])
    expect(result).toHaveLength(2)
    expect(result[0]!.profileId).toBe('openai-p')
    expect(result[1]!.profileId).toBe('gemini-p')
  })

  it('generates default profileId when no id is provided', () => {
    const result = normalizeStoredProviderProfiles([
      { name: 'No ID', providerId: 'openai', models: [] },
    ])
    expect(result[0]!.profileId).toBe('provider-1')
  })

  it('generates incremental default profileIds for multiple without ids', () => {
    const result = normalizeStoredProviderProfiles([
      { name: 'First', providerId: 'openai', models: [] },
      { name: 'Second', providerId: 'openai', models: [] },
    ])
    expect(result[0]!.profileId).toBe('provider-1')
    expect(result[1]!.profileId).toBe('provider-2')
  })
})
