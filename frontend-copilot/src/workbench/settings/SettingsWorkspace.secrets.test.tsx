/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest'

import {
  blurElement,
  clickElement,
  createPersistedSecretStatesResult,
  flushAsyncEffects,
  installSettingsWorkspaceBridge,
  mockClipboardWriteText,
  renderSettingsWorkspace,
  setFormControlValue,
} from './SettingsWorkspace.test-support'

describe('SettingsWorkspace secrets', () => {
  it('supports showing, hiding, and copying the provider api key', async () => {
    const clipboardWriteText = mockClipboardWriteText()
    installSettingsWorkspaceBridge()

    const rendered = renderSettingsWorkspace({
      initialSection: 'model-service',
    })

    await flushAsyncEffects()

    const apiKeyInput = rendered.getByTestId('provider-api-key-input') as HTMLInputElement
    expect(apiKeyInput.type).toBe('password')

    await setFormControlValue(apiKeyInput, 'secret-api-key')
    expect(apiKeyInput.value).toBe('secret-api-key')

    await clickElement(rendered.getByTestId('provider-api-key-visibility-toggle'))
    expect((rendered.getByTestId('provider-api-key-input') as HTMLInputElement).type).toBe('text')

    await clickElement(rendered.getByTestId('provider-api-key-visibility-toggle'))
    expect((rendered.getByTestId('provider-api-key-input') as HTMLInputElement).type).toBe('password')

    await clickElement(rendered.getByTestId('provider-api-key-copy'))

    expect(clipboardWriteText).toHaveBeenCalledWith('secret-api-key')
    expect(rendered.getByTestId('provider-api-key-feedback').textContent).toBe('已复制 API 密钥')

    rendered.unmount()
  })

  it('auto-saves provider api keys on blur and clears them when the draft becomes empty', async () => {
    const { saveProviderApiKey, clearProviderApiKey } = installSettingsWorkspaceBridge({
      saveProviderApiKeyResult: {
        ok: true,
        providerId: 'openrouter',
        state: {
          hasApiKey: true,
          apiKey: 'rotated-secret',
        },
      },
      clearProviderApiKeyResult: {
        ok: true,
        providerId: 'openrouter',
        state: {
          hasApiKey: false,
          apiKey: '',
        },
      },
    })

    const rendered = renderSettingsWorkspace({
      initialSection: 'model-service',
    })

    await flushAsyncEffects()

    const apiKeyInput = rendered.getByTestId('provider-api-key-input') as HTMLInputElement
    await setFormControlValue(apiKeyInput, 'rotated-secret')
    await blurElement(apiKeyInput)

    expect(saveProviderApiKey).toHaveBeenCalledWith({
      providerId: 'openrouter',
      apiKey: 'rotated-secret',
    })
    expect(apiKeyInput.value).toBe('rotated-secret')
    expect(rendered.getByTestId('provider-api-key-feedback').textContent).toBe('已自动保存 API 密钥')

    await setFormControlValue(apiKeyInput, '')
    await blurElement(apiKeyInput)

    expect(clearProviderApiKey).toHaveBeenCalledWith({
      providerId: 'openrouter',
    })
    expect(apiKeyInput.value).toBe('')
    expect(rendered.getByTestId('provider-api-key-feedback').textContent).toBe('已清除 API 密钥')

    rendered.unmount()
  })

  it('restores saved provider api keys for viewing and copying without helper descriptions', async () => {
    const clipboardWriteText = mockClipboardWriteText()
    installSettingsWorkspaceBridge({
      loadStatusesResult: createPersistedSecretStatesResult('persisted-secret', 'openrouter'),
    })

    const rendered = renderSettingsWorkspace({
      initialSection: 'model-service',
    })

    await flushAsyncEffects()

    const apiKeyInput = rendered.getByTestId('provider-api-key-input') as HTMLInputElement
    expect(apiKeyInput.value).toBe('persisted-secret')
    expect(apiKeyInput.type).toBe('password')
    expect(rendered.queryByTestId('provider-api-key-status')).toBeNull()
    expect(rendered.container.textContent).not.toContain('失焦会自动保存')
    expect(rendered.container.textContent).not.toContain('不会回填原文')
    expect(rendered.container.textContent).not.toContain('主进程持有')

    await clickElement(rendered.getByTestId('provider-api-key-visibility-toggle'))
    expect((rendered.getByTestId('provider-api-key-input') as HTMLInputElement).type).toBe('text')

    await clickElement(rendered.getByTestId('provider-api-key-copy'))

    expect(clipboardWriteText).toHaveBeenCalledWith('persisted-secret')
    expect(rendered.getByTestId('provider-api-key-feedback').textContent).toBe('已复制 API 密钥')

    rendered.unmount()
  })

  it('keeps provider api key drafts visible after auto-save and preserves show hide toggle behavior', async () => {
    const { saveProviderApiKey } = installSettingsWorkspaceBridge({
      saveProviderApiKeyResult: {
        ok: true,
        providerId: 'openrouter',
        state: {
          hasApiKey: true,
          apiKey: 'secret-after-blur',
        },
      },
    })

    const rendered = renderSettingsWorkspace({
      initialSection: 'model-service',
    })

    await flushAsyncEffects()

    const apiKeyInput = rendered.getByTestId('provider-api-key-input') as HTMLInputElement
    expect(apiKeyInput.type).toBe('password')

    await setFormControlValue(apiKeyInput, 'secret-after-blur')
    await blurElement(apiKeyInput)

    expect(saveProviderApiKey).toHaveBeenCalledWith({
      providerId: 'openrouter',
      apiKey: 'secret-after-blur',
    })
    expect(apiKeyInput.value).toBe('secret-after-blur')

    await clickElement(rendered.getByTestId('provider-api-key-visibility-toggle'))
    expect((rendered.getByTestId('provider-api-key-input') as HTMLInputElement).type).toBe('text')

    await clickElement(rendered.getByTestId('provider-api-key-visibility-toggle'))
    expect((rendered.getByTestId('provider-api-key-input') as HTMLInputElement).type).toBe('password')

    rendered.unmount()
  })

  it('keeps provider api key drafts and shows feedback when auto-save fails', async () => {
    const { saveProviderApiKey } = installSettingsWorkspaceBridge({
      saveProviderApiKeyResult: {
        ok: false,
        error: 'save failed',
      },
    })

    const rendered = renderSettingsWorkspace({
      initialSection: 'model-service',
    })

    await flushAsyncEffects()

    const apiKeyInput = rendered.getByTestId('provider-api-key-input') as HTMLInputElement
    await setFormControlValue(apiKeyInput, 'failed-secret')
    await blurElement(apiKeyInput)

    expect(saveProviderApiKey).toHaveBeenCalledWith({
      providerId: 'openrouter',
      apiKey: 'failed-secret',
    })
    expect(apiKeyInput.value).toBe('failed-secret')
    expect(rendered.getByTestId('provider-api-key-feedback').textContent).toBe('保存失败，请稍后重试')

    rendered.unmount()
  })

  it('loads, auto-saves, and clears the sustech cas password on blur', async () => {
    const { saveSustechCasPassword, clearSustechCasPassword } = installSettingsWorkspaceBridge({
      loadSustechCasPasswordResult: {
        ok: true,
        state: {
          hasPassword: true,
          password: 'persisted-cas-secret',
        },
      },
      saveSustechCasPasswordResult: {
        ok: true,
        state: {
          hasPassword: true,
          password: 'rotated-cas-secret',
        },
      },
      clearSustechCasPasswordResult: {
        ok: true,
        state: {
          hasPassword: false,
          password: '',
        },
      },
    })

    const rendered = renderSettingsWorkspace({
      initialSection: 'sustech-info',
    })

    await flushAsyncEffects()

    const casPasswordInput = rendered.getByTestId('sustech-cas-password-input') as HTMLInputElement
    expect(casPasswordInput.type).toBe('password')
    expect(casPasswordInput.value).toBe('persisted-cas-secret')

    await setFormControlValue(casPasswordInput, 'rotated-cas-secret')
    await blurElement(casPasswordInput)

    expect(saveSustechCasPassword).toHaveBeenCalledWith({
      password: 'rotated-cas-secret',
    })
    expect(casPasswordInput.value).toBe('rotated-cas-secret')
    expect(rendered.container.textContent).toContain('已自动保存 CAS 密码')

    await setFormControlValue(casPasswordInput, '')
    await blurElement(casPasswordInput)

    expect(clearSustechCasPassword).toHaveBeenCalled()
    expect(casPasswordInput.value).toBe('')
    expect(rendered.container.textContent).toContain('已清除 CAS 密码')

    rendered.unmount()
  })
})
