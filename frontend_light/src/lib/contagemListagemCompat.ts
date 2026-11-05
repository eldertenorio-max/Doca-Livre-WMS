import type { SupabaseClient } from '@supabase/supabase-js'
import { contagemLinhaAVenceB } from './contagemOrdemLinha'
import { normalizeCodigoInternoCompareKey } from './codigoInternoCompare'

export type ModoListagemContagem = 'inventario' | 'contagem_diaria'

/** IDs em `contagens_estoque` referenciados por `inventario_planilha_linhas` (mesmo critério da prévia). */
export async function fetchPlanilhaContagemIdsParaIntervalo(
  supabase: SupabaseClient,
  dataInventarioMinYmd: string,
  dataInventarioMaxYmd: string,
  fkColumn: 'contagens_estoque_id' | 'contagens_inventario_id' = 'contagens_inventario_id',
): Promise<Set<string>> {
  const out = new Set<string>()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInventarioMinYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(dataInventarioMaxYmd)) {
    return out
  }
  try {
    const { data } = await supabase
      .from('inventario_planilha_linhas')
      .select(`${fkColumn},contagens_estoque_id,contagens_inventario_id`)
      .gte('data_inventario', dataInventarioMinYmd)
      .lte('data_inventario', dataInventarioMaxYmd)
      .limit(20000)
    for (const pr of data ?? []) {
      const row = pr as Record<string, unknown>
      const cid =
        row[fkColumn] ??
        row.contagens_inventario_id ??
        row.contagens_estoque_id
      if (cid != null) out.add(String(cid))
    }
  } catch {
    /* tabela ausente / RLS */
  }
  return out
}

function hasInventarioMetaRow(r: Record<string, unknown>): boolean {
  return (
    (r.inventario_repeticao != null && String(r.inventario_repeticao).trim() !== '') ||
    (r.inventario_numero_contagem != null && String(r.inventario_numero_contagem).trim() !== '')
  )
}

/**
 * Mesma regra da prévia em `ContagemEstoque` (`byOrigem`): inventário vs contagem diária.
 * `previewOrigemAusenteNoResultado`: coluna `origem` não existe ou não veio no resultado (fallback SQL).
 */
export function filterContagensPorModoListagem(
  rows: Record<string, unknown>[],
  modo: ModoListagemContagem,
  planilhaContagemIds: Set<string>,
  previewOrigemAusenteNoResultado: boolean,
): Record<string, unknown>[] {
  return rows.filter((r) => {
    const o = r.origem != null ? String(r.origem) : ''
    if (modo === 'contagem_diaria') return o !== 'inventario' && !hasInventarioMetaRow(r)
    /** Tabela dedicada `contagens_inventario`: todas as linhas já são inventário. */
    if (previewOrigemAusenteNoResultado && modo === 'inventario' && o === '') return true
    if (o === 'inventario') return true
    const rid = String(r.id ?? '')
    if (planilhaContagemIds.has(rid)) return true
    if (previewOrigemAusenteNoResultado) return hasInventarioMetaRow(r)
    return hasInventarioMetaRow(r)
  })
}

/** Ordenação alinhada à prévia do inventário (Câmara → RUA → POS → nível → …). */
export function ordenarLinhasInventarioComoPrevia<T extends Record<string, unknown>>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const g = Number(a.planilha_grupo_armazem ?? 0) - Number(b.planilha_grupo_armazem ?? 0)
    if (g !== 0) return g
    const ruaCmp = String(a.planilha_rua ?? '').localeCompare(String(b.planilha_rua ?? ''), 'pt-BR')
    if (ruaCmp !== 0) return ruaCmp
    const p = Number(a.planilha_posicao ?? 0) - Number(b.planilha_posicao ?? 0)
    if (p !== 0) return p
    const n = Number(a.planilha_nivel ?? 0) - Number(b.planilha_nivel ?? 0)
    if (n !== 0) return n
    const rep = Number(a.inventario_repeticao ?? 0) - Number(b.inventario_repeticao ?? 0)
    if (rep !== 0) return rep
    const nc = Number(a.inventario_numero_contagem ?? 0) - Number(b.inventario_numero_contagem ?? 0)
    if (nc !== 0) return nc
    return String(a.id ?? '').localeCompare(String(b.id ?? ''), 'pt-BR')
  })
}

/** Detalhe por conferente em linha agrupada (contagem diária: dia+código+descrição). */
export type ConferenteDetalheGrupo = {
  conferente_id: string
  conferente_nome: string
  quantidade_up: number
  source_ids: string[]
}

type RowMergeContagemDiaria = Record<string, unknown> & {
  id: string
  codigo_interno?: string
  descricao?: string
  data_contagem?: string | null
  data_hora_contagem?: string
  /** Mesma finalização (lote) no mesmo dia — separa relançamentos do mesmo conferente. */
  finalizacao_sessao_id?: string | null
  conferente_id?: string
  conferentes?: { nome?: string } | Array<{ nome?: string }> | null
  quantidade_up?: number
  up_adicional?: number | null
  lote?: string | null
  observacao?: string | null
  unidade_medida?: string | null
  data_fabricacao?: string | null
  data_validade?: string | null
  ean?: string | null
  dun?: string | null
  foto_base64?: string | null
  source_ids?: string[]
  preview_conferentes_detalhe?: ConferenteDetalheGrupo[]
}

