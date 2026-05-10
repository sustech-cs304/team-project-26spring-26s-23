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

const API_KEY_INPUT_ID = 'provider-api-key-input'
const API_KEY_VISIBILITY_ID = 'provider-api-key-visibility-toggle'
const API_KEY_COPY_ID = 'provider-api-key-copy'
const API_KEY_FEEDBACK_ID = 'provider-api-key-feedback'
const CAS_PASSWORD_INPUT_ID = 'sustech-cas-password-input'
const MODEL_SERVICE_SECTION = 'model-service' as const
const SECRET_API_KEY = 'secret-api-key'
const COPIED_FEEDBACK = '已复制 API 密钥'
const DEFAULT_PROVIDER_ID = 'openrouter'

/* eslint-disable max-lines-per-function */
describe('SettingsWorkspace secrets', () => {
  describe('api key visibility and copy', () => {
    it('supports showing, hiding, and copying the provider api key', async () => {
      const clipboardWriteText = mockClipboardWriteText()
      installSettingsWorkspaceBridge()

      const rendered = renderSettingsWorkspace({
        initialSection: MODEL_SERVICE_SECTION,
      })

      await flushAsyncEffects()

      const apiKeyInput = rendered.getByTestId(API_KEY_INPUT_ID) as HTMLInputElement
      expect(apiKeyInput.type).toBe('password')

      await setFormControlValue(apiKeyInput, SECRET_API_KEY)
      expect(apiKeyInput.value).toBe(SECRET_API_KEY)

      await clickElement(rendered.getByTestId(API_KEY_VISIBILITY_ID))
      expect((rendered.getByTestId(API_KEY_INPUT_ID) as HTMLInputElement).type).toBe('text')

      await clickElement(rendered.getByTestId(API_KEY_VISIBILITY_ID))
      expect((rendered.getByTestId(API_KEY_INPUT_ID) as HTMLInputElement).type).toBe('password')

      await clickElement(rendered.getByTestId(API_KEY_COPY_ID))

      expect(clipboardWriteText).toHaveBeenCalledWith(SECRET_API_KEY)
      expect(rendered.getByTestId(API_KEY_FEEDBACK_ID).textContent).toBe(COPIED_FEEDBACK)

      rendered.unmount()
    })
  })

  describe('api key auto-save on blur', () => {
    it('auto-saves provider api keys on blur and clears them when the draft becomes empty', async () => {
      const { saveProfileApiKey, clearProfileApiKey } = installSettingsWorkspaceBridge({
        saveProfileApiKeyResult: {
          ok: true,
          profileId: DEFAULT_PROVIDER_ID,
          state: {
            hasApiKey: true,
            apiKey: 'rotated-secret',
          },
        },
        clearProfileApiKeyResult: {
          ok: true,
          profileId: DEFAULT_PROVIDER_ID,
          state: {
            hasApiKey: false,
            apiKey: '',
          },
        },
      })

      const rendered = renderSettingsWorkspace({
        initialSection: MODEL_SERVICE_SECTION,
      })

      await flushAsyncEffects()

      const apiKeyInput = rendered.getByTestId(API_KEY_INPUT_ID) as HTMLInputElement
      await setFormControlValue(apiKeyInput, 'rotated-secret')
      await blurElement(apiKeyInput)

      expect(saveProfileApiKey).toHaveBeenCalledWith({
        profileId: DEFAULT_PROVIDER_ID,
        apiKey: 'rotated-secret',
      })
      expect(apiKeyInput.value).toBe('rotated-secret')
      expect(rendered.getByTestId(API_KEY_FEEDBACK_ID).textContent).toBe('已自动保存 API 密钥')

      await setFormControlValue(apiKeyInput, '')
      await blurElement(apiKeyInput)

      expect(clearProfileApiKey).toHaveBeenCalledWith({
        profileId: DEFAULT_PROVIDER_ID,
      })
      expect(apiKeyInput.value).toBe('')
      expect(rendered.getByTestId(API_KEY_FEEDBACK_ID).textContent).toBe('已清除 API 密钥')

      rendered.unmount()
    })

    it('keeps provider api key drafts visible after auto-save and preserves show hide toggle behavior', async () => {
      const { saveProfileApiKey } = installSettingsWorkspaceBridge({
        saveProfileApiKeyResult: {
          ok: true,
          profileId: DEFAULT_PROVIDER_ID,
          state: {
            hasApiKey: true,
            apiKey: 'secret-after-blur',
          },
        },
      })

      const rendered = renderSettingsWorkspace({
        initialSection: MODEL_SERVICE_SECTION,
      })

      await flushAsyncEffects()

      const apiKeyInput = rendered.getByTestId(API_KEY_INPUT_ID) as HTMLInputElement
      expect(apiKeyInput.type).toBe('password')

      await setFormControlValue(apiKeyInput, 'secret-after-blur')
      await blurElement(apiKeyInput)

      expect(saveProfileApiKey).toHaveBeenCalledWith({
        profileId: DEFAULT_PROVIDER_ID,
        apiKey: 'secret-after-blur',
      })
      expect(apiKeyInput.value).toBe('secret-after-blur')

      await clickElement(rendered.getByTestId(API_KEY_VISIBILITY_ID))
      expect((rendered.getByTestId(API_KEY_INPUT_ID) as HTMLInputElement).type).toBe('text')

      await clickElement(rendered.getByTestId(API_KEY_VISIBILITY_ID))
      expect((rendered.getByTestId(API_KEY_INPUT_ID) as HTMLInputElement).type).toBe('password')

      rendered.unmount()
    })

    it('keeps provider api key drafts and shows feedback when auto-save fails', async () => {
      const { saveProfileApiKey } = installSettingsWorkspaceBridge({
        saveProfileApiKeyResult: {
          ok: false,
          error: 'save failed',
        },
      })

      const rendered = renderSettingsWorkspace({
        initialSection: MODEL_SERVICE_SECTION,
      })

      await flushAsyncEffects()

      const apiKeyInput = rendered.getByTestId(API_KEY_INPUT_ID) as HTMLInputElement
      await setFormControlValue(apiKeyInput, 'failed-secret')
      await blurElement(apiKeyInput)

      expect(saveProfileApiKey).toHaveBeenCalledWith({
        profileId: DEFAULT_PROVIDER_ID,
        apiKey: 'failed-secret',
      })
      expect(apiKeyInput.value).toBe('failed-secret')
      expect(rendered.getByTestId(API_KEY_FEEDBACK_ID).textContent).toBe('保存失败，请稍后重试')

      rendered.unmount()
    })
  })

  describe('restored provider secrets', () => {
    it('restores saved provider api keys for viewing and copying without helper descriptions', async () => {
      const clipboardWriteText = mockClipboardWriteText()
      installSettingsWorkspaceBridge({
        loadStatusesResult: createPersistedSecretStatesResult('persisted-secret', DEFAULT_PROVIDER_ID),
      })

      const rendered = renderSettingsWorkspace({
        initialSection: MODEL_SERVICE_SECTION,
      })

      await flushAsyncEffects()

      const apiKeyInput = rendered.getByTestId(API_KEY_INPUT_ID) as HTMLInputElement
      expect(apiKeyInput.value).toBe('persisted-secret')
      expect(apiKeyInput.type).toBe('password')
      expect(rendered.queryByTestId('provider-api-key-status')).toBeNull()
      expect(rendered.container.textContent).not.toContain('失焦会自动保存')
      expect(rendered.container.textContent).not.toContain('不会回填原文')
      expect(rendered.container.textContent).not.toContain('主进程持有')

      await clickElement(rendered.getByTestId(API_KEY_VISIBILITY_ID))
      expect((rendered.getByTestId(API_KEY_INPUT_ID) as HTMLInputElement).type).toBe('text')

      await clickElement(rendered.getByTestId(API_KEY_COPY_ID))

      expect(clipboardWriteText).toHaveBeenCalledWith('persisted-secret')
      expect(rendered.getByTestId(API_KEY_FEEDBACK_ID).textContent).toBe(COPIED_FEEDBACK)

      rendered.unmount()
    })
  })

  describe('cas password secrets', () => {
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

      const casPasswordInput = rendered.getByTestId(CAS_PASSWORD_INPUT_ID) as HTMLInputElement
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
})
