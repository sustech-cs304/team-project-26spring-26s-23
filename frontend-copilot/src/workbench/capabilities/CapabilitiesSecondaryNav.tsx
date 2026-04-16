import type { CapabilitiesNavItem, CapabilitiesSection } from './capabilities-demo'

interface CapabilitiesSecondaryNavProps {
  items: readonly CapabilitiesNavItem[]
  activeSection: CapabilitiesSection
  onSelect: (section: CapabilitiesSection) => void
}

export function CapabilitiesSecondaryNav({
  items,
  activeSection,
  onSelect,
}: CapabilitiesSecondaryNavProps) {
  return (
    <aside className="workspace-panel capabilities-panel" aria-label="能力中心二级导航">
      <header className="panel-head">
        <p className="panel-head__eyebrow">能力中心</p>
        <h1 className="panel-head__title">访问控制与服务接入</h1>
      </header>

      <nav className="capabilities-nav-list" aria-label="能力中心页面导航">
        {items.map((item) => {
          const Icon = item.icon
          const active = item.id === activeSection

          return (
            <button
              key={item.id}
              id={`capabilities-tab-${item.id}`}
              type="button"
              className={`capabilities-nav-item${active ? ' capabilities-nav-item--active' : ''}`}
              title={item.label}
              onClick={() => onSelect(item.id)}
            >
              <span className="capabilities-nav-item__icon-wrap">
                <Icon size={18} className="capabilities-nav-item__icon" />
              </span>
              <span className="capabilities-nav-item__body">
                <span className="capabilities-nav-item__title">{item.label}</span>
              </span>
            </button>
          )
        })}
      </nav>
    </aside>
  )
}
