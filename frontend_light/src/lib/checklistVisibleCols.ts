/** Última tela de lista visitada (Contagem diária vs Inventário) — relatório usa para escolher qual prefs de colunas. */
export const LAST_LIST_SCREEN_SESSION_KEY = 'contagem-last-list-screen' as const

export function writeLastListScreen(kind: 'contagem' | 'inventario'): void {
  try {
    sessionStorage.setItem(LAST_LIST_SCREEN_SESSION_KEY, kind)
  } catch {
    /* ignore */
  }
}

export function readLastListWasInventario(): boolean {
  try {
    return sessionStorage.getItem(LAST_LIST_SCREEN_SESSION_KEY) === 'inventario'
  } catch {
    return false
  }
}

/** Mesmas chaves que em ContagemEstoque — lista principal e relatório leem o mesmo localStorage. */
export const CHECKLIST_VISIBLE_COLS_STORAGE = {
  contagem: 'contagem-checklist-visible-cols',
  inventario: 'inventario-checklist-visible-cols',
} as const

export function loadChecklistVisibleColsFromStorage(inventario: boolean): Record<string, boolean> {
  try {
    const k = inventario ? CHECKLIST_VISIBLE_COLS_STORAGE.inventario : CHECKLIST_VISIBLE_COLS_STORAGE.contagem
    const raw = localStorage.getItem(k)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, boolean> = {}
    for (const [key, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'boolean') out[key] = v
    }
    return out
  } catch {
    return {}
  }
}
