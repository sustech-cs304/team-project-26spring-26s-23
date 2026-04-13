/** @vitest-environment jsdom */

import { describe, it } from 'vitest'

import {
  runAddProviderFromEmptyStateScenario,
  runApiAddressFieldScenario,
  runDeleteActiveProviderScenario,
  runDuplicateProviderScenario,
  runExtensionBannerHiddenScenario,
  runLegacyProviderWarningScenario,
  runOllamaGuidanceCleanupScenario,
  runProviderModelEditorFocusScenario,
} from './test-support/provider-profiles/settings-workspace-provider-detail-scenarios'
import { runProviderReorderScenario } from './test-support/provider-profiles/settings-workspace-provider-reorder-scenario'

describe('SettingsWorkspace provider interactions', () => {
  it('keeps focus in the model name field while editing the model dialog', async () => {
    await runProviderModelEditorFocusScenario()
  })

  it('adds a provider from the empty state using catalog-backed defaults and activates its detail form', async () => {
    await runAddProviderFromEmptyStateScenario()
  })

  it('renders the active provider detail and supports duplicating a provider from the context menu', async () => {
    await runDuplicateProviderScenario()
  })

  it('removes redundant provider guidance copy while keeping ollama controls editable', async () => {
    await runOllamaGuidanceCleanupScenario()
  })

  it('hides retained provider extension notices from the detail form', async () => {
    await runExtensionBannerHiddenScenario()
  })

  it('keeps legacy unsupported providers visible and shows compatibility warnings from the settings page', async () => {
    await runLegacyProviderWarningScenario()
  })

  it('deletes the active provider and shows the empty state when no providers remain', async () => {
    await runDeleteActiveProviderScenario()
  })

  it('keeps the API 地址 field editable and renders it with the full-width form-field layout', async () => {
    await runApiAddressFieldScenario()
  })

  it('reorders providers from drag interaction and persists the reordered list', async () => {
    await runProviderReorderScenario()
  })
})
