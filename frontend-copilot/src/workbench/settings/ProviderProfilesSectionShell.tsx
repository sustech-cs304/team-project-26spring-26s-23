import type { ReactNode } from 'react'

import { getProviderListCopy } from '../locale'

interface ProviderProfilesSectionShellProps {
  hasActiveProvider: boolean
  children: ReactNode
  language: string
}

export function ProviderProfilesSectionShell({
  hasActiveProvider,
  children,
  language,
}: ProviderProfilesSectionShellProps) {
  const copy = getProviderListCopy(language)

  return (
    <div className="settings-detail-column">
      {hasActiveProvider ? (
        children
      ) : (
        <section className="settings-card settings-card--empty">
          <p className="settings-empty-hint">{copy.emptyHint}</p>
        </section>
      )}
    </div>
  )
}
