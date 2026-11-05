import type { AppState, MovimentoRegistro, NotaFiscal, NotaFiscalCancelada } from '../../types'
import { dataArmazenagemNf, normalizarDataArmazenagemInput } from '../dataArmazenagem'
import { emitenteKey, normalizarEmitente } from '../emitentesRegistry'
import { normalizarQuantidadeItensNf } from '../nfeUnidades'
import { sincronizarPesoBrutoNota } from '../parseNfeXml'
import { limparMovimentosEntradaOrfaos, podeApagarTodasNotasSemEstoque } from '../movimentos'
import { loadUiSession, saveUiSession } from '../uiSession'
import { getSupabase, type CanceladaRow, type EmitenteRow, type EndRow, type ItemRow, type MovRow, type NfRow } from '../supabaseClient'
import type { EnderecamentoRepository } from './types'

/** Preferências de UI na sessão do navegador (sobrevivem ao F5). */
const uiPrefsMemory: Pick<AppState, 'activeNfId' | 'activeItemIndex'> = {
  activeNfId: null,
  activeItemIndex: null,
}

/** Quando o Supabase ainda não tem as colunas comerciais/entrada, salva só o básico. */
let omitNfCommercialFields = false
let omitNfCnpjField = false
let omitNfDataArmazenagemField = false
let omitItemExtendedFields = false
let omitItemLocalizacaoField = false

function missingColumnError(message: string): boolean {
  return message.includes('schema cache') || /Could not find the '[^']+' column/.test(message)
}

function nfUpsertRow(nf: NotaFiscal) {
  const base = {
    id: nf.id,
    numero: nf.numero,
    serie: nf.serie,
    chave: nf.chave,
    emitente: nf.emitente,
    data_emissao: nf.dataEmissao,
    status: nf.status,
  }
  const row = {
    ...base,
    ...(omitNfCnpjField ? {} : { emitente_cnpj: nf.emitenteCnpj ?? null }),
    ...(omitNfDataArmazenagemField
      ? {}
      : {
          data_armazenagem:
            normalizarDataArmazenagemInput(nf.dataArmazenagem ?? '') ??
            dataArmazenagemNf(nf) ??
            null,
        }),
  }
  if (omitNfCommercialFields) return row
  return {
    ...row,
    peso_bruto: nf.pesoBruto ?? null,
    peso_liquido: nf.pesoLiquido ?? null,
    valor_total_nota: nf.valorTotalNota ?? null,
    quantidade_volume: nf.quantidadeVolume ?? null,
  }
}

function itemInsertRow(nfId: string, it: NotaFiscal['items'][number]) {
  const row = {
    nf_id: nfId,
    item_index: it.index,
    codigo: it.codigo,
    descricao: it.descricao,
    quantidade: it.quantidade,
    unidade: it.unidade,
  }
  if (omitItemExtendedFields) return row
  const extended = {
    ...row,
    peso_bruto: it.pesoBruto ?? null,
    valor_unitario: it.valorUnitario ?? null,
    valor_total: it.valorTotal ?? null,
    up: it.up || null,
    lote: it.lote || null,
    data_fabricacao: it.dataFabricacao || null,
    data_validade: it.dataValidade || null,
    paletes: it.paletes ?? null,
  }
  if (omitItemLocalizacaoField) return extended
  return {
    ...extended,
    localizacao: it.localizacao === 'stage' ? 'stage' : 'armazem',
  }
}

async function upsertNf(
  sb: ReturnType<typeof getSupabase>,
  nf: NotaFiscal,
): Promise<{ error: { message: string } | null }> {
  let result = await sb.from('ultrafrio_notas_fiscais').upsert(nfUpsertRow(nf))
  if (result.error && missingColumnError(result.error.message) && !omitNfCnpjField) {
    omitNfCnpjField = true
    result = await sb.from('ultrafrio_notas_fiscais').upsert(nfUpsertRow(nf))
  }
  if (result.error && missingColumnError(result.error.message) && !omitNfDataArmazenagemField) {
    omitNfDataArmazenagemField = true
    result = await sb.from('ultrafrio_notas_fiscais').upsert(nfUpsertRow(nf))
  }
  if (result.error && missingColumnError(result.error.message) && !omitNfCommercialFields) {
    omitNfCommercialFields = true
    result = await sb.from('ultrafrio_notas_fiscais').upsert(nfUpsertRow(nf))
  }
  return result
}

