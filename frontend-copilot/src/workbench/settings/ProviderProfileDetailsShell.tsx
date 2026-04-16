import { ProviderModelEditorMount } from './ProviderModelEditorMount'
import { ProviderProfileDetails } from './ProviderProfileDetails'
import { ProviderProfilesSectionShell } from './ProviderProfilesSectionShell'
import type { ProviderProfileDetailsShellDomain } from './ProviderProfilesSectionDomain'

interface ProviderProfileDetailsShellProps {
  detailShell: ProviderProfileDetailsShellDomain
  language: string
}

export function ProviderProfileDetailsShell({ detailShell, language }: ProviderProfileDetailsShellProps) {
  return (
    <ProviderProfilesSectionShell hasActiveProvider={detailShell.hasActiveProvider} language={language}>
      {detailShell.detail ? (
        <>
          <ProviderProfileDetails detail={detailShell.detail} language={language} />
          <ProviderModelEditorMount modelEditor={detailShell.modelEditor} language={language} />
        </>
      ) : null}
    </ProviderProfilesSectionShell>
  )
}
