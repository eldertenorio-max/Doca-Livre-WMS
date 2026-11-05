import type { MouseEvent, PointerEvent } from 'react'
import type { SidebarMode } from '../lib/sidebarMode'

type Props = {
  mode: SidebarMode
  onChange: (mode: SidebarMode) => void
  orientation?: 'vertical' | 'horizontal'
}

const OPTIONS: { id: SidebarMode; label: string; title: string }[] = [
  { id: 'collapsed', label: 'Recolhido', title: 'Menu recolhido' },
  { id: 'open', label: 'Aberto', title: 'Menu aberto ao lado do mapa' },
  { id: 'fullscreen', label: 'Tela cheia', title: 'Menu em tela cheia' },
]

export function SidebarLayoutControl({ mode, onChange, orientation = 'vertical' }: Props) {
  function stopSidebar(e: MouseEvent | PointerEvent) {
    e.stopPropagation()
  }

  return (
    <div
      className={`sidebar-layout-control${orientation === 'horizontal' ? ' sidebar-layout-control--horizontal' : ''}`}
      role="group"
      aria-label="Layout do menu lateral"
      onPointerDown={stopSidebar}
      onClick={stopSidebar}
    >
      {OPTIONS.map((opt) => (
        <button
          key={opt.id}
          type="button"
          className={`sidebar-layout-btn${mode === opt.id ? ' sidebar-layout-btn--active' : ''}`}
          title={opt.title}
          aria-label={opt.title}
          aria-pressed={mode === opt.id}
          onClick={() => onChange(opt.id)}
        >
          <span className="sidebar-layout-btn-icon" aria-hidden>
            {opt.id === 'collapsed' && <CollapsedIcon />}
            {opt.id === 'open' && <OpenIcon />}
            {opt.id === 'fullscreen' && <FullscreenIcon />}
          </span>
        </button>
      ))}
    </div>
  )
}

function CollapsedIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
      <rect x="4" y="5" width="4" height="14" rx="1" stroke="currentColor" strokeWidth="1.75" />
      <rect x="10" y="5" width="10" height="14" rx="1" stroke="currentColor" strokeWidth="1.75" opacity="0.35" />
    </svg>
  )
}

function OpenIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
      <rect x="4" y="5" width="8" height="14" rx="1" stroke="currentColor" strokeWidth="1.75" />
      <rect x="14" y="5" width="6" height="14" rx="1" stroke="currentColor" strokeWidth="1.75" opacity="0.35" />
    </svg>
  )
}

function FullscreenIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="18" height="18">
      <rect x="4" y="5" width="16" height="14" rx="1" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  )
}
