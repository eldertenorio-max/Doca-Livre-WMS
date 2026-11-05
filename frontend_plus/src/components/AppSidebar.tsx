import { CollapsibleSidebarSection, type SidebarSectionId } from './CollapsibleSidebarSection'
import { IaDocaLivrePanel } from './IaDocaLivrePanel'
import { ConsultaEstoquePanel } from './ConsultaEstoquePanel'
import { CanceladasPanel } from './CanceladasPanel'
import { EditarPosicaoPanel } from './EditarPosicaoPanel'
import { EntradaPanel } from './EntradaPanel'
import { HubPrevisaoEntrada } from './HubPrevisaoEntrada'
import { FinanceiroPanel } from './FinanceiroPanel'
import { HistoricoPanel } from './HistoricoPanel'
import { ImprimirPanel } from './ImprimirPanel'
import { PainelPanel } from './PainelPanel'
import { RelatorioPanel } from './RelatorioPanel'
import { SaidaPanel } from './SaidaPanel'
import { ViewOnlyShell } from './ViewOnlyShell'
import { useSidebarExpand } from '../hooks/useSidebarExpand'
import type { SidebarMode } from '../lib/sidebarMode'
import {
  canOpenSection,
  isSectionReadOnly,
  type PlusModulosMap,
} from '../lib/portalModuleAccess'
import { type ComponentProps, type CSSProperties, type PointerEvent, type ReactNode, useMemo, useState } from 'react'

type Props = {
  sidebarMode: SidebarMode
  onSidebarModeChange: (mode: SidebarMode) => void
  openSection: SidebarSectionId | null
  onOpenSectionChange: (id: SidebarSectionId | null) => void
  /** null = todas as telas com editar; mapa = restrições do portal */
  plusModulos?: PlusModulosMap
  entrada: ComponentProps<typeof EntradaPanel>
  saida: ComponentProps<typeof SaidaPanel>
  editar: ComponentProps<typeof EditarPosicaoPanel>
  consulta: ComponentProps<typeof ConsultaEstoquePanel>
  historico: ComponentProps<typeof HistoricoPanel>
  relatorio: ComponentProps<typeof RelatorioPanel>
  painel: ComponentProps<typeof PainelPanel>
  canceladas: ComponentProps<typeof CanceladasPanel>
  imprimir: ComponentProps<typeof ImprimirPanel>
  cadastroVoz: ComponentProps<typeof IaDocaLivrePanel>
  financeiro: ComponentProps<typeof FinanceiroPanel>
  agendamentosHub: ComponentProps<typeof HubPrevisaoEntrada>
  onBeforeLeaveEntrada?: (proceed: () => void) => void
}

const SIDEBAR_MOBILE_WIDTH_KEY = 'ultrafrio-sidebar-mobile-width'
const SIDEBAR_MOBILE_MIN_WIDTH = 72
const SIDEBAR_MOBILE_EDGE_GAP = 24

