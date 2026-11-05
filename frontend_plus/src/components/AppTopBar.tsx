import { useEffect, useRef, useState } from 'react'
import type { SidebarSectionId } from './CollapsibleSidebarSection'
import type { SidebarMode } from '../lib/sidebarMode'
import type { Theme } from '../lib/theme'
import { SidebarLayoutControl } from './SidebarLayoutControl'
import { ThemeToggle } from './ThemeToggle'
import { LayoutLegend, type LayoutLegendProps } from './LayoutLegend'
import { AccountMenuPopover } from './AccountMenuPopover'
import { BRAND_PRODUCT_NAME, BRAND_PRODUCT_VARIANT, LOGO_DOCA_LIVRE_SRC } from '../lib/brandAssets'
import { isHomologacao } from '../lib/appAmbiente'
import { isSupabaseConfigured } from '../lib/supabaseClient'
import { PRESERVADO_ZERAR_HOMOLOG } from '../lib/homologZerarBanco'
import type { ContaUsuario } from '../lib/contaSessao'
import { corAvatarUsuario, iniciaisUsuario } from '../lib/contaSessao'

type Props = {
  sidebarMode: SidebarMode
  onSidebarModeChange: (mode: SidebarMode) => void
  theme: Theme
  onToggleTheme: () => void
  persistError: string | null
  mapLegend: LayoutLegendProps
  contaUsuarios: ContaUsuario[]
  contaUsuarioAtivoId: string
  onSelectContaUsuario: (id: string) => void
  onOpenContaSection: (section: SidebarSectionId, focus?: 'conta' | 'comandos') => void
  onZerarBancoHomolog?: () => void | Promise<void>
  zerandoBancoHomolog?: boolean
  /** Volta ao hub Light / Plus / Pro */
  onBackToSystems?: () => void
}

function formatClock(now: Date): { time: string; date: string } {
  return {
    time: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    date: now.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }),
  }
}

function BrandMark() {
  return (
    <img
      src={LOGO_DOCA_LIVRE_SRC}
      alt="Doca Livre"
      className="app-topbar-logo"
    />
  )
}

