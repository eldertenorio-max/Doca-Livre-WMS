import { getSupabase } from '../../supabaseClient'
import type { ClienteFinanceiro, ContratoCliente, TabelaCobranca } from '../types'
import { financeiroVazio } from '../types'
import type { FinanceiroRepository, FinanceiroSaveOptions } from './types'

type TabelaRow = {
  id: string
  nome: string
  custo_posicao_palete: number
  custo_por_kilo: number
  custo_por_palete: number
  custo_entrada: number
  custo_saida: number
  created_at: string
}

type ClienteRow = {
  cnpj: string
  razao_social: string
  origem: string
  created_at: string
}

type ContratoRow = {
  id: string
  cnpj: string
  razao_social: string
  tabela_id: string | null
  ciclo: string
  regra_tempo: string
  cobrar_posicao_palete: boolean
  cobrar_kilo: boolean
  cobrar_palete: boolean
  cobrar_entrada: boolean
  cobrar_saida: boolean
  kilo_por_dia: boolean
  ativo: boolean
  observacao: string | null
  created_at: string
}

function mapTabela(row: TabelaRow): TabelaCobranca {
  return {
    id: row.id,
    nome: row.nome,
    custoPosicaoPalete: Number(row.custo_posicao_palete),
    custoPorKilo: Number(row.custo_por_kilo),
    custoPorPalete: Number(row.custo_por_palete),
    custoEntrada: Number(row.custo_entrada),
    custoSaida: Number(row.custo_saida),
    criadoEm: row.created_at,
  }
}

function mapCliente(row: ClienteRow): ClienteFinanceiro {
  return {
    cnpj: row.cnpj,
    razaoSocial: row.razao_social,
    origem: row.origem === 'manual' ? 'manual' : 'auto',
    criadoEm: row.created_at,
  }
}

function mapContrato(row: ContratoRow): ContratoCliente {
  return {
    id: row.id,
    cnpj: row.cnpj,
    razaoSocial: row.razao_social,
    tabelaId: row.tabela_id,
    ciclo: row.ciclo === 'quinzenal' ? 'quinzenal' : 'mensal',
    regraTempo: row.regra_tempo === 'cheia' ? 'cheia' : 'proporcional',
    cobrarPosicaoPalete: row.cobrar_posicao_palete,
    cobrarKilo: row.cobrar_kilo,
    cobrarPalete: row.cobrar_palete,
    cobrarEntrada: row.cobrar_entrada,
    cobrarSaida: row.cobrar_saida,
    kiloPorDia: row.kilo_por_dia,
    ativo: row.ativo,
    ...(row.observacao ? { observacao: row.observacao } : {}),
    criadoEm: row.created_at,
  }
}

function tabelaUpsertRow(t: TabelaCobranca) {
  return {
    id: t.id,
    nome: t.nome,
    custo_posicao_palete: t.custoPosicaoPalete,
    custo_por_kilo: t.custoPorKilo,
    custo_por_palete: t.custoPorPalete,
    custo_entrada: t.custoEntrada,
    custo_saida: t.custoSaida,
    created_at: t.criadoEm,
  }
}

function clienteUpsertRow(c: ClienteFinanceiro) {
  return {
    cnpj: c.cnpj,
    razao_social: c.razaoSocial,
    origem: c.origem,
    created_at: c.criadoEm,
  }
}

function contratoUpsertRow(c: ContratoCliente) {
  return {
    id: c.id,
    cnpj: c.cnpj,
    razao_social: c.razaoSocial,
    tabela_id: c.tabelaId,
    ciclo: c.ciclo,
    regra_tempo: c.regraTempo,
    cobrar_posicao_palete: c.cobrarPosicaoPalete,
    cobrar_kilo: c.cobrarKilo,
    cobrar_palete: c.cobrarPalete,
    cobrar_entrada: c.cobrarEntrada,
    cobrar_saida: c.cobrarSaida,
    kilo_por_dia: c.kiloPorDia,
    ativo: c.ativo,
    observacao: c.observacao ?? null,
    created_at: c.criadoEm,
  }
}

async function syncTable<T extends { id: string }>(
  table: string,
  items: T[],
  toRow: (item: T) => Record<string, unknown>,
  opts?: FinanceiroSaveOptions,
): Promise<void> {
  const sb = getSupabase()
  const { data: existing, error: loadErr } = await sb.from(table).select('id')
  if (loadErr) {
    if (loadErr.message.includes('does not exist') || loadErr.code === 'PGRST205') return
    throw new Error(loadErr.message)
  }
  const keep = new Set(items.map((i) => i.id))
  const toDelete = ((existing ?? []) as { id: string }[])
    .map((r) => r.id)
    .filter((id) => !keep.has(id))
  if (toDelete.length) {
    if (items.length === 0 && !opts?.permitirListaVazia) {
      return
    }
    const { error } = await sb.from(table).delete().in('id', toDelete)
    if (error) throw new Error(error.message)
  }
  for (const item of items) {
    const { error } = await sb.from(table).upsert(toRow(item))
    if (error) throw new Error(error.message)
  }
}

async function syncClientes(clientes: ClienteFinanceiro[]): Promise<void> {
  const sb = getSupabase()
  for (const c of clientes) {
    const { error } = await sb
      .from('ultrafrio_fin_clientes')
      .upsert(clienteUpsertRow(c), { onConflict: 'cnpj' })
    if (error) {
      if (error.message.includes('does not exist') || error.code === 'PGRST205') return
      throw new Error(error.message)
    }
  }
}

export const supabaseFinanceiroRepository: FinanceiroRepository = {
  async load() {
    const sb = getSupabase()

    const { data: tabelas, error: tErr } = await sb
      .from('ultrafrio_fin_tabelas')
      .select('*')
      .order('created_at', { ascending: false })
    if (tErr) {
      if (tErr.message.includes('does not exist') || tErr.code === 'PGRST205') return financeiroVazio
      throw new Error(tErr.message)
    }

    const { data: clientes, error: cErr } = await sb
      .from('ultrafrio_fin_clientes')
      .select('*')
      .order('created_at', { ascending: false })
    if (cErr) {
      if (cErr.message.includes('does not exist') || cErr.code === 'PGRST205') {
        return {
          tabelas: (tabelas ?? []).map((r) => mapTabela(r as TabelaRow)),
          contratos: [],
          clientes: [],
        }
      }
      throw new Error(cErr.message)
    }

    const { data: contratos, error: ctErr } = await sb
      .from('ultrafrio_fin_contratos')
      .select('*')
      .order('created_at', { ascending: false })
    if (ctErr) {
      if (ctErr.message.includes('does not exist') || ctErr.code === 'PGRST205') {
        return {
          tabelas: (tabelas ?? []).map((r) => mapTabela(r as TabelaRow)),
          contratos: [],
          clientes: (clientes ?? []).map((r) => mapCliente(r as ClienteRow)),
        }
      }
      throw new Error(ctErr.message)
    }

    return {
      tabelas: (tabelas ?? []).map((r) => mapTabela(r as TabelaRow)),
      clientes: (clientes ?? []).map((r) => mapCliente(r as ClienteRow)),
      contratos: (contratos ?? []).map((r) => mapContrato(r as ContratoRow)),
    }
  },

  async save(data, opts) {
    await syncTable('ultrafrio_fin_tabelas', data.tabelas, tabelaUpsertRow, opts)
    await syncClientes(data.clientes)
    await syncTable('ultrafrio_fin_contratos', data.contratos, contratoUpsertRow, opts)
  },
}
