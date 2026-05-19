/** @vitest-environment jsdom */

import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'

import {
  clickElement,
  createPersistedWorkspaceState,
  createProviderProfile,
  flushAsyncEffects,
  installSettingsWorkspaceBridge,
  renderSettingsWorkspace,
  setFormControlValue,
} from './SettingsWorkspace.test-support'

const SHARED_MODEL_ID = 'shared-model'
const ALPHA_PROFILE_ID = 'alpha-profile'
const BETA_PROFILE_ID = 'beta-profile'

function createAlphaProfile() {
  return createProviderProfile({
    id: ALPHA_PROFILE_ID,
    profileId: ALPHA_PROFILE_ID,
    providerId: 'openai',
    protocol: 'openai',
    name: 'Alpha Provider',
    displayName: 'Alpha Provider',
    primaryModelId: SHARED_MODEL_ID,
    fastModel: 'alpha-fast',
    fallbackModel: 'alpha-fast',
    availableModels: [
      {
        ...createProviderProfile({ id: ALPHA_PROFILE_ID }).availableModels[0]!,
        id: 'alpha-model-1',
        modelId: SHARED_MODEL_ID,
        displayName: 'Shared Model A',
      },
    ],
  })
}

function createBetaProfile() {
  return createProviderProfile({
    id: BETA_PROFILE_ID,
    profileId: BETA_PROFILE_ID,
    providerId: 'gemini',
    protocol: 'gemini',
    name: 'Beta Provider',
    displayName: 'Beta Provider',
    primaryModelId: SHARED_MODEL_ID,
    fastModel: SHARED_MODEL_ID,
    fallbackModel: SHARED_MODEL_ID,
    availableModels: [
      {
        ...createProviderProfile({ id: BETA_PROFILE_ID }).availableModels[0]!,
        id: 'beta-model-1',
        modelId: SHARED_MODEL_ID,
        displayName: 'Shared Model B',
      },
    ],
  })
}

