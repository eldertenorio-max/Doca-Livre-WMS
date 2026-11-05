/** APIs de configuração do portal (Super Usuário) no Pro. */

import { getProApiBase, loadHubSession } from './portalApi'

export type SistemaId = 'light' | 'plus' | 'pro'

/** Nível de acesso por tela/módulo. */
export type ModuloAcesso = 'visualizar' | 'editar'

export type SistemaPermissao = {
  pode_acessar: boolean
  /**
   * null = todas as telas com editar;
   * {} = nenhuma;
   * mapa id → visualizar | editar
   * (legado: string[] ainda é aceito na leitura)
   */
  modulos: Record<string, ModuloAcesso> | null
}

/** Normaliza resposta da API (lista legado → mapa editar). */
export function normalizeModulosMap(
  raw: Record<string, ModuloAcesso> | string[] | null | undefined,
): Record<string, ModuloAcesso> | null {
  if (raw == null) return null
  if (Array.isArray(raw)) {
    const out: Record<string, ModuloAcesso> = {}
    for (const id of raw) {
      const k = String(id || '').trim()
      if (k) out[k] = 'editar'
    }
    return out
  }
  if (typeof raw === 'object') {
    const out: Record<string, ModuloAcesso> = {}
    for (const [k, v] of Object.entries(raw)) {
      const id = String(k || '').trim()
      if (!id) continue
      const acesso = String(v || '').toLowerCase()
      out[id] = acesso === 'visualizar' ? 'visualizar' : 'editar'
    }
    return out
  }
  return {}
}

export type PortalUsuarioRow = {
  usuario: string
  email?: string
  ativo?: boolean
  nivel?: string
  superior?: string
  empresa_org_id?: string | null
  is_superuser?: boolean
}

export type OrgTipo =
  | 'operador_logistico'
  | 'filial_operador'
  | 'embarcador'
  | 'unidade'
  | 'transportadora'

export type OrgNo = {
  id: string
  parent_id: string | null
  tipo: OrgTipo | string
  nome: string
  cnpj?: string | null
  codigo?: string | null
  ordem?: number
  sistema?: SistemaId | string
  is_fornecedor?: boolean
  label_tipo?: string
  usuarios_count?: number
  children?: OrgNo[]
}

export type OrgGrupoMembro = {
  id: string
  grupo_id: string
  empresa_id: string
  parent_empresa_id?: string | null
  posicao?: number
  sistema?: string
  empresa_nome?: string | null
  empresa_tipo?: string | null
}

export type OrgGrupo = {
  id: string
  nome: string
  descricao?: string | null
  sistema?: SistemaId | string
  empresa_id?: string | null
  membros?: OrgGrupoMembro[]
}

export type PortalConfigOverview = {
  ok: true
  actor: string
  usuarios: PortalUsuarioRow[]
  niveis: { id: string; label: string; ordem: number }[]
  matriz: Record<string, Record<SistemaId, SistemaPermissao>>
  sistemas: SistemaId[]
  modulos: Record<SistemaId, { id: string; label: string }[]>
  arvore?: OrgNo[]
  arvores?: Partial<Record<SistemaId, OrgNo[]>>
  grupos?: Partial<Record<SistemaId, OrgGrupo[]>>
  tipos_org?: {
    id: string
    label: string
    valid_parents?: string[]
    allowed_children?: string[]
  }[]
  sistemas_org?: { id: string; label: string }[]
}