/** Upsert de vários itens de uma NF numa única requisição, com fallback de colunas ausentes. */
async function upsertItensBulk(
  sb: ReturnType<typeof getSupabase>,
  nfId: string,
  items: NotaFiscal['items'],
): Promise<{ error: { message: string } | null }> {
  if (items.length === 0) return { error: null }
  const build = () => items.map((it) => itemInsertRow(nfId, it))
  let result = await sb
    .from('ultrafrio_nf_itens')
    .upsert(build(), { onConflict: 'nf_id,item_index' })
  if (result.error && missingColumnError(result.error.message) && !omitItemExtendedFields) {
    omitItemExtendedFields = true
    result = await sb.from('ultrafrio_nf_itens').upsert(build(), { onConflict: 'nf_id,item_index' })
  }
  if (result.error && missingColumnError(result.error.message) && !omitItemLocalizacaoField) {
    omitItemLocalizacaoField = true
    result = await sb.from('ultrafrio_nf_itens').upsert(build(), { onConflict: 'nf_id,item_index' })
  }
  return result
}

/** Sincroniza itens sem apagar tudo — evita perda se o insert falhar após delete. */
async function syncNfItens(
  sb: ReturnType<typeof getSupabase>,
  nf: NotaFiscal,
  opts?: { permitirLimparTudo?: boolean },
): Promise<void> {
  const { data: existing, error: loadErr } = await sb
    .from('ultrafrio_nf_itens')
    .select('item_index')
    .eq('nf_id', nf.id)
  if (loadErr) throw new Error(loadErr.message)

  if (nf.items.length === 0) {
    if (existing?.length && opts?.permitirLimparTudo) {
      const { error } = await sb.from('ultrafrio_nf_itens').delete().eq('nf_id', nf.id)
      if (error) throw new Error(error.message)
    }
    return
  }

  const keep = new Set(nf.items.map((it) => it.index))
  const toDelete = (existing ?? []).filter((row) => !keep.has(row.item_index))
  if (toDelete.length) {
    const { error } = await sb
      .from('ultrafrio_nf_itens')
      .delete()
      .eq('nf_id', nf.id)
      .in('item_index', toDelete.map((r) => r.item_index))
    if (error) throw new Error(error.message)
  }

  const { error } = await upsertItensBulk(sb, nf.id, nf.items)
  if (error) throw new Error(error.message)
}

/** Sincroniza endereços incrementalmente — não apaga posições se o estado local veio vazio por engano. */
async function syncNfEnderecamentos(
  sb: ReturnType<typeof getSupabase>,
  nf: NotaFiscal,
  opts?: { permitirLimparTudo?: boolean },
): Promise<void> {
  const desired = nf.items.flatMap((it) =>
    it.allocatedAddresses.map((address_id) => ({
      nf_id: nf.id,
      item_index: it.index,
      address_id,
    })),
  )

  const { data: existing, error: loadErr } = await sb
    .from('ultrafrio_enderecamentos')
    .select('item_index, address_id')
    .eq('nf_id', nf.id)
  if (loadErr) throw new Error(loadErr.message)

  const temEnderecosNoEstado = nf.items.some((it) => it.allocatedAddresses.length > 0)
  if (desired.length === 0 && (existing?.length ?? 0) > 0 && !temEnderecosNoEstado) {
    if (!opts?.permitirLimparTudo) return
  }

  const desiredByAddr = new Map(desired.map((d) => [d.address_id, d]))
  const desiredIds = new Set(desired.map((d) => d.address_id))

  const toDeleteIds = (existing ?? [])
    .filter((row) => !desiredIds.has(row.address_id))
    .map((row) => row.address_id)

  if (toDeleteIds.length) {
    const { error } = await sb
      .from('ultrafrio_enderecamentos')
      .delete()
      .eq('nf_id', nf.id)
      .in('address_id', toDeleteIds)
    if (error) throw new Error(error.message)
  }

  const existingIds = new Set((existing ?? []).map((e) => e.address_id))
  const toInsert = desired.filter((d) => !existingIds.has(d.address_id))
  if (toInsert.length) {
    const { error } = await sb.from('ultrafrio_enderecamentos').insert(toInsert)
    if (error) throw new Error(error.message)
  }

  for (const [address_id, d] of desiredByAddr) {
    const ex = (existing ?? []).find((e) => e.address_id === address_id)
    if (ex && ex.item_index !== d.item_index) {
      const { error } = await sb
        .from('ultrafrio_enderecamentos')
        .update({ item_index: d.item_index })
        .eq('nf_id', nf.id)
        .eq('address_id', address_id)
      if (error) throw new Error(error.message)
    }
  }
}

