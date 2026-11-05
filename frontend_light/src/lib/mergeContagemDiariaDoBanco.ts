import { TABLE_CONTAGEM_DIARIA } from './contagensDb'
import { fetchContagensPaged } from './contagensSelectCompat'
import { contagemLinhaAVenceB } from './contagemOrdemLinha'
import { contagemDiariaChaveProdutoDia } from './contagemListagemCompat'
import { normalizeCodigoInternoCompareKey } from './codigoInternoCompare'
import { isContagemDiariaRowResumo } from './contagemDiariaPresenca'
import { fetchConferentesNomesPorIds } from './conferentesNomesBatch'
import type { OfflineChecklistItem } from './offlineContagemSession'

/** Até 1000 por requisição — alinhado ao max_rows padrão da API Supabase. */
const FETCH_CHUNK = 1000

const MERGE_DIARIA_COLUMNS = [
  'id',
  'conferente_id',
  'codigo_interno',
  'descricao',
  'quantidade_up',
  'up_adicional',
  'lote',
  'observacao',
  'data_fabricacao',
  'data_validade',
  'ean',
  'dun',
  'data_hora_contagem',
  'origem',
  'inventario_repeticao',
  'inventario_numero_contagem',
] as const

function toDateInputValue(v?: string | null) {
  if (!v) return ''
  const str = String(v)
  const m = str.match(/^\d{4}-\d{2}-\d{2}/)
  return m ? m[0] : ''
}

function formatQtyFromNumber(n: number): string {
  if (!Number.isFinite(n)) return ''
  const s = String(n)
  return s.includes('.') ? s.replace('.', ',') : s
}

type RowSnapshot = {
  /** `contagens_estoque.id` — desempate quando `data_hora_contagem` é igual (insert mais recente). */
  contagensRowId: string
  conferente_id: string
  quantidade_up: number
  up_adicional: number | null
  lote: string | null
  observacao: string | null
  data_fabricacao: string | null
  data_validade: string | null
  ean: string | null
  dun: string | null
  data_hora_contagem: string
}

/**
 * Busca registros em `contagens_estoque` do dia civil (todos os conferentes), só contagem diária,
 * e devolve a linha mais recente por **dia + código normalizado + descrição** (igual à prévia).
 */
