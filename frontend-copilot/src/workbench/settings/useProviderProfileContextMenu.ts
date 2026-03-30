import { useEffect, useState } from 'react'

import type { ProviderProfile } from '../types'

import type { ProviderContextMenuState } from './provider-profiles'

interface UseProviderProfileContextMenuArgs {
  providerProfiles: ProviderProfile[]
  onEscape: () => void
  onBlur: () => void
}

export function useProviderProfileContextMenu({
  providerProfiles,
  onEscape,
  onBlur,
}: UseProviderProfileContextMenuArgs) {
  const [providerContextMenu, setProviderContextMenu] = useState<ProviderContextMenuState | null>(null)

  useEffect(() => {
    if (providerContextMenu === null) {
      return undefined
    }

    const handleWindowMouseDown = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-testid="provider-context-menu"]') !== null) {
        return
      }

      setProviderContextMenu(null)
    }

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProviderContextMenu(null)
        onEscape()
      }
    }

    const handleWindowBlur = () => {
      onBlur()
    }

    window.addEventListener('mousedown', handleWindowMouseDown)
    window.addEventListener('keydown', handleWindowKeyDown)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      window.removeEventListener('mousedown', handleWindowMouseDown)
      window.removeEventListener('keydown', handleWindowKeyDown)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [onBlur, onEscape, providerContextMenu])

  const openProviderContextMenu = (providerId: string, x: number, y: number) => {
    const provider = providerProfiles.find((profile) => profile.id === providerId)

    if (!provider) {
      return
    }

    setProviderContextMenu({
      providerId,
      providerName: provider.name,
      x,
      y,
    })
  }

  return {
    providerContextMenu,
    closeProviderContextMenu() {
      setProviderContextMenu(null)
    },
    openProviderContextMenu,
  }
}
