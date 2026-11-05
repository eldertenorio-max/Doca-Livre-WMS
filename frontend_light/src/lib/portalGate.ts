/** Acesso direto (sem SSO) redireciona ao portal público no Plus. */

const PORTAL_ENTRY_KEY = 'doca_portal_entry_v1'
const PORTAL_PROD = 'https://wms.docalivre.com.br/'
const PORTAL_HML = 'https://ultrafrio-homologacao.onrender.com/'

function isLocalHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local')
}

function isHomologHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return h.includes('homolog') || h.includes('homologacao')
}

export function getPublicPortalUrl(): string {
  const fromEnv =
    (import.meta.env.VITE_PORTAL_URL as string | undefined)?.trim() ||
    (import.meta.env.VITE_WMS_PLUS_URL as string | undefined)?.trim()
  if (fromEnv) return fromEnv.replace(/\/?$/, '/')

  if (typeof window !== 'undefined' && isHomologHost(window.location.hostname)) {
    return PORTAL_HML
  }
  return PORTAL_PROD
}

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

export function allowsDirectAccessWithoutPortal(loc: Location = window.location): boolean {
  try {
    const params = new URLSearchParams(loc.search || '')
    if (params.get('stay') === '1' || params.get('portal') === '0') return true
  } catch {
    /* ignore */
  }
  if (String(import.meta.env.VITE_ALLOW_DIRECT_ACCESS || '').trim() === '1') return true
  if (typeof window !== 'undefined' && isLocalHost(loc.hostname)) return true
  return false
}

export function redirectDirectAccessToProPortal(opts?: { hasSsoToken?: boolean }): boolean {
  // Nome legado: redireciona ao portal Plus (prod ou homolog conforme o host).
  if (typeof window === 'undefined') return false
  if (opts?.hasSsoToken) return false
  if (hasPortalEntryMarker()) return false
  if (allowsDirectAccessWithoutPortal()) return false
  window.location.replace(getPublicPortalUrl())
  return true
}

export function goToProPortal(sair = false, ssoErro?: string): void {
  const base = getPublicPortalUrl().replace(/\/?$/, '/')
  try {
    const u = new URL(base)
    if (sair) {
      u.searchParams.set('sair', '1')
    } else {
      // Volta ao hub Light/Plus/Pro (não reabre o app Plus).
      u.searchParams.set('hub', '1')
    }
    if (ssoErro) u.searchParams.set('sso_erro', ssoErro.slice(0, 180))
    window.location.assign(u.toString())
  } catch {
    window.location.assign(sair ? `${base}?sair=1` : `${base}?hub=1`)
  }
}
