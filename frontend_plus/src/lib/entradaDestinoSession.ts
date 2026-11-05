import type { MovimentoRegistro, NotaFiscal } from '../types'

const ENTRADA_DESTINO_KEY = 'ultrafrio-entrada-destino-pendente'

export type EntradaDestinoPendente = {
  imported: NotaFiscal[]
  movimentos: MovimentoRegistro[]
}

export function loadEntradaDestinoPendente(): EntradaDestinoPendente | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(ENTRADA_DESTINO_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as EntradaDestinoPendente
    if (!Array.isArray(parsed.imported) || parsed.imported.length === 0) return null
    return {
      imported: parsed.imported,
      movimentos: Array.isArray(parsed.movimentos) ? parsed.movimentos : [],
    }
  } catch {
    return null
  }
}

export function saveEntradaDestinoPendente(pending: EntradaDestinoPendente): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(ENTRADA_DESTINO_KEY, JSON.stringify(pending))
  } catch {
    /* ignore */
  }
}

export function clearEntradaDestinoPendente(): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.removeItem(ENTRADA_DESTINO_KEY)
  } catch {
    /* ignore */
  }
}
