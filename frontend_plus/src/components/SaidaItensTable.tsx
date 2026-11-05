import { Fragment, type MouseEvent } from 'react'
import {
  sobrasPorItem,
  pesoBrutoTotalItem,
  pesoLiquidoTotalItem,
  quantidadeBaseSaida,
  paletesDisponiveisItem,
  type SaidaLimitesPorItem,
  type SaidaPaleteDraft,
} from '../lib/saidaParcial'
import { unidadeEstoqueItem } from '../lib/nfeUnidades'
import { labelLocalizacaoItem } from '../lib/localizacaoLabels'
import type { AddressId, NfeItem, NotaFiscal } from '../types'
import { formatAddressLabel } from '../layout/camaras'
import {
  formatPesoBruto,
  formatQuantidadeNfe,
  formatValorNfe,
} from '../lib/formatNfeItem'
import { SaidaItemSubpainel } from './SaidaItemSubpainel'

type Props = {
  nf: NotaFiscal
  items: NfeItem[]
  limitesPorItem?: SaidaLimitesPorItem
  activeItemIndex: number | null
  paletesConfirmados: SaidaPaleteDraft[]
  paleteAtivo: string | null
  paletesConfirmadosIds: string[]
  paletesSelecionadosIds?: string[]
  modoPalete: boolean
  qtdPaletesInput: string
  qtdPaletesAlvo: number | null
  selecaoConcluida: boolean
  caixasInput: string
  onSelectItem: (index: number) => void
  onQtdPaletesChange: (value: string) => void
  onIniciarSelecao: () => void
  onConfirmarSelecaoPaletes: () => void
  onCaixasChange: (value: string) => void
  onConfirmarPalete: () => void
  onRemoverPalete: (addressId: AddressId) => void
  selecaoErro: string | null
}

function stopRowActivate(e: MouseEvent) {
  e.stopPropagation()
}

