import type { NotaFiscal } from '../types'
import { buildNfResumo, formatPesoKg } from '../lib/nfResumo'
import { formatValorNfe } from '../lib/formatNfeItem'

type Props = {
  nf: NotaFiscal
  compact?: boolean
}

export function NfResumoGrid({ nf, compact = false }: Props) {
  const resumo = buildNfResumo(nf)

  return (
    <dl className={`nf-resumo${compact ? ' nf-resumo--compact' : ''}`}>
      <div>
        <dt>P. bruto</dt>
        <dd>{formatPesoKg(resumo.pesoBruto)}</dd>
      </div>
      <div>
        <dt>P. líquido</dt>
        <dd>{formatPesoKg(resumo.pesoLiquido)}</dd>
      </div>
      <div>
        <dt>V. total</dt>
        <dd>{formatValorNfe(resumo.valorTotalNota)}</dd>
      </div>
      <div>
        <dt>Qtd. / vol.</dt>
        <dd>{resumo.quantidadeVolume}</dd>
      </div>
    </dl>
  )
}
