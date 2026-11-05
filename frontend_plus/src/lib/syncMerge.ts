import { todosItensEnderecados } from './excluirItemNf'
import { contarEnderecosPersistidos } from './movimentos'
import { itemEnderecamentoCompleto } from './paletes'
import type { MovimentoRegistro, NotaFiscal, NfeItem, PersistedData } from '../types'

function entityById<T extends { id: string }>(list: T[], id: string): T | undefined {
  return list.find((x) => x.id === id)
}

function entityJson<T>(entity: T | undefined): string {
  return entity === undefined ? '__missing__' : JSON.stringify(entity)
}

function enderecoCount(nf: NotaFiscal): number {
  return nf.items.reduce((s, it) => s + it.allocatedAddresses.length, 0)
}

/** Endereços e itens completos pesam mais que status concluída sem posições no mapa. */
function nfCompleteness(nf: NotaFiscal): number {
  const addrCount = enderecoCount(nf)
  const completeItems = nf.items.filter(itemEnderecamentoCompleto).length
  const concluidaComEstoque =
    nf.status === 'concluida' && (addrCount > 0 || todosItensEnderecados(nf))
  return (
    addrCount * 10_000 +
    completeItems * 1_000 +
    nf.items.length * 10 +
    (concluidaComEstoque ? 500 : nf.status === 'concluida' ? 50 : 0)
  )
}

function mergeAllocatedAddresses(primary: string[], secondary: string[]): string[] {
  const secondarySet = new Set(secondary)
  // Saída no primary: posições removidas — não restaurar endereços antigos.
  if (primary.length < secondary.length && primary.every((a) => secondarySet.has(a))) {
    return [...primary]
  }
  if (secondary.length > primary.length) return [...secondary]
  if (primary.length > secondary.length) return [...primary]
  return primary.length > 0 ? [...primary] : [...secondary]
}

function preserveOptionalItemFields(item: NfeItem, fallback: NfeItem): NfeItem {
  const allocatedAddresses = mergeAllocatedAddresses(item.allocatedAddresses, fallback.allocatedAddresses)
  return {
    ...item,
    allocatedAddresses,
    pesoBruto: item.pesoBruto ?? fallback.pesoBruto,
    valorUnitario: item.valorUnitario ?? fallback.valorUnitario,
    valorTotal: item.valorTotal ?? fallback.valorTotal,
    up: item.up || fallback.up,
    lote: item.lote || fallback.lote,
    dataFabricacao: item.dataFabricacao || fallback.dataFabricacao,
    dataValidade: item.dataValidade || fallback.dataValidade,
    paletes: item.paletes ?? fallback.paletes,
    localizacao: item.localizacao ?? fallback.localizacao,
  }
}

function mergeNfItems(primary: NotaFiscal, fallback: NotaFiscal): NfeItem[] {
  const primaryByIndex = new Map(primary.items.map((it) => [it.index, it]))
  const fallbackByIndex = new Map(fallback.items.map((it) => [it.index, it]))
  const indexes = new Set([...primaryByIndex.keys(), ...fallbackByIndex.keys()])
  return [...indexes]
    .sort((a, b) => a - b)
    .map((index) => {
      const primary = primaryByIndex.get(index)
      const fb = fallbackByIndex.get(index)
      if (primary && fb) return preserveOptionalItemFields(primary, fb)
      return (primary ?? fb)!
    })
}

function resolveNfStatus(
  nf: NotaFiscal,
  fallback: NotaFiscal,
  items: NfeItem[],
): NotaFiscal['status'] {
  if (fallback.status === 'concluida') return 'concluida'
  const candidate = { ...nf, items }
  if (todosItensEnderecados(candidate)) return 'concluida'
  if (nf.status === 'concluida') return 'concluida'
  return nf.status
}

