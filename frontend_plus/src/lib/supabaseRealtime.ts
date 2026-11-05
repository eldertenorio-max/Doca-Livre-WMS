import { getSupabase } from './supabaseClient'

const TABLES = [
  'ultrafrio_notas_fiscais',
  'ultrafrio_nf_itens',
  'ultrafrio_enderecamentos',
  'ultrafrio_movimentos',
  'ultrafrio_notas_canceladas',
  'ultrafrio_cadastro_remetentes',
  'ultrafrio_voz_cadastros',
] as const

export function subscribeEnderecamentoChanges(onChange: () => void): () => void {
  const sb = getSupabase()
  let channel = sb.channel('ultrafrio-sync')

  for (const table of TABLES) {
    channel = channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      () => onChange(),
    )
  }

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      onChange()
    }
  })

  return () => {
    void sb.removeChannel(channel)
  }
}