function mapNotas(
  rows: NfRow[],
  itemRows: ItemRow[],
  endRows: EndRow[],
): NotaFiscal[] {
  const endByItem = new Map<string, string[]>()
  for (const e of endRows) {
    const key = `${e.nf_id}:${e.item_index}`
    const list = endByItem.get(key) ?? []
    list.push(e.address_id)
    endByItem.set(key, list)
  }

  const itensByNf = new Map<string, ItemRow[]>()
  for (const it of itemRows) {
    const list = itensByNf.get(it.nf_id) ?? []
    list.push(it)
    itensByNf.set(it.nf_id, list)
  }

  return rows.map((nf) => {
    const dataArm = dataArmazenagemNf({
      dataArmazenagem: nf.data_armazenagem ?? undefined,
      createdAt: nf.created_at,
    })
    return (() => {
    const nota: NotaFiscal = {
    id: nf.id,
    numero: nf.numero,
    serie: nf.serie,
    chave: nf.chave,
    emitente: nf.emitente,
    ...(nf.emitente_cnpj ? { emitenteCnpj: nf.emitente_cnpj } : {}),
    dataEmissao: nf.data_emissao,
    ...(dataArm ? { dataArmazenagem: dataArm } : {}),
    status: nf.status,
    createdAt: nf.created_at,
    ...(nf.peso_bruto != null ? { pesoBruto: Number(nf.peso_bruto) } : {}),
    ...(nf.peso_liquido != null ? { pesoLiquido: Number(nf.peso_liquido) } : {}),
    ...(nf.valor_total_nota != null ? { valorTotalNota: Number(nf.valor_total_nota) } : {}),
    ...(nf.quantidade_volume ? { quantidadeVolume: nf.quantidade_volume } : {}),
    items: normalizarQuantidadeItensNf(
      (itensByNf.get(nf.id) ?? []).map((it) => ({
        index: it.item_index,
        codigo: it.codigo,
        descricao: it.descricao,
        quantidade: Number(it.quantidade),
        unidade: it.unidade,
        allocatedAddresses: endByItem.get(`${nf.id}:${it.item_index}`) ?? [],
        ...(it.peso_bruto != null ? { pesoBruto: Number(it.peso_bruto) } : {}),
        ...(it.valor_unitario != null ? { valorUnitario: Number(it.valor_unitario) } : {}),
        ...(it.valor_total != null ? { valorTotal: Number(it.valor_total) } : {}),
        ...(it.up ? { up: it.up } : {}),
        ...(it.lote ? { lote: it.lote } : {}),
        ...(it.data_fabricacao ? { dataFabricacao: it.data_fabricacao } : {}),
        ...(it.data_validade ? { dataValidade: it.data_validade } : {}),
        ...(it.paletes != null ? { paletes: Number(it.paletes) } : {}),
        ...(it.localizacao === 'stage' ? { localizacao: 'stage' as const } : {}),
      })),
    ),
  }
    sincronizarPesoBrutoNota(nota)
    return nota
    })()
  })
}

function mapMovimentos(rows: MovRow[]): MovimentoRegistro[] {
  return rows.map((m) => ({
    id: m.id,
    tipo: m.tipo,
    nfId: m.nf_id ?? m.payload?.nfIdHistorico ?? '',
    nfNumero: m.nf_numero,
    emitente: m.emitente,
    createdAt: m.created_at,
    itens: m.payload?.itens ?? [],
    ...(m.payload?.justificativaSaida ? { justificativaSaida: m.payload.justificativaSaida } : {}),
    ...(m.payload?.motivoRemocaoEstoque
      ? { motivoRemocaoEstoque: m.payload.motivoRemocaoEstoque }
      : {}),
    ...(m.payload?.nfSaida ? { nfSaida: m.payload.nfSaida } : {}),
    ...(m.payload?.dataSaida ? { dataSaida: m.payload.dataSaida } : {}),
    ...(m.payload?.excluido ? { excluido: true } : {}),
    ...(m.payload?.excluidoEm ? { excluidoEm: m.payload.excluidoEm } : {}),
  }))
}