function resolveDataArmazenagem(
  base: NotaFiscal | undefined,
  local: NotaFiscal | undefined,
  remote: NotaFiscal | undefined,
): string | undefined {
  const baseValue = base?.dataArmazenagem
  const localValue = local?.dataArmazenagem
  const remoteValue = remote?.dataArmazenagem

  if (local && localValue !== baseValue) return localValue
  if (remote && remoteValue !== baseValue) return remoteValue
  return localValue ?? remoteValue ?? baseValue
}

function withDataArmazenagem(nf: NotaFiscal, dataArmazenagem: string | undefined): NotaFiscal {
  return dataArmazenagem == null ? nf : { ...nf, dataArmazenagem }
}

function preserveOptionalNfFields(nf: NotaFiscal, fallback: NotaFiscal): NotaFiscal {
  const items = mergeNfItems(nf, fallback)
  return {
    ...nf,
    status: resolveNfStatus(nf, fallback, items),
    pesoBruto: nf.pesoBruto ?? fallback.pesoBruto,
    pesoLiquido: nf.pesoLiquido ?? fallback.pesoLiquido,
    valorTotalNota: nf.valorTotalNota ?? fallback.valorTotalNota,
    quantidadeVolume: nf.quantidadeVolume ?? fallback.quantidadeVolume,
    dataArmazenagem: nf.dataArmazenagem ?? fallback.dataArmazenagem,
    nfCanceladaOrigemId: nf.nfCanceladaOrigemId ?? fallback.nfCanceladaOrigemId,
    nfCanceladaOrigemNumero: nf.nfCanceladaOrigemNumero ?? fallback.nfCanceladaOrigemNumero,
    items,
  }
}

function pickBestNf(a: NotaFiscal, b: NotaFiscal): NotaFiscal {
  const scoreA = nfCompleteness(a)
  const scoreB = nfCompleteness(b)
  return scoreA >= scoreB ? a : b
}

function mergeSingleNotaFiscal(
  b: NotaFiscal | undefined,
  l: NotaFiscal | undefined,
  r: NotaFiscal | undefined,
): NotaFiscal | undefined {
  const dataArmazenagem = resolveDataArmazenagem(b, l, r)

  if (entityJson(b) !== entityJson(l)) {
    if (l !== undefined) return withDataArmazenagem(l, dataArmazenagem)
    // NF removida localmente (ex.: cancelar entrada) — não reintroduzir da base.
    if (b !== undefined) return undefined
  }

  if (entityJson(b) !== entityJson(r)) {
    if (r === undefined) return l ? withDataArmazenagem(l, dataArmazenagem) : b
    const fallback = l ?? b
    if (!fallback) return withDataArmazenagem(r, dataArmazenagem)
    const fromRemote = preserveOptionalNfFields(r, fallback)
    const fromFallback = preserveOptionalNfFields(fallback, r)
    return withDataArmazenagem(pickBestNf(fromFallback, fromRemote), dataArmazenagem)
  }

  const merged = l ?? b ?? r
  return merged ? withDataArmazenagem(merged, dataArmazenagem) : undefined
}

function mergeNotaFiscal(base: NotaFiscal[], local: NotaFiscal[], remote: NotaFiscal[]): NotaFiscal[] {
  const allIds = new Set([
    ...base.map((x) => x.id),
    ...local.map((x) => x.id),
    ...remote.map((x) => x.id),
  ])
  const result: NotaFiscal[] = []

  for (const id of allIds) {
    const merged = mergeSingleNotaFiscal(entityById(base, id), entityById(local, id), entityById(remote, id))
    if (merged !== undefined) result.push(merged)
  }

  return result
}

function movimentoRichness(m: MovimentoRegistro): number {
  return (
    m.itens.reduce((s, it) => s + it.addressIds.length, 0) * 1_000 +
    m.itens.length * 10 +
    (m.excluido ? 0 : 1)
  )
}

function mergeSingleMovimento(
  b: MovimentoRegistro | undefined,
  l: MovimentoRegistro | undefined,
  r: MovimentoRegistro | undefined,
): MovimentoRegistro | undefined {
  if (entityJson(b) !== entityJson(l)) {
    return l
  }

  if (entityJson(b) !== entityJson(r)) {
    if (r === undefined) return l
    if (l === undefined) return r
    return movimentoRichness(l) >= movimentoRichness(r) ? l : r
  }

  return l
}

