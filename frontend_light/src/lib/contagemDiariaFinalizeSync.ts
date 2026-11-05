import {
  getGrupoArmazemFromCamaraRua,
  getInventarioRuaArmazem,
} from '../components/inventario/inventarioPlanilhaModel'
import { parseEnderecoCodigo } from './enderecamentoStore'
import { buildPlanilhaMetaPorLinhaCaptura } from './inventarioSessaoFinalizeSync'
import type { InventarioLinhaCaptura } from './inventarioSessaoTypes'
import { TABLE_CONTAGEM_DIARIA } from './contagensDb'
import type { ContagemDiariaLinhaCaptura } from './contagemDiariaLinhaTypes'
import {
  contagemDiariaDatasReferenciaYmd,
  contagemDiariaSessaoFinalizada,
  sessaoDatasNoPeriodo,
} from './capturaSessaoExportUtils'
import { mergeContagemDiariaComFontesLocais } from './contagemDiariaSessaoLocalMerge'
import type { ContagemDiariaSessao } from './contagemDiariaSessaoTypes'
import {
  contagemDiariaSyncHabilitado,
  fetchContagemDiariaSessoesSupabase,
} from './contagemDiariaSessaoSupabase'
import { supabase } from './supabaseClient'
import {
  conferenteIdParaBanco,
  ensureConferenteIdParaGravacao,
  listConferentes,
  resolveConferenteIdPorNome,
  type Conferente,
} from './conferentesStore'

function parseUpAdicional(raw: string | undefined): number | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : null
}

function linhaToPayload(
  sessao: ContagemDiariaSessao,
  linha: ContagemDiariaLinhaCaptura,
  conferenteId: string,
): Record<string, unknown> {
  const df = String(linha.fabricacao ?? '').trim()
  const dv = String(linha.validade ?? '').trim()
  const end = String(linha.endereco ?? '').trim()
  const obsBase = `Contagem #${sessao.numero}${sessao.titulo ? ` — ${sessao.titulo}` : ''}${end ? ` · ${end}` : ''}`
  return {
    data_contagem: sessao.dataContagem,
    data_hora_contagem: linha.createdAt || sessao.dataFim || new Date().toISOString(),
    conferente_id: conferenteId,
    produto_id: null,
    codigo_interno: String(linha.codigoInterno ?? '').trim(),
    descricao: String(linha.descricao ?? '').trim(),
    unidade_medida: String(linha.unidade ?? '').trim() || null,
    quantidade_up: linha.quantidade,
    up_adicional: parseUpAdicional(linha.up),
    lote: String(linha.lote ?? '').trim() || null,
    observacao: obsBase,
    data_fabricacao: df || null,
    data_validade: dv || null,
    ean: String(linha.codigoBarras ?? '').trim() || null,
    dun: null,
    foto_base64: null,
    contagem_rascunho: false,
    finalizacao_sessao_id: sessao.id,
    origem: 'contagem_diaria',
  }
}

async function deleteContagensDaSessao(sessaoId: string): Promise<void> {
  const { error } = await supabase.from(TABLE_CONTAGEM_DIARIA).delete().eq('finalizacao_sessao_id', sessaoId)
  if (error) {
    const msg = String(error.message ?? '').toLowerCase()
    if (msg.includes('finalizacao_sessao_id') && msg.includes('does not exist')) return
    throw error
  }
}

async function sessaoJaSincronizada(sessaoId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from(TABLE_CONTAGEM_DIARIA)
    .select('id', { count: 'exact', head: true })
    .eq('finalizacao_sessao_id', sessaoId)
  if (error) {
    const msg = String(error.message ?? '').toLowerCase()
    if (msg.includes('finalizacao_sessao_id') && msg.includes('does not exist')) return false
    throw error
  }
  return (count ?? 0) > 0
}

function sessaoNoIntervalo(
  sessao: ContagemDiariaSessao,
  opts: { allTime?: boolean; startYmd?: string; endYmd?: string },
): boolean {
  return sessaoDatasNoPeriodo(contagemDiariaDatasReferenciaYmd(sessao), {
    allTime: Boolean(opts.allTime),
    startDate: opts.startYmd ?? '0000-01-01',
    endDate: opts.endYmd ?? '9999-12-31',
    useSingleDay: false,
    singleDay: '',
  })
}

