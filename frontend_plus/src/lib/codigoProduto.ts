/** Código comercial para exibição no mapa (prefixo da descrição NF-e, ex.: "9369 - FRANGO..."). */
export function codigoProdutoExibicao(codigo: string, descricao: string): string {
  const prefix = descricao.trim().match(/^(\S+)\s*-\s+/)
  if (prefix?.[1]) return prefix[1]
  return codigo.trim() || descricao.trim()
}
