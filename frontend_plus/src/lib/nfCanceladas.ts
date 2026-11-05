import type { MovimentoRegistro, NotaFiscal, NotaFiscalCancelada, PersistedData } from '../types'
import { buildNfResumo } from './nfResumo'
import { pesoBrutoTotalItem, pesoLiquidoTotalItem } from './saidaParcial'

function normNumero(numero: string): string {
  return numero.trim().replace(/^0+/, '') || '0'
}

export function notaFiscalToCancelada(nf: NotaFiscal): NotaFiscalCancelada {
  const resumo = buildNfResumo(nf)
  return {
    id: nf.id,
    numero: nf.numero,
    serie: nf.serie,
    chave: nf.chave,
    emitente: nf.emitente,
    dataEmissao: nf.dataEmissao,
    ...(resumo.pesoBruto != null ? { pesoBruto: resumo.pesoBruto } : {}),
    ...(resumo.pesoLiquido != null ? { pesoLiquido: resumo.pesoLiquido } : {}),
    ...(resumo.valorTotalNota != null ? { valorTotal: resumo.valorTotalNota } : {}),
    items: nf.items.map((it) => {
      const pesoBruto = pesoBrutoTotalItem(nf, it) ?? it.pesoBruto
      const pesoLiquido = pesoLiquidoTotalItem(nf, it)
      return {
        index: it.index,
        codigo: it.codigo,
        descricao: it.descricao,
        quantidade: it.quantidade,
        unidade: it.unidade,
        ...(pesoBruto != null ? { pesoBruto } : {}),
        ...(pesoLiquido != null ? { pesoLiquido } : {}),
        ...(it.valorUnitario != null ? { valorUnitario: it.valorUnitario } : {}),
        ...(it.valorTotal != null ? { valorTotal: it.valorTotal } : {}),
      }
    }),
    vinculoNfNovaId: null,
    vinculoNfNovaNumero: null,
    createdAt: new Date().toISOString(),
  }
}

/** Enriquece cancelada antiga com dados da NF em estoque ou do movimento de entrada. */
export function dadosCanceladaParaHistorico(
  cancelada: NotaFiscalCancelada,
  notas: NotaFiscal[],
  movimentos: MovimentoRegistro[],
): NotaFiscalCancelada {
  const nf =
    (cancelada.chave
      ? notas.find((n) => n.chave && n.chave === cancelada.chave)
      : undefined) ??
    notas.find((n) => normNumero(n.numero) === normNumero(cancelada.numero))

  const mov = movimentos.find(
    (m) =>
      m.tipo === 'entrada' &&
      !m.excluido &&
      (m.nfId === cancelada.id || normNumero(m.nfNumero) === normNumero(cancelada.numero)),
  )

  let base = cancelada

  if (nf && nf.items.length > 0) {
    const fromNf = notaFiscalToCancelada(nf)
    base = {
      ...fromNf,
      id: cancelada.id,
      createdAt: cancelada.createdAt,
      vinculoNfNovaId: cancelada.vinculoNfNovaId,
      vinculoNfNovaNumero: cancelada.vinculoNfNovaNumero,
      excluido: cancelada.excluido,
      excluidoEm: cancelada.excluidoEm,
    }
  } else if (mov && mov.itens.length > 0 && cancelada.items.length === 0) {
    base = {
      ...cancelada,
      pesoBruto: cancelada.pesoBruto ?? mov.pesoBruto,
      pesoLiquido: cancelada.pesoLiquido ?? mov.pesoLiquido,
      valorTotal: cancelada.valorTotal ?? mov.valorTotal,
      items: mov.itens.map((it) => ({
        index: it.itemIndex,
        codigo: it.codigo,
        descricao: it.descricao,
        quantidade: it.quantidade,
        unidade: it.unidade,
        ...(it.pesoBruto != null ? { pesoBruto: it.pesoBruto } : {}),
        ...(it.pesoLiquido != null ? { pesoLiquido: it.pesoLiquido } : {}),
        ...(it.valorUnitario != null ? { valorUnitario: it.valorUnitario } : {}),
        ...(it.valorTotal != null ? { valorTotal: it.valorTotal } : {}),
      })),
    }
  }

  if (base.items.length === 0 || (base.pesoBruto == null && mov?.itens.length)) {
    if (mov && mov.itens.length > 0) {
      const items =
        base.items.length > 0
          ? base.items.map((it) => {
              const snap = mov.itens.find((s) => s.itemIndex === it.index)
              if (!snap) return it
              return {
                ...it,
                ...(it.pesoBruto == null && snap.pesoBruto != null
                  ? { pesoBruto: snap.pesoBruto }
                  : {}),
                ...(it.pesoLiquido == null && snap.pesoLiquido != null
                  ? { pesoLiquido: snap.pesoLiquido }
                  : {}),
                ...(it.valorUnitario == null && snap.valorUnitario != null
                  ? { valorUnitario: snap.valorUnitario }
                  : {}),
                ...(it.valorTotal == null && snap.valorTotal != null
                  ? { valorTotal: snap.valorTotal }
                  : {}),
              }
            })
          : mov.itens.map((it) => ({
              index: it.itemIndex,
              codigo: it.codigo,
              descricao: it.descricao,
              quantidade: it.quantidade,
              unidade: it.unidade,
              ...(it.pesoBruto != null ? { pesoBruto: it.pesoBruto } : {}),
              ...(it.pesoLiquido != null ? { pesoLiquido: it.pesoLiquido } : {}),
              ...(it.valorUnitario != null ? { valorUnitario: it.valorUnitario } : {}),
              ...(it.valorTotal != null ? { valorTotal: it.valorTotal } : {}),
            }))

      return {
        ...base,
        pesoBruto: base.pesoBruto ?? mov.pesoBruto,
        pesoLiquido: base.pesoLiquido ?? mov.pesoLiquido,
        valorTotal: base.valorTotal ?? mov.valorTotal,
        items,
      }
    }
  }

  return base
}