/**
 * Dia civil (YYYY-MM-DD) para agrupar contagem diária:
 * prioriza `data_contagem` válida; senão usa a data de `data_hora_contagem` (legado).
 * Sem isso, linhas só com horário caem em `""` e duplicam no relatório/Excel frente a linhas com `data_contagem`.
 */
export function diaCivilYmdContagemRow(
  r: Pick<RowMergeContagemDiaria, 'data_contagem' | 'data_hora_contagem'>,
): string | null {
  const d = r.data_contagem != null ? String(r.data_contagem).slice(0, 10) : ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d
  const t = r.data_hora_contagem != null ? String(r.data_hora_contagem).slice(0, 10) : ''
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null
}

function nomeConferenteJoinRow(r: Record<string, unknown>): string {
  const c = r.conferentes as { nome?: string } | Array<{ nome?: string }> | null | undefined
  if (!c) return ''
  if (Array.isArray(c)) return String(c[0]?.nome ?? '').trim()
  return String((c as { nome?: string }).nome ?? '').trim()
}

/** Mesma ideia da prévia: vários conferentes no mesmo grupo viram lista única ordenada. */
function mergeConferenteNomesUnicos(a: string, b: string): string {
  const parts = new Set<string>()
  for (const s of [a, b]) {
    for (const part of String(s ?? '').split(',')) {
      const t = part.trim()
      if (t) parts.add(t)
    }
  }
  return Array.from(parts).sort((x, y) => x.localeCompare(y, 'pt-BR')).join(', ')
}

function conferenteNomeParaDetalhe(r: Record<string, unknown>): string {
  const plain = String(r.conferente_nome ?? '').trim()
  if (plain) return plain
  const n = nomeConferenteJoinRow(r)
  if (n) return n
  const id = String(r.conferente_id ?? '').trim()
  return id || '—'
}

/**
 * Rascunhos (`contagem_rascunho`): agrupa por dia + código + descrição para ver e editar em tempo real
 * a contagem de todos os conferentes na mesma linha (detalhe por conferente em `preview_conferentes_detalhe`).
 */
export function agruparContagemDiariaComoPrevia<T extends RowMergeContagemDiaria>(rows: T[]): T[] {
  const grouped = new Map<string, T>()
  for (const row of rows) {
    const day = diaCivilYmdContagemRow(row) ?? ''
    const key = `${day}|${normalizeCodigoInternoCompareKey(String(row.codigo_interno ?? '')).toLowerCase()}|${String(row.descricao ?? '').trim().toLowerCase()}`
    const existing = grouped.get(key)
    const rowRec = row as Record<string, unknown>
    const cid = String(row.conferente_id ?? '').trim() || '__sem__'
    const nomeLinha = conferenteNomeParaDetalhe(rowRec)

    if (!existing) {
      grouped.set(key, {
        ...row,
        source_ids: [String(row.id)],
        preview_conferentes_detalhe: [
          {
            conferente_id: cid,
            conferente_nome: nomeLinha,
            quantidade_up: Number(row.quantidade_up ?? 0),
            source_ids: [String(row.id)],
          },
        ],
      } as T)
      continue
    }
    existing.quantidade_up = Number(existing.quantidade_up ?? 0) + Number(row.quantidade_up ?? 0)
    const sid = existing.source_ids ?? []
    sid.push(String(row.id))
    existing.source_ids = sid
    const det = existing.preview_conferentes_detalhe
    if (det) {
      const idx = det.findIndex((d) => d.conferente_id === cid)
      if (idx >= 0) {
        det[idx].quantidade_up += Number(row.quantidade_up ?? 0)
        det[idx].source_ids.push(String(row.id))
      } else {
        det.push({
          conferente_id: cid,
          conferente_nome: nomeLinha,
          quantidade_up: Number(row.quantidade_up ?? 0),
          source_ids: [String(row.id)],
        })
      }
      det.sort((a, b) => a.conferente_nome.localeCompare(b.conferente_nome, 'pt-BR'))
    }
    const av = row.up_adicional
    if (av != null && Number.isFinite(Number(av))) {
      const nAv = Number(av)
      const ev = existing.up_adicional
      existing.up_adicional =
        ev != null && Number.isFinite(Number(ev)) ? Number(ev) + nAv : nAv
    }
    if (!existing.lote && row.lote) existing.lote = row.lote
    if (!existing.observacao && row.observacao) existing.observacao = row.observacao
    if (!existing.unidade_medida && row.unidade_medida) existing.unidade_medida = row.unidade_medida
    if (!existing.data_fabricacao && row.data_fabricacao) existing.data_fabricacao = row.data_fabricacao
    if (!existing.data_validade && row.data_validade) existing.data_validade = row.data_validade
    if (!existing.ean && row.ean) existing.ean = row.ean
    if (!existing.dun && row.dun) existing.dun = row.dun
    if (!existing.foto_base64 && row.foto_base64) existing.foto_base64 = row.foto_base64
    const ex = existing as Record<string, unknown>
    const n1 = conferenteNomeParaDetalhe(ex)
    const n2 = conferenteNomeParaDetalhe(row as Record<string, unknown>)
    const merged = mergeConferenteNomesUnicos(n1, n2)
    if (merged && merged !== n1) {
      ex.conferente_nome = merged
      ex.conferentes = { nome: merged }
    } else if (!n1 && n2) {
      ex.conferentes = (row as Record<string, unknown>).conferentes
      const pl = String((row as Record<string, unknown>).conferente_nome ?? '').trim()
      if (pl) ex.conferente_nome = pl
    }
  }
  return Array.from(grouped.values())
}