async function insertContagemRows(rows: Record<string, unknown>[]): Promise<number> {
  const CHUNK = 250
  let inserted = 0
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK).map((r) => ({
      ...r,
      conferente_id: conferenteIdParaBanco(r.conferente_id as string | null | undefined),
    }))
    let payload = chunk
    let { data, error } = await supabase.from(TABLE_CONTAGEM_DIARIA).insert(payload).select('id')
    if (error) {
      const msg = String(error.message ?? '').toLowerCase()
      if (msg.includes('origem')) {
        payload = chunk.map((r) => {
          const copy = { ...r }
          delete copy.origem
          return copy
        })
        const res = await supabase.from(TABLE_CONTAGEM_DIARIA).insert(payload).select('id')
        data = res.data
        error = res.error
      }
      if (error && String(error.message ?? '').toLowerCase().includes('finalizacao_sessao_id')) {
        payload = payload.map((r) => {
          const copy = { ...r }
          delete copy.finalizacao_sessao_id
          return copy
        })
        const res = await supabase.from(TABLE_CONTAGEM_DIARIA).insert(payload).select('id')
        data = res.data
        error = res.error
      }
      if (error && String(error.message ?? '').toLowerCase().includes('contagem_rascunho')) {
        payload = payload.map((r) => {
          const copy = { ...r }
          delete copy.contagem_rascunho
          return copy
        })
        const res = await supabase.from(TABLE_CONTAGEM_DIARIA).insert(payload).select('id')
        data = res.data
        error = res.error
      }
    }
    if (error) throw error
    inserted += data?.length ?? 0
  }
  return inserted
}

/** Linhas da captura de contagem diária no formato usado pelo relatório / Excel. */
export function contagemDiariaCapturaLinhasToRelatorioRows(
  sessao: ContagemDiariaSessao,
  conferentes?: Conferente[],
): Array<Record<string, unknown>> {
  const conf = conferentes ?? []
  const metaMap = buildPlanilhaMetaPorLinhaCaptura(sessao.linhas as unknown as InventarioLinhaCaptura[])
  return sessao.linhas.map((ln) => {
    const end = String(ln.endereco ?? '').trim()
    const df = String(ln.fabricacao ?? '').trim()
    const dv = String(ln.validade ?? '').trim()
    const obsBase = `Contagem #${sessao.numero}${sessao.titulo ? ` — ${sessao.titulo}` : ''}${end ? ` · ${end}` : ''}`
    const nomeConferente = String(ln.conferenteNome ?? sessao.conferenteNome ?? '').trim()
    const conferenteId = resolveConferenteIdPorNome(ln.conferenteNome ?? sessao.conferenteNome, conf)
    const parsed = parseEnderecoCodigo(ln.endereco)
    const temEndereco = Boolean(end)

    let grupo: number | null = null
    let rua: string | null = null
    let pos: number | null = null
    let nivel: number | null = null
    let repeticao: number | null = null
    let ordem: number | null = null
    let numeroContagem: number | null = null

    if (temEndereco) {
      const meta = metaMap.get(ln.id)
      const camara = ln.camara ?? parsed.camara
      grupo =
        meta?.grupo ??
        (camara != null && parsed.rua ? getGrupoArmazemFromCamaraRua(camara, parsed.rua) : null)
      rua =
        meta?.rua ??
        (parsed.rua || (grupo != null ? getInventarioRuaArmazem(grupo) : null))
      pos = meta?.posicao ?? parsed.posicao ?? null
      nivel = meta?.nivel ?? parsed.nivel ?? null
      repeticao = meta?.repeticao ?? null
      ordem = meta?.ordem ?? null
      numeroContagem = 1
    }

    return {
      id: ln.id,
      data_contagem: sessao.dataContagem,
      data_hora_contagem: ln.createdAt || sessao.dataFim || new Date().toISOString(),
      conferente_id: conferenteId,
      ...(nomeConferente ? { conferentes: { nome: nomeConferente } } : {}),
      codigo_interno: String(ln.codigoInterno ?? '').trim(),
      descricao: String(ln.descricao ?? '').trim(),
      unidade_medida: String(ln.unidade ?? '').trim() || null,
      quantidade_up: ln.quantidade,
      up_adicional: parseUpAdicional(ln.up),
      lote: String(ln.lote ?? '').trim() || null,
      observacao: obsBase,
      data_fabricacao: df || null,
      data_validade: dv || null,
      ean: String(ln.codigoBarras ?? '').trim() || null,
      dun: null,
      inventario_repeticao: repeticao,
      inventario_numero_contagem: numeroContagem,
      finalizacao_sessao_id: sessao.id,
      planilha_grupo_armazem: grupo,
      planilha_ordem_na_aba: ordem,
      planilha_rua: rua && rua !== '—' ? rua : null,
      planilha_posicao: pos,
      planilha_nivel: nivel,
      origem: 'contagem_diaria',
      contagem_rascunho: false,
    }
  })
}

