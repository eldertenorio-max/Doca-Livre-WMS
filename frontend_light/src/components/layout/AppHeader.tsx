import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { usernameFromSession } from '../../lib/authUser'
import { isHomologacao } from '../../lib/appAmbiente'
import { BRAND_PRODUCT_NAME, BRAND_PRODUCT_VARIANT, LOGO_DOCA_LIVRE_SRC } from '../../lib/brandAssets'

const EMPRESA_PADRAO = 'Doca Livre'
const CLIENTES_PADRAO = ['Todos clientes de armazenagem', 'Doca Livre WMS Light']

type Theme = 'dark' | 'light'

type Props = {
  session?: Session | null
  authEnabled?: boolean
  theme: Theme
  onThemeToggle: () => void
  onSignOut?: () => void
  sidebarOpen: boolean
  onSidebarToggle: () => void
  /** Volta ao hub Light/Plus/Pro no portal. */
  onBackToSystems?: () => void
}

function IconBell() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 01-3.46 0" />
    </svg>
  )
}

function IconUser() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 12c2.76 0 5-2.24 5-5s-2.24-5-5-5-5 2.24-5 5 2.24 5 5 5zm0 2c-3.33 0-10 1.67-10 5v1h20v-1c0-3.33-6.67-5-10-5z" />
    </svg>
  )
}

function IconHome() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" />
    </svg>
  )
}

function IconGear() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.49.49 0 00-.59-.22l-2.39.96a7.02 7.02 0 00-1.63-.94l-.36-2.54A.49.49 0 0014 2h-4a.49.49 0 00-.49.42l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 00-.59.22L2.74 8.87a.49.49 0 00.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.04.7 1.63.94l.36 2.54A.49.49 0 0010 22h4c.24 0 .44-.17.49-.42l.36-2.54c.59-.24 1.13-.56 1.63-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 00-.12-.61l-2.01-1.58zM12 15.5A3.5 3.5 0 1112 8.5a3.5 3.5 0 010 7z" />
    </svg>
  )
}

function IconAccount() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M22.7 19.3l-2.1-2.1A8 8 0 101.3 17.2l2.1 2.1A8 8 0 1022.7 19.3zM8 10a4 4 0 118 0 4 4 0 01-8 0z" />
    </svg>
  )
}

function IconLogout() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
    </svg>
  )
}

function MenuItem({
  active,
  icon,
  label,
  onClick,
}: {
  active?: boolean
  icon: ReactNode
  label: string
  onClick?: () => void
}) {
  return (
    <button type="button" className={`app-header__menu-item${active ? ' app-header__menu-item--active' : ''}`} onClick={onClick}>
      <span className="app-header__menu-icon">{icon}</span>
      {label}
    </button>
  )
}

export default function AppHeader({
  session,
  authEnabled,
  theme,
  onThemeToggle,
  onSignOut,
  sidebarOpen,
  onSidebarToggle,
  onBackToSystems,
}: Props) {
  const [open, setOpen] = useState(false)
  const [agora, setAgora] = useState(() => new Date())
  const [empresa, setEmpresa] = useState(() => localStorage.getItem('header-empresa') || EMPRESA_PADRAO)
  const [cliente, setCliente] = useState(
    () => localStorage.getItem('header-cliente') || CLIENTES_PADRAO[0],
  )
  const wrapRef = useRef<HTMLDivElement>(null)
  const username = usernameFromSession(session)

  useEffect(() => {
    localStorage.setItem('header-empresa', empresa)
  }, [empresa])

  useEffect(() => {
    localStorage.setItem('header-cliente', cliente)
  }, [cliente])

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => {
    const id = window.setInterval(() => setAgora(new Date()), 30_000)
    return () => window.clearInterval(id)
  }, [])

  const dataHora = agora.toLocaleString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })

  return (
    <header className="app-header">
      <div className="app-header__left">
        <button
          type="button"
          className="app-header__menu"
          onClick={onSidebarToggle}
          aria-label={sidebarOpen ? 'Recolher menu lateral' : 'Abrir menu lateral'}
          aria-pressed={sidebarOpen}
          title={sidebarOpen ? 'Recolher menu lateral' : 'Abrir menu lateral'}
        >
          <span className="app-header__menu-icon" aria-hidden />
        </button>

        {onBackToSystems ? (
          <button
            type="button"
            className="app-header__back-systems"
            onClick={onBackToSystems}
            title="Voltar ao Hub de Módulos WMS"
            aria-label="Voltar aos módulos"
          >
            <span aria-hidden>←</span> Módulos
          </button>
        ) : null}

        <div className="app-header__brand">
          <img src={LOGO_DOCA_LIVRE_SRC} alt="Doca Livre" className="app-header__logo" />
          <strong className="app-header__wms" aria-label={`${BRAND_PRODUCT_NAME} ${BRAND_PRODUCT_VARIANT}`}>
            <span className="app-header__wms-main">{BRAND_PRODUCT_NAME}</span>
            <span className="app-header__wms-variant">{BRAND_PRODUCT_VARIANT}</span>
            {isHomologacao() ? (
              <span className="app-header__ambiente app-header__ambiente--homolog">Homologação</span>
            ) : null}
          </strong>
        </div>
      </div>

      <div className="app-header__right">
        <button type="button" className="app-header__icon-btn" title="Notificações" aria-label="Notificações">
          <IconBell />
        </button>

        <div className="app-header__user-block">
          <p className="app-header__user-name">{username}</p>
          <p className="app-header__user-role">
            {empresa} / WMS PRO
          </p>
          <p className="app-header__user-time">{dataHora}</p>
        </div>

        <div className="app-header__user-wrap" ref={wrapRef}>
          <button
            type="button"
            className="app-header__avatar-btn"
            aria-expanded={open}
            aria-haspopup="menu"
            title={username}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="app-header__avatar">
              <IconUser />
            </span>
          </button>

          {open ? (
            <div className="app-header__dropdown" role="menu">
              <div className="app-header__dropdown-head">
                <span className="app-header__dropdown-avatar">
                  <IconUser />
                </span>
                <span className="app-header__dropdown-user">{username}</span>
                {authEnabled && onSignOut ? (
                  <button
                    type="button"
                    className="app-header__dropdown-logout"
                    title="Sair"
                    aria-label="Sair"
                    onClick={() => {
                      setOpen(false)
                      onSignOut()
                    }}
                  >
                    <IconLogout />
                  </button>
                ) : null}
              </div>

              <div className="app-header__dropdown-body">
                <MenuItem active icon={<IconHome />} label={empresa} onClick={() => setOpen(false)} />
                <MenuItem
                  icon={<IconGear />}
                  label="Configurações"
                  onClick={() => {
                    onThemeToggle()
                  }}
                />
                <MenuItem icon={<IconAccount />} label="Minha conta" onClick={() => setOpen(false)} />
              </div>

              <div className="app-header__dropdown-foot">
                <label className="app-header__select-label">
                  <select value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
                    <option value={EMPRESA_PADRAO}>{EMPRESA_PADRAO}</option>
                  </select>
                </label>
                <label className="app-header__select-label">
                  <select value={cliente} onChange={(e) => setCliente(e.target.value)}>
                    {CLIENTES_PADRAO.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="app-header__theme-hint">
                  Tema: {theme === 'dark' ? 'escuro' : 'claro'} — use Configurações para alternar
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
