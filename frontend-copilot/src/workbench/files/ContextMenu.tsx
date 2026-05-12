import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ContextMenuItem } from './context-menu-items'

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    // 延迟注册，避免右键的 mouseup 立即触发关闭
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }, 0)

    return () => {
      clearTimeout(timer)
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  // 调整菜单位置避免溢出视口
  const adjustedX = Math.max(0, Math.min(x, window.innerWidth - 200))
  const adjustedY = Math.max(0, Math.min(y, window.innerHeight - items.length * 36 - 12))

  const menu = (
    <div
      ref={menuRef}
      className="file-context-menu"
      role="menu"
      aria-label="右键菜单"
      style={{ left: adjustedX, top: adjustedY }}
    >
      {items.map((item, idx) => (
        <button
          key={idx}
          type="button"
          className={`file-context-menu__item${item.danger ? ' file-context-menu__item--danger' : ''}`}
          role="menuitem"
          disabled={item.disabled}
          onClick={(e) => {
            e.stopPropagation()
            item.onClick()
            onClose()
          }}
        >
          {item.icon && (
            <span className="file-context-menu__icon" aria-hidden="true">
              {item.icon}
            </span>
          )}
          <span className="file-context-menu__label">{item.label}</span>
        </button>
        ))}
    </div>
  )

  if (typeof document === 'undefined' || document.body === null) {
    return menu
  }

  return createPortal(menu, document.body)
}

