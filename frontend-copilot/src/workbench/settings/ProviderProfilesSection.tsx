import { ProviderProfileList } from './ProviderProfileList'
import { ProviderProfileDetailsShell } from './ProviderProfileDetailsShell'
import {
  resolveProviderProfileDetailsShellDomain,
  resolveProviderProfileListDomain,
  type ProviderProfilesSectionDomain,
} from './ProviderProfilesSectionDomain'

interface ProviderProfilesSectionProps {
  provider: ProviderProfilesSectionDomain
  language: string
}

export function ProviderProfilesSection({ provider, language }: ProviderProfilesSectionProps) {
  const listDomain = resolveProviderProfileListDomain(provider)
  const detailShellDomain = resolveProviderProfileDetailsShellDomain(provider)

  return (
    <div className="settings-page settings-page--split">
      <ProviderProfileList {...listDomain} language={language} />
      <ProviderProfileDetailsShell detailShell={detailShellDomain} language={language} />
    </div>
  )
}
