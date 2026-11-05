import { supabase } from './supabaseClient'

const DEBOUNCE_MS = 350

/** Escuta mudanças em `contagens_inventario` para um dia (YYYY-MM-DD). */
export function subscribeContagensInventarioDia(dataContagemYmd: string, onChange: () => void): () => void {
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
    .channel(`realtime-contagens_inventario-${ymd}-${Math.random().toString(36).slice(2, 11)}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'contagens_inventario',
        filter: `data_contagem=eq.${ymd}`,
      },
      () => schedule(),
    )
    .subscribe((status: string) => {
      if (import.meta.env.DEV && status === 'CHANNEL_ERROR') {
        console.warn('[subscribeContagensInventarioDia] realtime indisponível — verifique publication supabase_realtime.')
      }
    })

  return () => {
    if (timeout) clearTimeout(timeout)
    void supabase.removeChannel(channel)
  }
}
