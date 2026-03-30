import type { ReactNode } from 'react'

interface ProviderProfilesSectionShellProps {
  hasActiveProvider: boolean
  children: ReactNode
}

export function ProviderProfilesSectionShell({
  hasActiveProvider,
  children,
}: ProviderProfilesSectionShellProps) {
  return (
    <div className="settings-detail-column">
      {hasActiveProvider ? (
        children
      ) : (
        <section className="settings-card settings-card--empty">
          <p className="settings-empty-hint">可在左侧添加服务商信息</p>
        </section>
      )}
    </div>
  )
}
