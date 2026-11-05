import { Fragment, useState, type SyntheticEvent } from 'react'
import type { EntradaItemCampos } from '../lib/entradaCampos'
import { normalizeDataFabricacao, todayDateInputMax } from '../lib/entradaCampos'
import { canDesmembrarNfeItem } from '../lib/desmembrarItem'
import { itemEnderecamentoCompleto, paletesLimiteItem } from '../lib/paletes'
import { localizacaoItem } from '../layout/stage'
import { pesoBrutoTotalItem, pesoLiquidoTotalItem } from '../lib/saidaParcial'
import { quantidadeEstoqueItem, unidadeEstoqueItem } from '../lib/nfeUnidades'
import type { LocalizacaoEstoque, NfeItem, NotaFiscal } from '../types'
import { formatAddressLabel } from '../layout/camaras'
import {
  formatPesoBruto,
  formatQuantidadeNfe,
  formatValorNfe,
} from '../lib/formatNfeItem'

type Props = {
  nf: NotaFiscal
  items: NfeItem[]
  activeItemIndex: number | null
  onSelectItem: (index: number) => void
  onUpdateItemCampos: (itemIndex: number, patch: EntradaItemCampos) => void
  onUpdateItemQuantidade: (itemIndex: number, quantidade: string) => void
  onUpdateItemPaletes: (itemIndex: number, paletes: string) => void
  onUpdateItemLocalizacao?: (itemIndex: number, localizacao: LocalizacaoEstoque) => void
  onDesmembrarItem: (itemIndex: number) => void
  onConfirmItem?: () => void
  paletesRestantes?: number | null
  pendingCount?: number
  canEdit?: boolean
}

function resumoItemInativo(item: NfeItem, isStage: boolean): string {
  const parts: string[] = [isStage ? 'Stage' : 'Armazém']
  if (item.up) parts.push(`UP ${item.up}`)
  if (item.lote) parts.push(`Lote ${item.lote}`)
  if (!isStage && item.paletes) parts.push(`${item.paletes} pal.`)
  return parts.join(' · ')
}

function itemStatus(item: NfeItem): 'pendente' | 'parcial' | 'ok' {
  if (itemEnderecamentoCompleto(item)) return 'ok'
  const limite = paletesLimiteItem(item)
  if (item.allocatedAddresses.length > 0 && limite > 0) return 'parcial'
  return 'pendente'
}

function stopRowActivate(e: SyntheticEvent) {
  e.stopPropagation()
}

function paletesValueToDraft(value: number | undefined): string {
  return value != null && value > 0 ? String(value) : ''
}