function mergeMovimentos(
  base: MovimentoRegistro[],
  local: MovimentoRegistro[],
  remote: MovimentoRegistro[],
): MovimentoRegistro[] {
  const allIds = new Set([
    ...base.map((x) => x.id),
    ...local.map((x) => x.id),
    ...remote.map((x) => x.id),
  ])
  const result: MovimentoRegistro[] = []

  for (const id of allIds) {
    const merged = mergeSingleMovimento(
      entityById(base, id),
      entityById(local, id),
      entityById(remote, id),
    )
    if (merged !== undefined) result.push(merged)
  }

  return result
}

function aplicarEnderecosPreferidos(preferido: NotaFiscal, candidato: NotaFiscal): NotaFiscal {
  const prefByIndex = new Map(preferido.items.map((it) => [it.index, it]))
  return {
    ...candidato,
    items: candidato.items.map((it) => {
      const pref = prefByIndex.get(it.index)
      if (!pref || pref.allocatedAddresses.length >= it.allocatedAddresses.length) return it
      return { ...it, allocatedAddresses: [...pref.allocatedAddresses] }
    }),
  }
}

/** Evita que sync remoto apague endereços ou NFs que ainda existem no estado anterior. */
export function protegerNotasContraRegressao(
  anterior: NotaFiscal[],
  mesclado: NotaFiscal[],
): NotaFiscal[] {
  const porId = new Map(mesclado.map((nf) => [nf.id, nf]))
  const extras: NotaFiscal[] = []

  for (const prev of anterior) {
    const atual = porId.get(prev.id)
    if (!atual) {
      if (
        prev.status === 'concluida' ||
        prev.status === 'em_andamento' ||
        enderecoCount(prev) > 0
      ) {
        extras.push(prev)
      }
      continue
    }
    if (nfCompleteness(prev) > nfCompleteness(atual)) {
      porId.set(prev.id, prev)
      continue
    }
    if (enderecoCount(prev) < enderecoCount(atual)) {
      porId.set(prev.id, aplicarEnderecosPreferidos(prev, atual))
    }
  }

  return [...porId.values(), ...extras.filter((nf) => !porId.has(nf.id))]
}

export function protegerPersistedContraRegressao(
  preferido: PersistedData,
  mesclado: PersistedData,
): PersistedData {
  return {
    ...mesclado,
    notas: protegerNotasContraRegressao(preferido.notas, mesclado.notas),
    movimentos: mergeMovimentos(preferido.movimentos, preferido.movimentos, mesclado.movimentos),
  }
}

export function pickPersisted(state: {
  notas: PersistedData['notas']
  movimentos: PersistedData['movimentos']
  notasCanceladas: PersistedData['notasCanceladas']
  emitentes: PersistedData['emitentes']
}): PersistedData {
  return {
    notas: state.notas,
    movimentos: state.movimentos,
    notasCanceladas: state.notasCanceladas,
    emitentes: state.emitentes,
  }
}

export function persistedEquals(a: PersistedData, b: PersistedData): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Remoto atrasado (ex.: leitura antes do upsert propagar) — não substituir o estado local. */
export function remoteRegressedVersusLocal(local: PersistedData, remote: PersistedData): boolean {
  const remoteNfIds = new Set(remote.notas.map((n) => n.id))
  for (const nf of local.notas) {
    if (!remoteNfIds.has(nf.id)) return true
  }
  const remoteMovIds = new Set(remote.movimentos.map((m) => m.id))
  for (const mov of local.movimentos) {
    if (!remoteMovIds.has(mov.id)) return true
  }
  return contarEnderecosPersistidos(remote) < contarEnderecosPersistidos(local)
}