function readStoredMobileWidth(): number | null {
  try {
    const raw = localStorage.getItem(SIDEBAR_MOBILE_WIDTH_KEY)
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

function storeMobileWidth(width: number) {
  try {
    localStorage.setItem(SIDEBAR_MOBILE_WIDTH_KEY, String(Math.round(width)))
  } catch {
    /* ignore */
  }
}

function clampMobileSidebarWidth(width: number): number {
  const viewportWidth = typeof window === 'undefined' ? 420 : window.innerWidth
  const max = Math.max(SIDEBAR_MOBILE_MIN_WIDTH, viewportWidth - SIDEBAR_MOBILE_EDGE_GAP)
  return Math.min(Math.max(width, SIDEBAR_MOBILE_MIN_WIDTH), max)
}

export function AppSidebar({
  sidebarMode,
  onSidebarModeChange,
  openSection,
  onOpenSectionChange,
  plusModulos = null,
  entrada,
  saida,
  editar,
  consulta,
  historico,
  relatorio,
  painel,
  canceladas,
  imprimir,
  cadastroVoz,
  financeiro,
  agendamentosHub,
  onBeforeLeaveEntrada,
}: Props) {
  function sectionOpenChange(id: SidebarSectionId, open: boolean) {
    if (open && !canOpenSection(plusModulos, id)) return
    if (open && id === 'painel') {
      onSidebarModeChange('fullscreen')
    }
    onOpenSectionChange(open ? id : null)
  }

  function show(id: SidebarSectionId) {
    return canOpenSection(plusModulos, id)
  }

  function wrap(id: SidebarSectionId, node: ReactNode) {
    return <ViewOnlyShell active={isSectionReadOnly(plusModulos, id)}>{node}</ViewOnlyShell>
  }

  const guardOtherSection = (nextOpen: boolean, proceed: () => void) => {
    if (!nextOpen || !onBeforeLeaveEntrada) {
      proceed()
      return
    }
    onBeforeLeaveEntrada(proceed)
  }

  const guardEntradaSection = (nextOpen: boolean, proceed: () => void) => {
    if (nextOpen || !onBeforeLeaveEntrada) {
      proceed()
      return
    }
    onBeforeLeaveEntrada(proceed)
  }

  const { expanded, sidebarRef, onMouseEnter, onMouseLeave } =
    useSidebarExpand(sidebarMode)

  const wide = expanded
  const pinnedOpen = sidebarMode === 'open' || sidebarMode === 'fullscreen'
  const [mobileWidth, setMobileWidth] = useState<number | null>(() => readStoredMobileWidth())
  const sidebarStyle = useMemo(
    () =>
      mobileWidth == null
        ? undefined
        : ({ '--sidebar-w-mobile': `${mobileWidth}px` } as CSSProperties),
    [mobileWidth],
  )

  function handleResizePointerDown(e: PointerEvent<HTMLButtonElement>) {
    if (sidebarMode === 'fullscreen') return

    e.preventDefault()
    e.stopPropagation()
    if (sidebarMode === 'collapsed') onSidebarModeChange('open')

    const body = document.body
    const prevUserSelect = body.style.userSelect
    const prevCursor = body.style.cursor
    body.style.userSelect = 'none'
    body.style.cursor = 'ew-resize'

    const applyWidth = (clientX: number) => {
      const next = clampMobileSidebarWidth(clientX)
      setMobileWidth(next)
      storeMobileWidth(next)
    }

    applyWidth(e.clientX)

    const handleMove = (ev: globalThis.PointerEvent) => {
      applyWidth(ev.clientX)
    }

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleUp)
      body.style.userSelect = prevUserSelect
      body.style.cursor = prevCursor
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleUp)
  }

  return (
    <aside
      ref={sidebarRef}
      className={[
        'sidebar',
        `sidebar--mode-${sidebarMode}`,
        wide ? 'sidebar--wide' : '',
        expanded && sidebarMode === 'collapsed' ? 'sidebar--expanded' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      title={!pinnedOpen && !expanded ? 'Passe o mouse para abrir o menu' : undefined}
      style={sidebarStyle}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {sidebarMode !== 'fullscreen' && (
        <button
          type="button"
          className="sidebar-resize-handle"
          aria-label="Arrastar para ajustar largura do menu"
          title="Arraste para ajustar a largura do menu"
          onPointerDown={handleResizePointerDown}
        />
      )}
      <div className="sidebar-layout">
      <div className="sidebar-body">
      {show('consulta') ? (
      <CollapsibleSidebarSection
        id="consulta"
        title="Consulta estoque"
        open={openSection === 'consulta'}
        onOpenChange={(open) => sectionOpenChange('consulta', open)}
        onBeforeToggle={guardOtherSection}
      >
        {wrap('consulta', <ConsultaEstoquePanel {...consulta} />)}
      </CollapsibleSidebarSection>
      ) : null}

      {show('entrada') ? (
      <CollapsibleSidebarSection
        id="entrada"
        title="Entrada"
        open={openSection === 'entrada'}
        onOpenChange={(open) => sectionOpenChange('entrada', open)}
        onBeforeToggle={guardEntradaSection}
      >
        {wrap('entrada', <EntradaPanel {...entrada} />)}
      </CollapsibleSidebarSection>
      ) : null}

      {show('agendamentosHub') ? (
      <CollapsibleSidebarSection
        id="agendamentosHub"
        title="Agendamentos"
        open={openSection === 'agendamentosHub'}
        onOpenChange={(open) => sectionOpenChange('agendamentosHub', open)}
        onBeforeToggle={guardOtherSection}
      >
        {wrap('agendamentosHub', <HubPrevisaoEntrada {...agendamentosHub} />)}
      </CollapsibleSidebarSection>
      ) : null}

      {show('saida') ? (
      <CollapsibleSidebarSection
        id="saida"
        title="Saída"
        open={openSection === 'saida'}
        onOpenChange={(open) => sectionOpenChange('saida', open)}
        onBeforeToggle={guardOtherSection}
      >
        {wrap('saida', <SaidaPanel {...saida} />)}
      </CollapsibleSidebarSection>
      ) : null}

      {show('editar') ? (
      <CollapsibleSidebarSection
        id="editar"
        title="Movimentação"
        open={openSection === 'editar'}
        onOpenChange={(open) => sectionOpenChange('editar', open)}
        onBeforeToggle={guardOtherSection}
      >
        {wrap('editar', <EditarPosicaoPanel {...editar} />)}
      </CollapsibleSidebarSection>
      ) : null}

      {show('canceladas') ? (
      <CollapsibleSidebarSection
        id="canceladas"
        title="NF cancelada"
        open={openSection === 'canceladas'}
        onOpenChange={(open) => sectionOpenChange('canceladas', open)}
        onBeforeToggle={guardOtherSection}
      >
        {wrap('canceladas', <CanceladasPanel {...canceladas} />)}
      </CollapsibleSidebarSection>
      ) : null}

      {show('historico') ? (
      <CollapsibleSidebarSection
        id="historico"
        title="Histórico"
        open={openSection === 'historico'}
        onOpenChange={(open) => sectionOpenChange('historico', open)}
        onBeforeToggle={guardOtherSection}
      >
        {wrap('historico', <HistoricoPanel {...historico} />)}
      </CollapsibleSidebarSection>
      ) : null}

      {show('relatorio') ? (
      <CollapsibleSidebarSection
        id="relatorio"
        title="Relatório"
        open={openSection === 'relatorio'}
        onOpenChange={(open) => sectionOpenChange('relatorio', open)}
        onBeforeToggle={guardOtherSection}
      >
        {wrap('relatorio', <RelatorioPanel {...relatorio} />)}
      </CollapsibleSidebarSection>
      ) : null}

      {show('painel') ? (
      <CollapsibleSidebarSection
        id="painel"
        title="Painel"
        open={openSection === 'painel'}
        onOpenChange={(open) => sectionOpenChange('painel', open)}
        onBeforeToggle={guardOtherSection}
      >
        {wrap('painel', <PainelPanel {...painel} />)}
      </CollapsibleSidebarSection>
      ) : null}

      {show('financeiro') ? (
      <CollapsibleSidebarSection
        id="financeiro"
        title="Financeiro"
        open={openSection === 'financeiro'}
        onOpenChange={(open) => sectionOpenChange('financeiro', open)}
        onBeforeToggle={guardOtherSection}
      >
        {wrap('financeiro', <FinanceiroPanel {...financeiro} />)}
      </CollapsibleSidebarSection>
      ) : null}

      {show('cadastroVoz') ? (
      <CollapsibleSidebarSection
        id="cadastroVoz"
        title="IA DOCA LIVRE"
        open={openSection === 'cadastroVoz'}
        onOpenChange={(open) => sectionOpenChange('cadastroVoz', open)}
        onBeforeToggle={guardOtherSection}
      >
        {wrap('cadastroVoz', <IaDocaLivrePanel {...cadastroVoz} />)}
      </CollapsibleSidebarSection>
      ) : null}

      {show('imprimir') ? (
      <CollapsibleSidebarSection
        id="imprimir"
        title="Mapa"
        open={openSection === 'imprimir'}
        onOpenChange={(open) => sectionOpenChange('imprimir', open)}
        onBeforeToggle={guardOtherSection}
      >
        {wrap('imprimir', <ImprimirPanel {...imprimir} />)}
      </CollapsibleSidebarSection>
      ) : null}
      </div>
      </div>
    </aside>
  )
}
