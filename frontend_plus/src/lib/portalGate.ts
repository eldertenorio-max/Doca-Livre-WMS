/** Marcadores de sessão após entrar pelo portal (hub) ou SSO. */

const PORTAL_ENTRY_KEY = 'doca_portal_entry_v1'

export function hasPortalEntryMarker(): boolean {
  try {
    return sessionStorage.getItem(PORTAL_ENTRY_KEY) === '1'
  } catch {
    return false
  }
}

export function markPortalEntry(): void {
  try {
    sessionStorage.setItem(PORTAL_ENTRY_KEY, '1')
  } catch {
    /* ignore */
  }
}

export function clearPortalEntryMarker(): void {
  try {
    sessionStorage.removeItem(PORTAL_ENTRY_KEY)
  } catch {
    /* ignore */
  }
}

/** No WMS Unificado, voltar redireciona ao Hub de Módulos (/entrada) ou ao logout (/login?sair=1). */
export function goToPublicPortal(sair = false): void {
  clearPortalEntryMarker()
  if (sair) {
    window.location.assign('/login?sair=1')
    return
  }
  window.location.assign('/entrada')
}
