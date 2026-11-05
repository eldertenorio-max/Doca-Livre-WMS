import { type ReactNode } from 'react'

export type SidebarSectionId =
  | 'entrada'
  | 'saida'
  | 'editar'
  | 'consulta'
  | 'historico'
  | 'relatorio'
  | 'painel'
  | 'canceladas'
  | 'imprimir'
  | 'cadastroVoz'
  | 'financeiro'
  | 'agendamentosHub'

type Props = {
  id: SidebarSectionId
  title: string
  children: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
  onBeforeToggle?: (nextOpen: boolean, proceed: () => void) => void
}

export function CollapsibleSidebarSection({
  id,
  title,
  children,
  open,
  onOpenChange,
  onBeforeToggle,
}: Props) {
  function handleToggle() {
    const nextOpen = !open
    const apply = () => onOpenChange(nextOpen)
    if (onBeforeToggle) {
      onBeforeToggle(nextOpen, apply)
      return
    }
    apply()
  }

  return (
    <section
      id={id}
      className={`sidebar-section ${open ? 'sidebar-section--open' : ''} sidebar-section--${id}`}
    >
      <button
        type="button"
        className="sidebar-section-trigger"
        onClick={handleToggle}
        aria-expanded={open}
        title={title}
      >
        <span className={`sidebar-section-icon sidebar-section-icon--${id}`}>
          <SectionIcon id={id} />
        </span>
        <span className="sidebar-section-title">{title}</span>
        <span className={`sidebar-section-chevron ${open ? 'sidebar-section-chevron--open' : ''}`} aria-hidden>
          ›
        </span>
      </button>

      <div className="sidebar-section-body">
        <div className="sidebar-section-inner">{children}</div>
      </div>
    </section>
  )
}

function SectionIcon({ id }: { id: SidebarSectionId }) {
  if (id === 'entrada') {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          className="icon-entrada-box"
          d="M5 8h14v11H5z"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
        <path
          className="icon-entrada-arrow"
          d="M12 4v9m0 0-3-3m3 3 3-3"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  if (id === 'saida') {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          className="icon-saida-box"
          d="M5 8h14v11H5z"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
        <path
          className="icon-saida-arrow"
          d="M12 20v-9m0 0-3 3m3-3 3 3"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  if (id === 'editar') {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          className="icon-edit-grid"
          d="M5 5h6v6H5zM13 5h6v6h-6zM5 13h6v6H5z"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
        <path
          className="icon-edit-arrow"
          d="M16 16l4 4M18 14v6h-6"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  if (id === 'consulta') {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle
          className="icon-consulta-lens"
          cx="10.5"
          cy="10.5"
          r="5.5"
          stroke="currentColor"
          strokeWidth="1.75"
        />
        <path
          className="icon-consulta-handle"
          d="M15 15l5 5"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
        <path
          className="icon-consulta-grid"
          d="M4 4h3v3H4zM4 10h3v3H4z"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          opacity="0.55"
        />
      </svg>
    )
  }

  if (id === 'historico') {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        <circle className="icon-hist-clock" cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.75" />
        <path
          className="icon-hist-hand"
          d="M12 8v4l3 2"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          className="icon-hist-tick"
          d="M4 12H2M22 12h-2M12 4V2M12 22v-2"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.45"
        />
      </svg>
    )
  }

  if (id === 'relatorio') {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          className="icon-relatorio-doc"
          d="M7 4h10v16H7z"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
        <path
          className="icon-relatorio-line"
          d="M9.5 9h5M9.5 12.5h5M9.5 16h3.5"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
        <path
          className="icon-relatorio-chart"
          d="M15 17l2-3 2 2 2-4"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  if (id === 'painel') {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect
          className="icon-painel-card"
          x="3"
          y="4"
          width="8"
          height="7"
          rx="1.5"
          stroke="currentColor"
          strokeWidth="1.75"
        />
        <rect
          className="icon-painel-card"
          x="13"
          y="4"
          width="8"
          height="7"
          rx="1.5"
          stroke="currentColor"
          strokeWidth="1.75"
        />
        <rect
          className="icon-painel-card"
          x="3"
          y="13"
          width="18"
          height="7"
          rx="1.5"
          stroke="currentColor"
          strokeWidth="1.75"
        />
        <path
          className="icon-painel-bar"
          d="M5.5 9.5h3M15 9.5h3M5.5 16.5h12"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    )
  }

  if (id === 'cadastroVoz') {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M12 3.5 13.2 8l4.8.4-3.7 3.1 1.2 4.7L12 13.8 8.5 16.2l1.2-4.7L6 8.4 10.8 8z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path
          d="M18.5 14.5 19.1 16.4 21 17l-1.9.6-.6 1.9-.6-1.9L16 17l1.9-.6z"
          fill="currentColor"
        />
      </svg>
    )
  }

  if (id === 'financeiro') {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect
          x="3"
          y="6"
          width="18"
          height="12"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.75"
        />
        <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75" />
        <path
          d="M12 9v6M10.5 10.5h2.25a1.125 1.125 0 1 0 0-2.25H10.5M13.5 13.5H10.5a1.125 1.125 0 1 0 0 2.25h3"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
      </svg>
    )
  }

  if (id === 'imprimir') {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          className="icon-print-body"
          d="M6 9V4h12v5M6 17v3h12v-3"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
        <path
          className="icon-print-tray"
          d="M4 14h16v-4H4z"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinejoin="round"
        />
        <path
          className="icon-print-paper"
          d="M8 11h8"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      </svg>
    )
  }

  if (id === 'agendamentosHub') {
    return (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.75" />
        <path d="M8 3v4M16 3v4M3 10h18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        <path d="M8 14h3M8 17h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        className="icon-cancel-doc"
        d="M7 4h10v3H7zM6 7h12v13H6z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path
        className="icon-cancel-x"
        d="M9 12l6 6M15 12l-6 6"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  )
}
