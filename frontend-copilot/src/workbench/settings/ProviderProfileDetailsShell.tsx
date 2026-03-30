import { ProviderModelEditorMount } from './ProviderModelEditorMount'
import { ProviderProfileDetails } from './ProviderProfileDetails'
import { ProviderProfilesSectionShell } from './ProviderProfilesSectionShell'
import type { ProviderProfileDetailsShellDomain } from './ProviderProfilesSectionDomain'

interface ProviderProfileDetailsShellProps {
  detailShell: ProviderProfileDetailsShellDomain
}

export function ProviderProfileDetailsShell({ detailShell }: ProviderProfileDetailsShellProps) {
  return (
    <ProviderProfilesSectionShell hasActiveProvider={detailShell.hasActiveProvider}>
      {detailShell.detail ? (
        <>
          <ProviderProfileDetails detail={detailShell.detail} />
          <ProviderModelEditorMount modelEditor={detailShell.modelEditor} />
        </>
      ) : null}
    </ProviderProfilesSectionShell>
  )
}