function movimentoUpsertRow(mov: MovimentoRegistro, notaIds: Set<string>) {
  const nfInDb = notaIds.has(mov.nfId)
  return {
    id: mov.id,
    tipo: mov.tipo,
    nf_id: nfInDb ? mov.nfId : null,
    nf_numero: mov.nfNumero,
    emitente: mov.emitente,
    created_at: mov.createdAt,
    payload: {
      itens: mov.itens,
      ...(nfInDb ? {} : { nfIdHistorico: mov.nfId }),
      ...(mov.justificativaSaida ? { justificativaSaida: mov.justificativaSaida } : {}),
      ...(mov.motivoRemocaoEstoque ? { motivoRemocaoEstoque: mov.motivoRemocaoEstoque } : {}),
      ...(mov.nfSaida ? { nfSaida: mov.nfSaida } : {}),
      ...(mov.dataSaida ? { dataSaida: mov.dataSaida } : {}),
      ...(mov.excluido ? { excluido: true, excluidoEm: mov.excluidoEm ?? null } : {}),
    },
  }
}

async function upsertMovimento(
  sb: ReturnType<typeof getSupabase>,
  mov: MovimentoRegistro,
  notaIds: Set<string>,
): Promise<{ error: { message: string } | null }> {
  const row = movimentoUpsertRow(mov, notaIds)
  let result = await sb.from('ultrafrio_movimentos').upsert(row)
  if (
    result.error &&
    row.nf_id &&
    (result.error.message.includes('foreign key') ||
      result.error.message.includes('nf_id_fkey'))
  ) {
    result = await sb.from('ultrafrio_movimentos').upsert(
      movimentoUpsertRow({ ...mov }, new Set()),
    )
  }
  return result
}

function mapCanceladas(rows: CanceladaRow[]): NotaFiscalCancelada[] {
  return rows.map((c) => ({
    id: c.id,
    numero: c.numero,
    serie: c.serie,
    chave: c.chave,
    emitente: c.emitente,
    dataEmissao: c.data_emissao,
    createdAt: c.created_at,
    vinculoNfNovaId: c.vinculo_nf_nova_id,
    vinculoNfNovaNumero: c.vinculo_nf_nova_numero,
    items: c.payload?.items ?? [],
    ...(c.payload?.excluido ? { excluido: true } : {}),
    ...(c.payload?.excluidoEm ? { excluidoEm: c.payload.excluidoEm } : {}),
  }))
}

async function loadCanceladas(sb: ReturnType<typeof getSupabase>): Promise<NotaFiscalCancelada[]> {
  const { data, error } = await sb
    .from('ultrafrio_notas_canceladas')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) {
    if (error.message.includes('does not exist') || error.code === 'PGRST205') return []
    throw new Error(error.message)
  }
  return mapCanceladas((data ?? []) as CanceladaRow[])
}

async function loadEmitentes(sb: ReturnType<typeof getSupabase>): Promise<string[]> {
  const { data, error } = await sb
    .from('ultrafrio_cadastro_remetentes')
    .select('nome')
    .order('updated_at', { ascending: false })
  if (error) {
    if (error.message.includes('does not exist') || error.code === 'PGRST205') return []
    throw new Error(error.message)
  }
  return ((data ?? []) as Pick<EmitenteRow, 'nome'>[])
    .map((row) => normalizarEmitente(row.nome))
    .filter((nome): nome is string => nome !== null)
}