/** Mescla base → local vs remoto: alterações locais prevalecem; o restante vem da nuvem. */
export function mergeEntityList<T extends { id: string }>(
  base: T[],
  local: T[],
  remote: T[],
): T[] {
  const allIds = new Set([
    ...base.map((x) => x.id),
    ...local.map((x) => x.id),
    ...remote.map((x) => x.id),
  ])
  const result: T[] = []

  for (const id of allIds) {
    const b = entityById(base, id)
    const l = entityById(local, id)
    const r = entityById(remote, id)

    if (entityJson(b) !== entityJson(l)) {
      if (l !== undefined) result.push(l)
      continue
    }

    if (entityJson(b) !== entityJson(r)) {
      if (r !== undefined) {
        result.push(r)
      } else if (entityJson(b) !== entityJson(l)) {
        // Remoto apagou, mas há alteração local — mantém local (recriação).
        if (l !== undefined) result.push(l)
      }
      // Remoto apagou e local = base — descarta (ex.: reset do banco).
      continue
    }

    if (l !== undefined) result.push(l)
  }

  return result
}

function mergeEmitentes(base: string[], local: string[], remote: string[]): string[] {
  const baseSet = new Set(base)
  const localChanged =
    base.length !== local.length || local.some((nome) => !baseSet.has(nome))

  if (localChanged) {
    return [...new Set([...local, ...remote])]
  }

  return [...new Set([...remote, ...base])]
}

export function mergePersistedData(
  base: PersistedData,
  local: PersistedData,
  remote: PersistedData,
): PersistedData {
  return {
    notas: mergeNotaFiscal(base.notas, local.notas, remote.notas),
    movimentos: mergeMovimentos(base.movimentos, local.movimentos, remote.movimentos),
    notasCanceladas: mergeEntityList(base.notasCanceladas, local.notasCanceladas, remote.notasCanceladas),
    emitentes: mergeEmitentes(base.emitentes, local.emitentes, remote.emitentes),
  }
}

/** NFs retiradas do estoque localmente (presentes na base, ausentes no estado atual). */
export function nfIdsRemovidosDesde(base: PersistedData, local: PersistedData): Set<string> {
  const localIds = new Set(local.notas.map((n) => n.id))
  return new Set(base.notas.filter((n) => !localIds.has(n.id)).map((n) => n.id))
}

/**
 * Garante que remoções locais de NF (ex.: aba Movimentação) não sejam revertidas
 * pelo merge com a nuvem nem pela proteção contra regressão.
 */
export function consolidarRemocoesLocais(
  base: PersistedData | null,
  local: PersistedData,
  candidate: PersistedData,
): PersistedData {
  if (!base) return candidate

  const removidas = nfIdsRemovidosDesde(base, local)
  if (removidas.size === 0) return candidate

  /**
   * Rascunho vazio sem sinal de exclusão não significa remoção intencional.
   * Cancelar a única NF deixa local.notas vazio, mas o movimento de entrada fica excluído.
   */
  if (local.notas.length === 0 && base.notas.length > 0) {
    const exclusaoIntencional = [...removidas].some((nfId) =>
      local.movimentos.some((m) => m.tipo === 'entrada' && m.nfId === nfId && m.excluido),
    )
    if (!exclusaoIntencional) return candidate
  }

  const localMovById = new Map(local.movimentos.map((m) => [m.id, m]))
  const movimentos = candidate.movimentos.map((m) => {
    const localMov = localMovById.get(m.id)
    if (localMov?.excluido) return localMov
    if (m.nfId && removidas.has(m.nfId) && m.tipo === 'entrada' && !m.excluido) {
      return {
        ...m,
        excluido: true,
        excluidoEm: m.excluidoEm ?? new Date().toISOString(),
        ...(localMov?.motivoRemocaoEstoque
          ? { motivoRemocaoEstoque: localMov.motivoRemocaoEstoque }
          : {}),
      }
    }
    return m
  })

  for (const m of local.movimentos) {
    if (!movimentos.some((x) => x.id === m.id)) {
      movimentos.push(m)
    }
  }

  return {
    ...candidate,
    notas: candidate.notas.filter((n) => !removidas.has(n.id)),
    movimentos,
  }
}
