import { supabase } from './supabaseClient'
import { TABLE_CONTAGEM_DIARIA } from './contagensDb'
import { fetchContagensPaged } from './contagensSelectCompat'

/** Considera “ativo” quem deu sinal nos últimos 3 minutos. */
export const PRESENCA_STALE_MS = 3 * 60 * 1000

/** Enquanto a sessão de checklist estiver aberta, enviar presença a cada ~45s. */
export const PRESENCA_PING_INTERVAL_MS = 45 * 1000

/** Atualizar a lista visível para todos a cada ~30s. */
export const PRESENCA_POLL_INTERVAL_MS = 30 * 1000

export function isPresencaAtiva(iso: string, now = Date.now()): boolean {
  const t = new Date(iso).getTime()
  return Number.isFinite(t) && now - t <= PRESENCA_STALE_MS
}

export function formatPresencaRelativo(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const sec = Math.floor((Date.now() - t) / 1000)
  if (sec < 45) return 'agora'
  if (sec < 3600) return `há ${Math.max(1, Math.floor(sec / 60))} min`
  return formatHorarioUltimaGravacao(iso)
}

/** Horário civil da última gravação (ex.: `às 14:35` ou `15/06 às 14:35`). */
export function formatHorarioUltimaGravacao(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const d = new Date(t)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (sameDay) return `às ${hora}`
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} às ${hora}`
}

export type PresencaRow = {
  conferente_id: string
  atualizado_em: string
  linhas_com_qtd?: number | null
  linhas_total?: number | null
  camara?: number | null
  rua?: string | null
}

export type PresencaProgresso = {
  linhasComQtd: number
  linhasTotal: number
  /** Inventário planilha: câmara da aba ativa no heartbeat. */
  camara?: number | null
  /** Inventário planilha: rua selecionada no heartbeat. */
  rua?: string | null
}

function isMissingColumnError(e: unknown, columnSqlName: string): boolean {
  const o = e && typeof e === 'object' ? (e as Record<string, unknown>) : null
  const code = o && 'code' in o ? String(o.code) : ''
  const msg = [
    o && 'message' in o ? String(o.message) : '',
    o && 'details' in o ? String(o.details) : '',
    String(e),
  ]
    .join(' ')
    .toLowerCase()
  const col = columnSqlName.toLowerCase()
  return (
    code === '42703' ||
    (msg.includes('does not exist') && msg.includes(col)) ||
    (msg.includes('could not find') && msg.includes(col)) ||
    (msg.includes('schema cache') && msg.includes(col))
  )
}

/**
 * Envia/renova presença no dia civil da contagem (mesma tabela para todos os usuários).
 * Opcionalmente envia progresso (linhas com quantidade / total) para outros verem o andamento.
 * Falha silenciosa se a tabela ainda não existir no Supabase.
 */
export async function upsertContagemDiariaPresenca(
  conferenteId: string,
  dataContagemYmd: string,
  progresso?: PresencaProgresso,
): Promise<void> {
  const cid = String(conferenteId ?? '').trim()
  const ymd = String(dataContagemYmd ?? '').trim()
  if (!cid || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return
  const base = {
    conferente_id: cid,
    data_contagem: ymd,
    atualizado_em: new Date().toISOString(),
  }
  const podeProgresso =
    progresso != null &&
    Number.isFinite(progresso.linhasTotal) &&
    progresso.linhasTotal >= 0 &&
    Number.isFinite(progresso.linhasComQtd) &&
    progresso.linhasComQtd >= 0
  const camaraVal =
    progresso?.camara != null && Number.isFinite(Number(progresso.camara))
      ? Math.floor(Number(progresso.camara))
      : null
  const ruaVal = progresso?.rua != null ? String(progresso.rua).trim().toUpperCase().slice(0, 8) : ''
  const payloadBase =
    podeProgresso && progresso
      ? {
          ...base,
          linhas_com_qtd: Math.min(Math.floor(progresso.linhasComQtd), Math.floor(progresso.linhasTotal)),
          linhas_total: Math.floor(progresso.linhasTotal),
        }
      : base
  const payload =
    camaraVal != null || ruaVal
      ? {
          ...payloadBase,
          ...(camaraVal != null ? { camara: camaraVal } : {}),
          ...(ruaVal ? { rua: ruaVal } : {}),
        }
      : payloadBase

  try {
    let { error } = await supabase.from('contagem_diaria_presenca').upsert(payload, { onConflict: 'conferente_id,data_contagem' })
    if (
      error &&
      (isMissingColumnError(error, 'linhas_com_qtd') ||
        isMissingColumnError(error, 'linhas_total') ||
        isMissingColumnError(error, 'camara') ||
        isMissingColumnError(error, 'rua'))
    ) {
      const r2 = await supabase.from('contagem_diaria_presenca').upsert(base, { onConflict: 'conferente_id,data_contagem' })
      error = r2.error
    }
    if (error && import.meta.env.DEV) console.warn('[contagem_diaria_presenca] upsert', error)
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[contagem_diaria_presenca] upsert', e)
  }
}

/** Linhas brutas do dia (inclui inativos); filtre com `isPresencaAtiva`. */
export async function fetchContagemDiariaPresencaDia(dataContagemYmd: string): Promise<PresencaRow[]> {
  const ymd = String(dataContagemYmd ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return []
  try {
    let data: unknown[] | null = null
    let res = await supabase
      .from('contagem_diaria_presenca')
      .select('conferente_id,atualizado_em,linhas_com_qtd,linhas_total,camara,rua')
      .eq('data_contagem', ymd)
    if (
      res.error &&
      (isMissingColumnError(res.error, 'linhas_com_qtd') ||
        isMissingColumnError(res.error, 'linhas_total') ||
        isMissingColumnError(res.error, 'camara') ||
        isMissingColumnError(res.error, 'rua'))
    ) {
      res = await supabase
        .from('contagem_diaria_presenca')
        .select('conferente_id,atualizado_em,linhas_com_qtd,linhas_total')
        .eq('data_contagem', ymd)
      if (
        res.error &&
        (isMissingColumnError(res.error, 'linhas_com_qtd') || isMissingColumnError(res.error, 'linhas_total'))
      ) {
        res = await supabase
          .from('contagem_diaria_presenca')
          .select('conferente_id,atualizado_em')
          .eq('data_contagem', ymd)
      }
    }
    const { error } = res
    data = res.data as unknown[] | null
    if (error) {
      if (import.meta.env.DEV) console.warn('[contagem_diaria_presenca] select', error)
      return []
    }
    const out: PresencaRow[] = []
    for (const r of data ?? []) {
      const rec = r as {
        conferente_id?: string
        atualizado_em?: string
        linhas_com_qtd?: number | null
        linhas_total?: number | null
        camara?: number | null
        rua?: string | null
      }
      const id = rec.conferente_id != null ? String(rec.conferente_id).trim() : ''
      const em = rec.atualizado_em != null ? String(rec.atualizado_em) : ''
      if (id && em) {
        out.push({
          conferente_id: id,
          atualizado_em: em,
          linhas_com_qtd: rec.linhas_com_qtd != null ? Number(rec.linhas_com_qtd) : null,
          linhas_total: rec.linhas_total != null ? Number(rec.linhas_total) : null,
          camara: rec.camara != null && Number.isFinite(Number(rec.camara)) ? Number(rec.camara) : null,
          rua: rec.rua != null ? String(rec.rua).trim() : null,
        })
      }
    }
    return out
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[contagem_diaria_presenca] select', e)
    return []
  }
}

/** Contagem diária no relatório: exclui linhas claramente de inventário. */
export function isContagemDiariaRowResumo(r: Record<string, unknown>): boolean {
  const o = r.origem != null ? String(r.origem) : ''
  if (o === 'inventario') return false
  if (o === '') {
    const rep = r.inventario_repeticao != null && String(r.inventario_repeticao).trim() !== ''
    const nc = r.inventario_numero_contagem != null && String(r.inventario_numero_contagem).trim() !== ''
    if (rep || nc) return false
  }
  return true
}

export type ResumoFinalizadoDia = {
  conferente_id: string
  linhas_gravadas: number
  ultima_data_hora: string | null
}

const CONTAGENS_FETCH_CHUNK = 1000

/**
 * Usa a view de painel quando existir no banco (mesma fonte do SQL operacional).
 * Retorna `null` quando a view/colunas não estiverem disponíveis para manter fallback compatível.
 */
async function fetchResumoFinalizadosFromPainelView(dataContagemYmd: string): Promise<Map<string, { count: number; ultima: string | null }> | null> {
  const map = new Map<string, { count: number; ultima: string | null }>()
  const ymd = String(dataContagemYmd ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return map
  try {
    const { data, error } = await supabase
      .from('v_contagem_diaria_painel')
      .select('conferente_id,itens_contados,inicio,fim,data_contagem')
      .eq('data_contagem', ymd)
    if (error) return null
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const id = String(r.conferente_id ?? '').trim()
      if (!id) return null
      const rawCount = Number(r.itens_contados ?? 0)
      const count = Number.isFinite(rawCount) && rawCount >= 0 ? Math.floor(rawCount) : 0
      const fim = String(r.fim ?? '').trim()
      const inicio = String(r.inicio ?? '').trim()
      const ultima = fim || inicio || null
      map.set(id, { count, ultima })
    }
    return map
  } catch {
    return null
  }
}

/**
 * Fallback para ambientes em que o resumo agregado não está coerente/disponível:
 * agrega por conferente diretamente da view de itens do painel.
 */
async function fetchResumoFinalizadosFromItensPainelView(
  dataContagemYmd: string,
): Promise<Map<string, { count: number; ultima: string | null }> | null> {
  const map = new Map<string, { count: number; ultima: string | null }>()
  const ymd = String(dataContagemYmd ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return map
  try {
    const { data, error } = await supabase
      .from('v_contagem_diaria_itens_painel')
      .select('conferente_nome,data_contagem,data_hora_contagem')
      .eq('data_contagem', ymd)
    if (error) return null

    // Resolve nome -> id para manter compatibilidade com o restante da UI.
    const nomes = [
      ...new Set(
        ((data ?? []) as Record<string, unknown>[])
          .map((r) => String(r.conferente_nome ?? '').trim())
          .filter((n) => n !== ''),
      ),
    ]
    const nomeParaId = new Map<string, string>()
    if (nomes.length > 0) {
      const { data: confRows, error: confErr } = await supabase.from('conferentes').select('id,nome').in('nome', nomes)
      if (confErr) return null
      for (const row of confRows ?? []) {
        const id = String((row as { id?: unknown }).id ?? '').trim()
        const nome = String((row as { nome?: unknown }).nome ?? '').trim()
        if (id && nome) nomeParaId.set(nome.toLowerCase(), id)
      }
    }

    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const nome = String(r.conferente_nome ?? '').trim()
      if (!nome) continue
      const id = nomeParaId.get(nome.toLowerCase())
      if (!id) continue
      const dhRaw = String(r.data_hora_contagem ?? '').trim()
      const dh = dhRaw !== '' ? dhRaw : null
      const prev = map.get(id)
      const count = (prev?.count ?? 0) + 1
      let ultima = prev?.ultima ?? null
      if (dh) {
        const t = new Date(dh).getTime()
        if (Number.isFinite(t) && (!ultima || t > new Date(ultima).getTime())) {
          ultima = dh
        }
      }
      map.set(id, { count, ultima })
    }

    return map
  } catch {
    return null
  }
}

/**
 * Agrega linhas já gravadas em `contagens_estoque` no dia (contagem diária), por conferente.
 * Usado para preencher o painel junto com quem está com checklist aberta.
 */
export async function fetchResumoFinalizadosContagemDiariaDia(dataContagemYmd: string): Promise<Map<string, { count: number; ultima: string | null }>> {
  const map = new Map<string, { count: number; ultima: string | null }>()
  const ymd = String(dataContagemYmd ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return map
  const fromView = await fetchResumoFinalizadosFromPainelView(ymd)
  if (fromView) return fromView
  const fromItensView = await fetchResumoFinalizadosFromItensPainelView(ymd)
  if (fromItensView) return fromItensView

  const PRESENCA_DIARIA_COLUMNS = [
    'conferente_id',
    'data_hora_contagem',
    'origem',
    'inventario_repeticao',
    'inventario_numero_contagem',
    'contagem_rascunho',
  ] as const

  const { data: rows, error } = await fetchContagensPaged({
    table: TABLE_CONTAGEM_DIARIA,
    columns: PRESENCA_DIARIA_COLUMNS,
    eq: { data_contagem: ymd },
    order: { column: 'id', ascending: true },
    pageSize: CONTAGENS_FETCH_CHUNK,
  })
  if (error || !rows) return map

  const hasOrigemMeta = rows.length > 0 && 'origem' in (rows[0] as object)
  const hasRascunhoCol = rows.length > 0 && 'contagem_rascunho' in (rows[0] as object)
  for (const r of rows) {
    if (hasRascunhoCol && r.contagem_rascunho === true) continue
    if (hasOrigemMeta && !isContagemDiariaRowResumo(r)) continue
    const id = r.conferente_id != null ? String(r.conferente_id).trim() : ''
    if (!id) continue
    const dhRaw = r.data_hora_contagem != null ? String(r.data_hora_contagem) : ''
    const dh = dhRaw.trim() !== '' ? dhRaw : null
    const prev = map.get(id)
    const nextCount = (prev?.count ?? 0) + 1
    let ultima = prev?.ultima ?? null
    if (dh) {
      const t = new Date(dh).getTime()
      if (Number.isFinite(t)) {
        if (!ultima || t > new Date(ultima).getTime()) ultima = dh
      }
    }
    map.set(id, { count: nextCount, ultima })
  }
  return map
}