/** Sincroniza campos de vínculo nas notas ativas a partir das canceladas. */
export function syncVinculosNotas(data: PersistedData): PersistedData {
  const byNovaId = new Map(
    data.notasCanceladas
      .filter((c) => c.vinculoNfNovaId && !c.excluido)
      .map((c) => [c.vinculoNfNovaId!, c]),
  )

  const notas = data.notas.map((n) => {
    const cancelada = byNovaId.get(n.id)
    if (!cancelada) {
      return { ...n, nfCanceladaOrigemId: null, nfCanceladaOrigemNumero: null }
    }
    return {
      ...n,
      nfCanceladaOrigemId: cancelada.id,
      nfCanceladaOrigemNumero: cancelada.numero,
    }
  })

  return { ...data, notas }
}

export function vincularNotaCancelada(
  data: PersistedData,
  canceladaId: string,
  novaNfId: string,
): PersistedData {
  const nova = data.notas.find((n) => n.id === novaNfId)
  if (!nova) return data

  const notasCanceladas = data.notasCanceladas.map((c) => {
    if (c.id === canceladaId) {
      return {
        ...c,
        vinculoNfNovaId: nova.id,
        vinculoNfNovaNumero: nova.numero,
      }
    }
    if (c.vinculoNfNovaId === novaNfId) {
      return { ...c, vinculoNfNovaId: null, vinculoNfNovaNumero: null }
    }
    return c
  })

  return syncVinculosNotas({ ...data, notasCanceladas })
}

export function desvincularNotaCancelada(data: PersistedData, canceladaId: string): PersistedData {
  const notasCanceladas = data.notasCanceladas.map((c) =>
    c.id === canceladaId ? { ...c, vinculoNfNovaId: null, vinculoNfNovaNumero: null } : c,
  )
  return syncVinculosNotas({ ...data, notasCanceladas })
}

export function excluirNotaCancelada(data: PersistedData, canceladaId: string): PersistedData {
  const excluidoEm = new Date().toISOString()
  const notasCanceladas = data.notasCanceladas.map((c) =>
    c.id === canceladaId
      ? {
          ...c,
          excluido: true,
          excluidoEm,
          vinculoNfNovaId: null,
          vinculoNfNovaNumero: null,
        }
      : c,
  )
  return syncVinculosNotas({ ...data, notasCanceladas })
}

export function notasDisponiveisParaVinculo(
  notas: PersistedData['notas'],
  canceladas: NotaFiscalCancelada[],
  canceladaId: string,
): PersistedData['notas'] {
  const vinculadas = new Set(
    canceladas
      .filter((c) => c.vinculoNfNovaId && !c.excluido && c.id !== canceladaId)
      .map((c) => c.vinculoNfNovaId!),
  )
  return notas.filter((n) => !vinculadas.has(n.id))
}
