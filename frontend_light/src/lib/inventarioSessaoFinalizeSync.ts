import {
  getGrupoArmazemFromCamaraRua,
  getInventarioRuaArmazem,
  planilhaOrdemFromPosNivel,
} from '../components/inventario/inventarioPlanilhaModel'
import { parseEnderecoCodigo } from './enderecamentoStore'
import { listConferentes, resolveConferenteIdPorNome, ensureConferenteIdParaGravacao, type Conferente } from './conferentesStore'
import { planilhaFkContagemColumn, TABLE_CONTAGEM_INVENTARIO } from './contagensDb'
import {
  insertInventarioContagensRows,
  replaceInventarioExistentePorEndereco,
} from './inventarioUpsertOnFinalize'
import { deleteInventarioPlanilhaLinhasForContagensIds } from './inventarioPlanilhaLinhasDelete'
import {
  inventarioDatasReferenciaYmd,
  inventarioSessaoFinalizado,
  sessaoDatasNoPeriodo,
} from './capturaSessaoExportUtils'
import { mergeInventarioComFontesLocais } from './inventarioSessaoLocalMerge'
import {
  fetchInventarioSessaoByIdSupabase,
  fetchInventarioSessoesSupabase,
  inventarioSyncHabilitado,
} from './inventarioSessaoSupabase'
import type { InventarioLinhaCaptura, InventarioSessao } from './inventarioSessaoTypes'
import { supabase } from './supabaseClient'

export function ymdSpFromIso(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)
}

type PlanilhaMeta = {
  grupo: number | null
  ordem: number | null
  repeticao: number
  rua: string | null
  posicao: number
  nivel: number
}

export function buildPlanilhaMetaPorLinhaCaptura(
  linhas: InventarioLinhaCaptura[],
): Map<string, PlanilhaMeta> {
  const porEndereco = new Map<string, InventarioLinhaCaptura[]>()
  for (const ln of linhas) {
    const key = String(ln.endereco ?? '').trim().toUpperCase()
    if (!key) continue
    const arr = porEndereco.get(key) ?? []
    arr.push(ln)
    porEndereco.set(key, arr)
  }

  const out = new Map<string, PlanilhaMeta>()
  for (const items of porEndereco.values()) {
    items.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    items.forEach((ln, idx) => {
      const parsed = parseEnderecoCodigo(ln.endereco)
      const camara = ln.camara ?? parsed.camara
      const rua = parsed.rua
      const pos = parsed.posicao ?? 1
      const nivel = parsed.nivel ?? 1
      const repeticao = (idx % 3) + 1
      const grupo =
        camara != null && rua ? getGrupoArmazemFromCamaraRua(camara, rua) : null
      const ordem =
        grupo != null ? planilhaOrdemFromPosNivel(pos, nivel, repeticao) : null
      out.set(ln.id, { grupo, ordem, repeticao, rua: rua || null, posicao: pos, nivel })
    })
  }
  return out
}

function buildPlanilhaMetaPorLinha(linhas: InventarioLinhaCaptura[]): Map<string, PlanilhaMeta> {
  return buildPlanilhaMetaPorLinhaCaptura(linhas)
}

/** Linhas da captura de inventário no formato usado pelo relatório / Excel. */
export function inventarioCapturaLinhasToRelatorioRows(
  sessao: InventarioSessao,
  conferentes?: Conferente[],
): Array<Record<string, unknown>> {
  const dataContagemYmd = ymdSpFromIso(sessao.dataFim ?? sessao.dataInicio)
  const metaMap = buildPlanilhaMetaPorLinha(sessao.linhas)
  const conf = conferentes ?? []
  return sessao.linhas.map((ln) => {
    const parsed = parseEnderecoCodigo(ln.endereco)
    const meta = metaMap.get(ln.id) ?? {
      grupo: null,
      ordem: null,
      repeticao: 1,
      rua: parsed.rua || null,
      posicao: parsed.posicao ?? 1,
      nivel: parsed.nivel ?? 1,
    }
    const grupo =
      meta.grupo ??
      (parsed.camara != null && parsed.rua
        ? getGrupoArmazemFromCamaraRua(parsed.camara, parsed.rua)
        : null)
    const rua =
      meta.rua ??
      (parsed.rua || (grupo != null ? getInventarioRuaArmazem(grupo) : null))
    const pos = meta.posicao ?? parsed.posicao ?? 1
    const nivel = meta.nivel ?? parsed.nivel ?? 1
    const df = String(ln.fabricacao ?? '').trim()
    const dv = String(ln.validade ?? '').trim()
    const nomeConferente = String(ln.conferenteNome ?? '').trim()
    const conferenteId = resolveConferenteId(ln.conferenteNome, conf)
    return {
      id: ln.id,
      data_contagem: dataContagemYmd,
      data_hora_contagem: ln.createdAt || sessao.dataFim || new Date().toISOString(),
      conferente_id: conferenteId,
      ...(nomeConferente ? { conferentes: { nome: nomeConferente } } : {}),
      codigo_interno: String(ln.codigoInterno ?? '').trim(),
      descricao: String(ln.descricao ?? '').trim(),
      unidade_medida: String(ln.unidade ?? '').trim() || null,
      quantidade_up: ln.quantidade,
      up_adicional: parseUpAdicional(ln.up),
      lote: String(ln.lote ?? '').trim() || null,
      observacao: `Inventário #${sessao.numero}${sessao.titulo ? ` — ${sessao.titulo}` : ''}`,
      data_fabricacao: df || null,
      data_validade: dv || null,
      ean: String(ln.codigoBarras ?? '').trim() || null,
      dun: null,
      inventario_repeticao: meta.repeticao,
      inventario_numero_contagem: 1,
      finalizacao_sessao_id: sessao.id,
      planilha_grupo_armazem: grupo,
      planilha_ordem_na_aba: meta.ordem,
      planilha_rua: rua && rua !== '—' ? rua : null,
      planilha_posicao: pos,
      planilha_nivel: nivel,
    }
  })
}

