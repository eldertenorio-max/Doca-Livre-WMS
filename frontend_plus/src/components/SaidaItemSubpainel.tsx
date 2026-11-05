import { useMemo, type MouseEvent } from 'react'
import type { AddressId, NfeItem, NotaFiscal } from '../types'
import {
  calcularSaidaPalete,
  caixasJaSaidasItem,
  caixasPorPalete,
  paletesDisponiveisItem,
  parseQuantidadeSaida,
  quantidadeBaseSaida,
  totaisSaidaItem,
  type SaidaLimitesPorItem,
  type SaidaPaleteCalculo,
  type SaidaPaleteDraft,
} from '../lib/saidaParcial'
import { formatAddressLabel } from '../layout/camaras'
import { unidadeEstoqueItem } from '../lib/nfeUnidades'
import { formatPesoBruto, formatQuantidadeNfe, formatValorNfe } from '../lib/formatNfeItem'
import { SaidaItemEntradaResumo } from './SaidaItemEntradaResumo'

type Props = {
  nf: NotaFiscal
  item: NfeItem
  limitesPorItem?: SaidaLimitesPorItem
  isActive: boolean
  paletesConfirmados: SaidaPaleteDraft[]
  paletesSelecionadosIds: AddressId[]
  paleteAtivo: AddressId | null
  modoPalete: boolean
  qtdPaletesInput: string
  qtdPaletesAlvo: number | null
  selecaoConcluida: boolean
  caixasInput: string
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

export function SaidaItemSubpainel({
  nf,
  item,
  limitesPorItem,
  isActive,
  paletesConfirmados,
  paletesSelecionadosIds,
  paleteAtivo,
  modoPalete,
  qtdPaletesInput,
  qtdPaletesAlvo,
  selecaoConcluida,
  caixasInput,
  onQtdPaletesChange,
  onIniciarSelecao,
  onConfirmarSelecaoPaletes,
  onCaixasChange,
  onConfirmarPalete,
  onRemoverPalete,
  selecaoErro,
}: Props) {
  const confirmadosItem = paletesConfirmados.filter((p) => p.itemIndex === item.index)
  const paletesDisponiveis = paletesDisponiveisItem(item, paletesConfirmados)
  const totais = totaisSaidaItem(nf, item, paletesConfirmados, limitesPorItem)
  const maxCaixas =
    quantidadeBaseSaida(item, limitesPorItem) - caixasJaSaidasItem(item.index, paletesConfirmados)
  const maxCaixasExibicao = Math.max(0, maxCaixas)
  const semSaldo = maxCaixas <= 1e-9 && paletesDisponiveis > 0
  const maxPaletesInput = confirmadosItem.length + paletesDisponiveis

  const paleteAtivoDoItem =
    paleteAtivo && item.allocatedAddresses.includes(paleteAtivo) ? paleteAtivo : null
  const caixas = parseQuantidadeSaida(caixasInput)
  const calcPreview: SaidaPaleteCalculo | null = useMemo(() => {
    if (!isActive || !paleteAtivoDoItem || caixas == null || caixas < 0) return null
    if (caixas <= 0 && !semSaldo) return null
    return calcularSaidaPalete(nf, item, paleteAtivoDoItem, caixas, paletesConfirmados, limitesPorItem)
  }, [isActive, nf, item, paleteAtivoDoItem, caixas, paletesConfirmados, limitesPorItem, semSaldo])

  const totaisExibicao = useMemo(() => {
    if (!calcPreview) return totais
    return {
      caixas: totais.caixas + calcPreview.quantidadeCaixas,
      pesoBruto: totais.pesoBruto + (calcPreview.pesoBrutoSaida ?? 0),
      pesoLiquido: totais.pesoLiquido + (calcPreview.pesoLiquidoSaida ?? 0),
      valor: totais.valor + (calcPreview.valorTotalSaida ?? 0),
      sobra: calcPreview.quantidadeSobra,
    }
  }, [totais, calcPreview])

  const qtdInputValida = useMemo(() => {
    const n = Number(qtdPaletesInput.trim().replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0 || Math.floor(n) !== n) return false
    return confirmadosItem.length > 0 ? n > confirmadosItem.length : true
  }, [qtdPaletesInput, confirmadosItem.length])

  const selecaoCompleta =
    isActive && qtdPaletesAlvo != null && paletesSelecionadosIds.length === qtdPaletesAlvo

  const emSelecaoMapa =
    isActive && modoPalete && qtdPaletesAlvo != null && !selecaoConcluida
  const emConfirmacaoCaixas = isActive && selecaoConcluida && paleteAtivoDoItem != null
  const paletesEmConfirmacao = Math.max(1, paletesSelecionadosIds.length)

  return (
    <div className="saida-item-subpainel" onClick={stopRowActivate}>
      <SaidaItemEntradaResumo
        nf={nf}
        item={item}
        limitesPorItem={limitesPorItem}
        paletesConfirmados={paletesConfirmados}
      />
      <div className="saida-item-calculo-grid">
        {isActive && !emSelecaoMapa && !emConfirmacaoCaixas && (
          <label className="saida-item-campo">
            <span>{confirmadosItem.length > 0 ? 'Qtd. total de paletes' : 'Qtd. paletes'}</span>
            <input
              type="number"
              min={1}
              max={maxPaletesInput}
              step={1}
              className="input-nf input-nf--compact"
              value={qtdPaletesInput}
              onChange={(e) => onQtdPaletesChange(e.target.value)}
              placeholder="0"
              onClick={stopRowActivate}
            />
          </label>
        )}
        <div className="saida-item-campo saida-item-campo--calc">
          <span className="muted">Caixas disponíveis</span>
          <strong className="saida-valor--disponivel">
            {formatQuantidadeNfe(maxCaixasExibicao)} {unidadeEstoqueItem(item)}
          </strong>
        </div>
        <div className="saida-item-campo saida-item-campo--calc">
          <span className="muted">Caixas saindo</span>
          <strong className={totaisExibicao.caixas > 0 ? 'saida-valor--saindo' : undefined}>
            {totaisExibicao.caixas > 0 || isActive
              ? formatQuantidadeNfe(totaisExibicao.caixas)
              : '—'}
          </strong>
        </div>
        <div className="saida-item-campo saida-item-campo--calc">
          <span className="muted">P. bruto saindo</span>
          <strong>
            {totaisExibicao.pesoBruto > 0 || isActive
              ? `${formatPesoBruto(totaisExibicao.pesoBruto)} kg`
              : '—'}
          </strong>
        </div>
        <div className="saida-item-campo saida-item-campo--calc">
          <span className="muted">P. líquido saindo</span>
          <strong>
            {totaisExibicao.pesoLiquido > 0 || isActive
              ? `${formatPesoBruto(totaisExibicao.pesoLiquido)} kg`
              : '—'}
          </strong>
        </div>
        <div className="saida-item-campo saida-item-campo--calc">
          <span className="muted">V. total saindo</span>
          <strong className={totaisExibicao.valor > 0 ? 'saida-valor--saindo' : undefined}>
            {totaisExibicao.valor > 0 || isActive ? formatValorNfe(totaisExibicao.valor) : '—'}
          </strong>
        </div>
        <div className="saida-item-campo saida-item-campo--calc">
          <span className="muted">Sobra</span>
          <strong className="saida-valor--sobra">
            {formatQuantidadeNfe(totaisExibicao.sobra)} {unidadeEstoqueItem(item)}
          </strong>
        </div>
      </div>

      {isActive && !emSelecaoMapa && !emConfirmacaoCaixas && (
        <div className="saida-item-acoes">
          {semSaldo ? (
            <p className="muted saida-paletes-disponiveis saida-aviso-sem-saldo">
              Item sem saldo — {paletesDisponiveis} posição(ões) ainda ocupada(s) no mapa. Selecione
              no painel para liberar (0 caixas).
            </p>
          ) : (
            <p className="muted saida-paletes-disponiveis">
              {paletesDisponiveis} palete(s) disponível(is)
              {confirmadosItem.length > 0 && (
                <> · {confirmadosItem.length} confirmado(s)</>
              )}
            </p>
          )}
          {isActive && selecaoErro && <p className="error saida-item-erro">{selecaoErro}</p>}
          <button
            type="button"
            className="btn primary btn-sm"
            disabled={semSaldo ? paletesDisponiveis <= 0 : !qtdInputValida || paletesDisponiveis <= 0}
            onClick={() => {
              if (semSaldo && !qtdPaletesInput.trim()) {
                onQtdPaletesChange(String(paletesDisponiveis))
              }
              onIniciarSelecao()
            }}
          >
            {semSaldo
              ? 'Liberar posições no painel'
              : confirmadosItem.length > 0
                ? 'Selecionar mais paletes'
                : 'Selecionar no painel'}
          </button>
        </div>
      )}

      {emSelecaoMapa && (
        <div className="saida-item-fase saida-enderecar-box">
          <p className="consulta-enderecar-titulo">Selecione os paletes no painel</p>
          <p className="muted consulta-enderecar-texto">
            Clique nas células <strong>deste item</strong> no mapa. Selecione{' '}
            <strong>{qtdPaletesAlvo ?? '—'}</strong> palete(s).
          </p>
          <p className="consulta-enderecar-contagem">
            Selecionados:{' '}
            <strong>
              {paletesSelecionadosIds.length}
              {qtdPaletesAlvo != null ? ` / ${qtdPaletesAlvo}` : ''}
            </strong>
          </p>
          {paletesSelecionadosIds.length > 0 && (
            <ul className="saida-paletes-lista saida-paletes-lista--selecao">
              {paletesSelecionadosIds.map((a) => (
                <li key={a} className="saida-palete-item saida-palete-item--selecao">
                  <span>{formatAddressLabel(a)}</span>
                </li>
              ))}
            </ul>
          )}
          {selecaoErro && <p className="error saida-item-erro">{selecaoErro}</p>}
          <button
            type="button"
            className="btn primary btn-sm full"
            disabled={!selecaoCompleta}
            onClick={onConfirmarSelecaoPaletes}
          >
            Confirmar seleção de paletes
          </button>
        </div>
      )}

      {emConfirmacaoCaixas && paleteAtivoDoItem && (
        <div className="saida-item-fase">
          <p className="consulta-enderecar-contagem">
            {paletesEmConfirmacao > 1 ? 'Paletes selecionados' : 'Palete'}:{' '}
            <strong>
              {paletesEmConfirmacao > 1
                ? `${paletesEmConfirmacao} paletes`
                : formatAddressLabel(paleteAtivoDoItem)}
            </strong>
            <span className="muted">
              {' '}
              · até {formatQuantidadeNfe(maxCaixasExibicao)} {unidadeEstoqueItem(item)}
              {paletesEmConfirmacao === 1 && item.allocatedAddresses.length > 1 && (
                <> (média {formatQuantidadeNfe(caixasPorPalete(item))}/palete)</>
              )}
              {paletesEmConfirmacao > 1 && (
                <> · rateio automático entre {paletesEmConfirmacao} paletes</>
              )}
            </span>
          </p>
          <label className="saida-item-campo">
            <span>{paletesEmConfirmacao > 1 ? 'Caixas na seleção' : 'Caixas nesta saída'}</span>
            <input
              type="number"
              min={0}
              max={maxCaixasExibicao}
              step="any"
              className={`input-nf input-nf--compact${caixas != null && caixas > maxCaixasExibicao ? ' input-nf--error' : ''}`}
              value={caixasInput}
              onChange={(e) => onCaixasChange(e.target.value)}
              placeholder="0"
              onClick={stopRowActivate}
            />
          </label>
          {selecaoErro && <p className="error saida-item-erro">{selecaoErro}</p>}
          <button
            type="button"
            className="btn primary btn-sm full"
            disabled={!calcPreview && !(semSaldo && caixas === 0)}
            onClick={onConfirmarPalete}
          >
            {semSaldo
              ? paletesEmConfirmacao > 1
                ? 'Liberar posições'
                : 'Liberar posição'
              : paletesEmConfirmacao > 1
                ? 'Confirmar paletes selecionados'
                : 'Confirmar palete'}
          </button>
        </div>
      )}

      {confirmadosItem.length > 0 && (
        <ul className="saida-paletes-lista saida-paletes-lista--item">
          {confirmadosItem.map((p) => {
            const c = calcularSaidaPalete(nf, item, p.addressId, p.quantidadeCaixas, [])
            return (
              <li key={p.addressId} className="saida-palete-item saida-palete-item--compact">
                <div>
                  <strong>{formatAddressLabel(p.addressId)}</strong>
                  <span className="muted">
                    {' '}
                    · {formatQuantidadeNfe(p.quantidadeCaixas)} {unidadeEstoqueItem(item)}
                    {c ? ` · ${formatValorNfe(c.valorTotalSaida)}` : ''}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => onRemoverPalete(p.addressId)}
                >
                  Remover
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
