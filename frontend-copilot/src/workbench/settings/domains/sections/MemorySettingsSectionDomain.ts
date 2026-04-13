import type { ComponentProps } from 'react'

import { MemorySettingsSection } from '../../MemorySettingsSection'

export interface MemorySettingsSectionDomains {
  memory: ComponentProps<typeof MemorySettingsSection>
}

export function createMemorySettingsSectionDomains(
  memory: ComponentProps<typeof MemorySettingsSection>,
): MemorySettingsSectionDomains {
  return {
    memory: {
      ...memory,
    },
  }
}
