import { listConferentes } from './conferentesStore'
import { listEnderecoListas } from './enderecamentoListaSupabase'
import { listInventarios } from './inventarioSessaoStore'
import {
  loadProductOptionsCache,
  saveConferentesCache,
  saveEnderecoListCache,
  saveProductListCache,
  saveProductOptionsCache,
  type CachedProductOption,
} from './offlineCatalogCache'
import { mapRowToProductOption, TABELA_PRODUTOS } from './productOptionMapper'
import { getProdutoLista, produtoListaParaProductOptions } from './produtoListaSupabase'
import { supabase } from './supabaseClient'

export type PrefetchOfflineCatalogResult = {
  produtos: number
  conferentes: number
  listasEndereco: number
  listasProduto: number
}

/** Baixa produtos, conferentes e listas para uso offline (câmara fria sem internet). */
export async function prefetchContagemOfflineCatalog(): Promise<PrefetchOfflineCatalogResult> {
  const { data, error } = await supabase.from(TABELA_PRODUTOS).select('*').limit(15000)
  if (error) throw error

  const byCode = new Map<string, CachedProductOption>()
  for (const row of data ?? []) {
    const p = mapRowToProductOption(row as Record<string, unknown>)
    if (!p) continue
    const k = p.codigo.trim()
    if (!byCode.has(k)) {
      byCode.set(k, {
        id: p.id,
        codigo: p.codigo,
        descricao: p.descricao,
        unidade_medida: p.unidade_medida,
        data_fabricacao: p.data_fabricacao,
        data_validade: p.data_validade,
        ean: p.ean,
        dun: p.dun,
      })
    }
  }
  const produtos = Array.from(byCode.values())
  if (produtos.length) saveProductOptionsCache(produtos)

  const conferentes = await listConferentes()
  if (conferentes.length) saveConferentesCache(conferentes)

  let listasEndereco = 0
  try {
    const enderecos = await listEnderecoListas()
    for (const lista of enderecos) {
      saveEnderecoListCache({
        id: lista.id,
        nome: lista.nome,
        enderecos: lista.enderecos,
      })
      listasEndereco++
    }
  } catch {
    /* listas de endereço opcionais */
  }

  let listasProduto = 0
  const listaIds = new Set<string>()
  try {
    const inventarios = await listInventarios()
    for (const inv of inventarios) {
      if (inv.listaProdutosId) listaIds.add(inv.listaProdutosId)
    }
  } catch {
    /* ignore */
  }

  for (const listaId of listaIds) {
    const n = await prefetchProdutoListaOffline(listaId)
    if (n > 0) listasProduto++
  }

  return {
    produtos: produtos.length || loadProductOptionsCache().length,
    conferentes: conferentes.length,
    listasEndereco,
    listasProduto,
  }
}

export async function prefetchProdutoListaOffline(listaId: string): Promise<number> {
  const lista = await getProdutoLista(listaId)
  if (!lista) return 0
  const options = produtoListaParaProductOptions(lista)
  const cached: CachedProductOption[] = options.map((p) => ({
    id: p.id,
    codigo: p.codigo,
    descricao: p.descricao,
    unidade_medida: p.unidade_medida,
    data_fabricacao: p.data_fabricacao,
    data_validade: p.data_validade,
    ean: p.ean,
    dun: p.dun,
  }))
  saveProductListCache(listaId, cached)
  return cached.length
}
