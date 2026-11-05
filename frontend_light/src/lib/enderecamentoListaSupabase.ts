import type { EnderecoCadastro } from './enderecamentoStore'
import { isSupabaseConfigured, supabase } from './supabaseClient'
import { formatUnknownError } from './supabaseError'

const TABELA = 'enderecamento_listas'
export const LISTA_ENDERECO_PADRAO_NOME = 'CD Ultrapao guarulhos'
const LEGACY_STORAGE_KEY = 'enderecamento-cadastro-v1'

export type EnderecoLista = {
  id: string
  nome: string
  enderecos: EnderecoCadastro[]
  createdAt: string
  updatedAt: string
}

type DbRow = {
  id: string
  nome: string
  enderecos: EnderecoCadastro[] | null
  created_at: string
  updated_at: string
}

function rowToLista(r: DbRow): EnderecoLista {
  return {
    id: r.id,
    nome: r.nome,
    enderecos: Array.isArray(r.enderecos) ? r.enderecos : [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function readLegacyLocal(): EnderecoCadastro[] {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as EnderecoCadastro[]) : []
  } catch {
    return []
  }
}

export function enderecoListasHabilitado(): boolean {
  return isSupabaseConfigured()
}

export async function listEnderecoListas(): Promise<EnderecoLista[]> {
  if (!enderecoListasHabilitado()) return []
  const { data, error } = await supabase
    .from(TABELA)
    .select('id,nome,enderecos,created_at,updated_at')
    .order('nome', { ascending: true })
  if (error) throw new Error(formatUnknownError(error) || 'Erro ao listar endereçamentos.')
  return (data as DbRow[] | null)?.map(rowToLista) ?? []
}

export async function getEnderecoLista(id: string): Promise<EnderecoLista | null> {
  if (!enderecoListasHabilitado()) return null
  const { data, error } = await supabase
    .from(TABELA)
    .select('id,nome,enderecos,created_at,updated_at')
    .eq('id', id)
    .maybeSingle()
  if (error) throw new Error(formatUnknownError(error) || 'Erro ao carregar lista de endereços.')
  return data ? rowToLista(data as DbRow) : null
}

export async function saveEnderecoLista(lista: EnderecoLista): Promise<EnderecoLista> {
  if (!enderecoListasHabilitado()) throw new Error('Supabase não configurado.')
  const now = new Date().toISOString()
  const row = {
    id: lista.id,
    nome: lista.nome.trim(),
    enderecos: lista.enderecos ?? [],
    created_at: lista.createdAt || now,
    updated_at: now,
  }
  const { data, error } = await supabase.from(TABELA).upsert(row, { onConflict: 'id' }).select().single()
  if (error) throw new Error(formatUnknownError(error) || 'Erro ao salvar lista de endereços.')
  return rowToLista(data as DbRow)
}

export async function createEnderecoLista(nome: string, enderecos: EnderecoCadastro[] = []): Promise<EnderecoLista> {
  const now = new Date().toISOString()
  return saveEnderecoLista({
    id: crypto.randomUUID(),
    nome: nome.trim(),
    enderecos,
    createdAt: now,
    updatedAt: now,
  })
}

export async function deleteEnderecoLista(id: string): Promise<void> {
  if (!enderecoListasHabilitado()) return
  const { error } = await supabase.from(TABELA).delete().eq('id', id)
  if (error) throw new Error(formatUnknownError(error) || 'Erro ao excluir lista.')
}

/** Cria a lista padrão a partir do localStorage legado (uma vez) ou lista vazia. */
export async function ensureEnderecoListaPadrao(): Promise<EnderecoLista> {
  const listas = await listEnderecoListas()
  const existente = listas.find((l) => l.nome.toLowerCase() === LISTA_ENDERECO_PADRAO_NOME.toLowerCase())
  if (existente) return existente

  const legado = readLegacyLocal()
  const lista = await createEnderecoLista(LISTA_ENDERECO_PADRAO_NOME, legado)
  if (legado.length > 0) {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }
  return lista
}

export function findEnderecoNaLista(lista: EnderecoLista, codigo: string): EnderecoCadastro | undefined {
  const q = String(codigo ?? '').trim().toUpperCase()
  if (!q) return undefined
  return lista.enderecos.find((r) => r.ativo !== false && r.codigo.trim().toUpperCase() === q)
}

export function enderecosAtivosDaLista(lista: EnderecoLista): EnderecoCadastro[] {
  return [...lista.enderecos]
    .filter((r) => r.ativo !== false)
    .sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR'))
}
