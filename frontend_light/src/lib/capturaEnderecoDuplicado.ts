import { normalizeEnderecoCodigo } from './enderecamentoStore'
import { inventarioCamaraLabelFromGrupo } from '../components/inventario/inventarioPlanilhaModel'

type LinhaComEndereco = { id: string; endereco?: string | null }

export type LinhaEnderecoRelatorio = {
  id?: string
  planilha_grupo_armazem?: number | null
  planilha_rua?: string | null
  planilha_posicao?: number | null
  planilha_nivel?: number | null
  observacao?: string | null
}

/** Chave normalizada para comparar câmara + rua + posição + nível. */
export function chaveEnderecoCaptura(endereco: string | null | undefined): string {
  return normalizeEnderecoCodigo(String(endereco ?? '')).toUpperCase()
}

/** Endereços que aparecem em mais de uma linha da sessão. */
export function enderecosDuplicadosNasLinhas(linhas: LinhaComEndereco[]): Set<string> {
  const contagem = new Map<string, number>()
  for (const ln of linhas) {
    const key = chaveEnderecoCaptura(ln.endereco)
    if (!key) continue
    contagem.set(key, (contagem.get(key) ?? 0) + 1)
  }
  const out = new Set<string>()
  for (const [key, n] of contagem) {
    if (n > 1) out.add(key)
  }
  return out
}

export function linhasComMesmoEndereco(
  linhas: LinhaComEndereco[],
  endereco: string,
  excludeId?: string | null,
): LinhaComEndereco[] {
  const key = chaveEnderecoCaptura(endereco)
  if (!key) return []
  return linhas.filter((ln) => {
    if (excludeId && ln.id === excludeId) return false
    return chaveEnderecoCaptura(ln.endereco) === key
  })
}

export function confirmarSalvarEnderecoRepetido(endereco: string, qtdExistente: number): boolean {
  const end = endereco.trim() || '—'
  return window.confirm(
    `O endereço ${end} já foi usado ${qtdExistente} vez(es) nesta sessão.\n\nDeseja acrescentar outra linha neste mesmo endereço?\n\nOK = sim, acrescentar assim mesmo\nCancelar = voltar e informar outro endereço`,
  )
}

export function classeLinhaCapturaEndereco(opts: {
  editando: boolean
  endereco: string | null | undefined
  enderecosRepetidos: Set<string>
}): string | undefined {
  const parts: string[] = []
  if (opts.editando) parts.push('inv-cap__linha--editando')
  const key = chaveEnderecoCaptura(opts.endereco)
  if (key && opts.enderecosRepetidos.has(key)) parts.push('inv-cap__linha--endereco-repetido')
  return parts.length ? parts.join(' ') : undefined
}

/** Chave de endereço para linhas do relatório (planilha ou endereço na observação). */
export function chaveEnderecoRelatorioRow(r: LinhaEnderecoRelatorio): string {
  const rua = String(r.planilha_rua ?? '').trim()
  const pos = r.planilha_posicao
  const nivel = r.planilha_nivel
  if (
    rua &&
    pos != null &&
    Number.isFinite(Number(pos)) &&
    nivel != null &&
    Number.isFinite(Number(nivel))
  ) {
    const camLabel =
      r.planilha_grupo_armazem != null ? inventarioCamaraLabelFromGrupo(r.planilha_grupo_armazem) : '—'
    const cam = camLabel !== '—' ? camLabel : ''
    const codigo = cam
      ? `${cam}-${rua}-${Math.round(Number(pos))}-${Math.round(Number(nivel))}`
      : `${rua}-${Math.round(Number(pos))}-${Math.round(Number(nivel))}`
    return chaveEnderecoCaptura(codigo)
  }
  const obs = String(r.observacao ?? '')
  const sep = obs.lastIndexOf(' · ')
  if (sep >= 0) {
    const end = obs.slice(sep + 3).trim()
    const key = chaveEnderecoCaptura(end)
    if (key) return key
  }
  return ''
}

export function enderecosDuplicadosRelatorio(rows: LinhaEnderecoRelatorio[]): Set<string> {
  const contagem = new Map<string, number>()
  for (const r of rows) {
    const key = chaveEnderecoRelatorioRow(r)
    if (!key) continue
    contagem.set(key, (contagem.get(key) ?? 0) + 1)
  }
  const out = new Set<string>()
  for (const [key, n] of contagem) {
    if (n > 1) out.add(key)
  }
  return out
}

export function linhaRelatorioEnderecoRepetido(
  r: LinhaEnderecoRelatorio,
  duplicados: Set<string>,
): boolean {
  const key = chaveEnderecoRelatorioRow(r)
  return Boolean(key && duplicados.has(key))
}
