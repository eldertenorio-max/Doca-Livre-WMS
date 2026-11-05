type NavIconId =
  | 'painel'
  | 'produtos'
  | 'temperatura'
  | 'ocupacao'
  | 'seguranca'
  | 'enderecamento'
  | 'inventarios'
  | 'contagem'
  | 'estoque'
  | 'agendamentos'
  | 'permissoes'

type Props = {
  id: NavIconId | string
}

export function SidebarNavIcon({ id }: Props) {
  return (
    <span className="app-sidebar__nav-icon" aria-hidden>
      <NavSvg id={id} />
    </span>
  )
}

function NavSvg({ id }: { id: string }) {
  switch (id) {
    case 'painel':
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <rect x="3" y="4" width="8" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.75" />
          <rect x="13" y="4" width="8" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.75" />
          <rect x="3" y="13" width="18" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.75" />
          <path d="M5.5 9.5h3M15 9.5h3M5.5 16.5h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'produtos':
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M5 8h14v11H5z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
          <path d="M8 8V6h8v2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <path d="M9 12h6M9 15h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'temperatura':
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M14 14.76V5a2 2 0 00-4 0v9.76a4 4 0 104 0z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
          <path d="M12 8v4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      )
    case 'ocupacao':
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M4 19h16" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <path d="M7 19V13M12 19V9M17 19V15" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      )
    case 'seguranca':
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
          <path d="M9.5 12.5l1.8 1.8 3.5-3.6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'enderecamento':
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M12 21s6-5.2 6-10a6 6 0 10-12 0c0 4.8 6 10 6 10z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
          <circle cx="12" cy="11" r="2.25" stroke="currentColor" strokeWidth="1.75" />
        </svg>
      )
    case 'inventarios':
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M7 4h10v16H7z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
          <path d="M9.5 9h5M9.5 12.5h5M9.5 16h3.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
        </svg>
      )
    case 'contagem':
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M8 4h11v16H8z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
          <path d="M6 7H5a1 1 0 00-1 1v12a1 1 0 001 1h1" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <path d="M11 8h4M11 12h4M11 16h2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'estoque':
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M4 8l8-4 8 4-8 4-8-4z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
          <path d="M4 12l8 4 8-4M4 16l8 4 8-4" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
        </svg>
      )
    case 'agendamentos':
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <rect x="3" y="5" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.75" />
          <path d="M8 3v4M16 3v4M3 10h18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <path d="M8 14h3M8 17h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case 'permissoes':
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.75" />
          <path d="M8 11V8a4 4 0 118 0v3" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          <circle cx="12" cy="15" r="1.25" fill="currentColor" />
        </svg>
      )
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.75" />
        </svg>
      )
  }
}
