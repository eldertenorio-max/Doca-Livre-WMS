import { itemNoStage } from '../layout/stage'
import { todosItensEnderecados } from './excluirItemNf'
import {
  contarEnderecosPersistidos,
  nfTemEnderecosValidos,
  nfTemHistoricoEnderecos,
  upsertMovimentoEntrada,
} from './movimentos'
import { findNotaDuplicada } from './nfDuplicate'
import { normalizePersistedData } from './persistence'
import type { MovimentoRegistro, NfeItem, NotaFiscal, PersistedData } from '../types'

export function nfSemEnderecosNoMapa(nf: NotaFiscal): boolean {
  return !nfTemEnderecosValidos(nf)
}

export function nfTemEstoqueVisivel(nf: NotaFiscal): boolean {
  return nfTemEnderecosValidos(nf) || nf.items.some((it) => itemNoStage(it))
}

export function nfPrecisaReparoEnderecos(
  nf: NotaFiscal,
  movimentos: MovimentoRegistro[],
): boolean {
  return !nfTemEnderecosValidos(nf) && nfTemHistoricoEnderecos(nf, movimentos)
}

/** NF cadastrada mas sem posição válida no mapa das câmaras. */
export function nfPrecisaAtualizacao(
  nf: NotaFiscal,
  movimentos: MovimentoRegistro[],
): boolean {
  if (nfTemEnderecosValidos(nf)) return false
  if (nf.items.length === 0) return true
  if (nfPrecisaReparoEnderecos(nf, movimentos)) return true
  return true
}

function acharItemCorrespondente(atual: NotaFiscal, xmlItem: NfeItem): NfeItem | undefined {
  return (
    atual.items.find((it) => it.index === xmlItem.index) ??
    atual.items.find(
      (it) =>
        it.codigo.trim() !== '' &&
        xmlItem.codigo.trim() !== '' &&
        it.codigo.trim() === xmlItem.codigo.trim(),
    )
  )
}

function mesclarItemComXml(xmlItem: NfeItem, existente: NfeItem | undefined): NfeItem {
  if (!existente) return { ...xmlItem }

  const enderecos =
    existente.allocatedAddresses.length > 0
      ? [...existente.allocatedAddresses]
      : [...xmlItem.allocatedAddresses]

  const noStage = itemNoStage(existente)
  const noArmazem = enderecos.length > 0

  return {
    ...xmlItem,
    allocatedAddresses: enderecos,
    ...(noArmazem
      ? {
          localizacao: 'armazem' as const,
          paletes: existente.paletes ?? enderecos.length,
        }
      : noStage
        ? {
            localizacao: 'stage' as const,
            paletes: existente.paletes,
          }
        : {}),
    up: xmlItem.up || existente.up,
    lote: xmlItem.lote || existente.lote,
    dataFabricacao: xmlItem.dataFabricacao || existente.dataFabricacao,
    dataValidade: xmlItem.dataValidade || existente.dataValidade,
    pesoBruto: xmlItem.pesoBruto ?? existente.pesoBruto,
    pesoLiquido: xmlItem.pesoLiquido ?? existente.pesoLiquido,
    valorUnitario: xmlItem.valorUnitario ?? existente.valorUnitario,
    valorTotal: xmlItem.valorTotal ?? existente.valorTotal,
  }
}

function resolverStatusAposMescla(atual: NotaFiscal, items: NfeItem[]): NotaFiscal['status'] {
  const candidata = { ...atual, items }
  if (todosItensEnderecados(candidata)) return 'concluida'
  if (atual.status === 'concluida' && items.some((it) => it.allocatedAddresses.length > 0)) {
    return 'concluida'
  }
  if (items.length === 0) return 'em_andamento'
  return 'em_andamento'
}