/* eslint-disable max-lines-per-function */
describe('SettingsWorkspace persistence', () => {
  describe('section transitions', () => {
    it('fades out the current settings section before fading in the next section while preserving visited state', async () => {
      installSettingsWorkspaceBridge()
      const rendered = renderSettingsWorkspace({
        initialSection: 'model-service',
      })

      await flushAsyncEffects()

      const providerSearchInput = rendered.container.querySelector('.search-box__input') as HTMLInputElement
      await setFormControlValue(providerSearchInput, 'Router')
      expect(providerSearchInput.value).toBe('Router')

      vi.useFakeTimers()
      try {
        const generalNavButton = Array.from(rendered.container.querySelectorAll<HTMLButtonElement>('.settings-nav-item')).find((button) => {
          return button.textContent?.includes('常规设置')
        })
        if (!(generalNavButton instanceof HTMLButtonElement)) {
          throw new Error('Missing general settings nav button')
        }

        await clickElement(generalNavButton)

        const providerSection = rendered.container.querySelector('[data-settings-section="model-service"]') as HTMLElement
        const generalSection = rendered.container.querySelector('[data-settings-section="general"]') as HTMLElement
        expect(providerSection.className).toContain('settings-section-keepalive-panel--exiting')
        expect(providerSection.hidden).toBe(false)
        expect(providerSection.getAttribute('aria-hidden')).toBe('true')
        expect(generalSection.hidden).toBe(true)

        await act(async () => {
          vi.advanceTimersByTime(120)
          await Promise.resolve()
        })

        expect(providerSection.hidden).toBe(true)
        expect((providerSection.querySelector('.search-box__input') as HTMLInputElement).value).toBe('Router')
        expect(generalSection.hidden).toBe(false)
        expect(generalSection.className).toContain('settings-section-keepalive-panel--active')

        const modelServiceNavButton = Array.from(rendered.container.querySelectorAll<HTMLButtonElement>('.settings-nav-item')).find((button) => {
          return button.textContent?.includes('模型服务')
        })
        if (!(modelServiceNavButton instanceof HTMLButtonElement)) {
          throw new Error('Missing model service settings nav button')
        }

        await clickElement(modelServiceNavButton)
        expect(generalSection.className).toContain('settings-section-keepalive-panel--exiting')
        expect(providerSection.hidden).toBe(true)

        await act(async () => {
          vi.advanceTimersByTime(120)
          await Promise.resolve()
        })

        const activeProviderSection = rendered.container.querySelector('[data-settings-section="model-service"]') as HTMLElement
        expect(activeProviderSection.hidden).toBe(false)
        expect(activeProviderSection.className).toContain('settings-section-keepalive-panel--active')
        expect((activeProviderSection.querySelector('.search-box__input') as HTMLInputElement).value).toBe('Router')
      } finally {
        rendered.unmount()
        vi.useRealTimers()
      }
    })
  })

  describe('provider metadata persistence', () => {
    it('loads persisted provider metadata and saves normal provider edits without serializing secrets', async () => {
      vi.useFakeTimers()

      const persistedState = createPersistedWorkspaceState()
      const { loadState, saveState } = installSettingsWorkspaceBridge({
        loadStateResult: {
          ok: true,
          source: 'stored',
          state: persistedState,
        },
      })

      const rendered = renderSettingsWorkspace({
        initialSection: 'model-service',
      })

      await flushAsyncEffects()

      expect(loadState).toHaveBeenCalledOnce()

      const providerNameInput = rendered.getByTestId('provider-display-name-input') as HTMLInputElement
      expect(providerNameInput.value).toBe('Persisted Router')

      await setFormControlValue(providerNameInput, 'Renamed Router')
      await act(async () => {
        vi.advanceTimersByTime(250)
      })

      expect(saveState).toHaveBeenCalled()
      const lastSaveCall = saveState.mock.calls[saveState.mock.calls.length - 1]?.[0]
      expect(lastSaveCall?.providerProfiles[0]?.displayName).toBe('Renamed Router')
      expect(lastSaveCall?.providerProfiles[0]).not.toHaveProperty('hasApiKey')

      rendered.unmount()
    })
  })

  describe('model routing persistence', () => {
    it('keeps ambiguous legacy model strings readable after hydration and saves stable route refs after reselection', async () => {
      vi.useFakeTimers()

      const alphaProvider = createAlphaProfile()
      const betaProvider = createBetaProfile()
      const { saveState } = installSettingsWorkspaceBridge({
        loadStateResult: {
          ok: true,
          source: 'stored',
          state: createPersistedWorkspaceState({
            providerProfiles: [alphaProvider, betaProvider],
            defaultModelRouting: {
              primaryAssistantModel: SHARED_MODEL_ID,
              fastAssistantModel: SHARED_MODEL_ID,
              primaryAssistantModelRoute: null,
              fastAssistantModelRoute: null,
            },
          }),
        },
        loadStatusesResult: {
          ok: true,
          states: {},
        },
      })

      const rendered = renderSettingsWorkspace({
        initialSection: 'default-model',
      })

      await flushAsyncEffects()

      expect(rendered.container.textContent).toContain('当前选择不可用')

      await clickElement(rendered.getByTestId('primary-default-model-trigger'))
      await selectOpenSelectOption(rendered.container, 'Alpha Provider · Shared Model A')
      await clickElement(rendered.getByTestId('fast-default-model-trigger'))
      await selectOpenSelectOption(rendered.container, 'Beta Provider · Shared Model B')

      await act(async () => {
        vi.advanceTimersByTime(250)
      })

      const lastSaveCall = saveState.mock.calls[saveState.mock.calls.length - 1]?.[0]
      expect(lastSaveCall?.defaultModelRouting).toEqual({
        primaryAssistantModel: {
          routeKind: 'provider-model',
          profileId: ALPHA_PROFILE_ID,
          modelId: SHARED_MODEL_ID,
        },
        fastAssistantModel: {
          routeKind: 'provider-model',
          profileId: BETA_PROFILE_ID,
          modelId: SHARED_MODEL_ID,
        },
      })

      rendered.unmount()
    })
  })

  describe('sustech persistence', () => {
    it('loads sustech form values and persists non-secret edits', async () => {
      vi.useFakeTimers()

      const { saveState } = installSettingsWorkspaceBridge({
        loadStateResult: {
          ok: true,
          source: 'stored',
          state: createPersistedWorkspaceState({
            sustech: {
              studentId: '12210001',
              email: '12210001@sustech.edu.cn',
              blackboardCurrentTermOnly: true,
            },
          }),
        },
      })

      const rendered = renderSettingsWorkspace({
        initialSection: 'sustech-info',
      })

      await flushAsyncEffects()

      const studentIdInput = rendered.getByPlaceholder('输入学号') as HTMLInputElement
      expect(studentIdInput.value).toBe('12210001')
      expect(rendered.container.textContent).toContain('CAS 密码')
      expect(rendered.container.textContent).toContain('仅抓取本学期课程（推荐）')
      expect(rendered.container.textContent).not.toContain('自动下载 Blackboard 文件')
      expect(rendered.container.textContent).not.toContain('下载文件大小限制')

      await setFormControlValue(studentIdInput, '12219999')
      await act(async () => {
        vi.advanceTimersByTime(250)
      })

      const lastSaveCall = saveState.mock.calls[saveState.mock.calls.length - 1]?.[0]
      expect(lastSaveCall?.sustech.studentId).toBe('12219999')
      expect(lastSaveCall?.sustech.email).toBe('12210001@sustech.edu.cn')
      expect(lastSaveCall?.sustech.blackboardCurrentTermOnly).toBe(true)

      rendered.unmount()
    })
  })

  describe('external source persistence', () => {
    it('loads the wakeup ics payload and persists external source edits', async () => {
      vi.useFakeTimers()

      const originalFileReader = window.FileReader

      class MockFileReader {
        public result: string | ArrayBuffer | null = null
        public onload: ((this: FileReader, _ev: ProgressEvent<FileReader>) => unknown) | null = null
        public onerror: ((this: FileReader, _ev: ProgressEvent<FileReader>) => unknown) | null = null

        public readAsText(file: Blob) {
          void file.text().then((text) => {
            this.result = text
            this.onload?.call(this as unknown as FileReader, new ProgressEvent('load'))
          }, () => {
            this.onerror?.call(this as unknown as FileReader, new ProgressEvent('error'))
          })
        }
      }

      Object.defineProperty(window, 'FileReader', {
        configurable: true,
        value: MockFileReader,
      })

      const initialIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Candue//WakeUp Test//EN',
        'END:VCALENDAR',
      ].join('\n')

      const { saveState } = installSettingsWorkspaceBridge({
        loadStateResult: {
          ok: true,
          source: 'stored',
          state: createPersistedWorkspaceState({
            externalSource: {
              wakeupShareLink: initialIcs,
            },
          }),
        },
      })

      const rendered = renderSettingsWorkspace({
        initialSection: 'external-source',
      })

      await flushAsyncEffects()

      expect(rendered.container.textContent).toContain('WakeUP 课程群同步')
      expect(rendered.container.textContent).toContain('已加载 .ics 内容')

      const importInput = rendered.container.querySelector(
        'input[type="file"][aria-label="导入 WakeUP .ics 文件"]',
      ) as HTMLInputElement | null
      expect(importInput).not.toBeNull()

      const nextIcs = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Candue//WakeUp Next//EN',
        'END:VCALENDAR',
      ].join('\n')

      await act(async () => {
        Object.defineProperty(importInput!, 'files', {
          configurable: true,
          value: [new File([nextIcs], 'wakeup.ics', { type: 'text/calendar' })],
        })
        importInput!.dispatchEvent(new Event('change', { bubbles: true }))
      })

      await flushAsyncEffects()
      await act(async () => {
        vi.advanceTimersByTime(250)
      })

      const lastSaveCall = saveState.mock.calls[saveState.mock.calls.length - 1]?.[0]
      expect(lastSaveCall?.externalSource.wakeupShareLink).toBe(nextIcs)

      rendered.unmount()

      Object.defineProperty(window, 'FileReader', {
        configurable: true,
        value: originalFileReader,
      })
    })
  })

  describe('debug mode persistence', () => {
    it('reads debug mode from config center and persists toggle updates through the public patch bridge', async () => {
      installSettingsWorkspaceBridge()

      const loadPublicSnapshot = vi.fn(async () => ({
        ok: true as const,
        snapshot: {
          version: 1,
          domains: {
            frontendPreferences: {
              theme: 'light' as const,
              animationsEnabled: true,
            },
            assistantBehavior: {
              agentName: null,
              debugModeEnabled: false,
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
      const applyPublicPatch = vi.fn(async () => ({
        ok: true as const,
        snapshot: {
          version: 1,
          domains: {
            frontendPreferences: {
              theme: 'light' as const,
              animationsEnabled: true,
            },
            assistantBehavior: {
              agentName: null,
              debugModeEnabled: true,
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
      const subscribe = vi.fn(() => (() => undefined))

      Object.assign(window, {
        configCenterPublicSnapshot: {
          load: loadPublicSnapshot,
        },
        configCenterPublicPatch: {
          apply: applyPublicPatch,
        },
        configCenterPublicSnapshotSubscription: {
          subscribe,
        },
      })

      const rendered = renderSettingsWorkspace({
        initialSection: 'general',
      })

      await flushAsyncEffects()

      const debugToggleLabel = rendered.getByText('启用调试模式')
      const debugToggle = debugToggleLabel.closest('button')
      if (!(debugToggle instanceof HTMLButtonElement)) {
        throw new Error('Expected debug mode toggle button.')
      }

      expect(loadPublicSnapshot).toHaveBeenCalledOnce()
      expect(debugToggle.getAttribute('aria-checked')).toBe('false')

      await clickElement(debugToggle)
      await flushAsyncEffects()

      expect(applyPublicPatch).toHaveBeenCalledOnce()
      expect(applyPublicPatch).toHaveBeenCalledWith({
        domains: {
          assistantBehavior: {
            debugModeEnabled: true,
          },
        },
      })
      expect(debugToggle.getAttribute('aria-checked')).toBe('true')

      rendered.unmount()
    })
  })
})

async function selectOpenSelectOption(container: HTMLElement, text: string) {
  const option = Array.from(container.querySelectorAll<HTMLElement>('.select-dropdown--open .select-option')).find((element) => {
    return element.textContent?.includes(text)
  })

  if (option === undefined) {
    throw new Error(`Missing open select option containing text=${text}`)
  }

  await clickElement(option)
}
