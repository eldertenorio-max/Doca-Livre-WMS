/** Invoca Edge Function sso-entrar do WMS Light. */

import {
  clearPortalSsoClaim,
  clearPortalSsoTokenFromUrl,
  readPortalSsoTokenFromLocation,
} from './portalSso'

export { clearPortalSsoClaim, clearPortalSsoTokenFromUrl, readPortalSsoTokenFromLocation }

type SsoOk = { ok: true; access_token: string; refresh_token: string; usuario?: string }
type SsoFail = { ok: false; error: string }
type SsoResult = SsoOk | SsoFail

/** Evita double-consume (StrictMode / remount) no mesmo token. */
const inflightByToken = new Map<string, Promise<SsoResult>>()

async function consumeLightSsoTokenRaw(token: string): Promise<SsoResult> {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim().replace(/\/$/, '')
  const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()
  if (!base || !anon) {
    return { ok: false, error: 'Supabase não configurado no Light.' }
  }
  try {
    const res = await fetch(`${base}/functions/v1/sso-entrar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anon,
        Authorization: `Bearer ${anon}`,
      },
      body: JSON.stringify({ token }),
    })
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean
      error?: string
      code?: string
      message?: string
      access_token?: string
      refresh_token?: string
      usuario?: string
    }
    if (res.status === 404 || data.code === 'NOT_FOUND') {
      return {
        ok: false,
        error:
          'Função SSO do Light não está publicada (sso-entrar). No Supabase: supabase functions deploy sso-entrar.',
      }
    }
    if (!res.ok || !data.ok || !data.access_token || !data.refresh_token) {
      return {
        ok: false,
        error: data.error || data.message || 'Falha no SSO do Light.',
      }
    }
    clearPortalSsoClaim()
    return {
      ok: true,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      usuario: data.usuario,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    // OPTIONS 404 sem CORS vira TypeError/Failed to fetch no browser.
    if (/failed to fetch|networkerror|load failed|cors/i.test(msg) || !msg) {
      return {
        ok: false,
        error:
          'Função SSO do Light não está publicada (sso-entrar). Rode: supabase functions deploy sso-entrar',
      }
    }
    return { ok: false, error: `Falha de rede ao consumir SSO (${msg}).` }
  }
}

export function consumeLightSsoToken(token: string): Promise<SsoResult> {
  const key = token.trim()
  const existing = inflightByToken.get(key)
  if (existing) return existing
  const promise = consumeLightSsoTokenRaw(key)
  inflightByToken.set(key, promise)
  return promise
}
