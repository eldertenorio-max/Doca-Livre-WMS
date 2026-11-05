import { Fragment } from 'react'
import { contagemPaletesItem, rotuloPaletes, rotuloPosicoes } from '../lib/paletes'
import { itemMovimentavel } from '../lib/movimentacaoItens'
import { pesoBrutoTotalItem, pesoLiquidoTotalItem } from '../lib/saidaParcial'
import { quantidadeEstoqueItem, unidadeEstoqueItem } from '../lib/nfeUnidades'
import { labelLocalizacaoItem, suffixLocalizacaoEndereco } from '../lib/localizacaoLabels'
import { itemNoStage, STAGE_LABEL } from '../layout/stage'
import type { NfeItem, NotaFiscal, AddressId } from '../types'
import { formatAddressLabel } from '../layout/camaras'
import {
  formatPesoBruto,
  formatQuantidadeNfe,
  formatValorNfe,
} from '../lib/formatNfeItem'

type Props = {
  nf: NotaFiscal
  items: NfeItem[]
  activeItemIndex?: number | null
  onSelectItem?: (index: number) => void
  selectablePredicate?: (item: NfeItem) => boolean
  highlightAddresses?: Set<string>
  vozOrigemAddress?: AddressId | null
  onSelectVozOrigem?: (addressId: AddressId, itemIndex: number) => void
}

function formatDateShort(raw: string | undefined): string {
  if (!raw) return '—'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10)
  return d.toLocaleDateString('pt-BR')
}

