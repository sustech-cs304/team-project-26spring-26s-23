import type { ComponentProps } from 'react'

import { McpSettingsSection } from '../../McpSettingsSection'

export interface McpSettingsSectionDomains {
  mcp: ComponentProps<typeof McpSettingsSection>
}

export function createMcpSettingsSectionDomains(
  mcp: ComponentProps<typeof McpSettingsSection>,
): McpSettingsSectionDomains {
  return {
    mcp: {
      ...mcp,
    },
  }
}