const SELECT_INVENTARIO_EXPORT =
  'id,data_contagem,data_hora_contagem,conferente_id,codigo_interno,descricao,unidade_medida,quantidade_up,up_adicional,lote,observacao,data_fabricacao,data_validade,ean,dun,finalizacao_sessao_id,origem,inventario_repeticao,inventario_numero_contagem,planilha_grupo_armazem,planilha_ordem_na_aba,planilha_rua,planilha_posicao,planilha_nivel,contagem_rascunho'

const SELECT_INVENTARIO_EXPORT_COM_CONFERENTE = `${SELECT_INVENTARIO_EXPORT},conferentes(nome)`

async function buscarLinhasInventarioExport(
  build: (select: string) => ReturnType<typeof supabase.from>,
): Promise<Record<string, unknown>[]> {
  const comNome = await build(SELECT_INVENTARIO_EXPORT_COM_CONFERENTE)
  if (!comNome.error && comNome.data?.length) {
    return comNome.data as Record<string, unknown>[]
  }
  const basico = await build(SELECT_INVENTARIO_EXPORT)
  if (basico.error) return []
  return (basico.data ?? []) as Record<string, unknown>[]
}

function filtraLinhasInventarioDbPorSessao(
  rows: Record<string, unknown>[],
  sessao: InventarioSessao,
): Record<string, unknown>[] {
  const marcador = `Inventário #${sessao.numero}`
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

/** Busca linhas de inventário no banco para exportar uma sessão fechada. */
export async function fetchInventarioDbRowsParaSessaoExport(
  sessao: InventarioSessao,
): Promise<Record<string, unknown>[]> {
  if (!inventarioSyncHabilitado()) return []

  const porSessaoId = await buscarLinhasInventarioExport((select) =>
    supabase.from(TABLE_CONTAGEM_INVENTARIO).select(select).eq('finalizacao_sessao_id', sessao.id),
  )
  if (porSessaoId.length > 0) {
    return filtraLinhasInventarioDbPorSessao(porSessaoId, sessao)
  }

  const ymd = ymdSpFromIso(sessao.dataFim ?? sessao.dataInicio)
  if (!ymd) return []

  const porData = await buscarLinhasInventarioExport((select) =>
    supabase.from(TABLE_CONTAGEM_INVENTARIO).select(select).eq('data_contagem', ymd),
  )
  return filtraLinhasInventarioDbPorSessao(porData, sessao)
}

function inventarioCapturaMatchKey(
  sessaoId: string,
  codigo: string,
  quantidade: number,
  lote: string | null | undefined,
): string {
  return `${sessaoId}|${String(codigo).trim().toLowerCase()}|${quantidade}|${String(lote ?? '').trim()}`
}

/** Completa Câmara/Rua/POS/Nível a partir das linhas da captura quando o banco não tem planilha. */
export async function enrichInventarioRowsFromSessaoCaptura<
  T extends {
    finalizacao_sessao_id?: string | null
    codigo_interno: string
    quantidade_up: number
    lote?: string | null
    planilha_grupo_armazem?: number | null
    planilha_rua?: string | null
    planilha_posicao?: number | null
    planilha_nivel?: number | null
    planilha_ordem_na_aba?: number | null
  },
>(rows: T[]): Promise<T[]> {
  const precisa = rows.some((r) => {
    const sid = String(r.finalizacao_sessao_id ?? '').trim()
    if (!sid) return false
    const temRua = r.planilha_rua != null && String(r.planilha_rua).trim() !== ''
    const temGrupo = r.planilha_grupo_armazem != null && Number.isFinite(Number(r.planilha_grupo_armazem))
    return !temRua || !temGrupo
  })
  if (!precisa) return rows

  const sessaoIds = [
    ...new Set(rows.map((r) => String(r.finalizacao_sessao_id ?? '').trim()).filter(Boolean)),
  ]
  const capturaByKey = new Map<string, Record<string, unknown>>()
  for (const sid of sessaoIds) {
    const s = await fetchInventarioSessaoByIdSupabase(sid)
    if (!s?.linhas.length) continue
    for (const cap of inventarioCapturaLinhasToRelatorioRows(s)) {
      capturaByKey.set(
        inventarioCapturaMatchKey(
          sid,
          String(cap.codigo_interno ?? ''),
          Number(cap.quantidade_up ?? 0),
          cap.lote as string | null,
        ),
        cap,
      )
    }
  }

  return rows.map((r) => {
    const sid = String(r.finalizacao_sessao_id ?? '').trim()
    if (!sid) return r
    const cap = capturaByKey.get(
      inventarioCapturaMatchKey(sid, r.codigo_interno, r.quantidade_up, r.lote),
    )
    if (!cap) return r
    return {
      ...r,
      planilha_grupo_armazem:
        r.planilha_grupo_armazem ?? (cap.planilha_grupo_armazem as number | null) ?? null,
      planilha_rua:
        r.planilha_rua != null && String(r.planilha_rua).trim() !== ''
          ? r.planilha_rua
          : (cap.planilha_rua as string | null) ?? null,
      planilha_posicao: r.planilha_posicao ?? (cap.planilha_posicao as number | null) ?? null,
      planilha_nivel: r.planilha_nivel ?? (cap.planilha_nivel as number | null) ?? null,
      planilha_ordem_na_aba:
        r.planilha_ordem_na_aba ?? (cap.planilha_ordem_na_aba as number | null) ?? null,
    }
  })
}

function resolveConferenteId(nome: string | undefined, conferentes: Conferente[]): string | null {
  return resolveConferenteIdPorNome(nome, conferentes)
}

function parseUpAdicional(raw: string | undefined): number | null {
  const s = String(raw ?? '').trim()
  if (!s) return null
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : null
}

function linhaToPayload(
  sessao: InventarioSessao,
  linha: InventarioLinhaCaptura,
  dataContagemYmd: string,
  meta: PlanilhaMeta,
  conferenteId: string,
): Record<string, unknown> {
  const df = String(linha.fabricacao ?? '').trim()
  const dv = String(linha.validade ?? '').trim()
  const obsBase = `Inventário #${sessao.numero}${sessao.titulo ? ` — ${sessao.titulo}` : ''}`
  return {
    data_contagem: dataContagemYmd,
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
    inventario_repeticao: meta.repeticao,
    inventario_numero_contagem: 1,
    contagem_rascunho: false,
    finalizacao_sessao_id: sessao.id,
    planilha_grupo_armazem: meta.grupo,
    planilha_ordem_na_aba: meta.ordem,
  }
}

async function deleteContagensDaSessao(sessaoId: string): Promise<void> {
  const { error } = await supabase
    .from(TABLE_CONTAGEM_INVENTARIO)
    .delete()
    .eq('finalizacao_sessao_id', sessaoId)
  if (error) {
    const msg = String(error.message ?? '').toLowerCase()
    if (msg.includes('finalizacao_sessao_id') && msg.includes('does not exist')) return
    throw error
  }
}

async function sessaoJaSincronizada(sessaoId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from(TABLE_CONTAGEM_INVENTARIO)
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
  sessao: InventarioSessao,
  opts: { allTime?: boolean; startYmd?: string; endYmd?: string },
): boolean {
  return sessaoDatasNoPeriodo(inventarioDatasReferenciaYmd(sessao), {
    allTime: Boolean(opts.allTime),
    startDate: opts.startYmd ?? '0000-01-01',
    endDate: opts.endYmd ?? '9999-12-31',
    useSingleDay: false,
    singleDay: '',
  })
}

/** Grava linhas de um inventário fechado em `contagens_inventario`. */
export async function syncInventarioSessaoParaContagens(
  sessao: InventarioSessao,
  opts?: { force?: boolean },
): Promise<{ inserted: number }> {
  if (!inventarioSyncHabilitado()) return { inserted: 0 }
  if (!inventarioSessaoFinalizado(sessao) || sessao.linhas.length === 0) return { inserted: 0 }

  if (!opts?.force && (await sessaoJaSincronizada(sessao.id))) {
    return { inserted: 0 }
  }

  const dataContagemYmd = ymdSpFromIso(sessao.dataFim ?? sessao.dataInicio)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataContagemYmd)) {
    throw new Error('Data de fechamento do inventário inválida para exportação.')
  }

  const conferentes = await listConferentes()
  const metaMap = buildPlanilhaMetaPorLinha(sessao.linhas)
  const rows: Record<string, unknown>[] = []
  for (const ln of sessao.linhas) {
    const meta = metaMap.get(ln.id) ?? {
      grupo: null,
      ordem: null,
      repeticao: 1,
      rua: null,
      posicao: 1,
      nivel: 1,
    }
    const conferenteId = await ensureConferenteIdParaGravacao(ln.conferenteNome, conferentes)
    rows.push(linhaToPayload(sessao, ln, dataContagemYmd, meta, conferenteId))
  }

  await deleteContagensDaSessao(sessao.id)
  await replaceInventarioExistentePorEndereco(dataContagemYmd, rows)
  const { ids } = await insertInventarioContagensRows(rows)
  await insertPlanilhaLinhasInventarioSessao(
    dataContagemYmd,
    sessao,
    sessao.linhas,
    metaMap,
    rows,
    ids,
  )
  return { inserted: ids.length }
}

