import type { ComponentProps } from 'react'

import { vi } from 'vitest'

import { SettingsWorkspace } from '../../SettingsWorkspace'
import { createBootstrapController } from '../settings-workspace-test-fixtures'

export function createSettingsWorkspaceStructureProps(
  overrides: Partial<ComponentProps<typeof SettingsWorkspace>> = {},
): ComponentProps<typeof SettingsWorkspace> {
  return {
    bootstrap: createBootstrapController(),
    themeMode: 'light',
    onThemeModeChange: vi.fn(),
    ...overrides,
  }
}