/** Chave única para o mesmo produto na contagem diária (alinhada à prévia e ao merge da checklist). */
export function contagemDiariaChaveProdutoDia(dataContagemYmd: string, codigo_interno: string, descricao: string): string {
  const day = String(dataContagemYmd ?? '').trim().slice(0, 10)
  const code = normalizeCodigoInternoCompareKey(String(codigo_interno ?? '')).toLowerCase()
  const desc = String(descricao ?? '').trim().toLowerCase()
  return `${day}|${code}|${desc}`
}

function rowKeyCodigoBase(r: RowMergeContagemDiaria): string {
  const day = diaCivilYmdContagemRow(r) ?? ''
  return contagemDiariaChaveProdutoDia(day, String(r.codigo_interno ?? ''), String(r.descricao ?? ''))
}

/**
 * Consolida a contagem diária para "valor real do dia": mantém apenas a última linha por dia+código+descrição.
 * Critério de desempate: maior `data_hora_contagem`; depois maior `id`.
 */
export function consolidarUltimaContagemDiariaPorCodigo<T extends RowMergeContagemDiaria>(rows: T[]): T[] {
  const byKey = new Map<string, T>()
  for (const row of rows) {
    const key = rowKeyCodigoBase(row)
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, { ...row, source_ids: [String(row.id)] } as T)
      continue
    }
    if (
      contagemLinhaAVenceB(
        { data_hora_contagem: String(row.data_hora_contagem ?? ''), id: String(row.id) },
        { data_hora_contagem: String(prev.data_hora_contagem ?? ''), id: String(prev.id) },
      )
    ) {
      byKey.set(key, { ...row, source_ids: [String(row.id)] } as T)
    }
  }
  return Array.from(byKey.values())
}

/**
 * Igual à consolidação por código, mas separa por conferente.
 * Útil para exportar por abas de conferente sem somar relançamentos antigos.
 */
export function consolidarUltimaContagemDiariaPorCodigoEConferente<T extends RowMergeContagemDiaria>(rows: T[]): T[] {
  const byKey = new Map<string, T>()
  for (const row of rows) {
    const cid = String(row.conferente_id ?? '').trim() || '__sem__'
    const key = `${rowKeyCodigoBase(row)}|${cid}`
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, { ...row, source_ids: [String(row.id)] } as T)
      continue
    }
    if (
      contagemLinhaAVenceB(
        { data_hora_contagem: String(row.data_hora_contagem ?? ''), id: String(row.id) },
        { data_hora_contagem: String(prev.data_hora_contagem ?? ''), id: String(prev.id) },
      )
    ) {
      byKey.set(key, { ...row, source_ids: [String(row.id)] } as T)
    }
  }
  return Array.from(byKey.values())
}

/**
 * Contagem diária na prévia/lista: **uma linha por produto** no dia.
 * Considera rascunho e oficiais juntos e mantém o último lançamento do item
 * (`data_hora_contagem`, depois `id`), sem duplicar linhas.
 *
 * `preview_conferentes_detalhe` traz só o conferente vencedor da linha.
 */
export function prepararContagemDiariaOficialListaUnicaPorProduto<T extends RowMergeContagemDiaria>(rows: T[]): T[] {
  const cons = consolidarUltimaContagemDiariaPorCodigo(rows)
  return cons.map((r) => {
    const rowRec = r as Record<string, unknown>
    const q = Number(r.quantidade_up ?? 0)
    const sid = r.source_ids?.length ? [...r.source_ids] : [String(r.id)]
    const winnerCid = String(r.conferente_id ?? '').trim() || '__sem__'
    const det: ConferenteDetalheGrupo[] = [
      {
        conferente_id: winnerCid,
        conferente_nome: conferenteNomeParaDetalhe(rowRec),
        quantidade_up: q,
        source_ids: sid,
      },
    ]
    return {
      ...r,
      quantidade_up: q,
      source_ids: sid,
      preview_conferentes_detalhe: det,
    } as T
  })
}
