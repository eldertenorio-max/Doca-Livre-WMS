/** API do portal único hospedado no WMS Unificado (Pro). */

const HUB_TOKEN_KEY = 'doca_hub_token_v1'
const HUB_USER_KEY = 'doca_hub_user_v1'

type PortalLoginBody = {
  ok?: boolean
  usuario?: string
  hub_token?: string
  is_superuser?: boolean
  permissoes?: Record<
    string,
    { pode_acessar?: boolean; modulos?: string[] | Record<string, string> | null }
  > | null
  erro?: string
}

export function getProApiBase(): string {
  // No sistema unificado, o Plus roda na mesma origem do Flask Pro.
  if (typeof window !== 'undefined') {
    const w = window as unknown as { __WMS_UNIFIED__?: { apiBase?: string } }
    if (w.__WMS_UNIFIED__?.apiBase) {
      return w.__WMS_UNIFIED__.apiBase.replace(/\/?$/, '/')
    }
    return '/'
  }
  const fromEnv = (import.meta.env.VITE_WMS_PRO_URL as string | undefined)?.trim()
  if (fromEnv) return fromEnv.replace(/\/?$/, '/')
  return '/'
}

async function portalPost<T extends { ok?: boolean; erro?: string }>(
  path: string,
  body: Record<string, unknown>,
): Promise<T | { ok: false; erro: string }> {
  try {
    const res = await fetch(`${getProApiBase()}${path.replace(/^\//, '')}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json().catch(() => ({}))) as T & {
      smtp_motivo?: string
    }
    if (!res.ok || !data.ok) {
      const base = data.erro || 'Não foi possível concluir a operação.'
      const detail = (data.smtp_motivo || '').trim()
      return {
        ok: false,
        erro: detail && !base.includes(detail) ? `${base} (${detail})` : base,
      }
    }
    return data
  } catch {
    return { ok: false, erro: 'Falha de conexão com o portal.' }
  }
}

export function loadHubSession(): { usuario: string; hubToken: string } | null {
  try {
    const w =
      typeof window !== 'undefined'
        ? (window as unknown as { __WMS_UNIFIED__?: { usuario?: string; hubToken?: string } })
            .__WMS_UNIFIED__
        : undefined
    const hubToken =
      sessionStorage.getItem(HUB_TOKEN_KEY)?.trim() || w?.hubToken?.trim() || 'session-cookie'
    const usuario = sessionStorage.getItem(HUB_USER_KEY)?.trim() || w?.usuario?.trim() || ''
    if (!usuario) return null
    return { usuario, hubToken }
  } catch {
    return null
  }
}

export function saveHubSession(usuario: string, hubToken: string): void {
  sessionStorage.setItem(HUB_USER_KEY, usuario)
  sessionStorage.setItem(HUB_TOKEN_KEY, hubToken)
}

export function clearHubSession(): void {
  try {
    sessionStorage.removeItem(HUB_TOKEN_KEY)
    sessionStorage.removeItem(HUB_USER_KEY)
  } catch {
    /* ignore */
  }
}

function isRenderWakingBody(text: string): boolean {
  const t = text.toLowerCase()
  return (
    t.includes('application loading') ||
    t.includes('waking up') ||
    t.includes('service waking') ||
    t.includes('allocating compute')
  )
}

export async function wakeProApi(
  timeoutMs = 90000,
  onAttempt?: (info: { attempt: number; elapsedMs: number }) => void,
): Promise<boolean> {
  const base = getProApiBase()
  const deadline = Date.now() + timeoutMs
  let attempt = 0
  while (Date.now() < deadline) {
    attempt += 1
    onAttempt?.({ attempt, elapsedMs: Date.now() - (deadline - timeoutMs) })
    const remaining = Math.max(1000, deadline - Date.now())
    const perTry = Math.min(25000, remaining)
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), perTry)
    try {
      const res = await fetch(`${base}api/health`, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
      })
      const text = await res.text()
      if (isRenderWakingBody(text)) {
        /* ainda na tela de loading do Render */
      } else if (res.ok) {
        const data = JSON.parse(text) as { ok?: boolean }
        if (data?.ok) return true
      }
    } catch {
      /* cold start / CORS antigo / abort → tenta de novo */
    } finally {
      window.clearTimeout(timer)
    }
    const pause = Math.min(1500, Math.max(400, deadline - Date.now()))
    if (pause > 0) await new Promise((r) => setTimeout(r, pause))
  }
  return false
}

export async function portalLogin(
  usuario: string,
  senha: string,
  opts?: {
    onPhase?: (phase: 'wake' | 'login', detail?: { attempt?: number; elapsedMs?: number }) => void
  },
): Promise<
  | {
      ok: true
      usuario: string
      hubToken: string
      isSuperuser?: boolean
      permissoes?: Record<
        string,
        { pode_acessar?: boolean; modulos?: string[] | Record<string, string> | null }
      > | null
    }
  | { ok: false; erro: string }
> {
  void wakeProApi(20000)
  opts?.onPhase?.('login')

  let lastErro = 'Falha de conexão com o portal.'
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    opts?.onPhase?.('login', { attempt, elapsedMs: (attempt - 1) * 8000 })
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 25000)
    try {
      const res = await fetch(`${getProApiBase()}api/portal/login`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario, senha }),
        signal: controller.signal,
      })
      const text = await res.text()
      if (isRenderWakingBody(text) && attempt < 4) {
        lastErro = 'O servidor está iniciando. Tentando de novo…'
        await new Promise((r) => setTimeout(r, 2500))
        continue
      }
      let data: PortalLoginBody = {}
      try {
        data = JSON.parse(text) as PortalLoginBody
      } catch {
        data = {}
      }
      if (res.status === 503 && attempt < 4) {
        lastErro = data.erro || 'Servidor ocupado. Tentando de novo…'
        await new Promise((r) => setTimeout(r, 2000))
        continue
      }
      if (!res.ok || !data.ok || !data.hub_token || !data.usuario) {
        if (!data.erro && attempt < 4) {
          lastErro = 'Servidor iniciando. Tentando de novo…'
          await new Promise((r) => setTimeout(r, 2000))
          continue
        }
        return { ok: false, erro: data.erro || 'Usuário ou senha incorretos.' }
      }
      saveHubSession(data.usuario, data.hub_token)
      return {
        ok: true,
        usuario: data.usuario,
        hubToken: data.hub_token,
        isSuperuser: Boolean(data.is_superuser),
        permissoes: data.permissoes ?? null,
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        lastErro = 'O servidor demorou para responder. Aguarde ~30s e tente de novo.'
      } else {
        lastErro = 'Falha de conexão com o portal.'
      }
      if (attempt < 4) {
        await new Promise((r) => setTimeout(r, 1500))
        continue
      }
    } finally {
      window.clearTimeout(timer)
    }
  }
  return { ok: false, erro: lastErro }
}

export async function portalCadastroEnviarCodigo(email: string) {
  return portalPost<{
    ok: true
    mensagem?: string
    email?: string
    debug_codigo?: string
  }>('api/portal/cadastro/enviar-codigo', { email })
}

export async function portalCadastroVerificarCodigo(email: string, codigo: string) {
  return portalPost<{
    ok: true
    verify_token: string
    email?: string
    mensagem?: string
  }>('api/portal/cadastro/verificar-codigo', { email, codigo })
}

export async function portalCadastroConcluir(input: {
  verifyToken: string
  usuario: string
  senha: string
  confirmarSenha: string
}) {
  return portalPost<{ ok: true; mensagem?: string; usuario?: string }>('api/portal/cadastro/concluir', {
    verify_token: input.verifyToken,
    usuario: input.usuario,
    senha: input.senha,
    confirmar_senha: input.confirmarSenha,
  })
}

export async function portalSenhaEnviarCodigo(identificador: string) {
  return portalPost<{
    ok: true
    enviado?: boolean
    mensagem?: string
    email_mascarado?: string
    debug_codigo?: string
  }>('api/portal/senha/enviar-codigo', { identificador })
}

export async function portalSenhaVerificarCodigo(identificador: string, codigo: string) {
  return portalPost<{
    ok: true
    verify_token: string
    usuario?: string
    email?: string
    mensagem?: string
  }>('api/portal/senha/verificar-codigo', { identificador, codigo })
}

export async function portalSenhaRedefinir(input: {
  verifyToken: string
  senha: string
  confirmarSenha: string
}) {
  return portalPost<{ ok: true; mensagem?: string; usuario?: string }>('api/portal/senha/redefinir', {
    verify_token: input.verifyToken,
    senha: input.senha,
    confirmar_senha: input.confirmarSenha,
  })
}

export async function issueSystemSsoUrl(
  system: 'light' | 'plus' | 'pro',
  hubToken: string,
): Promise<{ ok: true; url: string } | { ok: false; erro: string }> {
  try {
    const res = await fetch(`${getProApiBase()}api/sso/issue`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hubToken}`,
      },
      body: JSON.stringify({ system, hub_token: hubToken }),
    })
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; url?: string; erro?: string }
    if (!res.ok || !data.ok || !data.url) {
      return { ok: false, erro: data.erro || 'Não foi possível abrir o sistema.' }
    }
    return { ok: true, url: data.url }
  } catch {
    return { ok: false, erro: 'Falha de conexão ao emitir SSO.' }
  }
}
