import { useEffect, useState, type ReactNode } from 'react'

export type SidebarChild = {
  id: string
  label: string
}

export type SidebarItem = {
  id: string
  label: string
  icon: ReactNode
  accent?: string
  children?: SidebarChild[]
}

type Props = {
  items: SidebarItem[]
  activeId: string
  onSelect: (id: string) => void
  footer?: ReactNode
  open?: boolean
}

function childParentId(items: SidebarItem[], activeId: string): string | null {
  for (const item of items) {
    if (!item.children?.length) continue
    if (item.children.some((c) => c.id === activeId)) return item.id
  }
  return null
}

export default function ExpandableSidebar({ items, activeId, onSelect, footer, open = true }: Props) {
  const parentOfActive = childParentId(items, activeId)
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const s = new Set<string>()
    if (parentOfActive) s.add(parentOfActive)
    return s
  })

  useEffect(() => {
    if (!parentOfActive) return
    setOpenGroups((prev) => {
      if (prev.has(parentOfActive)) return prev
      const next = new Set(prev)
      next.add(parentOfActive)
      return next
    })
  }, [parentOfActive])

  function toggleGroup(id: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <aside className={`app-sidebar${open ? ' app-sidebar--wide' : ''}`} aria-label="Menu principal">
      <nav className="app-sidebar__nav">
        {items.map((item) => {
          const hasChildren = Boolean(item.children?.length)
          const groupOpen = openGroups.has(item.id)
          const childActive = item.children?.some((c) => c.id === activeId) ?? false
          const active = !hasChildren && item.id === activeId

          if (!hasChildren) {
            return (
              <div key={item.id} className="app-sidebar__section">
                <button
                  type="button"
                  className={`app-sidebar__item${active ? ' app-sidebar__item--active' : ''}`}
                  onClick={() => onSelect(item.id)}
                  title={item.label}
                >
                  <span className="app-sidebar__item-icon">{item.icon}</span>
                  <span className="app-sidebar__item-label">{item.label}</span>
                </button>
              </div>
            )
          }

          return (
            <div
              key={item.id}
              className={`app-sidebar__section app-sidebar__group${groupOpen ? ' app-sidebar__group--open' : ''}`}
            >
              <button
                type="button"
                className={`app-sidebar__item app-sidebar__item--parent${
                  childActive ? ' app-sidebar__item--parent-active' : ''
                }`}
                onClick={() => toggleGroup(item.id)}
                title={item.label}
                aria-expanded={groupOpen}
              >
                <span className="app-sidebar__item-icon">{item.icon}</span>
                <span className="app-sidebar__item-label">{item.label}</span>
                <span className="app-sidebar__chevron" aria-hidden>
                  ›
                </span>
              </button>
              {groupOpen ? (
                <div className="app-sidebar__subnav" role="group" aria-label={item.label}>
                  {item.children!.map((child) => {
                    const subActive = child.id === activeId
                    return (
                      <button
                        key={child.id}
                        type="button"
                        className={`app-sidebar__subitem${subActive ? ' app-sidebar__subitem--active' : ''}`}
                        onClick={() => onSelect(child.id)}
                        title={child.label}
                      >
                        <span className="app-sidebar__subitem-label">{child.label}</span>
                      </button>
                    )
                  })}
                </div>
              ) : null}
            </div>
          )
        })}
      </nav>
      {footer ? <div className="app-sidebar__footer">{footer}</div> : null}
    </aside>
  )
}
