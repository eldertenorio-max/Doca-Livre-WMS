/** Contexto da sessão ativa (inventário/contagem) para sincronizar produtos com a lista correta. */

export type SessaoProdutoListaContext = {
  tipo: 'inventario' | 'contagem'
  sessaoId: string
  listaProdutosId: string | null
  listaProdutosNome?: string
}

const STORAGE_KEY = 'dis-sessao-produto-lista-v1'

export function setSessaoProdutoListaContext(ctx: SessaoProdutoListaContext): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(ctx))
  } catch {
    /* ignore */
  }
}

export function getSessaoProdutoListaContext(): SessaoProdutoListaContext | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SessaoProdutoListaContext
    if (!parsed?.sessaoId || !parsed?.tipo) return null
    return parsed
  } catch {
    return null
  }
}

export function clearSessaoProdutoListaContext(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export const PRODUTO_LISTA_ATUALIZADA_EVENT = 'dis-produto-lista-atualizada'

export function emitProdutoListaAtualizada(listaIds: string[]): void {
  if (!listaIds.length) return
  window.dispatchEvent(new CustomEvent(PRODUTO_LISTA_ATUALIZADA_EVENT, { detail: { listaIds } }))
}
