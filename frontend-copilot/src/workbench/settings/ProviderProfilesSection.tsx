import { ProviderProfileList } from './ProviderProfileList'
import { ProviderProfileDetailsShell } from './ProviderProfileDetailsShell'
import {
  resolveProviderProfileDetailsShellDomain,
  resolveProviderProfileListDomain,
  type ProviderProfilesSectionDomain,
} from './ProviderProfilesSectionDomain'

interface ProviderProfilesSectionProps {
  provider: ProviderProfilesSectionDomain
}

export function ProviderProfilesSection({ provider }: ProviderProfilesSectionProps) {
  const listDomain = resolveProviderProfileListDomain(provider)
  const detailShellDomain = resolveProviderProfileDetailsShellDomain(provider)

  return (
    <div className="settings-page settings-page--split">
      <ProviderProfileList {...listDomain} />
      <ProviderProfileDetailsShell detailShell={detailShellDomain} />
    </div>
  )
}
