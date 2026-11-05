import type {
  AddressId,
  JustificativaSaidaId,
  MotivoRemocaoEstoqueId,
  MovimentoItemSnapshot,
  MovimentoRegistro,
  NfeDocumentoResumo,
  NfeItem,
  NotaFiscal,
  PersistedData,
} from '../types'
import { parseAddressId, remapLegacyAddressId } from '../layout/camaras'
import { itemNoStage } from '../layout/stage'
import { syncVinculosNotas } from './nfCanceladas'
import { buildNfResumo } from './nfResumo'
import { pesoBrutoTotalItem, pesoLiquidoTotalItem } from './saidaParcial'
import type { SaidaItemDraft, SaidaLimitesPorItem, SaidaPaleteDraft } from './saidaParcial'
import { snapshotSaidaItens, snapshotSaidaPaletes } from './saidaParcial'

/** Atualiza IDs de endereço salvos antes da troca de numeração das ruas. */
export function migrarRuasNosDados(data: PersistedData): PersistedData {
  let changed = false

  const notas = data.notas.map((nf) => ({
    ...nf,
    items: nf.items.map((it) => {
      const allocatedAddresses = it.allocatedAddresses.map(remapLegacyAddressId)
      if (allocatedAddresses.some((a, i) => a !== it.allocatedAddresses[i])) changed = true
      return { ...it, allocatedAddresses }
    }),
  }))

  const movimentos = data.movimentos.map((mov) => ({
    ...mov,
    itens: mov.itens.map((it) => {
      const addressIds = it.addressIds.map(remapLegacyAddressId)
      if (addressIds.some((a, i) => a !== it.addressIds[i])) changed = true
      return { ...it, addressIds }
    }),
  }))

  return changed ? { ...data, notas, movimentos } : data
}

export function enderecoValidoNoMapa(addressId: AddressId): boolean {
  return parseAddressId(remapLegacyAddressId(addressId)) != null
}

export function enderecosValidosItem(item: NfeItem): AddressId[] {
  return item.allocatedAddresses
    .map(remapLegacyAddressId)
    .filter((a) => parseAddressId(a) != null)
}

export function nfTemEnderecosValidos(nf: NotaFiscal): boolean {
  return nf.items.some((it) => enderecosValidosItem(it).length > 0)
}

/** Remove IDs de posição inválidos que impedem reparo e exibição nas câmaras. */
export function sanitizarEnderecosInvalidos(data: PersistedData): PersistedData {
  let changed = false
  const notas = data.notas.map((nf) => {
    const items = nf.items.map((it) => {
      const validos = enderecosValidosItem(it)
      if (validos.length === it.allocatedAddresses.length) return it
      changed = true
      if (validos.length > 0) {
        return {
          ...it,
          allocatedAddresses: validos,
          localizacao: 'armazem' as const,
          paletes: it.paletes ?? validos.length,
        }
      }
      if (itemNoStage(it)) return { ...it, allocatedAddresses: [] }
      const { localizacao: _loc, ...rest } = it
      return { ...rest, allocatedAddresses: [] as AddressId[] }
    })
    if (items.every((it, i) => it === nf.items[i])) return nf
    return { ...nf, items }
  })
  return changed ? { ...data, notas } : data
}

export function nfTemEnderecos(nf: NotaFiscal): boolean {
  return nf.items.some((it) => it.allocatedAddresses.length > 0)
}

export function contarEnderecosPersistidos(data: PersistedData): number {
  return data.notas.reduce(
    (s, nf) => s + nf.items.reduce((s2, it) => s2 + it.allocatedAddresses.length, 0),
    0,
  )
}

/** Endereços liberados em saídas registradas — não restaurar no reparo automático. */
export function enderecosLiberadosPorSaidas(
  movimentos: MovimentoRegistro[],
  nfId: string,
  itemIndex: number,
): Set<AddressId> {
  const liberados = new Set<AddressId>()
  for (const m of movimentos) {
    if (m.excluido || m.nfId !== nfId || m.tipo !== 'saida') continue
    const snapsItem = m.itens.filter((it) => it.itemIndex === itemIndex)
    const enderecosSaida = snapsItem.flatMap((it) => it.addressIds ?? [])
    const multiPaleteSaida = enderecosSaida.length > 1
    for (const it of snapsItem) {
      const ids = it.addressIds ?? []
      if (ids.length === 0) continue
      const qtdSaida = it.quantidadeSaida ?? it.quantidade ?? 0
      const liberouPalete = (it.paletes ?? 0) >= 1
      const esgotouItem = (it.quantidadeSobra ?? 0) <= 1e-9 && qtdSaida > 0
      const saiuMultiPalete = multiPaleteSaida && qtdSaida > 0
      if (liberouPalete || esgotouItem || saiuMultiPalete) {
        for (const addr of ids) liberados.add(addr)
      }
    }
  }
  return liberados
}

