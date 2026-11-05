import { TABELA_PRODUTOS } from './productOptionMapper'
import { supabase } from './supabaseClient'

const DEBOUNCE_MS = 400

/** Escuta INSERT/UPDATE/DELETE em `Todos os Produtos` para atualizar descrições na planilha. */
export function subscribeTodosOsProdutosRealtime(onChange: () => void): () => void {
  let timeout: ReturnType<typeof setTimeout> | null = null
  const schedule = () => {
    if (timeout) clearTimeout(timeout)
    timeout = setTimeout(() => {
      timeout = null
      onChange()
    }, DEBOUNCE_MS)
  }

  const channel = supabase
    .channel(`realtime-todos-os-produtos-${Math.random().toString(36).slice(2, 11)}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: TABELA_PRODUTOS,
      },
      () => schedule(),
    )
    .subscribe((status: string) => {
      if (import.meta.env.DEV && status === 'CHANNEL_ERROR') {
        console.warn(
          '[subscribeTodosOsProdutosRealtime] realtime indisponível — adicione "Todos os Produtos" à publication supabase_realtime ou use Atualizar cadastro.',
        )
      }
    })

  return () => {
    if (timeout) clearTimeout(timeout)
    void supabase.removeChannel(channel)
  }
}
