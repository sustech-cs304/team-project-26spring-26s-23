import { describe, expect, it } from 'vitest'

import { normalizeSettingsWorkspaceSecretsDocument, projectProviderSecretStateById } from './secret-schema'

describe('settings workspace secret schema migration', () => {
  it('migrates legacy api key records into auth envelopes keyed by profile id', () => {
    const document = normalizeSettingsWorkspaceSecretsDocument({
      version: 1,
      kind: 'settings-workspace-secrets',
      values: {
        providerSecrets: {
          'profile-openai': {
            apiKey: 'sk-test-123',
          },
        },
        sustech: {
          casPassword: '',
        },
      },
    })

    expect(document).toEqual({
      version: 2,
      kind: 'settings-workspace-secrets',
      values: {
        providerSecrets: {
          'profile-openai': {
            profileId: 'profile-openai',
            authKind: 'api-key',
            secretValues: {
              apiKey: 'sk-test-123',
            },
          },
        },
        sustech: {
          casPassword: '',
        },
      },
    })
  })

  it('keeps ollama no-key secret state readable without requiring a persisted secret record', () => {
    const document = normalizeSettingsWorkspaceSecretsDocument({
      version: 2,
      kind: 'settings-workspace-secrets',
      values: {
        providerSecrets: {},
        sustech: {
          casPassword: '',
        },
      },
    })

    expect(projectProviderSecretStateById(['ollama-local'], document)).toEqual({
      'ollama-local': {
        hasApiKey: false,
        apiKey: '',
      },
    })
  })
})