export function NfItensLeituraTable({
  nf,
  items,
  activeItemIndex = null,
  onSelectItem,
  selectablePredicate,
  highlightAddresses,
  vozOrigemAddress,
  onSelectVozOrigem,
}: Props) {
  return (
    <div className="nf-itens-table-wrap">
      <table className="nf-itens-table nf-itens-table--leitura">
        <thead>
          <tr>
            {onSelectItem && <th scope="col" className="nf-itens-col-status" aria-label="Selecionar" />}
            <th scope="col">Código</th>
            <th scope="col">Descrição</th>
            <th scope="col">Un.</th>
            <th scope="col" className="nf-itens-col-num">
              Peso br.
            </th>
            <th scope="col" className="nf-itens-col-num">
              P. líq.
            </th>
            <th scope="col" className="nf-itens-col-num">
              Qtd.
            </th>
            <th scope="col" className="nf-itens-col-num">
              V. unit.
            </th>
            <th scope="col" className="nf-itens-col-num">
              V. total
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const isActive = activeItemIndex === item.index
            const movimentavel = itemMovimentavel(item)
            const selectable =
              onSelectItem != null &&
              movimentavel &&
              (selectablePredicate ? selectablePredicate(item) : true)
            const temMeta =
              item.up ||
              item.lote ||
              item.dataFabricacao ||
              item.dataValidade ||
              (item.paletes != null && item.paletes > 0)

            return (
              <Fragment key={item.index}>
                <tr
                  className={`nf-itens-row nf-itens-row--ok${isActive ? ' nf-itens-row--active' : ''}${selectable ? ' nf-itens-row--clickable' : ''}`}
                  onClick={
                    selectable
                      ? () => onSelectItem!(item.index)
                      : undefined
                  }
                  role={selectable ? 'button' : undefined}
                  tabIndex={selectable ? 0 : undefined}
                  onKeyDown={
                    selectable
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onSelectItem!(item.index)
                          }
                        }
                      : undefined
                  }
                >
                  {onSelectItem && (
                    <td className="nf-itens-col-status">
                      {selectable ? (
                        <span className="nf-itens-status nf-itens-status--ok">
                          {isActive ? '✎' : '○'}
                        </span>
                      ) : movimentavel ? (
                        <span className="nf-itens-status nf-itens-status--ok">✓</span>
                      ) : (
                        <span
                          className="nf-itens-status nf-itens-status--muted"
                          title="Sem estoque no armazém nem no stage — enderece na Entrada"
                        >
                          —
                        </span>
                      )}
                    </td>
                  )}
                  <td className="nf-itens-col-codigo">{item.codigo || '—'}</td>
                  <td className="nf-itens-col-descricao" title={item.descricao}>
                    {item.descricao || '—'}
                  </td>
                  <td className="nf-itens-col-un">{unidadeEstoqueItem(item) || '—'}</td>
                  <td className="nf-itens-col-num">
                    {formatPesoBruto(pesoBrutoTotalItem(nf, item) ?? item.pesoBruto)}
                  </td>
                  <td className="nf-itens-col-num">
                    {formatPesoBruto(pesoLiquidoTotalItem(nf, item))}
                  </td>
                  <td className="nf-itens-col-num">{formatQuantidadeNfe(quantidadeEstoqueItem(item))}</td>
                  <td className="nf-itens-col-num">{formatValorNfe(item.valorUnitario)}</td>
                  <td className="nf-itens-col-num">{formatValorNfe(item.valorTotal)}</td>
                </tr>
                {temMeta && (
                  <tr className="nf-itens-row-meta">
                    <td colSpan={onSelectItem ? 9 : 8}>
                      <div className="nf-itens-meta-leitura">
                        {item.up && (
                          <span>
                            <span className="muted">UP</span> {item.up}
                          </span>
                        )}
                        {item.lote && (
                          <span>
                            <span className="muted">Lote</span> {item.lote}
                          </span>
                        )}
                        {item.dataFabricacao && (
                          <span>
                            <span className="muted">Fab.</span>{' '}
                            {formatDateShort(item.dataFabricacao)}
                          </span>
                        )}
                        {item.dataValidade && (
                          <span>
                            <span className="muted">Valid.</span>{' '}
                            {formatDateShort(item.dataValidade)}
                          </span>
                        )}
                        {item.paletes != null && item.paletes > 0 && (
                          <span>
                            <span className="muted">Paletes</span> {item.paletes}
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
                {itemNoStage(item) && (
                  <tr className="nf-itens-row-addr">
                    <td colSpan={onSelectItem ? 9 : 8}>
                      <ul className="addr-mini nf-itens-addr-list">
                        <li className={isActive ? 'addr-edit-active' : undefined}>
                          {STAGE_LABEL} · {labelLocalizacaoItem(item)}
                        </li>
                      </ul>
                    </td>
                  </tr>
                )}
                {item.allocatedAddresses.length > 0 && (
                  <tr className="nf-itens-row-addr">
                    <td colSpan={onSelectItem ? 9 : 8}>
                      <p className="nf-itens-addr-resumo">
                        {rotuloPosicoes(item.allocatedAddresses.length)}
                        {' · '}
                        {rotuloPaletes(contagemPaletesItem(item))}
                      </p>
                      <ul className="addr-mini nf-itens-addr-list">
                        {item.allocatedAddresses.map((a) => {
                          const vozSelecionavel =
                            onSelectVozOrigem != null && isActive && !itemNoStage(item)
                          return (
                          <li
                            key={a}
                            className={[
                              isActive ? 'addr-edit-active' : '',
                              highlightAddresses?.has(a) ? 'addr-flagged' : '',
                              vozOrigemAddress === a ? 'addr-voz-origem' : '',
                              vozSelecionavel ? 'addr-voz-clickable' : '',
                            ]
                              .filter(Boolean)
                              .join(' ') || undefined}
                            onClick={
                              vozSelecionavel
                                ? (e) => {
                                    e.stopPropagation()
                                    onSelectVozOrigem!(a, item.index)
                                  }
                                : undefined
                            }
                            role={vozSelecionavel ? 'button' : undefined}
                            tabIndex={vozSelecionavel ? 0 : undefined}
                            onKeyDown={
                              vozSelecionavel
                                ? (e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault()
                                      e.stopPropagation()
                                      onSelectVozOrigem!(a, item.index)
                                    }
                                  }
                                : undefined
                            }
                          >
                            {formatAddressLabel(a)}
                            {suffixLocalizacaoEndereco(item)}
                          </li>
                          )
                        })}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