export function SaidaItensTable({
  nf,
  items,
  limitesPorItem,
  activeItemIndex,
  paletesConfirmados,
  paleteAtivo,
  paletesConfirmadosIds,
  paletesSelecionadosIds = [],
  modoPalete,
  qtdPaletesInput,
  qtdPaletesAlvo,
  selecaoConcluida,
  caixasInput,
  onSelectItem,
  onQtdPaletesChange,
  onIniciarSelecao,
  onConfirmarSelecaoPaletes,
  onCaixasChange,
  onConfirmarPalete,
  onRemoverPalete,
  selecaoErro,
}: Props) {
  const itensEstoque = items.filter((it) => it.allocatedAddresses.length > 0)
  const sobras = sobrasPorItem(items, paletesConfirmados, limitesPorItem)

  return (
    <div className="nf-itens-table-wrap saida-itens-table-wrap">
      <table className="nf-itens-table saida-itens-table">
        <thead>
          <tr>
            <th scope="col" className="nf-itens-col-status" aria-label="Status" />
            <th scope="col">Código</th>
            <th scope="col">Descrição</th>
            <th scope="col">Un.</th>
            <th scope="col" className="nf-itens-col-num">Peso br.</th>
            <th scope="col" className="nf-itens-col-num">P. líq.</th>
            <th scope="col" className="nf-itens-col-num">Qtd.</th>
            <th scope="col" className="nf-itens-col-num">V. unit.</th>
            <th scope="col" className="nf-itens-col-num">V. total</th>
            <th scope="col" className="nf-itens-col-num">Sobra</th>
          </tr>
        </thead>
        <tbody>
          {itensEstoque.map((item) => {
            const qtdItem = quantidadeBaseSaida(item, limitesPorItem)
            const sobra = sobras[item.index] ?? qtdItem
            const esgotado = sobra <= 1e-9
            const temSaida = sobra < qtdItem - 1e-9
            const isActive = activeItemIndex === item.index
            const paletesLivres = paletesDisponiveisItem(item, paletesConfirmados)
            const semSaldoPosicoes = esgotado && paletesLivres > 0
            const selecionavel = !esgotado || semSaldoPosicoes
            const selecionadosItem = paletesSelecionadosIds.filter((a) =>
              item.allocatedAddresses.includes(a),
            )
            const classeEnderecoSaida = (addressId: AddressId): string => {
              if (paletesConfirmadosIds.includes(addressId)) return 'addr-confirmado'
              if (paletesSelecionadosIds.includes(addressId)) return 'addr-selecionado'
              if (paleteAtivo === addressId) return 'addr-ativo'
              return ''
            }

            return (
              <Fragment key={item.index}>
                <tr
                  className={`nf-itens-row nf-itens-row--ok${isActive ? ' nf-itens-row--active' : ''}${temSaida && !isActive ? ' nf-itens-row--parcial' : ''}${selecionavel ? ' nf-itens-row--clickable' : ''}`}
                  onClick={selecionavel ? () => onSelectItem(item.index) : undefined}
                  role={selecionavel ? 'button' : undefined}
                  tabIndex={selecionavel ? 0 : undefined}
                  onKeyDown={
                    selecionavel
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onSelectItem(item.index)
                          }
                        }
                      : undefined
                  }
                >
                  <td className="nf-itens-col-status">
                    <span
                      className={`nf-itens-status${esgotado || (!isActive && !temSaida) ? ' nf-itens-status--ok' : ''}${temSaida && !isActive ? ' nf-itens-status--parcial' : ''}`}
                    >
                      {isActive ? '✎' : esgotado && !semSaldoPosicoes ? '✓' : semSaldoPosicoes ? '⊘' : temSaida ? '◐' : '○'}
                    </span>
                  </td>
                  <td className="nf-itens-col-codigo">{item.codigo || '—'}</td>
                  <td className="nf-itens-col-descricao" title={item.descricao}>
                    {item.descricao || '—'}
                  </td>
                  <td className="nf-itens-col-un">{unidadeEstoqueItem(item)}</td>
                  <td className="nf-itens-col-num">
                    {formatPesoBruto(pesoBrutoTotalItem(nf, item) ?? item.pesoBruto)}
                  </td>
                  <td className="nf-itens-col-num">
                    {formatPesoBruto(pesoLiquidoTotalItem(nf, item))}
                  </td>
                  <td className="nf-itens-col-num">{formatQuantidadeNfe(qtdItem)}</td>
                  <td className="nf-itens-col-num">{formatValorNfe(item.valorUnitario)}</td>
                  <td className="nf-itens-col-num">{formatValorNfe(item.valorTotal)}</td>
                  <td className="nf-itens-col-num">
                    <span className={temSaida ? 'saida-valor--sobra' : undefined}>
                      {formatQuantidadeNfe(sobra)}
                    </span>
                  </td>
                </tr>
                {isActive && (
                  <>
                    <tr className="nf-itens-row-addr nf-itens-row-addr--active">
                      <td colSpan={10}>
                        <ul className="addr-mini nf-itens-addr-list addr-mini--saida">
                          {item.allocatedAddresses.map((a) => (
                            <li
                              key={a}
                              className={classeEnderecoSaida(a)}
                            >
                              {formatAddressLabel(a)} · {labelLocalizacaoItem(item)}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                    <tr
                      className="nf-itens-row-saida nf-itens-row-saida--active"
                      onClick={stopRowActivate}
                    >
                      <td colSpan={10}>
                        <SaidaItemSubpainel
                          nf={nf}
                          item={item}
                          limitesPorItem={limitesPorItem}
                          isActive={isActive}
                          paletesConfirmados={paletesConfirmados}
                          paletesSelecionadosIds={selecionadosItem}
                          paleteAtivo={paleteAtivo}
                          modoPalete={modoPalete}
                          qtdPaletesInput={qtdPaletesInput}
                          qtdPaletesAlvo={qtdPaletesAlvo}
                          selecaoConcluida={selecaoConcluida}
                          caixasInput={caixasInput}
                          onQtdPaletesChange={onQtdPaletesChange}
                          onIniciarSelecao={onIniciarSelecao}
                          onConfirmarSelecaoPaletes={onConfirmarSelecaoPaletes}
                          onCaixasChange={onCaixasChange}
                          onConfirmarPalete={onConfirmarPalete}
                          onRemoverPalete={onRemoverPalete}
                          selecaoErro={selecaoErro}
                        />
                      </td>
                    </tr>
                  </>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
