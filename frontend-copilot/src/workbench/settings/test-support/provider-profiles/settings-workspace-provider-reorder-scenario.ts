import { act } from 'react'
import { expect, vi } from 'vitest'

import {
  createPersistedWorkspaceState,
  createProviderProfile,
  flushAsyncEffects,
  installSettingsWorkspaceBridge,
  mockButtonRect,
  mockListItemRect,
  renderSettingsWorkspace,
} from '../SettingsWorkspaceTestSupport'

export async function runProviderReorderScenario() {
  vi.useFakeTimers()

  try {
    const alphaProvider = createProviderProfile({
      id: 'provider-a',
      name: 'Alpha Provider',
      endpoint: 'https://alpha.example.com/v1',
    })
    const betaProvider = createProviderProfile({
      id: 'provider-b',
      name: 'Beta Provider',
      providerId: 'gemini',
      protocol: 'gemini',
      endpoint: 'https://beta.example.com/v1',
      baseUrl: 'https://beta.example.com/v1',
      hasApiKey: false,
      primaryModelId: 'google/gemini-2.5-pro',
      fastModel: 'google/gemini-2.5-flash',
      fallbackModel: 'google/gemini-2.0-flash',
    })
    const { saveState } = installSettingsWorkspaceBridge({
      loadStateResult: {
        ok: true,
        source: 'stored',
        state: createPersistedWorkspaceState({
          providerProfiles: [alphaProvider, betaProvider],
        }),
      },
      loadStatusesResult: {
        ok: true,
        states: {
          'provider-a': {
            hasApiKey: true,
            apiKey: 'alpha-secret',
          },
          'provider-b': {
            hasApiKey: false,
            apiKey: '',
          },
        },
      },
    })

    const rendered = renderSettingsWorkspace({
      initialSection: 'model-service',
    })

    await flushAsyncEffects()

    mockListItemRect(rendered.getByTestId('settings-provider-list-item-provider-a'), 0)
    mockListItemRect(rendered.getByTestId('settings-provider-list-item-provider-b'), 60)
    mockButtonRect(rendered.getByTestId('settings-provider-card-provider-a'))

    await act(async () => {
      rendered.getByTestId('settings-provider-card-provider-a').dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 10, clientY: 10 }),
      )
    })

    await act(async () => {
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 12, clientY: 92 }))
      await Promise.resolve()
    })

    await act(async () => {
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 12, clientY: 92 }))
      await Promise.resolve()
    })

    const providerItems = Array.from(
      rendered.container.querySelectorAll<HTMLElement>('[data-testid^="settings-provider-list-item-"]'),
    )
    expect(providerItems[0]?.textContent).toContain('Beta Provider')
    expect(providerItems[1]?.textContent).toContain('Alpha Provider')

    await act(async () => {
      vi.advanceTimersByTime(250)
    })

    const lastSaveCall = saveState.mock.calls[saveState.mock.calls.length - 1]?.[0]
    expect(lastSaveCall?.providerProfiles.map((profile) => profile.profileId)).toEqual(['provider-b', 'provider-a'])

    rendered.unmount()
  } finally {
    vi.useRealTimers()
  }
}
