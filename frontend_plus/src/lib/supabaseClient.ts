import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { instalarRealtimePorConsulta, usaBackendWms } from './pollingRealtime'

function cleanEnv(value: string | undefined): string {
  if (!value) return ''
  return value.trim().replace(/^['"]|['"]$/g, '')
}

function isValidHttpUrl(value: string): boolean {
  if (!value) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

const unifiedWin =
  typeof window !== 'undefined'
    ? (window as unknown as {
        __WMS_UNIFIED__?: { supabaseUrl?: string; supabaseAnonKey?: string }
      }).__WMS_UNIFIED__
    : undefined

let supabaseUrl =
  cleanEnv(unifiedWin?.supabaseUrl) ||
  cleanEnv(import.meta.env.VITE_SUPABASE_URL) ||
  'https://wbqyufalamdsgurejvyz.supabase.co'
let supabaseAnonKey =
  cleanEnv(unifiedWin?.supabaseAnonKey) ||
  cleanEnv(import.meta.env.VITE_SUPABASE_ANON_KEY) ||
  'sb_publishable_G1gT1Fp_sc_ojXyJYKzElA_-fVP80TK'

export function applySupabaseCredentials(url: string, anonKey: string): void {
  supabaseUrl = cleanEnv(url)
  supabaseAnonKey = cleanEnv(anonKey)
  client = null
}

export function getSupabaseUrl(): string {
  return supabaseUrl
}

export function getSupabaseAnonKey(): string {
  return supabaseAnonKey
}

export function isSupabaseConfigured(): boolean {
  return isValidHttpUrl(supabaseUrl) && supabaseAnonKey.length > 0
}

const missingEnvError = new Error(
  'Supabase não configurado. Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no Render.',
)

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured()) throw missingEnvError
  if (!client) {
    client = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
    // Dados na Azure via /sb do WMS: tempo real por consulta periódica (sem WebSocket).
    if (usaBackendWms(supabaseUrl)) instalarRealtimePorConsulta(client, supabaseUrl)
  }
  return client
}

type NfRow = {
  id: string
  numero: string
  serie: string
  chave: string
  emitente: string
  emitente_cnpj?: string | null
  data_emissao: string
  data_armazenagem?: string | null
  status: 'em_andamento' | 'concluida'
  created_at: string
  peso_bruto?: number | null
  peso_liquido?: number | null
  valor_total_nota?: number | null
  quantidade_volume?: string | null
}

type ItemRow = {
  nf_id: string
  item_index: number
  codigo: string
  descricao: string
  quantidade: number
  unidade: string
  peso_bruto?: number | null
  valor_unitario?: number | null
  valor_total?: number | null
  up?: string | null
  lote?: string | null
  data_fabricacao?: string | null
  data_validade?: string | null
  paletes?: number | null
  localizacao?: string | null
}

type EndRow = {
  nf_id: string
  item_index: number
  address_id: string
}

type MovRow = {
  id: string
  tipo: 'entrada' | 'saida' | 'movimentacao'
  nf_id: string | null
  nf_numero: string
  emitente: string
  created_at: string
  payload: {
    itens: import('../types').MovimentoItemSnapshot[]
    nfIdHistorico?: string
    justificativaSaida?: import('../types').JustificativaSaidaId
    motivoRemocaoEstoque?: import('../types').MotivoRemocaoEstoqueId
    nfSaida?: import('../types').NfeDocumentoResumo
    dataSaida?: string
    excluido?: boolean
    excluidoEm?: string | null
  }
}

type CanceladaRow = {
  id: string
  numero: string
  serie: string
  chave: string
  emitente: string
  data_emissao: string
  created_at: string
  vinculo_nf_nova_id: string | null
  vinculo_nf_nova_numero: string | null
  payload: {
    items: import('../types').NfeItemCancelado[]
    excluido?: boolean
    excluidoEm?: string | null
  }
}

type EmitenteRow = {
  nome_key: string
  nome: string
  updated_at: string
}

export type { NfRow, ItemRow, EndRow, MovRow, CanceladaRow, EmitenteRow }
