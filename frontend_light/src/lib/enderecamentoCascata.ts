import type { EnderecoCadastro } from './enderecamentoStore'
import { listEnderecos, normalizeEnderecoCodigo, parseEnderecoCodigo } from './enderecamentoStore'
import { enderecosAtivosDaLista, type EnderecoLista } from './enderecamentoListaSupabase'
import { posicoesPermitidas, type InventarioSessao } from './inventarioSessaoStore'

export type EnderecoPartesForm = {
  camara: string
  rua: string
  posicao: string
  nivel: string
}

function uniqueSortedNums(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b)
}

function uniqueSortedStr(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

function enderecoSinteticoDoCodigo(codigo: string): EnderecoCadastro | null {
  const normalized = normalizeEnderecoCodigo(codigo)
  if (!normalized) return null
  const p = parseEnderecoCodigo(normalized)
  if (p.camara == null || !p.rua || p.posicao == null || p.nivel == null) return null
  return {
    id: normalized,
    codigo: normalized,
    camara: p.camara,
    rua: p.rua,
    posicao: p.posicao,
    nivel: p.nivel,
    observacao: '',
    ativo: true,
    createdAt: '',
  }
}

/** Endereços disponíveis na captura (lista vinculada + filtro de posições do inventário). */
export function enderecosParaCaptura(
  listaEndereco: EnderecoLista | null,
  sessao: InventarioSessao | null,
): EnderecoCadastro[] {
  const todos = listaEndereco ? enderecosAtivosDaLista(listaEndereco) : listEnderecos()
  const permitidos = sessao ? posicoesPermitidas(sessao) : null
  let filtered = permitidos
    ? todos.filter((e) => permitidos.has(e.codigo.trim().toUpperCase()))
    : todos

  if (filtered.length === 0 && sessao?.posicoesCodigos?.length) {
    filtered = sessao.posicoesCodigos
      .map((cod) => enderecoSinteticoDoCodigo(cod))
      .filter((e): e is EnderecoCadastro => e != null)
  }

  return filtered
}

export function camarasDosEnderecos(enderecos: EnderecoCadastro[]): number[] {
  return uniqueSortedNums(
    enderecos
      .map((e) => e.camara)
      .filter((c): c is number => c != null && Number.isFinite(c)),
  )
}

export function ruasDosEnderecos(enderecos: EnderecoCadastro[], camara: number): string[] {
  if (!Number.isFinite(camara)) return []
  return uniqueSortedStr(
    enderecos
      .filter((e) => e.camara === camara)
      .map((e) => e.rua.trim().toUpperCase())
      .filter(Boolean),
  )
}

export function posicoesDosEnderecos(
  enderecos: EnderecoCadastro[],
  camara: number,
  rua: string,
): number[] {
  const ru = rua.trim().toUpperCase()
  if (!ru || !Number.isFinite(camara)) return []
  return uniqueSortedNums(
    enderecos
      .filter((e) => e.camara === camara && e.rua.trim().toUpperCase() === ru)
      .map((e) => e.posicao)
      .filter((p): p is number => p != null && Number.isFinite(p)),
  )
}

export function niveisDosEnderecos(
  enderecos: EnderecoCadastro[],
  camara: number,
  rua: string,
  posicao: number,
): number[] {
  const ru = rua.trim().toUpperCase()
  if (!ru || !Number.isFinite(camara) || !Number.isFinite(posicao)) return []
  return uniqueSortedNums(
    enderecos
      .filter(
        (e) =>
          e.camara === camara &&
          e.rua.trim().toUpperCase() === ru &&
          e.posicao === posicao,
      )
      .map((e) => e.nivel)
      .filter((n): n is number => n != null && Number.isFinite(n)),
  )
}

export function partesFormDoCodigo(codigo: string): EnderecoPartesForm {
  const p = parseEnderecoCodigo(codigo)
  return {
    camara: p.camara != null ? String(p.camara) : '',
    rua: p.rua,
    posicao: p.posicao != null ? String(p.posicao) : '',
    nivel: p.nivel != null ? String(p.nivel) : '',
  }
}