/** Último snapshot com endereços para um item (entrada ou movimentação posterior). */
export function ultimoSnapshotEnderecosItem(
  movimentos: MovimentoRegistro[],
  nfId: string,
  itemIndex: number,
): AddressId[] {
  const relevant = movimentos
    .filter(
      (m) =>
        !m.excluido &&
        m.nfId === nfId &&
        (m.tipo === 'entrada' || m.tipo === 'movimentacao'),
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  for (const mov of relevant) {
    const snap = mov.itens.find((it) => it.itemIndex === itemIndex && it.addressIds.length > 0)
    if (snap) return [...snap.addressIds]
  }
  return []
}

export function nfTemHistoricoEnderecos(
  nf: NotaFiscal,
  movimentos: MovimentoRegistro[],
): boolean {
  if (nf.items.length === 0) {
    return movimentos.some(
      (m) =>
        !m.excluido &&
        m.nfId === nf.id &&
        (m.tipo === 'entrada' || m.tipo === 'movimentacao') &&
        m.itens.some((it) => it.addressIds.length > 0),
    )
  }
  return nf.items.some((it) => {
    if (itemNoStage(it) || it.allocatedAddresses.length > 0) return false
    return ultimoSnapshotEnderecosItem(movimentos, nf.id, it.index).length > 0
  })
}

function scoreMovimentoItens(mov: MovimentoRegistro): number {
  return mov.itens.reduce((s, it) => s + (it.addressIds?.length ?? 0), 0) * 1000 + mov.itens.length
}

function snapshotParaNfeItem(
  snap: MovimentoItemSnapshot,
  movimentos: MovimentoRegistro[],
  nfId: string,
): NfeItem {
  const enderecosHistorico = ultimoSnapshotEnderecosItem(movimentos, nfId, snap.itemIndex)
  const enderecos =
    enderecosHistorico.length > 0 ? enderecosHistorico : [...(snap.addressIds ?? [])]
  return {
    index: snap.itemIndex,
    codigo: snap.codigo ?? '',
    descricao: snap.descricao ?? '',
    quantidade: snap.quantidade ?? 0,
    unidade: snap.unidade ?? 'UN',
    allocatedAddresses: enderecos,
    ...(enderecos.length > 0 ? { localizacao: 'armazem' as const } : {}),
    ...(snap.paletes != null
      ? { paletes: snap.paletes }
      : enderecos.length > 0
        ? { paletes: enderecos.length }
        : {}),
    ...(snap.up ? { up: snap.up } : {}),
    ...(snap.lote ? { lote: snap.lote } : {}),
    ...(snap.dataFabricacao ? { dataFabricacao: snap.dataFabricacao } : {}),
    ...(snap.dataValidade ? { dataValidade: snap.dataValidade } : {}),
    ...(snap.pesoBruto != null ? { pesoBruto: snap.pesoBruto } : {}),
    ...(snap.valorUnitario != null ? { valorUnitario: snap.valorUnitario } : {}),
    ...(snap.valorTotal != null ? { valorTotal: snap.valorTotal } : {}),
  }
}

/**
 * Reconstrói itens de NF cujo array ficou vazio no banco, usando snapshots do histórico.
 */
export function recuperarItensPerdidos(data: PersistedData): PersistedData {
  let changed = false
  const notas = data.notas.map((nf) => {
    if (nf.items.length > 0) return nf

    const candidatos = data.movimentos.filter(
      (m) =>
        !m.excluido &&
        m.nfId === nf.id &&
        (m.tipo === 'entrada' || m.tipo === 'movimentacao') &&
        m.itens.some((it) => it.codigo || it.descricao || it.addressIds.length > 0),
    )
    if (candidatos.length === 0) return nf

    const mov =
      candidatos.find((m) => m.tipo === 'entrada' && m.itens.length > 0) ??
      [...candidatos].sort((a, b) => scoreMovimentoItens(b) - scoreMovimentoItens(a))[0]

    const items = mov.itens.map((snap) => snapshotParaNfeItem(snap, data.movimentos, nf.id))
    if (items.length === 0) return nf

    changed = true
    return {
      ...nf,
      items,
      status: nf.status === 'em_andamento' ? nf.status : ('concluida' as const),
    }
  })

  return changed ? { ...data, notas } : data
}

/** Remove do estoque posições já liberadas em saídas registradas (corrige DB desatualizado). */
export function aplicarLiberacoesSaidaNosItens(data: PersistedData): PersistedData {
  let changed = false
  const notas = data.notas.map((nf) => {
    const items = nf.items.map((it) => {
      if (itemNoStage(it) || it.allocatedAddresses.length === 0) return it
      const liberados = enderecosLiberadosPorSaidas(data.movimentos, nf.id, it.index)
      if (liberados.size === 0) return it
      const enderecos = it.allocatedAddresses.filter((a) => !liberados.has(a))
      if (enderecos.length === it.allocatedAddresses.length) return it
      changed = true
      return {
        ...it,
        allocatedAddresses: enderecos,
        localizacao: 'armazem' as const,
        ...(it.paletes != null ? { paletes: enderecos.length } : {}),
      }
    })
    if (items.every((it, i) => it === nf.items[i])) return nf
    return { ...nf, items }
  })
  return changed ? { ...data, notas } : data
}

/**
 * Recupera endereços perdidos no estoque usando snapshots do histórico
 * (entrada e movimentações posteriores), quando allocatedAddresses ficou vazio indevidamente.
 */
export function recuperarEnderecosPerdidos(data: PersistedData): PersistedData {
  const ocupacao = new Map<AddressId, string>()
  for (const nf of data.notas) {
    for (const it of nf.items) {
      for (const addr of it.allocatedAddresses) {
        ocupacao.set(addr, nf.id)
      }
    }
  }

  let changed = false
  const notas = data.notas.map((nf) => {
    const items = nf.items.map((it) => {
      if (itemNoStage(it)) return it
      const validos = enderecosValidosItem(it)
      if (validos.length > 0) {
        const liberadosPorSaida = enderecosLiberadosPorSaidas(data.movimentos, nf.id, it.index)
        const enderecos = validos.filter((a) => !liberadosPorSaida.has(a))
        if (
          enderecos.length === it.allocatedAddresses.length &&
          enderecos.every((a, i) => a === it.allocatedAddresses[i])
        ) {
          return it
        }
        changed = true
        return {
          ...it,
          allocatedAddresses: enderecos,
          localizacao: 'armazem' as const,
          paletes: it.paletes ?? enderecos.length,
        }
      }

      const candidatos = ultimoSnapshotEnderecosItem(data.movimentos, nf.id, it.index)
      if (candidatos.length === 0) return it

      const liberadosPorSaida = enderecosLiberadosPorSaidas(data.movimentos, nf.id, it.index)
      const enderecos = candidatos.filter(
        (addr) =>
          enderecoValidoNoMapa(addr) &&
          (!ocupacao.has(addr) || ocupacao.get(addr) === nf.id) &&
          !liberadosPorSaida.has(addr),
      )
      if (enderecos.length === 0) return it

      for (const addr of enderecos) ocupacao.set(addr, nf.id)
      changed = true
      return {
        ...it,
        localizacao: 'armazem' as const,
        allocatedAddresses: enderecos,
        paletes: enderecos.length,
      }
    })

    if (items.every((it, i) => it === nf.items[i])) return nf
    return { ...nf, items }
  })

  return changed ? { ...data, notas } : data
}

export function snapshotItemFromNfe(nf: NotaFiscal, it: NfeItem): MovimentoItemSnapshot {
  const pesoBruto = pesoBrutoTotalItem(nf, it) ?? it.pesoBruto
  const pesoLiquido = pesoLiquidoTotalItem(nf, it)
  return {
    itemIndex: it.index,
    codigo: it.codigo,
    descricao: it.descricao,
    quantidade: it.quantidade,
    unidade: it.unidade,
    addressIds: [...it.allocatedAddresses],
    ...(it.paletes != null
      ? { paletes: it.paletes }
      : it.allocatedAddresses.length > 0
        ? { paletes: it.allocatedAddresses.length }
        : {}),
    ...(it.up ? { up: it.up } : {}),
    ...(it.lote ? { lote: it.lote } : {}),
    ...(it.dataFabricacao ? { dataFabricacao: it.dataFabricacao } : {}),
    ...(it.dataValidade ? { dataValidade: it.dataValidade } : {}),
    ...(pesoBruto != null ? { pesoBruto } : {}),
    ...(pesoLiquido != null ? { pesoLiquido } : {}),
    ...(it.valorUnitario != null ? { valorUnitario: it.valorUnitario } : {}),
    ...(it.valorTotal != null ? { valorTotal: it.valorTotal } : {}),
  }
}

export function totaisDocumentoMovimento(nf: NotaFiscal): Pick<
  MovimentoRegistro,
  'pesoBruto' | 'pesoLiquido' | 'valorTotal'
> {
  const resumo = buildNfResumo(nf)
  return {
    ...(resumo.pesoBruto != null ? { pesoBruto: resumo.pesoBruto } : {}),
    ...(resumo.pesoLiquido != null ? { pesoLiquido: resumo.pesoLiquido } : {}),
    ...(resumo.valorTotalNota != null ? { valorTotal: resumo.valorTotalNota } : {}),
  }
}

function movimentoEntradaDesatualizado(mov: MovimentoRegistro, nf: NotaFiscal): boolean {
  if (mov.itens.length === 0 && nf.items.length > 0) return true
  const atual = snapshotItensNf(nf)
  if (atual.length > mov.itens.length) return true
  const endMov = mov.itens.reduce((s, it) => s + it.addressIds.length, 0)
  const endAtual = atual.reduce((s, it) => s + it.addressIds.length, 0)
  return endAtual > endMov
}

export function snapshotItensNfPorEnderecos(
  nf: NotaFiscal,
  addressIds: AddressId[],
): MovimentoItemSnapshot[] {
  const pick = new Set(addressIds)
  const snapshots: MovimentoItemSnapshot[] = []
  for (const it of nf.items) {
    const ids = it.allocatedAddresses.filter((a) => pick.has(a))
    if (ids.length === 0) continue
    snapshots.push({
      ...snapshotItemFromNfe(nf, it),
      addressIds: ids,
      paletes: ids.length,
    })
  }
  return snapshots
}

export function snapshotItensNf(nf: NotaFiscal, itemIndexes?: number[]): MovimentoItemSnapshot[] {
  const items = itemIndexes
    ? nf.items.filter((it) => itemIndexes.includes(it.index))
    : nf.items
  return items.map((it) => snapshotItemFromNfe(nf, it))
}

export function criarMovimentoEntrada(nf: NotaFiscal): MovimentoRegistro {
  return {
    id: `mov-entrada-${nf.id}-${Date.now()}`,
    tipo: 'entrada',
    nfId: nf.id,
    nfNumero: nf.numero,
    emitente: nf.emitente,
    createdAt: nf.createdAt || new Date().toISOString(),
    ...totaisDocumentoMovimento(nf),
    itens: snapshotItensNf(nf),
  }
}

export function atualizarMovimentoEntrada(mov: MovimentoRegistro, nf: NotaFiscal): MovimentoRegistro {
  return {
    ...mov,
    nfNumero: nf.numero,
    emitente: nf.emitente,
    ...totaisDocumentoMovimento(nf),
    itens: snapshotItensNf(nf),
  }
}

export function enderecosAlterados(
  antes: Set<AddressId> | AddressId[],
  depois: AddressId[],
): boolean {
  const origem = antes instanceof Set ? antes : new Set(antes)
  if (origem.size !== depois.length) return true
  return depois.some((id) => !origem.has(id))
}

export function criarMovimentoMovimentacao(
  nf: NotaFiscal,
  itemIndex: number,
  addressIds: AddressId[],
): MovimentoRegistro {
  const item = nf.items.find((it) => it.index === itemIndex)
  if (!item) {
    throw new Error('Item não encontrado para registrar movimentação.')
  }
  const snap = {
    ...snapshotItemFromNfe(nf, item),
    addressIds: [...addressIds],
    paletes: addressIds.length,
  }
  return {
    id: `mov-mov-${nf.id}-${itemIndex}-${Date.now()}`,
    tipo: 'movimentacao',
    nfId: nf.id,
    nfNumero: nf.numero,
    emitente: nf.emitente,
    createdAt: new Date().toISOString(),
    itens: [snap],
  }
}

export function findMovimentoEntradaAtivo(
  movimentos: MovimentoRegistro[],
  nfId: string,
): MovimentoRegistro | undefined {
  return movimentos.find((m) => m.tipo === 'entrada' && m.nfId === nfId && !m.excluido)
}

export function removerMovimentoEntradaAtivo(
  movimentos: MovimentoRegistro[],
  nfId: string,
): MovimentoRegistro[] {
  return movimentos.filter((m) => !(m.tipo === 'entrada' && m.nfId === nfId && !m.excluido))
}

/** Remove entradas ativas cujo nfId não existe mais no estoque (evita FK no Supabase). */
export function limparMovimentosEntradaOrfaos(data: PersistedData): PersistedData {
  const notaIds = new Set(data.notas.map((n) => n.id))
  let changed = false
  const movimentos = data.movimentos.filter((m) => {
    if (m.tipo !== 'entrada' || m.excluido) return true
    if (notaIds.has(m.nfId)) return true
    changed = true
    return false
  })
  return changed ? { ...data, movimentos } : data
}

/**
 * Cancelou entrada(s) sem endereços — pode remover todas as NFs do Supabase
 * sem confundir com wipe acidental de estoque endereçado.
 */
export function podeApagarTodasNotasSemEstoque(
  data: Pick<PersistedData, 'notas' | 'movimentos' | 'notasCanceladas'>,
  previous: Pick<PersistedData, 'notas'> | null,
): boolean {
  if (data.notas.length > 0) return false
  if (contarEnderecosPersistidos({ ...data, emitentes: [] }) > 0) return false
  if (!previous || previous.notas.length === 0) return false
  const haviaEnderecos = previous.notas.some((nf) =>
    nf.items.some((it) => it.allocatedAddresses.length > 0),
  )
  return !haviaEnderecos
}

/** Data efetiva da saída (informada pelo usuário ou data do registro). */
export function dataEfetivaMovimentoSaida(mov: MovimentoRegistro): string {
  return mov.dataSaida ?? mov.createdAt
}

export function upsertMovimentoEntrada(
  movimentos: MovimentoRegistro[],
  nf: NotaFiscal,
): MovimentoRegistro[] {
  const existing = movimentos.find((m) => m.tipo === 'entrada' && m.nfId === nf.id && !m.excluido)
  if (existing) {
    const updated = atualizarMovimentoEntrada(existing, nf)
    return movimentos.map((m) => (m.id === existing.id ? updated : m))
  }
  return [criarMovimentoEntrada(nf), ...movimentos]
}

/** Cria registros de entrada faltantes (ex.: NFs importadas antes do histórico). */
export function sincronizarMovimentosEntrada(data: PersistedData): PersistedData {
  let movimentos = data.movimentos
  let changed = false

  for (const nf of data.notas) {
    const existing = movimentos.find((m) => m.tipo === 'entrada' && m.nfId === nf.id && !m.excluido)
    if (!existing) {
      movimentos = upsertMovimentoEntrada(movimentos, nf)
      changed = true
      continue
    }
    if (nf.status === 'em_andamento') {
      const updated = atualizarMovimentoEntrada(existing, nf)
      if (JSON.stringify(updated.itens) !== JSON.stringify(existing.itens)) {
        movimentos = movimentos.map((m) => (m.id === existing.id ? updated : m))
        changed = true
      }
      continue
    }
    if (movimentoEntradaDesatualizado(existing, nf)) {
      const updated = atualizarMovimentoEntrada(existing, nf)
      movimentos = movimentos.map((m) => (m.id === existing.id ? updated : m))
      changed = true
    }
  }

  return changed ? { ...data, movimentos } : data
}

export function criarMovimentoSaida(
  nf: NotaFiscal,
  addressIds: AddressId[],
  justificativaSaida: JustificativaSaidaId,
  saidas?: SaidaItemDraft[],
  paletes?: SaidaPaleteDraft[],
  options?: {
    nfSaida?: NfeDocumentoResumo
    limitesPorItem?: SaidaLimitesPorItem
    dataSaida?: string
  },
): MovimentoRegistro {
  return {
    id: `mov-saida-${nf.id}-${Date.now()}`,
    tipo: 'saida',
    nfId: nf.id,
    nfNumero: nf.numero,
    emitente: nf.emitente,
    createdAt: new Date().toISOString(),
    justificativaSaida,
    ...(options?.dataSaida ? { dataSaida: options.dataSaida } : {}),
    ...(options?.nfSaida ? { nfSaida: options.nfSaida } : {}),
    itens:
      paletes && paletes.length > 0
        ? snapshotSaidaPaletes(nf, paletes, options?.limitesPorItem)
        : saidas && saidas.length > 0
          ? snapshotSaidaItens(nf, saidas, addressIds)
          : snapshotItensNfPorEnderecos(nf, addressIds),
  }
}

export function aplicarSaidaEnderecos(nf: NotaFiscal, addressIds: AddressId[]): NotaFiscal {
  const pick = new Set(addressIds)
  return {
    ...nf,
    items: nf.items.map((it) => ({
      ...it,
      allocatedAddresses: it.allocatedAddresses.filter((a) => !pick.has(a)),
    })),
  }
}

/** Remove todos os endereços dos itens indicados (saída total por item). */
export function aplicarSaidaItens(nf: NotaFiscal, itemIndexes: number[]): NotaFiscal {
  const pick = new Set(itemIndexes)
  return {
    ...nf,
    items: nf.items.map((it) =>
      pick.has(it.index) ? { ...it, allocatedAddresses: [] } : it,
    ),
  }
}

export function enderecosDaNf(nf: NotaFiscal): AddressId[] {
  return nf.items.flatMap((it) => it.allocatedAddresses)
}

export function enderecosDosItens(nf: NotaFiscal, itemIndexes: number[]): AddressId[] {
  const pick = new Set(itemIndexes)
  return nf.items.filter((it) => pick.has(it.index)).flatMap((it) => it.allocatedAddresses)
}

export function marcarMovimentoExcluidoHistorico(
  data: PersistedData,
  movId: string,
): PersistedData {
  const mov = data.movimentos.find((m) => m.id === movId)
  if (!mov || mov.excluido) return data

  const excluidoEm = new Date().toISOString()
  return {
    ...data,
    movimentos: data.movimentos.map((m) =>
      m.id === movId ? { ...m, excluido: true, excluidoEm } : m,
    ),
  }
}

/** Remove a NF do estoque e registra no histórico com motivo opcional. */
export function removerNfDoEstoque(
  data: PersistedData,
  nfId: string,
  options?: { motivoRemocaoEstoque?: MotivoRemocaoEstoqueId },
): PersistedData {
  const nf = data.notas.find((n) => n.id === nfId)
  const notas = data.notas.filter((n) => n.id !== nfId)
  const excluidoEm = new Date().toISOString()
  const motivo = options?.motivoRemocaoEstoque

  let movimentos = data.movimentos
  const entradaAtiva = movimentos.find(
    (m) => m.tipo === 'entrada' && m.nfId === nfId && !m.excluido,
  )

  if (entradaAtiva) {
    movimentos = movimentos.map((m) =>
      m.id === entradaAtiva.id
        ? {
            ...m,
            excluido: true,
            excluidoEm,
            ...(motivo ? { motivoRemocaoEstoque: motivo } : {}),
          }
        : m,
    )
  } else if (nf) {
    movimentos = [
      {
        ...criarMovimentoEntrada(nf),
        excluido: true,
        excluidoEm,
        ...(motivo ? { motivoRemocaoEstoque: motivo } : {}),
      },
      ...movimentos,
    ]
  }

  const notasCanceladas = data.notasCanceladas.map((c) =>
    c.vinculoNfNovaId === nfId
      ? { ...c, vinculoNfNovaId: null, vinculoNfNovaNumero: null }
      : c,
  )
  return syncVinculosNotas({ ...data, notas, movimentos, notasCanceladas })
}

/** Remove apenas o registro do histórico/movimentação — não altera o estoque. */
export function excluirMovimento(data: PersistedData, movId: string): PersistedData {
  return marcarMovimentoExcluidoHistorico(data, movId)
}

export function buscarNfPorNumero(notas: NotaFiscal[], numero: string): NotaFiscal | null {
  const q = numero.trim()
  if (!q) return null
  const found = notas.filter((n) => n.numero === q || n.numero.replace(/^0+/, '') === q.replace(/^0+/, ''))
  return found.find((n) => nfTemEnderecos(n)) ?? found[0] ?? null
}
