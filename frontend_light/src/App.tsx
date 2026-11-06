import { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import './App.css'
import AppHeader from './components/layout/AppHeader'
import AppShell from './components/layout/AppShell'
import type { SidebarItem } from './components/layout/ExpandableSidebar'
import { SidebarNavIcon } from './components/layout/SidebarNavIcon'
import BaseProdutos from './pages/BaseProdutos'
import ProdutosFamilia from './pages/ProdutosFamilia'
import ProdutosGrupos from './pages/ProdutosGrupos'
import ProdutosImportacaoPlanilha from './pages/ProdutosImportacaoPlanilha'
import ProdutosSubGrupos from './pages/ProdutosSubGrupos'
import CadastroEnderecamento from './pages/CadastroEnderecamento'
import ContagemDiariaAmbiental from './pages/ContagemDiariaAmbiental'
import ContagemCaptura from './pages/ContagemCaptura'
import ContagemGerenciar from './pages/ContagemGerenciar'
import EstoqueConsulta from './pages/EstoqueConsulta'
import AgendamentosHub from './pages/AgendamentosHub'
import EstoqueSeguranca from './pages/EstoqueSeguranca'
import InventarioCaptura from './pages/InventarioCaptura'
import InventarioGerenciar from './pages/InventarioGerenciar'
import PainelPage from './pages/PainelPage'
import { tituloApp } from './lib/appAmbiente'
import { clearSessaoProdutoListaContext } from './lib/sessaoProdutoListaContext'
import type { AppView } from './lib/appViews'
import { getStoredSidebarOpen, storeSidebarOpen } from './lib/sidebarOpen'
import { useTheme } from './hooks/useTheme'
import { estaEmbutidoNoWms } from './lib/appTheme'

export type { AppView } from './lib/appViews'

type UnifiedWindow = Window & {
  __WMS_UNIFIED__?: {
    usuario?: string
    isSuperuser?: boolean
    hubHref?: string
    logoutHref?: string
  }
}

const VALID_VIEWS: ReadonlySet<AppView> = new Set<AppView>([
  'produtos',
  'produtosFamilia',
  'produtosGrupos',
  'produtosImportacao',
  'produtosSubGrupos',
  'temperatura',
  'ocupacao',
  'seguranca',
  'enderecamento',
  'inventarios',
  'inventarioCaptura',
  'contagem',
  'contagemCaptura',
  'estoque',
  'agendamentos',
  'painel',
  'permissoes',
])

function readViewFromUrl(): AppView {
  if (typeof window === 'undefined') return 'painel'
  try {
    const raw = (new URLSearchParams(window.location.search).get('view') || '').trim() as AppView
    if (VALID_VIEWS.has(raw)) return raw
  } catch {
    /* ignore */
  }
  return 'painel'
}

function buildUnifiedSession(usuarioRaw?: string): Session {
  const win = typeof window !== 'undefined' ? (window as UnifiedWindow) : undefined
  const clean = (usuarioRaw || win?.__WMS_UNIFIED__?.usuario || 'Usuário').trim() || 'Usuário'
  return {
    access_token: 'unified-wms-pro-session',
    refresh_token: 'unified-wms-pro-session',
    expires_in: 86400,
    token_type: 'bearer',
    user: {
      id: '00000000-0000-0000-0000-000000000001',
      app_metadata: {},
      user_metadata: { username: clean, nome: clean, name: clean },
      aud: 'authenticated',
      created_at: new Date().toISOString(),
      email: `${clean.toLowerCase().replace(/\s+/g, '.')}@docalivre.local`,
    },
  }
}

class PanelErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[Painel]', error.message, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, maxWidth: 560, margin: '0 auto', color: 'var(--text, #e5e7eb)' }}>
          <h2 style={{ color: '#f87171', marginTop: 0 }}>Erro ao exibir esta aba</h2>
          <p style={{ fontSize: 14 }}>{this.state.error.message}</p>
          <button type="button" onClick={() => window.location.reload()}>
            Recarregar página
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

function navIcon(id: string) {
  return <SidebarNavIcon id={id} />
}

export default function App() {
  const [session] = useState<Session>(() => buildUnifiedSession())
  const [view, setView] = useState<AppView>(() => readViewFromUrl())
  const [capturaInventarioId, setCapturaInventarioId] = useState<string | null>(null)
  const [capturaContagemId, setCapturaContagemId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(() => getStoredSidebarOpen())
  const { theme, toggleTheme } = useTheme({ authEnabled: true, sessionActive: true })

  useEffect(() => {
    storeSidebarOpen(sidebarOpen)
  }, [sidebarOpen])

  useEffect(() => {
    document.title = tituloApp()
  }, [])

  useEffect(() => {
    function onPopState() {
      setView(readViewFromUrl())
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const sidebarItems: SidebarItem[] = useMemo(
    () => [
      { id: 'painel', label: 'Painel de Contagem', icon: navIcon('painel') },
      { id: 'contagem', label: 'Contagem diária', icon: navIcon('contagem') },
      { id: 'inventarios', label: 'Inventários', icon: navIcon('inventarios') },
      { id: 'temperatura', label: 'Temperatura', icon: navIcon('temperatura') },
      { id: 'ocupacao', label: 'Ocupação', icon: navIcon('ocupacao') },
      { id: 'seguranca', label: 'Estoque de segurança', icon: navIcon('seguranca') },
      { id: 'estoque', label: 'Estoque & Shelf-Life', icon: navIcon('estoque') },
      { id: 'enderecamento', label: 'Cadastro Endereços', icon: navIcon('enderecamento') },
      {
        id: 'produtos',
        label: 'Catálogo de Produtos',
        icon: navIcon('produtos'),
        children: [
          { id: 'produtos', label: 'Produtos' },
          { id: 'produtosFamilia', label: 'Família' },
          { id: 'produtosGrupos', label: 'Grupos' },
          { id: 'produtosSubGrupos', label: 'SubGrupos' },
          { id: 'produtosImportacao', label: 'Importação de Planilha' },
        ],
      },
      { id: 'agendamentos', label: 'Agendamentos', icon: navIcon('agendamentos') },
    ],
    [],
  )

  const activeSidebarId =
    view === 'inventarioCaptura' ? 'inventarios' : view === 'contagemCaptura' ? 'contagem' : view

  function navigate(id: string) {
    if (id === 'inventarios') setCapturaInventarioId(null)
    if (id === 'contagem') setCapturaContagemId(null)
    const nextView = id as AppView
    setView(nextView)
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('view', nextView)
      window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`)
    } catch {
      /* ignore */
    }
  }

  function abrirCaptura(inventarioId: string) {
    setCapturaInventarioId(inventarioId)
    setView('inventarioCaptura')
  }

  function abrirContagem(contagemId: string) {
    setCapturaContagemId(contagemId)
    setView('contagemCaptura')
  }

  function handleBackToSystemsHub() {
    const win = window as UnifiedWindow
    window.location.assign(win.__WMS_UNIFIED__?.hubHref || '/entrada')
  }

  function handleSignOut() {
    const win = window as UnifiedWindow
    window.location.assign(win.__WMS_UNIFIED__?.logoutHref || '/login?sair=1')
  }

  const sidebarFooter = (
    <button
      type="button"
      className="app-sidebar__footer-btn"
      onClick={toggleTheme}
      title={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
      aria-label={theme === 'dark' ? 'Mudar para tema claro' : 'Mudar para tema escuro'}
    >
      <span className="app-sidebar__footer-icon" aria-hidden>
        {theme === 'dark' ? (
          <svg viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.75" />
            <path
              d="M12 3v2M12 19v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M3 12h2M19 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none">
            <path
              d="M20 14.5A8.5 8.5 0 0 1 9.5 4 7 7 0 1 0 20 14.5z"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <span className="app-sidebar__footer-label">{theme === 'dark' ? 'Tema claro' : 'Tema escuro'}</span>
    </button>
  )

  return (
    <AppShell
      items={sidebarItems}
      activeId={activeSidebarId}
      onNavigate={navigate}
      footer={sidebarFooter}
      sidebarOpen={sidebarOpen}
      embutido={estaEmbutidoNoWms()}
      header={
        <AppHeader
          session={session}
          authEnabled
          theme={theme}
          sidebarOpen={sidebarOpen}
          onSidebarToggle={() => setSidebarOpen((open) => !open)}
          onThemeToggle={toggleTheme}
          onSignOut={handleSignOut}
          onBackToSystems={handleBackToSystemsHub}
        />
      }
    >
      {view === 'produtos' ? <BaseProdutos /> : null}
      {view === 'produtosFamilia' ? <ProdutosFamilia /> : null}
      {view === 'produtosGrupos' ? <ProdutosGrupos /> : null}
      {view === 'produtosImportacao' ? <ProdutosImportacaoPlanilha /> : null}
      {view === 'produtosSubGrupos' ? <ProdutosSubGrupos /> : null}
      {view === 'temperatura' ? (
        <PanelErrorBoundary>
          <ContagemDiariaAmbiental initialTab="temperatura" lockTab />
        </PanelErrorBoundary>
      ) : null}
      {view === 'ocupacao' ? (
        <PanelErrorBoundary>
          <ContagemDiariaAmbiental initialTab="ocupacao" lockTab />
        </PanelErrorBoundary>
      ) : null}
      {view === 'seguranca' ? (
        <PanelErrorBoundary>
          <EstoqueSeguranca />
        </PanelErrorBoundary>
      ) : null}
      {view === 'enderecamento' ? <CadastroEnderecamento /> : null}
      {view === 'painel' ? (
        <PanelErrorBoundary>
          <PainelPage />
        </PanelErrorBoundary>
      ) : null}
      {view === 'inventarios' ? (
        <InventarioGerenciar onAbrirCaptura={abrirCaptura} session={session} />
      ) : null}
      {view === 'inventarioCaptura' && capturaInventarioId ? (
        <InventarioCaptura
          inventarioId={capturaInventarioId}
          session={session}
          onVoltar={() => {
            clearSessaoProdutoListaContext()
            setCapturaInventarioId(null)
            setView('inventarios')
          }}
        />
      ) : null}
      {view === 'contagem' ? (
        <PanelErrorBoundary>
          <ContagemGerenciar onAbrirContagem={abrirContagem} session={session} />
        </PanelErrorBoundary>
      ) : null}
      {view === 'contagemCaptura' && capturaContagemId ? (
        <ContagemCaptura
          contagemId={capturaContagemId}
          session={session}
          onVoltar={() => {
            clearSessaoProdutoListaContext()
            setCapturaContagemId(null)
            setView('contagem')
          }}
        />
      ) : null}
      {view === 'estoque' ? (
        <PanelErrorBoundary>
          <EstoqueConsulta />
        </PanelErrorBoundary>
      ) : null}
      {view === 'agendamentos' ? (
        <PanelErrorBoundary>
          <AgendamentosHub />
        </PanelErrorBoundary>
      ) : null}
    </AppShell>
  )
}