const SELECT_CONTAGEM_EXPORT =
  'id,data_contagem,data_hora_contagem,conferente_id,codigo_interno,descricao,unidade_medida,quantidade_up,up_adicional,lote,observacao,data_fabricacao,data_validade,ean,dun,finalizacao_sessao_id,origem,inventario_repeticao,inventario_numero_contagem,planilha_grupo_armazem,planilha_ordem_na_aba,planilha_rua,planilha_posicao,planilha_nivel,contagem_rascunho'

const SELECT_CONTAGEM_EXPORT_COM_CONFERENTE = `${SELECT_CONTAGEM_EXPORT},conferentes(nome)`

async function buscarLinhasContagemExport(
  run: (select: string) => PromiseLike<{ data: unknown[] | null; error: unknown }>,
): Promise<Record<string, unknown>[]> {
  const comNome = await run(SELECT_CONTAGEM_EXPORT_COM_CONFERENTE)
  if (!comNome.error && comNome.data?.length) {
    return comNome.data as Record<string, unknown>[]
  }
  const basico = await run(SELECT_CONTAGEM_EXPORT)
  if (basico.error) return []
  return (basico.data ?? []) as Record<string, unknown>[]
}

function filtraLinhasContagemDbPorSessao(
  rows: Record<string, unknown>[],
  sessao: ContagemDiariaSessao,
): Record<string, unknown>[] {
  const marcador = `Contagem #${sessao.numero}`
  const titulo = String(sessao.titulo ?? '').trim()
  return rows.filter((r) => {
    if (r.contagem_rascunho === true) return false
    const sid = String(r.finalizacao_sessao_id ?? '').trim()
    if (sid && sid === sessao.id) return true
    const obs = String(r.observacao ?? '')
    if (!obs.includes(marcador)) return false
    if (titulo && !obs.includes(titulo)) return false
    return true
  })
}

/** Busca linhas de contagem diária no banco para exportar uma sessão fechada. */
export async function fetchContagemDbRowsParaSessaoExport(
  sessao: ContagemDiariaSessao,
): Promise<Record<string, unknown>[]> {
  if (!contagemDiariaSyncHabilitado()) return []

  const porSessaoId = await buscarLinhasContagemExport((select) =>
    supabase.from(TABLE_CONTAGEM_DIARIA).select(select).eq('finalizacao_sessao_id', sessao.id),
  )
  if (porSessaoId.length > 0) {
    return filtraLinhasContagemDbPorSessao(porSessaoId, sessao)
  }

  const ymd = String(sessao.dataContagem ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return []

  const porData = await buscarLinhasContagemExport((select) =>
    supabase.from(TABLE_CONTAGEM_DIARIA).select(select).eq('data_contagem', ymd),
  )
  return filtraLinhasContagemDbPorSessao(porData, sessao)
}

export async function syncContagemDiariaSessaoParaContagens(
  sessao: ContagemDiariaSessao,
  opts?: { force?: boolean },
): Promise<{ inserted: number }> {
  if (!contagemDiariaSyncHabilitado()) return { inserted: 0 }
  if (!contagemDiariaSessaoFinalizada(sessao) || sessao.linhas.length === 0) return { inserted: 0 }
  if (!opts?.force && (await sessaoJaSincronizada(sessao.id))) return { inserted: 0 }

  const conferentes = await listConferentes()
  const rows: Record<string, unknown>[] = []
  for (const ln of sessao.linhas) {
    const conferenteId = await ensureConferenteIdParaGravacao(ln.conferenteNome ?? sessao.conferenteNome, conferentes)
    rows.push(linhaToPayload(sessao, ln, conferenteId))
  }
  await deleteContagensDaSessao(sessao.id)
  const inserted = await insertContagemRows(rows)
  return { inserted }
}

export async function ensureContagensDiariaSessaoSincronizadas(opts?: {
  allTime?: boolean
  startYmd?: string
  endYmd?: string
}): Promise<{ sessoes: number; linhas: number }> {
  if (!contagemDiariaSyncHabilitado()) return { sessoes: 0, linhas: 0 }
  const sessoes = (await fetchContagemDiariaSessoesSupabase()).map((s) =>
    mergeContagemDiariaComFontesLocais(s),
  )
  const alvo = sessoes.filter(
    (s) =>
      contagemDiariaSessaoFinalizada(s) && s.linhas.length > 0 && sessaoNoIntervalo(s, opts ?? {}),
  )
  let sessoesSync = 0
  let linhas = 0
  for (const s of alvo) {
    try {
      const { inserted } = await syncContagemDiariaSessaoParaContagens(s)
      if (inserted > 0) {
        sessoesSync++
        linhas += inserted
      }
    } catch (e) {
      if (import.meta.env.DEV) console.warn('[contagemDiariaSync]', s.id, e)
    }
  }
  return { sessoes: sessoesSync, linhas }
}