export const supabaseRepository: EnderecamentoRepository = {
  mode: 'supabase',

  async loadData() {
    const sb = getSupabase()

    const { data: nfs, error: nfErr } = await sb
      .from('ultrafrio_notas_fiscais')
      .select('*')
      .order('created_at', { ascending: false })
    if (nfErr) throw new Error(nfErr.message)

    const rows = (nfs ?? []) as NfRow[]
    const ids = rows.map((n) => n.id)

    let itemRows: ItemRow[] = []
    let endRows: EndRow[] = []
    if (ids.length) {
      const { data: itens, error: itErr } = await sb
        .from('ultrafrio_nf_itens')
        .select('*')
        .in('nf_id', ids)
        .order('item_index')
      if (itErr) throw new Error(itErr.message)
      itemRows = (itens ?? []) as ItemRow[]

      const { data: ends, error: endErr } = await sb
        .from('ultrafrio_enderecamentos')
        .select('*')
        .in('nf_id', ids)
      if (endErr) throw new Error(endErr.message)
      endRows = (ends ?? []) as EndRow[]
    }

    const { data: movs, error: movErr } = await sb
      .from('ultrafrio_movimentos')
      .select('*')
      .order('created_at', { ascending: false })
    if (movErr) throw new Error(movErr.message)

    const notasCanceladas = await loadCanceladas(sb)
    const emitentes = await loadEmitentes(sb)

    return {
      notas: mapNotas(rows, itemRows, endRows),
      movimentos: mapMovimentos((movs ?? []) as MovRow[]),
      notasCanceladas,
      emitentes,
    }
  },

  async saveData({ notas, movimentos, notasCanceladas }, opts) {
    omitNfCommercialFields = false
    omitNfCnpjField = false
    omitNfDataArmazenagemField = false
    omitItemExtendedFields = false
    omitItemLocalizacaoField = false

    const previous = opts?.previous ?? null
    const prevNotaJson = new Map(
      (previous?.notas ?? []).map((n) => [n.id, JSON.stringify(n)]),
    )
    const prevMovJson = new Map(
      (previous?.movimentos ?? []).map((m) => [m.id, JSON.stringify(m)]),
    )
    const prevCanJson = new Map(
      (previous?.notasCanceladas ?? []).map((c) => [c.id, JSON.stringify(c)]),
    )

    const cleaned = limparMovimentosEntradaOrfaos({
      notas,
      movimentos,
      notasCanceladas,
      emitentes: [],
    })
    notas = cleaned.notas
    movimentos = cleaned.movimentos

    const sb = getSupabase()
    const notaIds = new Set(notas.map((n) => n.id))
    const keepIds = notas.map((n) => n.id)

    async function countRows(table: string): Promise<number> {
      const { count, error } = await sb.from(table).select('*', { count: 'exact', head: true })
      if (error) throw new Error(error.message)
      return count ?? 0
    }

    if (keepIds.length === 0) {
      const existingCount = await countRows('ultrafrio_notas_fiscais')
      if (existingCount > 0) {
        const cancelamentoSemEstoque = podeApagarTodasNotasSemEstoque(
          { notas, movimentos, notasCanceladas },
          previous,
        )
        if (!cancelamentoSemEstoque) {
          throw new Error(
            'Bloqueado: tentativa de apagar todo o estoque no Supabase. Recupere pelo backup antes de sincronizar.',
          )
        }
        const { data: existing } = await sb.from('ultrafrio_notas_fiscais').select('id')
        const allIds = ((existing ?? []) as { id: string }[]).map((r) => r.id)
        if (allIds.length) {
          const { error } = await sb.from('ultrafrio_notas_fiscais').delete().in('id', allIds)
          if (error) throw new Error(error.message)
        }
      }
    } else {
      const { data: existing } = await sb.from('ultrafrio_notas_fiscais').select('id')
      const toDelete = ((existing ?? []) as { id: string }[])
        .map((r) => r.id)
        .filter((id) => !keepIds.includes(id))
      if (toDelete.length) {
        const { error } = await sb.from('ultrafrio_notas_fiscais').delete().in('id', toDelete)
        if (error) throw new Error(error.message)
      }
    }

    for (const nf of notas) {
      // Save incremental: pula NFs idênticas ao último snapshot já gravado.
      const permitirLimparTudo = movimentos.some(
        (m) => m.tipo === 'saida' && m.nfId === nf.id && !m.excluido,
      )
      const notaMudou = prevNotaJson.get(nf.id) !== JSON.stringify(nf)
      const saidaNovaOuAlterada = movimentos.some(
        (m) =>
          m.tipo === 'saida' &&
          m.nfId === nf.id &&
          !m.excluido &&
          prevMovJson.get(m.id) !== JSON.stringify(m),
      )
      if (!notaMudou && !saidaNovaOuAlterada) continue

      // Grava saídas novas antes de apagar endereços — evita reparo restaurar posições.
      if (saidaNovaOuAlterada) {
        for (const mov of movimentos) {
          if (mov.tipo !== 'saida' || mov.nfId !== nf.id || mov.excluido) continue
          if (prevMovJson.get(mov.id) === JSON.stringify(mov)) continue
          const { error } = await upsertMovimento(sb, mov, notaIds)
          if (error) throw new Error(error.message)
        }
      }

      const { error: upErr } = await upsertNf(sb, nf)
      if (upErr) throw new Error(upErr.message)

      // Libera posições no banco antes dos itens — evita reload com endereços fantasmas após saída.
      await syncNfEnderecamentos(sb, nf, { permitirLimparTudo })
      await syncNfItens(sb, nf, { permitirLimparTudo })
    }

    const keepMov = movimentos.map((m) => m.id)
    const { data: existingMov } = await sb.from('ultrafrio_movimentos').select('id')
    const toDelMov = ((existingMov ?? []) as { id: string }[])
      .map((r) => r.id)
      .filter((id) => !keepMov.includes(id))
    if (keepMov.length === 0) {
      const movCount = await countRows('ultrafrio_movimentos')
      if (movCount > 0) {
        throw new Error(
          'Bloqueado: tentativa de apagar todo o histórico no Supabase. Recupere pelo backup antes de sincronizar.',
        )
      }
    } else if (toDelMov.length) {
      const { error } = await sb.from('ultrafrio_movimentos').delete().in('id', toDelMov)
      if (error) throw new Error(error.message)
    }

    for (const mov of movimentos) {
      if (prevMovJson.get(mov.id) === JSON.stringify(mov)) continue
      const { error } = await upsertMovimento(sb, mov, notaIds)
      if (error) throw new Error(error.message)
    }

    const keepCan = notasCanceladas.map((c) => c.id)
    const { data: existingCan } = await sb.from('ultrafrio_notas_canceladas').select('id')
    const toDelCan = ((existingCan ?? []) as { id: string }[])
      .map((r) => r.id)
      .filter((id) => !keepCan.includes(id))
    if (toDelCan.length) {
      const { error } = await sb.from('ultrafrio_notas_canceladas').delete().in('id', toDelCan)
      if (error && !error.message.includes('does not exist')) throw new Error(error.message)
    }

    for (const c of notasCanceladas) {
      if (prevCanJson.get(c.id) === JSON.stringify(c)) continue
      const { error } = await sb.from('ultrafrio_notas_canceladas').upsert({
        id: c.id,
        numero: c.numero,
        serie: c.serie,
        chave: c.chave,
        emitente: c.emitente,
        data_emissao: c.dataEmissao,
        created_at: c.createdAt,
        vinculo_nf_nova_id: c.vinculoNfNovaId,
        vinculo_nf_nova_numero: c.vinculoNfNovaNumero,
        payload: {
          items: c.items,
          ...(c.excluido ? { excluido: true, excluidoEm: c.excluidoEm ?? null } : {}),
        },
      })
      if (error && !error.message.includes('does not exist')) throw new Error(error.message)
    }
  },

  async registrarEmitente(nome: string) {
    const n = normalizarEmitente(nome)
    const key = emitenteKey(nome)
    if (!n || !key) return

    const sb = getSupabase()
    const { error } = await sb.from('ultrafrio_cadastro_remetentes').upsert(
      {
        nome_key: key,
        nome: n,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'nome_key' },
    )
    if (error) {
      if (error.message.includes('does not exist') || error.code === 'PGRST205') return
      throw new Error(error.message)
    }
  },

  loadUiPrefs() {
    const session = loadUiSession()
    uiPrefsMemory.activeNfId = session.activeNfId
    uiPrefsMemory.activeItemIndex = session.activeItemIndex
    return { ...uiPrefsMemory }
  },

  saveUiPrefs(prefs) {
    uiPrefsMemory.activeNfId = prefs.activeNfId
    uiPrefsMemory.activeItemIndex = prefs.activeItemIndex
    saveUiSession({
      activeNfId: prefs.activeNfId,
      activeItemIndex: prefs.activeItemIndex,
    })
  },
}
