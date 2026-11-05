/** Consome token SSO emitido pelo portal WMS Pro. */

export function readPortalSsoTokenFromLocation(loc: Location = window.location): string | null {
  try {
    const params = new URLSearchParams(loc.search || '')
    const token = (params.get('sso') || params.get('token') || '').trim()
    return token || null
  } catch {
    return null
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

function portalVerifyUrl(): string {
  const fromEnv = (import.meta.env.VITE_WMS_PRO_URL as string | undefined)?.trim()
  const base = (fromEnv || 'https://doca-livre-wms-pro.onrender.com/').replace(/\/?$/, '/')
  return `${base}api/sso/verify`
}

export async function verifyPortalSsoToken(token: string): Promise<{ ok: true; usuario: string } | { ok: false; erro: string }> {
  try {
    const res = await fetch(portalVerifyUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, system: 'plus' }),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; usuario?: string; erro?: string }
    if (!res.ok || !data.ok || !data.usuario) {
      return { ok: false, erro: data.erro || 'Token SSO inválido.' }
    }
    return { ok: true, usuario: String(data.usuario) }
  } catch {
    return { ok: false, erro: 'Falha ao validar SSO no portal Pro.' }
  }
}
