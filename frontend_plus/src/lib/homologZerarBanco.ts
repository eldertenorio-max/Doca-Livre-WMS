import { isHomologacao, isProducao } from './appAmbiente'
import { getSupabase, isSupabaseConfigured } from './supabaseClient'

/** Só homologação — nunca produção (wms.docalivre.com.br). */
export function podeZerarBancoHomologacao(): boolean {
  return isHomologacao() && !isProducao()
}

/** Estoque, histórico e dados de permanência das NFs (aba Financeiro → Data de entrada). */
export const TABELAS_ZERAR_HOMOLOG: { table: string; filterCol: string }[] = [
  { table: 'ultrafrio_movimentos', filterCol: 'id' },
  { table: 'ultrafrio_notas_canceladas', filterCol: 'id' },
  { table: 'ultrafrio_enderecamentos', filterCol: 'nf_id' },
  { table: 'ultrafrio_nf_itens', filterCol: 'nf_id' },
  { table: 'ultrafrio_notas_fiscais', filterCol: 'id' },
]

/** Texto exibido na confirmação do botão zerar homolog. */
export const PRESERVADO_ZERAR_HOMOLOG =
  'lógica de cobrança (tabelas de frete, contratos e clientes cadastrados)'

/** Cadastro financeiro e remetentes — não apagar no reset de homolog. */
export const TABELAS_PRESERVAR_HOMOLOG = [
  'ultrafrio_fin_tabelas',
  'ultrafrio_fin_clientes',
  'ultrafrio_fin_contratos',
  'ultrafrio_cadastro_remetentes',
] as const

/** Apaga estoque e histórico operacional; mantém tabelas, clientes e contratos financeiros. */
export async function zerarBancoHomologacaoSupabase(): Promise<void> {
  if (!podeZerarBancoHomologacao()) {
    throw new Error('Zerar banco só é permitido no ambiente de homologação.')
  }
  if (!isSupabaseConfigured()) {
    throw new Error('Supabase não configurado.')
  }

  const sb = getSupabase()

  for (const { table, filterCol } of TABELAS_ZERAR_HOMOLOG) {
    const { error } = await sb.from(table).delete().not(filterCol, 'is', null)
    if (error) {
      if (error.message.includes('does not exist') || error.code === 'PGRST205') continue
      throw new Error(`${table}: ${error.message}`)
    }
  }
}