/** Atualiza NF existente com dados do XML, preservando id e endereços já alocados. */
export function mesclarNfComXml(atual: NotaFiscal, xmlNf: NotaFiscal): NotaFiscal {
  const items = xmlNf.items.map((xmlItem) =>
    mesclarItemComXml(xmlItem, acharItemCorrespondente(atual, xmlItem)),
  )

  return {
    ...xmlNf,
    id: atual.id,
    chave: xmlNf.chave || atual.chave,
    createdAt: atual.createdAt,
    status: resolverStatusAposMescla(atual, items),
    nfCanceladaOrigemId: atual.nfCanceladaOrigemId,
    nfCanceladaOrigemNumero: atual.nfCanceladaOrigemNumero,
    pesoBruto: xmlNf.pesoBruto ?? atual.pesoBruto,
    pesoLiquido: xmlNf.pesoLiquido ?? atual.pesoLiquido,
    valorTotalNota: xmlNf.valorTotalNota ?? atual.valorTotalNota,
    quantidadeVolume: xmlNf.quantidadeVolume ?? atual.quantidadeVolume,
    items,
  }
}

export type ReconciliarNfXmlResult = {
  data: PersistedData
  nota: NotaFiscal
  mensagem: string
  enderecosRecuperados: number
}

/** Reimportação de XML duplicado: restaura histórico e/ou atualiza itens da NF fantasma. */
export function reconciliarNfDuplicadaDoXml(
  data: PersistedData,
  xmlNf: NotaFiscal,
): ReconciliarNfXmlResult | null {
  const dupNota = findNotaDuplicada(xmlNf, data.notas)
  if (!dupNota) return null

  const antes = contarEnderecosPersistidos(data)
  const mesclada = mesclarNfComXml(dupNota, xmlNf)
  const notas = data.notas.map((n) => (n.id === dupNota.id ? mesclada : n))
  const next: PersistedData = normalizePersistedData({
    ...data,
    notas,
    movimentos: upsertMovimentoEntrada(data.movimentos, mesclada),
  })
  const depois = contarEnderecosPersistidos(next)
  const enderecosRecuperados = Math.max(0, depois - antes)
  const nota = next.notas.find((n) => n.id === dupNota.id) ?? mesclada

  let mensagem: string
  if (enderecosRecuperados > 0) {
    mensagem = `NF ${nota.numero}: ${enderecosRecuperados} posição(ões) restaurada(s).`
  } else if (nfTemEnderecosValidos(nota)) {
    mensagem = `NF ${nota.numero}: dados sincronizados com o XML.`
  } else {
    mensagem =
      `NF ${nota.numero}: itens atualizados do XML. ` +
      'Enderece no mapa — os endereços anteriores não estavam no histórico.'
  }

  return { data: next, nota, mensagem, enderecosRecuperados }
}

/** Tenta restaurar endereços/itens a partir do histórico de movimentações. */
export function tentarRepararPersistido(data: PersistedData): {
  data: PersistedData
  reparado: boolean
  enderecosRecuperados: number
} {
  const antes = contarEnderecosPersistidos(data)
  const reparado = normalizePersistedData(data)
  const depois = contarEnderecosPersistidos(reparado)
  return {
    data: reparado,
    reparado:
      depois > antes ||
      reparado.notas.some((nf) => {
        const prev = data.notas.find((n) => n.id === nf.id)
        return prev != null && nf.items.length > prev.items.length
      }),
    enderecosRecuperados: Math.max(0, depois - antes),
  }
}

export function repararNfDuplicadaDoXml(
  data: PersistedData,
  xmlNf: NotaFiscal,
): ReconciliarNfXmlResult | null {
  const dupNota = findNotaDuplicada(xmlNf, data.notas)
  if (!dupNota || !nfPrecisaAtualizacao(dupNota, data.movimentos)) return null

  const historico = tentarRepararPersistido(data)
  const notaAposHistorico =
    historico.data.notas.find((n) => n.id === dupNota.id) ?? dupNota

  if (!nfPrecisaAtualizacao(notaAposHistorico, historico.data.movimentos)) {
    if (!historico.reparado) return null
    return {
      data: historico.data,
      nota: notaAposHistorico,
      mensagem: `NF ${notaAposHistorico.numero}: ${historico.enderecosRecuperados} posição(ões) restaurada(s) do histórico.`,
      enderecosRecuperados: historico.enderecosRecuperados,
    }
  }

  return reconciliarNfDuplicadaDoXml(historico.data, xmlNf)
}