export function AppTopBar({
  sidebarMode,
  onSidebarModeChange,
  theme,
  onToggleTheme,
  persistError,
  mapLegend,
  contaUsuarios,
  contaUsuarioAtivoId,
  onSelectContaUsuario,
  onOpenContaSection,
  onZerarBancoHomolog,
  zerandoBancoHomolog = false,
  onBackToSystems,
}: Props) {
  const [clock, setClock] = useState(() => formatClock(new Date()))
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const accountTriggerRef = useRef<HTMLButtonElement>(null)

  const usuarioAtivo =
    contaUsuarios.find((u) => u.id === contaUsuarioAtivoId) ?? contaUsuarios[0]

  useEffect(() => {
    const tick = () => setClock(formatClock(new Date()))
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [])

  function handleMenuClick() {
    if (sidebarMode === 'fullscreen' || sidebarMode === 'collapsed') {
      onSidebarModeChange('open')
      return
    }
    onSidebarModeChange('collapsed')
  }

  const menuLabel =
    sidebarMode === 'fullscreen'
      ? 'Voltar ao mapa'
      : sidebarMode === 'collapsed'
        ? 'Abrir menu lateral'
        : 'Recolher menu lateral'

  function toggleAccountMenu() {
    setAccountMenuOpen((v) => !v)
  }

  function closeAccountMenu() {
    setAccountMenuOpen(false)
  }

  function handleConfigConta() {
    closeAccountMenu()
    onOpenContaSection('cadastroVoz', 'conta')
  }

  function handleComandoVoz() {
    closeAccountMenu()
    onOpenContaSection('cadastroVoz', 'comandos')
  }

  function handleSelectUsuario(id: string) {
    onSelectContaUsuario(id)
    closeAccountMenu()
  }

  function handleRefreshPage() {
    window.location.reload()
  }

  function handleZerarBancoHomolog() {
    if (!onZerarBancoHomolog || zerandoBancoHomolog) return
    const ok1 = window.confirm(
      'Zerar estoque e histórico na HOMOLOGAÇÃO?\n\n' +
        'Serão apagadas todas as NFs, endereços, movimentações e os dados de permanência ' +
        '(Financeiro → Movimentação).\n\n' +
        `Mantém: ${PRESERVADO_ZERAR_HOMOLOG}.`,
    )
    if (!ok1) return
    const ok2 = window.confirm(
      'Confirme novamente: apagar todo o estoque operacional e as NFs do banco de homologação?',
    )
    if (!ok2) return
    void onZerarBancoHomolog()
  }

  const mostrarZerarHomolog =
    isHomologacao() && isSupabaseConfigured() && typeof onZerarBancoHomolog === 'function'

  return (
    <header className="app-topbar" aria-label="Barra principal">
      <div className="app-topbar-left">
        <button
          type="button"
          className="app-topbar-menu"
          onClick={handleMenuClick}
          aria-label={menuLabel}
          aria-pressed={sidebarMode === 'open'}
          title={menuLabel}
        >
          <span className="app-topbar-menu-icon" aria-hidden />
        </button>

        {onBackToSystems ? (
          <button
            type="button"
            className="app-topbar-back-systems"
            onClick={onBackToSystems}
            title="Voltar ao Hub de Módulos do WMS"
            aria-label="Voltar aos módulos"
          >
            <span aria-hidden>←</span> Módulos
          </button>
        ) : null}

        <div className="app-topbar-brand-row">
          <div className="app-topbar-brand">
            <BrandMark />
            <strong className="app-topbar-wms" aria-label={`${BRAND_PRODUCT_NAME} ${BRAND_PRODUCT_VARIANT}`}>
              <span className="app-topbar-wms-main">{BRAND_PRODUCT_NAME}</span>
              <span className="app-topbar-wms-light">{BRAND_PRODUCT_VARIANT}</span>
              {isHomologacao() && (
                <span className="app-topbar-ambiente app-topbar-ambiente--homolog">Homologação</span>
              )}
            </strong>
          </div>
        </div>
      </div>

      <div className="app-topbar-right">
        <LayoutLegend {...mapLegend} className="app-topbar-legend" />
        <SidebarLayoutControl
          mode={sidebarMode}
          onChange={onSidebarModeChange}
          orientation="horizontal"
        />
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        <div className="app-topbar-toolbar-actions">
          {mostrarZerarHomolog && (
            <button
              type="button"
              className="app-topbar-zerar-homolog"
              onClick={handleZerarBancoHomolog}
              disabled={zerandoBancoHomolog}
              title="Zerar estoque (mantém lógica de cobrança)"
              aria-label="Zerar estoque de homologação, mantendo lógica de cobrança"
            >
              <TrashIcon />
            </button>
          )}
          <button
            type="button"
            className="app-topbar-refresh"
            onClick={handleRefreshPage}
            title="Atualizar página"
            aria-label="Atualizar página"
          >
            <RefreshIcon />
          </button>
        </div>

        <div className="app-topbar-meta" aria-label="Data e hora">
          <span className="app-topbar-meta-time">{clock.time}</span>
          <span className="app-topbar-meta-date">{clock.date}</span>
          <span className="app-topbar-meta-version">v1.0</span>
        </div>

        <div className="app-topbar-user-wrap">
          <button
            ref={accountTriggerRef}
            type="button"
            className={`app-topbar-user ${accountMenuOpen ? 'app-topbar-user--open' : ''}`}
            onClick={toggleAccountMenu}
            aria-expanded={accountMenuOpen}
            aria-haspopup="menu"
            aria-label="Menu da conta"
          >
            <div className="app-topbar-user-text">
              <strong>{usuarioAtivo?.nome ?? 'Doca Livre'}</strong>
              <span>Estoque / NF-e</span>
              {persistError && <em className="app-topbar-error">{persistError}</em>}
            </div>
            <span className="app-topbar-avatar" aria-hidden>
              {usuarioAtivo?.avatarUrl ? (
                <img src={usuarioAtivo.avatarUrl} alt="" />
              ) : (
                <span
                  className="app-topbar-avatar-iniciais"
                  style={{ background: corAvatarUsuario(usuarioAtivo?.id ?? 'dl') }}
                >
                  {iniciaisUsuario(usuarioAtivo?.nome ?? 'DL')}
                </span>
              )}
            </span>
          </button>

          <AccountMenuPopover
            open={accountMenuOpen}
            onClose={closeAccountMenu}
            anchorRef={accountTriggerRef}
            usuarios={contaUsuarios}
            usuarioAtivoId={contaUsuarioAtivoId}
            onSelectUsuario={handleSelectUsuario}
            onConfigConta={handleConfigConta}
            onComandoVoz={handleComandoVoz}
            theme={theme}
            onToggleTheme={onToggleTheme}
          />
        </div>
      </div>
    </header>
  )
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="18" height="18" aria-hidden>
      <path
        d="M20 6v5h-5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M19 11a7 7 0 1 0-2.05 4.95"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="18" height="18" aria-hidden>
      <path
        d="M4 7h16M9 7V5h6v2M10 11v6M14 11v6M6 7l1 14h10l1-14"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