async function fetchUltimasPorCodigo(dataContagemYmd: string): Promise<Map<string, RowSnapshot>> {
  const map = new Map<string, RowSnapshot>()
  const ymd = String(dataContagemYmd ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return map

  const { data: acc, error } = await fetchContagensPaged({
    table: TABLE_CONTAGEM_DIARIA,
    columns: MERGE_DIARIA_COLUMNS,
    eq: { data_contagem: ymd },
    order: { column: 'id', ascending: true },
    pageSize: FETCH_CHUNK,
  })
  if (error) {
    if (import.meta.env.DEV) console.warn('[mergeContagemDiariaDoBanco] select', error)
    return map
  }

  for (const r of acc) {
    if (!isContagemDiariaRowResumo(r)) continue
    const cidRow = r.conferente_id != null ? String(r.conferente_id).trim() : ''
    if (!cidRow) continue
    const codRaw = r.codigo_interno != null ? String(r.codigo_interno) : ''
    const descRaw = r.descricao != null ? String(r.descricao) : ''
    const key = contagemDiariaChaveProdutoDia(ymd, codRaw, descRaw)
    if (!normalizeCodigoInternoCompareKey(codRaw)) continue
    const dhRaw = r.data_hora_contagem != null ? String(r.data_hora_contagem) : ''
    const qRaw = r.quantidade_up
    const q = typeof qRaw === 'number' ? qRaw : Number(String(qRaw ?? '').replace(',', '.'))
    if (!Number.isFinite(q) || q < 0) continue

    let up_adicional: number | null = null
    const upRaw = r.up_adicional
    if (upRaw != null && String(upRaw).trim() !== '') {
      const u = typeof upRaw === 'number' ? upRaw : Number(String(upRaw).replace(',', '.'))
      if (Number.isFinite(u) && u >= 0) up_adicional = u
    }

    const rowId = r.id != null ? String(r.id) : ''
    if (!rowId) continue

    const snap: RowSnapshot = {
      contagensRowId: rowId,
      conferente_id: cidRow,
      quantidade_up: q,
      up_adicional,
      lote: r.lote != null && String(r.lote).trim() !== '' ? String(r.lote) : null,
      observacao: r.observacao != null && String(r.observacao).trim() !== '' ? String(r.observacao) : null,
      data_fabricacao: r.data_fabricacao != null ? String(r.data_fabricacao) : null,
      data_validade: r.data_validade != null ? String(r.data_validade) : null,
      ean: r.ean != null && String(r.ean).trim() !== '' ? String(r.ean).trim() : null,
      dun: r.dun != null && String(r.dun).trim() !== '' ? String(r.dun).trim() : null,
      data_hora_contagem: dhRaw || new Date(0).toISOString(),
    }

    const prev = map.get(key)
    if (
      !prev ||
      contagemLinhaAVenceB(
        { data_hora_contagem: snap.data_hora_contagem, id: snap.contagensRowId },
        { data_hora_contagem: prev.data_hora_contagem, id: prev.contagensRowId },
      )
    ) {
      map.set(key, snap)
    }
  }

  return map
}

export type MergeContagemDiariaOptions = {
  /** Itens que o usuário alterou localmente — não sobrescreve quantidade/dados com o banco até limpar a quantidade. */
  skipKeys?: Set<string>
}

/**
 * Preenche itens da checklist com a última contagem diária já gravada no banco (mesmo dia, todos os conferentes).
 */
export async function mergeContagensDiariasDoDiaParaItems(
  dataContagemYmd: string,
  items: OfflineChecklistItem[],
  options?: MergeContagemDiariaOptions,
): Promise<{ items: OfflineChecklistItem[]; preenchidos: number }> {
  const skipKeys = options?.skipKeys
  const porChave = await fetchUltimasPorCodigo(dataContagemYmd)
  if (porChave.size === 0) {
    return { items: items.map((i) => ({ ...i })), preenchidos: 0 }
  }

  const ids = [...new Set([...porChave.values()].map((s) => s.conferente_id).filter(Boolean))]
  const nomesPorId = await fetchConferentesNomesPorIds(ids)

  /** Fallback quando a descrição na checklist difere da gravada em contagens_estoque (ex.: cadastro atualizado). */
  const porCodigoNorm = new Map<string, RowSnapshot>()
  for (const [key, snap] of porChave) {
    const codeNorm = String(key.split('|')[1] ?? '').trim().toLowerCase()
    if (!codeNorm) continue
    const prev = porCodigoNorm.get(codeNorm)
    if (
      !prev ||
      contagemLinhaAVenceB(
        { data_hora_contagem: snap.data_hora_contagem, id: snap.contagensRowId },
        { data_hora_contagem: prev.data_hora_contagem, id: prev.contagensRowId },
      )
    ) {
      porCodigoNorm.set(codeNorm, snap)
    }
  }

  let preenchidos = 0
  const ymd = String(dataContagemYmd ?? '').trim()
  const next = items.map((it) => {
    if (skipKeys?.has(it.key)) {
      const kSkip = contagemDiariaChaveProdutoDia(ymd, String(it.codigo_interno ?? ''), String(it.descricao ?? ''))
      const snapSkip = porChave.get(kSkip) ?? porCodigoNorm.get(normalizeCodigoInternoCompareKey(String(it.codigo_interno ?? '')).toLowerCase())
      if (!snapSkip) return { ...it }
      const nomeUltimo =
        nomesPorId.get(snapSkip.conferente_id)?.trim() || snapSkip.conferente_id
      return { ...it, contagem_banco_ultimo_conferente_nome: nomeUltimo }
    }
    const k = contagemDiariaChaveProdutoDia(ymd, String(it.codigo_interno ?? ''), String(it.descricao ?? ''))
    const snap =
      porChave.get(k) ??
      porCodigoNorm.get(normalizeCodigoInternoCompareKey(String(it.codigo_interno ?? '')).toLowerCase())
    if (!snap) {
      return { ...it, contagem_banco_ultimo_conferente_nome: undefined }
    }

    preenchidos += 1
    const nomeConf =
      nomesPorId.get(snap.conferente_id)?.trim() || snap.conferente_id
    return {
      ...it,
      quantidade_contada: formatQtyFromNumber(snap.quantidade_up),
      up_quantidade: snap.up_adicional != null ? formatQtyFromNumber(snap.up_adicional) : '',
      lote: snap.lote ?? '',
      observacao: snap.observacao ?? '',
      data_fabricacao: snap.data_fabricacao != null ? toDateInputValue(snap.data_fabricacao) : it.data_fabricacao ?? '',
      data_validade: snap.data_validade != null ? toDateInputValue(snap.data_validade) : it.data_validade ?? '',
      ean: snap.ean != null ? snap.ean : it.ean ?? null,
      dun: snap.dun != null ? snap.dun : it.dun ?? null,
      contagem_banco_ultimo_conferente_nome: nomeConf,
    }
  })

  return { items: next, preenchidos }
}
