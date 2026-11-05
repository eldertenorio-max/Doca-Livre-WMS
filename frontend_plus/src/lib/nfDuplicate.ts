import type { MovimentoRegistro, NotaFiscal, NotaFiscalCancelada } from '../types'
import { nfPrecisaAtualizacao } from './repararNfEstoque'

type NfRef = Pick<NotaFiscal, 'id' | 'chave' | 'numero' | 'serie'>

export function normNumero(numero: string): string {
  return numero.trim().replace(/^0+/, '') || '0'
}

export function findNotaByNumero(notas: NotaFiscal[], numero: string): NotaFiscal | undefined {
  const alvo = normNumero(numero)
  return notas.find((n) => normNumero(n.numero) === alvo)
}

function mesmaNf(a: NfRef, b: NfRef): boolean {
  if (a.id && b.id && a.id === b.id) return true
  if (a.chave && b.chave && a.chave === b.chave) return true
  if (
    normNumero(a.numero) === normNumero(b.numero) &&
    a.serie.trim() === b.serie.trim()
  ) {
    return true
  }
  return false
}

export function findNotaDuplicada(nf: NfRef, notas: NotaFiscal[]): NotaFiscal | undefined {
  return notas.find((n) => mesmaNf(n, nf))
}

export function mensagemNfDuplicada(
  nf: NfRef,
  notas: NotaFiscal[],
  notasCanceladas: NotaFiscalCancelada[] = [],
  movimentos: MovimentoRegistro[] = [],
): string | null {
  const dupNota = notas.find((n) => mesmaNf(n, nf))
  if (dupNota) {
    if (nfPrecisaAtualizacao(dupNota, movimentos)) {
      return (
        `Esta NF já está cadastrada (NF ${dupNota.numero}), mas não aparece no estoque. ` +
        'O sistema vai restaurar ou atualizar automaticamente a partir do XML.'
      )
    }
    return `Esta NF já foi importada (NF ${dupNota.numero}).`
  }

  const dupCancelada = notasCanceladas.find((c) => !c.excluido && mesmaNf(c, nf))
  if (dupCancelada) {
    return `Esta NF já está registrada como cancelada (NF ${dupCancelada.numero}).`
  }

  return null
}

/** Só bloqueia se a cancelada já existir — NF ativa no estoque pode ser vinculada depois. */
export function mensagemNfCanceladaDuplicada(
  nf: NfRef,
  notasCanceladas: NotaFiscalCancelada[],
): string | null {
  const dupCancelada = notasCanceladas.find((c) => !c.excluido && mesmaNf(c, nf))
  if (dupCancelada) {
    return `Esta NF já está registrada como cancelada (NF ${dupCancelada.numero}).`
  }
  return null
}
