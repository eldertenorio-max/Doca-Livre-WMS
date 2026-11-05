/** Acesso por tela do Plus a partir das permissões do portal. */

import {
  normalizeModulosMap,
  type ModuloAcesso,
} from './portalConfigApi'
import type { SidebarSectionId } from '../components/CollapsibleSidebarSection'

export type PlusModulosMap = Record<string, ModuloAcesso> | null

const PLUS_MODULOS_KEY = 'doca_plus_modulos_v1'

export type ModuloNivel = 'editar' | 'visualizar' | 'bloqueado'

/** null = tudo editar; {} = nada; chave ausente = bloqueado. */
export function acessoModulo(
  map: PlusModulosMap | undefined,
  id: string,
): ModuloNivel {
  if (map == null) return 'editar'
  const v = map[id]
  if (v === 'editar') return 'editar'
  if (v === 'visualizar') return 'visualizar'
  return 'bloqueado'
}

export function canOpenSection(map: PlusModulosMap | undefined, id: string): boolean {
  const a = acessoModulo(map, id)
  return a === 'editar' || a === 'visualizar'
}

export function canEditSection(map: PlusModulosMap | undefined, id: string): boolean {
  return acessoModulo(map, id) === 'editar'
}

export function isSectionReadOnly(map: PlusModulosMap | undefined, id: string): boolean {
  return acessoModulo(map, id) === 'visualizar'
}

export function normalizePlusModulos(
  raw: Record<string, string> | string[] | null | undefined,
): PlusModulosMap {
  return normalizeModulosMap(raw as never)
}

export function savePlusModulosSession(map: PlusModulosMap) {
  try {
    if (map == null) {
      sessionStorage.removeItem(PLUS_MODULOS_KEY)
      sessionStorage.setItem(PLUS_MODULOS_KEY, 'null')
      return
    }
    sessionStorage.setItem(PLUS_MODULOS_KEY, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

export function loadPlusModulosSession(): PlusModulosMap | undefined {
  try {
    const raw = sessionStorage.getItem(PLUS_MODULOS_KEY)
    if (raw == null) return undefined
    if (raw === 'null') return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return normalizePlusModulos(parsed as Record<string, string>)
  } catch {
    return undefined
  }
}

export function clearPlusModulosSession() {
  try {
    sessionStorage.removeItem(PLUS_MODULOS_KEY)
  } catch {
    /* ignore */
  }
}

/** Substitui callbacks de mutação por no-op com aviso. */
export function guardMutations<T extends Record<string, unknown>>(
  props: T,
  readOnly: boolean,
  mutateKeys: readonly (keyof T)[],
  onBlocked: () => void,
): T {
  if (!readOnly) return props
  const next = { ...props }
  for (const key of mutateKeys) {
    const fn = next[key]
    if (typeof fn === 'function') {
      ;(next as Record<string, unknown>)[key as string] = (..._args: unknown[]) => {
        onBlocked()
      }
    }
  }
  return next
}

export const ALL_SIDEBAR_SECTIONS: SidebarSectionId[] = [
  'consulta',
  'entrada',
  'agendamentosHub',
  'saida',
  'editar',
  'canceladas',
  'historico',
  'relatorio',
  'painel',
  'financeiro',
  'cadastroVoz',
  'imprimir',
]
