import { supabase } from './supabaseClient'
import { formatUnknownError } from './supabaseError'

export type Conferente = { id: string; nome: string }

const SEM_CONFERENTE_LABEL = 'Sem conferente'

export function conferenteNomeDeUsuario(username: string): string {
  return String(username ?? '').trim().toLowerCase()
}

export function conferenteCombinaUsuario(conferenteNome: string, username: string): boolean {
  const a = conferenteNomeDeUsuario(conferenteNome)
  const b = conferenteNomeDeUsuario(username)
  if (!a || !b) return false
  return a === b
}

/** Conferente sem usuário com o mesmo login (nome deve ser igual ao username). */
export function conferenteEhOrfao(
  conferente: Conferente,
  usuarios: Array<{ username: string; nome?: string }>,
): boolean {
  const key = conferenteNomeDeUsuario(conferente.nome)
  if (!key || key === conferenteNomeDeUsuario(SEM_CONFERENTE_LABEL)) return true
  return !usuarios.some(
    (u) =>
      conferenteCombinaUsuario(conferente.nome, u.username) ||
      conferenteCombinaUsuario(conferente.nome, u.nome ?? ''),
  )
}

/** Evita erro PostgreSQL 22P02 ao gravar string vazia em coluna uuid. */
export function conferenteIdParaBanco(id: string | null | undefined): string | null {
  const s = String(id ?? '').trim()
  return s || null
}

export function resolveConferenteIdPorNome(
  nome: string | undefined,
  conferentes: Conferente[],
): string | null {
  const alvo = conferenteNomeDeUsuario(nome)
  if (!alvo) return null
  const exato = conferentes.find((c) => conferenteNomeDeUsuario(c.nome) === alvo)
  return exato?.id ?? null
}

export async function ensureConferenteParaUsuario(username: string): Promise<Conferente> {
  const nome = conferenteNomeDeUsuario(username)
  if (!nome) throw new Error('Usuário sem login válido para vincular conferente.')
  const conferentes = await listConferentes()
  const exato = conferentes.find((c) => conferenteNomeDeUsuario(c.nome) === nome)
  if (exato) return exato
  return cadastrarConferente(nome)
}

/**
 * Garante UUID válido para colunas NOT NULL (`contagens_inventario`, etc.).
 * O nome do conferente deve ser igual ao login do usuário.
 */
export async function ensureConferenteIdParaGravacao(
  nome: string | undefined,
  conferentes: Conferente[],
): Promise<string> {
  const resolved = resolveConferenteIdPorNome(nome, conferentes)
  if (resolved) return resolved

  const label = conferenteNomeDeUsuario(nome) || SEM_CONFERENTE_LABEL
  if (label !== SEM_CONFERENTE_LABEL) {
    try {
      const novo = await cadastrarConferente(label)
      conferentes.push(novo)
      return novo.id
    } catch {
      /* tenta fallback abaixo */
    }
  }

  const sem = conferentes.find(
    (c) => conferenteNomeDeUsuario(c.nome) === conferenteNomeDeUsuario(SEM_CONFERENTE_LABEL),
  )
  if (sem) return sem.id

  try {
    const novo = await cadastrarConferente(SEM_CONFERENTE_LABEL)
    conferentes.push(novo)
    return novo.id
  } catch {
    if (conferentes[0]?.id) return conferentes[0].id
    throw new Error(
      `Conferente "${label}" não encontrado. O nome deve ser igual ao login do usuário.`,
    )
  }
}

export async function listConferentes(): Promise<Conferente[]> {
  const { data, error } = await supabase.from('conferentes').select('id,nome').order('nome')
  if (error) throw error
  return data ?? []
}

export async function cadastrarConferente(nome: string): Promise<Conferente> {
  const trimmed = conferenteNomeDeUsuario(nome)
  if (!trimmed) throw new Error('Informe o nome do conferente (igual ao login do usuário).')

  const { data, error } = await supabase
    .from('conferentes')
    .insert({ nome: trimmed })
    .select('id,nome')
    .maybeSingle()

  if (error) {
    if (error.code === '42501' || String(error.message).toLowerCase().includes('row-level security')) {
      throw new Error(
        'Sem permissão para cadastrar conferente no banco. Rode o SQL de policy (RLS) no Supabase para liberar insert em conferentes.',
      )
    }
    throw new Error(formatUnknownError(error) || 'Erro ao cadastrar conferente.')
  }
  if (!data?.id) throw new Error('Conferente não foi criado.')
  return data
}

export async function excluirConferente(conferenteId: string): Promise<void> {
  const id = String(conferenteId ?? '').trim()
  if (!id) return
  const { error } = await supabase.from('conferentes').delete().eq('id', id)
  if (error) {
    const msg = formatUnknownError(error)
    if (msg.toLowerCase().includes('foreign key') || msg.includes('23503')) {
      throw new Error(
        'Não foi possível excluir: este conferente já possui contagens ou inventários vinculados.',
      )
    }
    throw new Error(msg || 'Erro ao excluir conferente.')
  }
}
