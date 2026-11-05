import { supabase } from './supabaseClient'

const DEBOUNCE_MS = 350

/**
 * Escuta INSERT/UPDATE/DELETE em `contagens_estoque` para um `data_contagem` (YYYY-MM-DD).
 * Exige a tabela na publicação `supabase_realtime` no projeto (ver SQL em `supabase/sql/`).
 */
export function subscribeContagensEstoqueDia(dataContagemYmd: string, onChange: () => void): () => void {
  const ymd = String(dataContagemYmd ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return () => {}

  let timeout: ReturnType<typeof setTimeout> | null = null
  const schedule = () => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => {
      timeout = null
      onChange()
    }, DEBOUNCE_MS)
  }

  const channel = supabase
    .channel(`realtime-contagens_estoque-${ymd}-${Math.random().toString(36).slice(2, 11)}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'contagens_estoque',
        filter: `data_contagem=eq.${ymd}`,
      },
      () => schedule(),
    )
    .subscribe((status: string) => {
      if (import.meta.env.DEV && status === 'CHANNEL_ERROR') {
        console.warn('[subscribeContagensEstoqueDia] realtime indisponível — verifique publication supabase_realtime.')
      }
    })

  return () => {
    if (timeout) clearTimeout(timeout)
    void supabase.removeChannel(channel)
  }
}