async function insertPlanilhaLinhasInventarioSessao(
  dataContagemYmd: string,
  sessao: InventarioSessao,
  linhas: InventarioLinhaCaptura[],
  metaMap: Map<string, PlanilhaMeta>,
  rows: Record<string, unknown>[],
  contagensIds: string[],
): Promise<void> {
  if (contagensIds.length !== linhas.length) return
  const fkCol = planilhaFkContagemColumn(true)
  const planilhaRows: Record<string, unknown>[] = []
  for (let i = 0; i < linhas.length; i++) {
    const ln = linhas[i]!
    const meta = metaMap.get(ln.id)
    if (!meta?.grupo) continue
    const conferenteId = String(rows[i]?.conferente_id ?? '').trim()
    if (!conferenteId) continue
    planilhaRows.push({
      conferente_id: conferenteId,
      data_inventario: dataContagemYmd,
      grupo_armazem: meta.grupo,
      rua: meta.rua,
      posicao: meta.posicao,
      nivel: meta.nivel,
      numero_contagem: 1,
      codigo_interno: String(ln.codigoInterno ?? '').trim(),
      descricao: String(ln.descricao ?? '').trim(),
      inventario_repeticao: meta.repeticao,
      quantidade: ln.quantidade,
      data_fabricacao: String(ln.fabricacao ?? '').trim() || null,
      data_validade: String(ln.validade ?? '').trim() || null,
      lote: String(ln.lote ?? '').trim() || null,
      up_quantidade: parseUpAdicional(ln.up),
      observacao: `Inventário #${sessao.numero}${sessao.titulo ? ` — ${sessao.titulo}` : ''}`,
      [fkCol]: contagensIds[i],
    })
  }
  if (!planilhaRows.length) return
  await deleteInventarioPlanilhaLinhasForContagensIds(supabase, contagensIds)
  const CHUNK = 250
  for (let i = 0; i < planilhaRows.length; i += CHUNK) {
    const { error } = await supabase
      .from('inventario_planilha_linhas')
      .insert(planilhaRows.slice(i, i + CHUNK))
    if (error) {
      const msg = String(error.message ?? '').toLowerCase()
      if (msg.includes('inventario_planilha_linhas') && msg.includes('does not exist')) return
      throw error
    }
  }
}

export type EnsureInventariosSyncResult = {
  sessoes: number
  linhas: number
}

/** Sincroniza inventários fechados (captura) que ainda não estão em `contagens_inventario`. */
export async function ensureInventariosSessaoSincronizados(opts?: {
  allTime?: boolean
  startYmd?: string
  endYmd?: string
}): Promise<EnsureInventariosSyncResult> {
  if (!inventarioSyncHabilitado()) return { sessoes: 0, linhas: 0 }

  const sessoes = (await fetchInventarioSessoesSupabase()).map((s) => mergeInventarioComFontesLocais(s))
  const alvo = sessoes.filter(
    (s) =>
      inventarioSessaoFinalizado(s) && s.linhas.length > 0 && sessaoNoIntervalo(s, opts ?? {}),
  )

  let sessoesSync = 0
  let linhas = 0
  for (const s of alvo) {
    try {
      const { inserted } = await syncInventarioSessaoParaContagens(s)
      if (inserted > 0) {
        sessoesSync++
        linhas += inserted
      }
    } catch (e) {
      if (import.meta.env.DEV) console.warn('[inventarioSync]', s.id, e)
    }
  }
  return { sessoes: sessoesSync, linhas }
}
