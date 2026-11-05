import type { ContagemDiariaLinhaCaptura } from './contagemDiariaLinhaTypes'
import type { ContagemDiariaSessao } from './contagemDiariaSessaoTypes'
import { isSupabaseConfigured, supabase } from './supabaseClient'
import { formatUnknownError, isColumnMissingError } from './supabaseError'

const TABELA = 'contagem_diaria_sessoes'

type DbRow = {
  id: string
  numero: number
  titulo: string
  local: string
  data_contagem: string
  conferente_nome: string | null
  lista_produtos_id: string | null
  lista_produtos_nome: string | null
  data_inicio: string
  data_fim: string | null
  status: 'aberto' | 'fechado'
  iniciada: boolean
  linhas: ContagemDiariaLinhaCaptura[] | null
  created_at: string
  updated_at: string
}

export type UpsertContagemDiariaResult = {
  /** `false` quando a coluna `linhas` não existe ou não aceitou o JSON — use overlay local. */
  linhasNoBanco: boolean
}

export function contagemDiariaSyncHabilitado(): boolean {
  return isSupabaseConfigured()
}

function rowToSessao(r: DbRow): ContagemDiariaSessao {
  return {
    id: r.id,
    numero: r.numero,
    titulo: r.titulo,
    local: r.local,
    dataContagem: String(r.data_contagem).slice(0, 10),
    conferenteNome: r.conferente_nome?.trim() || undefined,
    listaProdutosId: r.lista_produtos_id ?? undefined,
    listaProdutosNome: r.lista_produtos_nome?.trim() || undefined,
    dataInicio: r.data_inicio,
    dataFim: r.data_fim,
    status: r.status,
    iniciada: Boolean(r.iniciada),
    linhas: Array.isArray(r.linhas) ? r.linhas : [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function sessaoToRow(s: ContagemDiariaSessao): DbRow {
  const now = new Date().toISOString()
  return {
    id: s.id,
    numero: s.numero,
    titulo: s.titulo,
    local: s.local,
    data_contagem: s.dataContagem,
    conferente_nome: s.conferenteNome?.trim() || null,
    lista_produtos_id: s.listaProdutosId ?? null,
    lista_produtos_nome: s.listaProdutosNome?.trim() || null,
    data_inicio: s.dataInicio,
    data_fim: s.dataFim,
    status: s.status,
    iniciada: Boolean(s.iniciada),
    linhas: s.linhas ?? [],
    created_at: s.createdAt || now,
    updated_at: s.updatedAt || now,
  }
}

/** `null` = ainda não sabemos; definido após leitura ou upsert. */
let linhasColumnDisponivel: boolean | null = null
let listaProdutosColumnDisponivel: boolean | null = null

/** Infere colunas opcionais a partir do retorno de `select('*')` (sem GETs extras com 400). */
function aplicarDicasSchemaNasLinhas(data: DbRow[] | DbRow | null): void {
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') return
  if ('linhas' in row) linhasColumnDisponivel = true
  else if (linhasColumnDisponivel === null) linhasColumnDisponivel = false
  if ('lista_produtos_id' in row) listaProdutosColumnDisponivel = true
  else if (listaProdutosColumnDisponivel === null) listaProdutosColumnDisponivel = false
}

export function resetContagemDiariaSchemaProbe(): void {
  linhasColumnDisponivel = null
  listaProdutosColumnDisponivel = null
}

async function queryContagemSessoes(id?: string): Promise<DbRow[] | DbRow | null> {
  const res = id
    ? await supabase.from(TABELA).select('*').eq('id', id).maybeSingle()
    : await supabase.from(TABELA).select('*').order('numero', { ascending: false })
  if (res.error) {
    throw new Error(formatUnknownError(res.error) || 'Erro ao buscar contagens no banco.')
  }
  const data = (res.data as DbRow[] | DbRow | null) ?? (id ? null : [])
  aplicarDicasSchemaNasLinhas(data)
  return data
}

export async function fetchContagemDiariaSessoesSupabase(): Promise<ContagemDiariaSessao[]> {
  if (!contagemDiariaSyncHabilitado()) return []
  const data = await queryContagemSessoes()
  return Array.isArray(data) ? data.map(rowToSessao) : []
}

export async function fetchContagemDiariaSessaoByIdSupabase(id: string): Promise<ContagemDiariaSessao | null> {
  if (!contagemDiariaSyncHabilitado()) return null
  const data = await queryContagemSessoes(id)
  return data && !Array.isArray(data) ? rowToSessao(data as DbRow) : null
}

async function upsertRow(payload: Record<string, unknown>): Promise<{ error: unknown | null }> {
  const { error } = await supabase.from(TABELA).upsert(payload, { onConflict: 'id' })
  return { error }
}

export async function upsertContagemDiariaSessaoSupabase(
  sessao: ContagemDiariaSessao,
): Promise<UpsertContagemDiariaResult> {
  if (!contagemDiariaSyncHabilitado()) return { linhasNoBanco: true }
  const row = sessaoToRow(sessao)
  const temLinhas = (sessao.linhas?.length ?? 0) > 0

  const payload: Record<string, unknown> = { ...row }
  if (listaProdutosColumnDisponivel === false) {
    delete payload.lista_produtos_id
    delete payload.lista_produtos_nome
  }
  if (linhasColumnDisponivel === false) {
    delete payload.linhas
  }

  let { error } = await upsertRow(payload)
  if (error && isColumnMissingError(error)) {
    delete payload.lista_produtos_id
    delete payload.lista_produtos_nome
    listaProdutosColumnDisponivel = false
    const res = await upsertRow(payload)
    error = res.error
  }
  if (error && isColumnMissingError(error)) {
    delete payload.linhas
    linhasColumnDisponivel = false
    const res = await upsertRow(payload)
    error = res.error
    if (!error) return { linhasNoBanco: temLinhas ? false : true }
  }
  if (error) throw new Error(formatUnknownError(error) || 'Erro ao salvar contagem no banco.')
  if ('linhas' in payload) linhasColumnDisponivel = true
  if ('lista_produtos_id' in payload) listaProdutosColumnDisponivel = true
  return { linhasNoBanco: linhasColumnDisponivel !== false }
}

export async function deleteContagemDiariaSessaoSupabase(id: string): Promise<void> {
  if (!contagemDiariaSyncHabilitado()) return
  const { error } = await supabase.from(TABELA).delete().eq('id', id)
  if (error) throw new Error(formatUnknownError(error) || 'Erro ao excluir contagem no banco.')
}

export async function fetchProximoNumeroContagemDiariaSupabase(): Promise<number> {
  if (!contagemDiariaSyncHabilitado()) return 1
  const { data, error } = await supabase.from(TABELA).select('numero').order('numero', { ascending: false }).limit(1)
  if (error) throw new Error(formatUnknownError(error) || 'Erro ao obter número da contagem.')
  const max = data?.[0]?.numero
  if (typeof max === 'number' && Number.isFinite(max)) return max + 1
  return 1
}
