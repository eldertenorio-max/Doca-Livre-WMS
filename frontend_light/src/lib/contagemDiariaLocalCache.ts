import type { ContagemDiariaSessao } from './contagemDiariaSessaoTypes'

const LIST_CACHE_KEY = 'contagem-diaria-sessoes-list-cache-v1'
const SESSAO_MAP_KEY = 'contagem-diaria-sessao-map-cache-v1'

function readMap(): Record<string, ContagemDiariaSessao> {
  try {
    const raw = localStorage.getItem(SESSAO_MAP_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, ContagemDiariaSessao>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeMap(map: Record<string, ContagemDiariaSessao>): void {
  try {
    localStorage.setItem(SESSAO_MAP_KEY, JSON.stringify(map))
  } catch {
    /* quota */
  }
}

export function cacheSessao(sessao: ContagemDiariaSessao): void {
  const map = readMap()
  map[sessao.id] = sessao
  writeMap(map)
}

export function cacheSessaoList(sessoes: ContagemDiariaSessao[]): void {
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

export function readCachedSessao(id: string): ContagemDiariaSessao | null {
  return readMap()[id] ?? null
}

export function readCachedSessaoList(): ContagemDiariaSessao[] {
  const map = readMap()
  try {
    const raw = localStorage.getItem(LIST_CACHE_KEY)
    if (raw) {
      const ids = JSON.parse(raw) as string[]
      if (Array.isArray(ids) && ids.length) {
        return ids.map((id) => map[id]).filter(Boolean) as ContagemDiariaSessao[]
      }
    }
  } catch {
    /* ignore */
  }
  return Object.values(map)
}

export function removeCachedSessao(id: string): void {
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
