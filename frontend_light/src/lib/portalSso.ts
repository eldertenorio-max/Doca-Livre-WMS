/** Lê e limpa token SSO vindo do portal WMS Pro (?sso= / ?token=). */

const SSO_CLAIM_KEY = 'doca_light_sso_claim_v1'

/** Lê o token da URL e, se existir, guarda one-shot (evita double-consume no StrictMode/reload). */
export function readPortalSsoTokenFromLocation(loc: Location = window.location): string | null {
  try {
    const params = new URLSearchParams(loc.search || '')
    const fromUrl = (params.get('sso') || params.get('token') || '').trim()
    if (fromUrl) {
      try {
        sessionStorage.setItem(SSO_CLAIM_KEY, fromUrl)
      } catch {
        /* ignore */
      }
      return fromUrl
    }
    try {
      const claimed = (sessionStorage.getItem(SSO_CLAIM_KEY) || '').trim()
      return claimed || null
    } catch {
      return null
    }
  } catch {
    return null
  }
}

export function clearPortalSsoClaim(): void {
  try {
    sessionStorage.removeItem(SSO_CLAIM_KEY)
  } catch {
    /* ignore */
  }
}

export function clearPortalSsoTokenFromUrl(): void {
  try {
    const url = new URL(window.location.href)
    if (!url.searchParams.has('sso') && !url.searchParams.has('token')) return
    url.searchParams.delete('sso')
    url.searchParams.delete('token')
    const next = `${url.pathname}${url.search}${url.hash}`
    window.history.replaceState({}, document.title, next || '/')
  } catch {
    /* ignore */
  }
}
