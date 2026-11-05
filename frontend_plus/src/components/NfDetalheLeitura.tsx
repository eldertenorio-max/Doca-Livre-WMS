import type { ReactNode } from 'react'
import type { NfeItem, NotaFiscal, AddressId } from '../types'
import { rotuloPaletes, rotuloPosicoes, totalEnderecosNf, totalPaletesNf } from '../lib/paletes'
import { NfResumoGrid } from './NfResumoGrid'
import { NfItensLeituraTable } from './NfItensLeituraTable'
import { NfLocalizacaoBadge } from './NfLocalizacaoBadge'

type Props = {
  nf: NotaFiscal
  actions?: ReactNode
  items?: NfeItem[]
  activeItemIndex?: number | null
  onSelectItem?: (index: number) => void
  selectablePredicate?: (item: NfeItem) => boolean
  highlightAddresses?: Set<string>
  vozOrigemAddress?: AddressId | null
  onSelectVozOrigem?: (addressId: AddressId, itemIndex: number) => void
  itensIntro?: string
  showItensTitle?: boolean
  showItensTable?: boolean
  /** Exibe totais de posições e paletes no armazém (consulta / movimentação). */
  showEstoqueResumo?: boolean
}

function formatDate(raw: string): string {
  if (!raw) return '—'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10)
  return d.toLocaleString('pt-BR')
}

export function NfDetalheLeitura({
  nf,
  actions,
  items,
  activeItemIndex,
  onSelectItem,
  selectablePredicate,
  highlightAddresses,
  vozOrigemAddress,
  onSelectVozOrigem,
  itensIntro,
  showItensTitle = true,
  showItensTable = true,
  showEstoqueResumo = true,
}: Props) {
  const lista = items ?? nf.items
  const enderecosNf = totalEnderecosNf(nf)
  const paletesNf = totalPaletesNf(nf)

  return (
    <>
      <div className="nf-detail-head">
        <h3 className="nf-detail-title-row">
          NF {nf.numero}
          <NfLocalizacaoBadge nf={nf} />
        </h3>
        {actions}
      </div>

      {showEstoqueResumo && (enderecosNf > 0 || paletesNf > 0) && (
        <p className="nf-estoque-resumo">
          {enderecosNf > 0 && <span>{rotuloPosicoes(enderecosNf)}</span>}
          {enderecosNf > 0 && paletesNf > 0 && <span className="nf-estoque-resumo-sep"> · </span>}
          {paletesNf > 0 && <span>{rotuloPaletes(paletesNf)}</span>}
        </p>
      )}

      <dl className="meta-list meta-list--nf">
        <div>
          <dt>Emitente</dt>
          <dd>{nf.emitente || '—'}</dd>
        </div>
        <div>
          <dt>Emissão</dt>
          <dd>{formatDate(nf.dataEmissao)}</dd>
        </div>
        {nf.serie && (
          <div>
            <dt>Série</dt>
            <dd>{nf.serie}</dd>
          </div>
        )}
      </dl>

      <p className="nf-leitura-subtitle">Totais do documento</p>
      <NfResumoGrid nf={nf} compact />

      {showItensTitle && <h4 className="nf-section-title nf-section-title--sm">Itens da nota</h4>}
      {itensIntro && <p className="muted nf-itens-intro">{itensIntro}</p>}

      {showItensTable && (
        <NfItensLeituraTable
          nf={nf}
          items={lista}
          activeItemIndex={activeItemIndex}
          onSelectItem={onSelectItem}
          selectablePredicate={selectablePredicate}
          highlightAddresses={highlightAddresses}
          vozOrigemAddress={vozOrigemAddress}
          onSelectVozOrigem={onSelectVozOrigem}
        />
      )}
    </>
  )
}
