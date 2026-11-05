import type { SupabaseClient } from '@supabase/supabase-js'

function isMissingInventarioPlanilhaTableError(e: unknown): boolean {
  const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : ''
  const msg = (
    e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : String(e)
  ).toLowerCase()
  return (
    code === '42P01' ||
    (msg.includes('inventario_planilha_linhas') && (msg.includes('does not exist') || msg.includes('não existe')))
  )
}

/**
 * Remove linhas em `inventario_planilha_linhas` ligadas aos ids de `contagens_estoque`.
 * Necessário porque a FK está como `ON DELETE SET NULL` — só apagar contagens deixa órfãos no painel do Supabase.
 */
export async function deleteInventarioPlanilhaLinhasForContagensIds(
  supabase: SupabaseClient,
  contagensIds: string[],
): Promise<void> {
  const ids = contagensIds.filter(Boolean)
  if (ids.length === 0) return
  const { error: e1 } = await supabase.from('inventario_planilha_linhas').delete().in('contagens_inventario_id', ids)
  if (e1 && !isMissingInventarioPlanilhaTableError(e1)) throw e1
  const { error: e2 } = await supabase.from('inventario_planilha_linhas').delete().in('contagens_estoque_id', ids)
  if (e2 && !isMissingInventarioPlanilhaTableError(e2)) throw e2
}

/** Apaga todas as linhas da planilha de inventário do dia (alinhado a “Excluir tudo” da prévia no modo inventário). */
export async function deleteInventarioPlanilhaLinhasForDay(
  supabase: SupabaseClient,
  dataInventarioYmd: string,
): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataInventarioYmd)) return
  const { error } = await supabase.from('inventario_planilha_linhas').delete().eq('data_inventario', dataInventarioYmd)
  if (error && !isMissingInventarioPlanilhaTableError(error)) throw error
}
