const SAIDA_DESTINO_KEY = 'ultrafrio-saida-destino-pendente'

export function loadSaidaDestinoPendenteId(): string | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    return sessionStorage.getItem(SAIDA_DESTINO_KEY)
  } catch {
    return null
  }
}

export function saveSaidaDestinoPendenteId(nfId: string): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.setItem(SAIDA_DESTINO_KEY, nfId)
  } catch {
    /* ignore */
  }
}

export function clearSaidaDestinoPendenteId(): void {
  if (typeof sessionStorage === 'undefined') return
  try {
    sessionStorage.removeItem(SAIDA_DESTINO_KEY)
  } catch {
    /* ignore */
  }
}
