import type { ReactNode } from 'react'
import ExpandableSidebar, { type SidebarItem } from './ExpandableSidebar'

type Props = {
  items: SidebarItem[]
  activeId: string
  onNavigate: (id: string) => void
  children: ReactNode
  header?: ReactNode
  footer?: ReactNode
  sidebarOpen: boolean
}

export default function AppShell({
  items,
  activeId,
  onNavigate,
  children,
  header,
  footer,
  sidebarOpen,
}: Props) {
  return (
    <div className="app-shell">
      {header}
      <div className="app-workspace">
        <ExpandableSidebar
          items={items}
          activeId={activeId}
          onSelect={onNavigate}
          footer={footer}
          open={sidebarOpen}
        />
        <div className="app-shell__main">
          <main className="app-shell__content">{children}</main>
        </div>
      </div>
    </div>
  )
}
