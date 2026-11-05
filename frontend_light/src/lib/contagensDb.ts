/** Contagem diária e inventário físico em tabelas separadas no Supabase. */
export const TABLE_CONTAGEM_DIARIA = 'contagens_estoque' as const
export const TABLE_CONTAGEM_INVENTARIO = 'contagens_inventario' as const

export type ContagensDbModo = 'contagem_diaria' | 'inventario'

export function tableContagens(modo: ContagensDbModo | boolean): typeof TABLE_CONTAGEM_DIARIA | typeof TABLE_CONTAGEM_INVENTARIO {
  const inv = typeof modo === 'boolean' ? modo : modo === 'inventario'
  return inv ? TABLE_CONTAGEM_INVENTARIO : TABLE_CONTAGEM_DIARIA
}

/** FK em `inventario_planilha_linhas` para o registro canônico da contagem. */
export function planilhaFkContagemColumn(modo: ContagensDbModo | boolean): 'contagens_inventario_id' | 'contagens_estoque_id' {
  const inv = typeof modo === 'boolean' ? modo : modo === 'inventario'
  return inv ? 'contagens_inventario_id' : 'contagens_estoque_id'
}
