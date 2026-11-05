import { LOGO_DOCA_LIVRE_SRC } from './brandAssets'

export type ContaUsuario = {
  id: string
  nome: string
  avatarUrl?: string
  ultimoAcesso: string
  ativo?: boolean
}

const SESSAO_KEY = 'ultrafrio-conta-sessao'
const ATIVO_KEY = 'ultrafrio-conta-ativo'
const SESSAO_TTL_MS = 8 * 60 * 60 * 1000
const MAX_USUARIOS = 8

export const CONTA_SISTEMA_ID = 'conta-sistema'

export function contaSistema(): ContaUsuario {
  return {
    id: CONTA_SISTEMA_ID,
    nome: 'Doca Livre',
    avatarUrl: LOGO_DOCA_LIVRE_SRC,
    ultimoAcesso: new Date().toISOString(),
    ativo: true,
  }
}

function lerSessao(): ContaUsuario[] {
  if (typeof sessionStorage === 'undefined') return [contaSistema()]
  try {
    const raw = sessionStorage.getItem(SESSAO_KEY)
    if (!raw) return [contaSistema()]
    const parsed = JSON.parse(raw) as ContaUsuario[]
    if (!Array.isArray(parsed) || parsed.length === 0) return [contaSistema()]
    return parsed
  } catch {
    return [contaSistema()]
  }
}

function salvarSessao(usuarios: ContaUsuario[]) {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(SESSAO_KEY, JSON.stringify(usuarios))
}

function limparExpirados(usuarios: ContaUsuario[]): ContaUsuario[] {
  const cutoff = Date.now() - SESSAO_TTL_MS
  const sistema = contaSistema()
  const filtrados = usuarios.filter(
    (u) => u.id === CONTA_SISTEMA_ID || new Date(u.ultimoAcesso).getTime() >= cutoff,
  )
  if (!filtrados.some((u) => u.id === CONTA_SISTEMA_ID)) {
    return [sistema, ...filtrados]
  }
  return filtrados
}

export function listarUsuariosSessao(): ContaUsuario[] {
  const ativoId = getUsuarioAtivoId()
  const lista = limparExpirados(lerSessao())
    .sort((a, b) => new Date(b.ultimoAcesso).getTime() - new Date(a.ultimoAcesso).getTime())
    .slice(0, MAX_USUARIOS)
    .map((u) => ({ ...u, ativo: u.id === ativoId }))

  salvarSessao(lista.map(({ ativo: _, ...u }) => u))
  return lista
}

export function getUsuarioAtivoId(): string {
  if (typeof sessionStorage === 'undefined') return CONTA_SISTEMA_ID
  return sessionStorage.getItem(ATIVO_KEY) ?? CONTA_SISTEMA_ID
}

export function setUsuarioAtivoId(id: string) {
  if (typeof sessionStorage === 'undefined') return
  sessionStorage.setItem(ATIVO_KEY, id)
}

export function getUsuarioAtivo(): ContaUsuario {
  const id = getUsuarioAtivoId()
  return listarUsuariosSessao().find((u) => u.id === id) ?? contaSistema()
}

export function registrarAcessoUsuario(input: {
  id: string
  nome: string
  avatarUrl?: string
  tornarAtivo?: boolean
}): ContaUsuario[] {
  const agora = new Date().toISOString()
  let usuarios = limparExpirados(lerSessao())
  const idx = usuarios.findIndex((u) => u.id === input.id)

  if (idx >= 0) {
    usuarios[idx] = {
      ...usuarios[idx],
      nome: input.nome,
      avatarUrl: input.avatarUrl ?? usuarios[idx].avatarUrl,
      ultimoAcesso: agora,
    }
  } else {
    usuarios = [
      {
        id: input.id,
        nome: input.nome,
        avatarUrl: input.avatarUrl,
        ultimoAcesso: agora,
        ativo: false,
      },
      ...usuarios.filter((u) => u.id !== input.id),
    ].slice(0, MAX_USUARIOS)
  }

  if (!usuarios.some((u) => u.id === CONTA_SISTEMA_ID)) {
    usuarios.push(contaSistema())
  }

  salvarSessao(usuarios.map(({ ativo: _, ...u }) => u))

  if (input.tornarAtivo !== false) {
    setUsuarioAtivoId(input.id)
  }

  return listarUsuariosSessao()
}

export function iniciaisUsuario(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean)
  if (partes.length === 0) return '?'
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase()
  return `${partes[0][0] ?? ''}${partes[1][0] ?? ''}`.toUpperCase()
}

export function corAvatarUsuario(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  const hue = Math.abs(hash) % 360
  return `hsl(${hue} 42% 42%)`
}
