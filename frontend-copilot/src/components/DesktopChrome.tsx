import type { ReactNode } from 'react'

import { WindowTitlebar } from './WindowTitlebar'

interface DesktopChromeProps {
  children: ReactNode
}

export function DesktopChrome({ children }: DesktopChromeProps) {
  return (
    <div className="desktop-chrome">
      <WindowTitlebar />
      <div className="desktop-chrome__content">{children}</div>
    </div>
  )
}
