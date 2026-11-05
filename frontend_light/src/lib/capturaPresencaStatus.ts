import { isPresencaAtiva } from './contagemDiariaPresenca'

export type CapturaPresencaSessaoRow = {
  sessaoId: string
  usuario_nome: string
  atualizado_em: string
}

/** Agrupa nomes ativos (últimos 3 min) por sessão de captura. */
export function groupContadoresAtivosBySessao(rows: CapturaPresencaSessaoRow[]): Map<string, string[]> {
  const porSessao = new Map<string, Set<string>>()
  for (const r of rows) {
    const id = String(r.sessaoId ?? '').trim()
    const nome = String(r.usuario_nome ?? '').trim()
    if (!id || !nome || !isPresencaAtiva(r.atualizado_em)) continue
    const set = porSessao.get(id) ?? new Set<string>()
    set.add(nome)
    porSessao.set(id, set)
  }
  const out = new Map<string, string[]>()
  for (const [id, set] of porSessao) {
    out.set(id, [...set].sort((a, b) => a.localeCompare(b, 'pt-BR')))
  }
  return out
}

export function labelContandoGerenciar(aberto: boolean, nomes?: string[]): { texto: string; title: string } {
  if (!aberto) return { texto: '—', title: '' }
  if (!nomes?.length) {
    return { texto: 'Livre', title: 'Ninguém na tela de contagem agora — pode finalizar' }
  }
  const texto = nomes.join(', ')
  return { texto, title: `${texto} — aguarde saírem para finalizar` }
}
