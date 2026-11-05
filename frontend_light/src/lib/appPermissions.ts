import type { AppView } from './appViews'
import type { SidebarItem } from '../components/layout/ExpandableSidebar'

export type MenuPermissionDef = {
  id: AppView
  label: string
  group?: string
}

/** Telas configuráveis no menu (ordem = sidebar). */
export const APP_MENU_PERMISSIONS: MenuPermissionDef[] = [
  { id: 'painel', label: 'Painel' },
  { id: 'produtosFamilia', label: 'Família', group: 'Produtos' },
  { id: 'produtosGrupos', label: 'Grupos', group: 'Produtos' },
  { id: 'produtosImportacao', label: 'Importação de Planilha', group: 'Produtos' },
  { id: 'produtos', label: 'Produtos', group: 'Produtos' },
  { id: 'produtosSubGrupos', label: 'SubGrupos', group: 'Produtos' },
  { id: 'temperatura', label: 'Temperatura' },
  { id: 'ocupacao', label: 'Ocupação' },
  { id: 'seguranca', label: 'Estoque de segurança' },
  { id: 'enderecamento', label: 'Endereçamento' },
  { id: 'inventarios', label: 'Inventários' },
  { id: 'contagem', label: 'Contagem diária' },
  { id: 'estoque', label: 'Estoque' },
  { id: 'agendamentos', label: 'Agendamentos' },
]

export const ALL_MENU_VIEW_IDS = APP_MENU_PERMISSIONS.map((p) => p.id)

export function permissoesViewsToSet(views: string[] | null | undefined): Set<string> | null {
  if (views == null) return null
  return new Set(views.filter((v) => typeof v === 'string' && v.trim()))
}

export function filterSidebarByPermissions(
  items: SidebarItem[],
  allowed: Set<string> | null,
): SidebarItem[] {
  if (!allowed) return items
  return items
    .map((item) => {
      if (item.children?.length) {
        const children = item.children.filter((c) => allowed.has(c.id))
        if (children.length === 0) return null
        return { ...item, children }
      }
      if (allowed.has(item.id)) return item
      return null
    })
    .filter((item): item is SidebarItem => item != null)
}

export function canAccessView(
  view: AppView,
  allowed: Set<string> | null,
  isAdmin: boolean,
): boolean {
  if (isAdmin) return true
  if (view === 'permissoes') return false
  if (!allowed) return true
  if (view === 'inventarioCaptura') return allowed.has('inventarios')
  if (view === 'contagemCaptura') return allowed.has('contagem')
  return allowed.has(view)
}

export function firstAllowedView(allowed: Set<string> | null): AppView {
  if (!allowed) return 'painel'
  for (const p of APP_MENU_PERMISSIONS) {
    if (allowed.has(p.id)) return p.id
  }
  return 'painel'
}

export function parsePermissoesViewsFromDb(raw: unknown): string[] | null {
  if (raw == null) return null
  if (!Array.isArray(raw)) return null
  const ids = raw.map((v) => String(v).trim()).filter(Boolean)
  return ids
}
