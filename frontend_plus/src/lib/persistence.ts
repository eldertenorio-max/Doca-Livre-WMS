import { sanitizarNotasEntrada } from './excluirItemNf'
import {
  contarEnderecosPersistidos,
  aplicarLiberacoesSaidaNosItens,
  limparMovimentosEntradaOrfaos,
  migrarRuasNosDados,
  recuperarEnderecosPerdidos,
  recuperarItensPerdidos,
  sanitizarEnderecosInvalidos,
  sincronizarMovimentosEntrada,
} from './movimentos'
import { syncVinculosNotas } from './nfCanceladas'
import { emitentesFromPersisted } from './emitentesRegistry'
import { dataArmazenagemNf } from './dataArmazenagem'
import type { NotaFiscal, PersistedData } from '../types'

function normalizarStatusNotas(notas: NotaFiscal[]): NotaFiscal[] {
  // Não concluir entradas automaticamente: a conclusão deve ocorrer só por ação
  // explícita (confirmar item / finalizar entrada). Assim, escolher "stage" no
  // destino do item não some com o painel da entrada em andamento.
  return sanitizarNotasEntrada(notas).map((nf) => ({
    ...nf,
    dataArmazenagem: dataArmazenagemNf(nf) ?? new Date().toISOString().slice(0, 10),
  }))
}

export type NormalizePersistedOptions = {
  /** Repara endereços/itens a partir do histórico (só ao carregar da nuvem). */
  reparar?: boolean
}

export function normalizePersistedData(
  data: PersistedData,
  opts?: NormalizePersistedOptions,
): PersistedData {
  const reparar = opts?.reparar !== false
  let base = migrarRuasNosDados(data)
  base = sanitizarEnderecosInvalidos(base)
  base = sincronizarMovimentosEntrada(base)
  base = aplicarLiberacoesSaidaNosItens(base)
  if (reparar) {
    base = recuperarItensPerdidos(base)
    base = recuperarEnderecosPerdidos(base)
  }
  base = limparMovimentosEntradaOrfaos(syncVinculosNotas(base))
  return {
    ...base,
    notas: normalizarStatusNotas(base.notas),
    emitentes: base.emitentes?.length ? base.emitentes : emitentesFromPersisted(base),
  }
}

/** Dados vindos da nuvem — sem mesclar com localStorage do navegador. */
export function prepareLoadedData(remote: PersistedData): PersistedData {
  return normalizePersistedData(remote)
}

export function prepareLoadedDataWithRepair(remote: PersistedData): {
  data: PersistedData
  enderecosRecuperados: number
  enderecosRemovidos: number
  dadosReparados: boolean
} {
  const antesEnd = contarEnderecosPersistidos(remote)
  const antesItens = remote.notas.reduce((s, nf) => s + nf.items.length, 0)
  const data = normalizePersistedData(remote)
  const depoisEnd = contarEnderecosPersistidos(data)
  const depoisItens = data.notas.reduce((s, nf) => s + nf.items.length, 0)
  return {
    data,
    enderecosRecuperados: Math.max(0, depoisEnd - antesEnd),
    enderecosRemovidos: Math.max(0, antesEnd - depoisEnd),
    dadosReparados: depoisEnd !== antesEnd || depoisItens !== antesItens,
  }
}
