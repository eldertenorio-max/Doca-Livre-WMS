import type { InventarioSessao } from './inventarioSessaoTypes'

const LIST_CACHE_KEY = 'inventario-sessoes-list-cache-v1'
const SESSAO_MAP_KEY = 'inventario-sessao-map-cache-v1'

function readMap(): Record<string, InventarioSessao> {
  try {
    const raw = localStorage.getItem(SESSAO_MAP_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, InventarioSessao>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeMap(map: Record<string, InventarioSessao>): void {
  try {
    localStorage.setItem(SESSAO_MAP_KEY, JSON.stringify(map))
  } catch {
    /* quota */
  }
}

export function cacheInventario(sessao: InventarioSessao): void {
  const map = readMap()
  map[sessao.id] = sessao
  writeMap(map)
}

export function cacheInventarioList(sessoes: InventarioSessao[]): void {
  if (!sessoes.length) return
  const map = readMap()
  for (const s of sessoes) map[s.id] = s
  writeMap(map)
  try {
    localStorage.setItem(LIST_CACHE_KEY, JSON.stringify(sessoes.map((s) => s.id)))
  } catch {
    /* quota */
  }
}

export function readCachedInventario(id: string): InventarioSessao | null {
  return readMap()[id] ?? null
}

export function readCachedInventarioList(): InventarioSessao[] {
  const map = readMap()
  try {
    const raw = localStorage.getItem(LIST_CACHE_KEY)
    if (raw) {
      const ids = JSON.parse(raw) as string[]
      if (Array.isArray(ids) && ids.length) {
        return ids.map((id) => map[id]).filter(Boolean) as InventarioSessao[]
      }
    }
  } catch {
    /* ignore */
  }
  return Object.values(map)
}

export function removeCachedInventario(id: string): void {
  const map = readMap()
  delete map[id]
  writeMap(map)
  try {
    const raw = localStorage.getItem(LIST_CACHE_KEY)
    if (!raw) return
    const ids = (JSON.parse(raw) as string[]).filter((x) => x !== id)
    localStorage.setItem(LIST_CACHE_KEY, JSON.stringify(ids))
  } catch {
    /* ignore */
  }
}