function PaletesItemInput({
  itemIndex,
  value,
  disabled,
  onCommit,
}: {
  itemIndex: number
  value: number | undefined
  disabled: boolean
  onCommit: (itemIndex: number, raw: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<{ itemIndex: number; value: string } | null>(null)
  const persistedDraft = paletesValueToDraft(value)
  const inputValue = editing && draft?.itemIndex === itemIndex ? draft.value : persistedDraft

  return (
    <input
      type="number"
      min={1}
      step={1}
      className="input-nf input-nf--compact"
      value={inputValue}
      disabled={disabled}
      onFocus={() => {
        setEditing(true)
        setDraft({ itemIndex, value: persistedDraft })
      }}
      onChange={(e) => {
        const next = e.target.value
        setDraft({ itemIndex, value: next })
      }}
      onBlur={(e) => {
        onCommit(itemIndex, e.target.value)
        setEditing(false)
        setDraft(null)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
        stopRowActivate(e)
      }}
      onClick={stopRowActivate}
    />
  )
}

export function NfItensTable({
  nf,
  items,
  activeItemIndex,
  onSelectItem,
  onUpdateItemCampos,
  onUpdateItemQuantidade,
  onUpdateItemPaletes,
  onUpdateItemLocalizacao,
  onDesmembrarItem,
  onConfirmItem,
  paletesRestantes = null,
  pendingCount = 0,
  canEdit = true,
}: Props) {
  return (
    <div className="nf-itens-table-wrap">
      <table className="nf-itens-table">
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
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const st = itemStatus(item)
            const isActive = activeItemIndex === item.index
            const camposEditaveis = canEdit && isActive
            const isStage = localizacaoItem(item) === 'stage'
            const showEnderecos = item.allocatedAddresses.length > 0
            const podeDesmembrar = canEdit && canDesmembrarNfeItem(item)
            const podeSalvar =
              isStage || (pendingCount > 0 && (paletesRestantes == null || paletesRestantes <= 0))
            const salvarTitulo = isStage
              ? 'Confirma o item no stage e minimiza a linha'
              : podeSalvar
                ? 'Confirma os endereços do item e minimiza a linha'
                : paletesRestantes != null && paletesRestantes > 0
                  ? `Faltam ${paletesRestantes} posição(ões) no mapa`
                  : 'Informe Paletes e marque as posições no mapa antes de salvar'

            return (
              <Fragment key={item.index}>
                <tr
                  className={`nf-itens-row nf-itens-row--${st}${isActive ? ' nf-itens-row--active' : ''}`}
                  onClick={() => onSelectItem(item.index)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelectItem(item.index)
                    }
                  }}
                >
                  <td className="nf-itens-col-status">
                    <span
                      className={`nf-itens-status ${
                        isActive
                          ? 'nf-itens-status--marcado'
                          : `nf-itens-status--${st}`
                      }`}
                      aria-label={
                        isActive
                          ? 'Item selecionado'
                          : st === 'ok'
                            ? 'Endereçado'
                            : st === 'parcial'
                              ? 'Parcialmente endereçado'
                              : 'Pendente'
                      }
                    >
                      {isActive ? '✓' : st === 'ok' ? '✓' : st === 'parcial' ? '◐' : '○'}
                    </span>
                  </td>
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
                <tr
                  className={`nf-itens-row-campos${isActive ? '' : ' nf-itens-row-campos--inativo'}`}
                  onClick={
                    isActive
                      ? stopRowActivate
                      : () => onSelectItem(item.index)
                  }
                  role={isActive ? undefined : 'button'}
                  tabIndex={isActive ? undefined : 0}
                  onKeyDown={
                    isActive
                      ? undefined
                      : (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onSelectItem(item.index)
                          }
                        }
                  }
                >
                  <td className="nf-itens-col-status" aria-hidden />
                  <td colSpan={8}>
                    {!isActive ? (
                      <div className="nf-itens-campos-collapsed">
                        <span className="nf-itens-collapsed-resumo">
                          {resumoItemInativo(item, isStage)}
                        </span>
                        {canEdit && (
                          <button
                            type="button"
                            className="btn btn-sm btn-ghost nf-itens-editar"
                            onClick={(e) => {
                              stopRowActivate(e)
                              onSelectItem(item.index)
                            }}
                          >
                            Editar
                          </button>
                        )}
                      </div>
                    ) : (
                    <>
                    <div className="nf-itens-campos-row">
                      <label className="nf-itens-campo">
                        <span>UP</span>
                        <input
                          type="text"
                          className="input-nf input-nf--compact"
                          value={item.up ?? ''}
                          disabled={!camposEditaveis}
                          onChange={(e) => onUpdateItemCampos(item.index, { up: e.target.value })}
                          onClick={stopRowActivate}
                        />
                      </label>
                      <label className="nf-itens-campo">
                        <span>Lote</span>
                        <input
                          type="text"
                          className="input-nf input-nf--compact"
                          value={item.lote ?? ''}
                          disabled={!camposEditaveis}
                          onChange={(e) => onUpdateItemCampos(item.index, { lote: e.target.value })}
                          onClick={stopRowActivate}
                        />
                      </label>
                      <label className="nf-itens-campo">
                        <span>Fab.</span>
                        <input
                          type="date"
                          className="input-nf input-nf--compact"
                          max={todayDateInputMax()}
                          value={item.dataFabricacao ?? ''}
                          disabled={!camposEditaveis}
                          onChange={(e) =>
                            onUpdateItemCampos(item.index, {
                              dataFabricacao: normalizeDataFabricacao(e.target.value),
                            })
                          }
                          onClick={stopRowActivate}
                        />
                      </label>
                      <label className="nf-itens-campo">
                        <span>Valid.</span>
                        <input
                          type="date"
                          className="input-nf input-nf--compact"
                          value={item.dataValidade ?? ''}
                          disabled={!camposEditaveis}
                          onChange={(e) =>
                            onUpdateItemCampos(item.index, { dataValidade: e.target.value })
                          }
                          onClick={stopRowActivate}
                        />
                      </label>
                      <label className="nf-itens-campo nf-itens-campo--destino">
                        <span>Destino</span>
                        <select
                          className="input-select input-nf--compact"
                          value={localizacaoItem(item)}
                          disabled={!camposEditaveis || !onUpdateItemLocalizacao}
                          onChange={(e) =>
                            onUpdateItemLocalizacao?.(
                              item.index,
                              e.target.value as LocalizacaoEstoque,
                            )
                          }
                          onClick={stopRowActivate}
                        >
                          <option value="armazem">Armazém</option>
                          <option value="stage">Stage</option>
                        </select>
                      </label>
                      {!isStage && (
                        <label className="nf-itens-campo">
                          <span>Paletes</span>
                          <PaletesItemInput
                            itemIndex={item.index}
                            value={item.paletes}
                            disabled={!camposEditaveis}
                            onCommit={onUpdateItemPaletes}
                          />
                        </label>
                      )}
                      {isStage && (
                        <span className="nf-itens-stage-badge muted">No stage — sem endereço</span>
                      )}
                      <label className="nf-itens-campo">
                        <span>Qtd.</span>
                        <input
                          type="number"
                          min={0}
                          step="any"
                          className="input-nf input-nf--compact"
                          value={quantidadeEstoqueItem(item)}
                          disabled={!camposEditaveis}
                          onChange={(e) => onUpdateItemQuantidade(item.index, e.target.value)}
                          onClick={stopRowActivate}
                        />
                      </label>
                    </div>
                    {camposEditaveis && (
                      <div className="nf-itens-campos-actions">
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost nf-itens-desmembrar"
                          disabled={!podeDesmembrar}
                          title={
                            podeDesmembrar
                              ? 'Duplica a linha para registrar outra data ou lote'
                              : 'Confirme os endereços antes de desmembrar'
                          }
                          onClick={(e) => {
                            stopRowActivate(e)
                            onDesmembrarItem(item.index)
                          }}
                        >
                          Desmembrar
                        </button>
                        {onConfirmItem && (
                          <button
                            type="button"
                            className="btn btn-sm primary nf-itens-salvar"
                            disabled={!podeSalvar}
                            title={salvarTitulo}
                            onMouseDown={(e) => {
                              stopRowActivate(e)
                              if (document.activeElement instanceof HTMLElement) {
                                document.activeElement.blur()
                              }
                            }}
                            onClick={(e) => {
                              stopRowActivate(e)
                              onConfirmItem()
                            }}
                          >
                            Salvar
                          </button>
                        )}
                      </div>
                    )}
                    </>
                    )}
                  </td>
                </tr>
                {showEnderecos && (
                  <tr className="nf-itens-row-addr">
                    <td colSpan={9}>
                      <ul className="addr-mini nf-itens-addr-list">
                        {item.allocatedAddresses.map((a) => (
                          <li key={a}>{formatAddressLabel(a)}</li>
                        ))}
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
