import type { NotaFiscal } from '../../types'
import { normalizarCnpj } from './calculo'
import type { ClienteFinanceiro, FinanceiroData } from './types'

function chaveClienteFromNf(nf: NotaFiscal): string | null {
  if (nf.emitenteCnpj) {
    const cnpj = normalizarCnpj(nf.emitenteCnpj)
    if (cnpj.length >= 11) return cnpj
  }
  const nome = nf.emitente.trim()
  if (!nome) return null
  return `nome:${nome.toLowerCase()}`
}

/** Garante que o emitente da NF esteja cadastrado como cliente (sem duplicar CNPJ). */
export function garantirClienteFromNf(
  data: FinanceiroData,
  nf: NotaFiscal,
): FinanceiroData {
  const chave = chaveClienteFromNf(nf)
  if (!chave) return data

  const exists = data.clientes.some((c) => c.cnpj === chave)
  if (exists) return data

  const novo: ClienteFinanceiro = {
    cnpj: chave,
    razaoSocial: nf.emitente.trim(),
    origem: 'auto',
    criadoEm: new Date().toISOString(),
  }

  return {
    ...data,
    clientes: [novo, ...data.clientes],
  }
}

/** Sincroniza clientes a partir de todas as NFs do estoque. */
export function sincronizarClientesFromNotas(
  data: FinanceiroData,
  notas: NotaFiscal[],
): FinanceiroData {
  let next = data
  for (const nf of notas) {
    next = garantirClienteFromNf(next, nf)
  }
  return next
}

export function contratoAtivoCliente(
  data: FinanceiroData,
  cnpj: string,
): import('./types').ContratoCliente | null {
  return data.contratos.find((c) => c.cnpj === cnpj && c.ativo) ?? null
}

export function tabelaById(
  data: FinanceiroData,
  id: string | null,
): import('./types').TabelaCobranca | null {
  if (!id) return null
  return data.tabelas.find((t) => t.id === id) ?? null
}