async function authFetchOnce<T extends { ok?: boolean; erro?: string }>(
  path: string,
  init?: RequestInit,
): Promise<T | { ok: false; erro: string }> {
  const hub = loadHubSession()
  const hubToken = hub?.hubToken || 'session-cookie'
  const url = `${getProApiBase()}${path.replace(/^\//, '')}`
  // Envia hub_token no body + Authorization (alguns proxies cortam o header).
  let body = init?.body
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body || '{}') as Record<string, unknown>
      if (parsed && typeof parsed === 'object' && !parsed.hub_token) {
        body = JSON.stringify({ ...parsed, hub_token: hubToken })
      }
    } catch {
      body = JSON.stringify({ hub_token: hubToken })
    }
  } else if (body == null) {
    body = JSON.stringify({ hub_token: hubToken })
  }
  try {
    const res = await fetch(url, {
      ...init,
      credentials: 'same-origin',
      method: init?.method || 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hubToken}`,
        ...(init?.headers || {}),
      },
      body,
      signal: init?.signal,
    })
    const data = (await res.json().catch(() => ({}))) as T
    if (!res.ok || !data.ok) {
      return {
        ok: false,
        erro:
          (data as { erro?: string }).erro ||
          `Falha na configuração do portal (${res.status}).`,
      }
    }
    return data
  } catch {
    return {
      ok: false,
      erro: `Falha de conexão com o portal (${getProApiBase()}).`,
    }
  }
}

async function authFetch<T extends { ok?: boolean; erro?: string }>(
  path: string,
  init?: RequestInit,
): Promise<T | { ok: false; erro: string }> {
  let last = await authFetchOnce<T>(path, init)
  if (last.ok) return last
  const msg = String((last as { erro?: string }).erro || '')
  if (!msg.includes('Falha de conexão')) return last
  try {
    await fetch(`${getProApiBase()}api/health`, { method: 'GET', credentials: 'same-origin' })
  } catch {
    /* ignore */
  }
  await new Promise((r) => setTimeout(r, 1000))
  last = await authFetchOnce<T>(path, init)
  return last
}

export async function fetchPortalMe(): Promise<
  | { ok: true; usuario: string; is_superuser: boolean; permissoes: Record<SistemaId, SistemaPermissao> | null }
  | { ok: false; erro: string }
> {
  return authFetch('api/portal/me', { method: 'POST', body: '{}' })
}

export async function fetchPortalConfigOverview(): Promise<PortalConfigOverview | { ok: false; erro: string }> {
  return authFetch('api/portal/config/overview', { method: 'POST', body: '{}' })
}

export async function savePortalPermissoes(
  usuario: string,
  permissoes: Record<SistemaId, SistemaPermissao>,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  return authFetch('api/portal/config/permissoes', {
    method: 'POST',
    body: JSON.stringify({ usuario, permissoes }),
  })
}

export async function savePortalHierarquia(input: {
  usuario: string
  nivel?: string
  superior?: string
}): Promise<{ ok: true } | { ok: false; erro: string }> {
  return authFetch('api/portal/config/hierarquia', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function savePortalOrgNo(input: {
  id?: string
  parent_id?: string | null
  tipo?: string
  nome: string
  cnpj?: string
  codigo?: string
  sistema?: SistemaId | string
  is_fornecedor?: boolean
}): Promise<{ ok: true; no?: OrgNo; id?: string } | { ok: false; erro: string }> {
  return authFetch('api/portal/config/org', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function deletePortalOrgNo(id: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  return authFetch('api/portal/config/org/delete', {
    method: 'POST',
    body: JSON.stringify({ id }),
  })
}

export async function savePortalHierarquiaUsuario(input: {
  usuario: string
  nivel?: string
  superior?: string
  empresa_org_id?: string | null
}): Promise<{ ok: true } | { ok: false; erro: string }> {
  return authFetch('api/portal/config/hierarquia', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function savePortalGrupo(input: {
  id?: string
  nome: string
  descricao?: string
  sistema?: SistemaId | string
  empresa_id?: string | null
}): Promise<{ ok: true; grupo?: OrgGrupo; id?: string } | { ok: false; erro: string }> {
  return authFetch('api/portal/config/grupos', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function deletePortalGrupo(id: string): Promise<{ ok: true } | { ok: false; erro: string }> {
  return authFetch('api/portal/config/grupos/delete', {
    method: 'POST',
    body: JSON.stringify({ id }),
  })
}

export async function addPortalGrupoMembro(input: {
  grupo_id: string
  empresa_id: string
  parent_empresa_id?: string | null
  posicao?: number
}): Promise<{ ok: true; membro?: OrgGrupoMembro } | { ok: false; erro: string }> {
  return authFetch('api/portal/config/grupos/membros', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function deletePortalGrupoMembro(input: {
  id?: string
  grupo_id?: string
  empresa_id?: string
}): Promise<{ ok: true } | { ok: false; erro: string }> {
  return authFetch('api/portal/config/grupos/membros/delete', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/** Filhos permitidos sob um tipo de pai (parentesco flexível Docalivre). */
export function allowedOrgChildTypes(tipoPai: string | null | undefined): OrgTipo[] {
  const map: Record<string, OrgTipo[]> = {
    '': ['operador_logistico'],
    operador_logistico: ['filial_operador', 'embarcador'],
    filial_operador: ['embarcador', 'unidade', 'transportadora'],
    embarcador: ['unidade'],
    unidade: ['transportadora'],
    transportadora: [],
  }
  if (!tipoPai) return ['operador_logistico']
  return map[tipoPai] ?? []
}

/** Próximo tipo filho sugerido (primeiro permitido). */
export function nextOrgChildType(tipoPai: string | null | undefined): OrgTipo | null {
  const list = allowedOrgChildTypes(tipoPai)
  return list[0] ?? null
}

/** Super usuários conhecidos (fallback se API antiga não devolver is_superuser). */
export function isLocalSuperUser(usuario: string): boolean {
  const u = (usuario || '').trim().toLowerCase()
  if (!u) return false
  const ascii = u
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  const locals = [
    'diego',
    'elder',
    'diego.isidoro',
    'elder.tenorio',
    'eldertenorio',
    'diegoisidoro',
    'diego isidoro',
    'elder tenorio',
  ]
  if (locals.includes(u) || locals.includes(ascii)) return true
  const local = (ascii.split('@')[0] || '').trim()
  if (locals.includes(local)) return true
  if (locals.some((s) => ascii === s || ascii.startsWith(`${s}.`) || ascii.startsWith(`${s}@`))) {
    return true
  }
  if (local.startsWith('diego') || local.startsWith('elder')) return true
  return false
}

const PORTAL_CONFIG_SEEN_KEY = 'doca_portal_config_seen_v1'

export function clearPortalConfigSeen(): void {
  try {
    sessionStorage.removeItem(PORTAL_CONFIG_SEEN_KEY)
  } catch {
    /* ignore */
  }
}

export function markPortalConfigSeen(): void {
  try {
    sessionStorage.setItem(PORTAL_CONFIG_SEEN_KEY, '1')
  } catch {
    /* ignore */
  }
}

export function hasPortalConfigSeen(): boolean {
  try {
    return sessionStorage.getItem(PORTAL_CONFIG_SEEN_KEY) === '1'
  } catch {
    return false
  }
}
