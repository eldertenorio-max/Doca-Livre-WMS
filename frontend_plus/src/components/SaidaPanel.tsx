import { useEffect, useState, type ChangeEvent } from 'react'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import type { AddressId, JustificativaSaidaId, NfeItem, NotaFiscal, SaidaXmlDocumento } from '../types'
import type { SaidaLimitesPorItem, SaidaPaleteDraft } from '../lib/saidaParcial'
import { calcularSaidaStageItem, parseQuantidadeSaida } from '../lib/saidaParcial'
import { nfTemEnderecos } from '../lib/movimentos'
import { itemNoStage } from '../layout/stage'
import { quantidadeEstoqueItem, unidadeEstoqueItem } from '../lib/nfeUnidades'
import { formatPesoBruto, formatQuantidadeNfe, formatValorNfe } from '../lib/formatNfeItem'
import type { SaidaItemDraft } from '../lib/saidaParcial'
import type { SaidaReferencia } from '../lib/saidaXml'
import { JUSTIFICATIVAS_SAIDA } from '../lib/justificativaSaida'
import { NfResumoGrid } from './NfResumoGrid'
import { NfLocalizacaoBadge } from './NfLocalizacaoBadge'
import { SaidaItensTable } from './SaidaItensTable'
import { SaidaResumoTotal } from './SaidaResumoTotal'
import { SaidaItemEntradaResumo } from './SaidaItemEntradaResumo'

export type SaidaModoBusca = 'numero' | 'xml'

export type SaidaOrigemEstoque = 'armazem' | 'stage'

type Props = {
  origemEstoque: SaidaOrigemEstoque
  modoBusca: SaidaModoBusca
  onModoBuscaChange: (modo: SaidaModoBusca) => void
  nfBusca: NotaFiscal | null
  saidaXml: SaidaXmlDocumento | null
  referencias: SaidaReferencia[]
  onSelecionarReferencia: (nfId: string) => void
  notasOrigem: NotaFiscal[]
  origemSelecionadaId: string
  onOrigemSelecionadaChange: (nfId: string) => void
  onVincularOrigem: () => void
  onUploadXml: (file: File) => void
  itensSaida: NfeItem[]
  limitesPorItem?: SaidaLimitesPorItem
  vinculoAvisos: string[]
  itemIndex: number | null
  modoPalete: boolean
  qtdPaletesInput: string
  qtdPaletesAlvo: number | null
  paletesSelecionados: AddressId[]
  selecaoConcluida: boolean
  paleteAtivo: AddressId | null
  caixasPalete: string
  paletesConfirmados: SaidaPaleteDraft[]
  onBuscar: (numero: string) => void
  onSelectItem: (index: number) => void
  onQtdPaletesChange: (value: string) => void
  onIniciarSelecao: () => void
  onConfirmarSelecaoPaletes: () => void
  onCaixasPaleteChange: (value: string) => void
  onConfirmarPalete: () => void
  onRemoverPalete: (addressId: AddressId) => void
  onFinalizarSaida: (justificativa: JustificativaSaidaId, dataSaida: string) => void
  onCancelarSaida: () => void
  dataSaidaInput: string
  onDataSaidaChange: (value: string) => void
  buscaErro: string | null
  uploadXmlErro: string | null
  selecaoErro: string | null
  /** Saída do stage (sem paletes/endereços). */
  stageItemIndex: number | null
  stageQtdInput: string
  stageConfirmados: SaidaItemDraft[]
  onSelectItemStage: (index: number) => void
  onStageQtdChange: (value: string) => void
  onConfirmarItemStage: () => void
  onRemoverItemStage: (itemIndex: number) => void
  onFinalizarSaidaStage: (justificativa: JustificativaSaidaId, dataSaida: string) => void
}

export function SaidaPanel({
  origemEstoque,
  modoBusca,
  onModoBuscaChange,
  nfBusca,
  saidaXml,
  referencias,
  onSelecionarReferencia,
  notasOrigem,
  origemSelecionadaId,
  onOrigemSelecionadaChange,
  onVincularOrigem,
  onUploadXml,
  itensSaida,
  limitesPorItem,
  vinculoAvisos,
  itemIndex,
  modoPalete,
  qtdPaletesInput,
  qtdPaletesAlvo,
  paletesSelecionados,
  selecaoConcluida,
  paleteAtivo,
  caixasPalete,
  paletesConfirmados,
  onBuscar,
  onSelectItem,
  onQtdPaletesChange,
  onIniciarSelecao,
  onConfirmarSelecaoPaletes,
  onCaixasPaleteChange,
  onConfirmarPalete,
  onRemoverPalete,
  onFinalizarSaida,
  onCancelarSaida,
  dataSaidaInput,
  onDataSaidaChange,
  buscaErro,
  uploadXmlErro,
  selecaoErro,
  stageItemIndex,
  stageQtdInput,
  stageConfirmados,
  onSelectItemStage,
  onStageQtdChange,
  onConfirmarItemStage,
  onRemoverItemStage,
  onFinalizarSaidaStage,
}: Props) {
  const [numero, setNumero] = useState('')
  const [confirmarCancelar, setConfirmarCancelar] = useState(false)
  const [justificativa, setJustificativa] = useState<JustificativaSaidaId | null>(null)
  useBodyScrollLock(confirmarCancelar)

  useEffect(() => {
    setJustificativa(null)
  }, [nfBusca?.id, saidaXml?.chave])

  function handleBuscar() {
    onBuscar(numero.trim())
    setNumero('')
  }

  function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) onUploadXml(file)
    e.target.value = ''
  }

  const podeFinalizar =
    origemEstoque === 'stage'
      ? stageConfirmados.length > 0 && justificativa != null
      : paletesConfirmados.length > 0 && justificativa != null
  const aguardandoVinculo = modoBusca === 'xml' && saidaXml != null && nfBusca == null
  const refsComEstoque = referencias.filter((r) => r.nf != null)
  const itensComEstoque =
    origemEstoque === 'stage'
      ? itensSaida.filter(itemNoStage)
      : saidaXml
        ? itensSaida
        : itensSaida.filter((it) => it.allocatedAddresses.length > 0)
  const nfTemEstoqueSaida =
    nfBusca &&
    (origemEstoque === 'stage'
      ? nfBusca.items.some(itemNoStage)
      : nfTemEnderecos(nfBusca))

  return (
    <>
      <div className="sidebar-block">
        <div className="saida-modo-busca" role="tablist" aria-label="Forma de buscar saída">
          <button
            type="button"
            role="tab"
            aria-selected={modoBusca === 'numero'}
            className={`saida-modo-btn${modoBusca === 'numero' ? ' saida-modo-btn--active' : ''}`}
            onClick={() => onModoBuscaChange('numero')}
            disabled={modoPalete}
          >
            Buscar NF
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={modoBusca === 'xml'}
            className={`saida-modo-btn${modoBusca === 'xml' ? ' saida-modo-btn--active' : ''}`}
            onClick={() => onModoBuscaChange('xml')}
            disabled={modoPalete}
          >
            XML de saída
          </button>
        </div>

        {modoBusca === 'numero' ? (
          <>
            <div className="saida-busca">
              <input
                type="text"
                className="input-nf"
                placeholder="Número da NF"
                value={numero}
                onChange={(e) => setNumero(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleBuscar()}
                disabled={modoPalete}
              />
              <button type="button" className="btn primary" onClick={handleBuscar} disabled={modoPalete}>
                Buscar
              </button>
            </div>
            {buscaErro && <p className="error">{buscaErro}</p>}
          </>
        ) : (
          <>
            <p className="muted">
              Suba o XML da NF de saída, vincule à NF de origem já endereçada no sistema e siga o
              processo normal.
            </p>
            {!saidaXml && (
              <label className="upload-btn">
                <input
                  type="file"
                  accept=".xml,text/xml,application/xml"
                  hidden
                  onChange={handleFile}
                  disabled={modoPalete}
                />
                Subir XML da NF de saída
              </label>
            )}
            {uploadXmlErro && <p className="error">{uploadXmlErro}</p>}
          </>
        )}
      </div>

      {modoBusca === 'xml' && saidaXml && (
        <div className="sidebar-block nf-detail saida-xml-doc">
          <h3 className="nf-section-title nf-section-title--sm">NF de saída {saidaXml.numero}</h3>
          <dl className="meta-list meta-list--nf">
            <div>
              <dt>Emitente</dt>
              <dd>{saidaXml.emitente || '—'}</dd>
            </div>
            <div>
              <dt>Emissão</dt>
              <dd>{formatDate(saidaXml.dataEmissao)}</dd>
            </div>
            {saidaXml.serie && (
              <div>
                <dt>Série</dt>
                <dd>{saidaXml.serie}</dd>
              </div>
            )}
          </dl>

          {aguardandoVinculo && referencias.length > 0 && (
            <div className="saida-referencias">
              <p className="saida-referencias-titulo">
                Este XML referencia {referencias.length}{' '}
                {referencias.length === 1 ? 'nota fiscal' : 'notas fiscais'}.{' '}
                {refsComEstoque.length > 0 ? (
                  <>
                    Você tem <strong>{refsComEstoque.length}</strong> para dar saída:
                  </>
                ) : (
                  'Nenhuma delas está com estoque no sistema.'
                )}
              </p>
              <ul className="saida-referencias-lista">
                {referencias.map((ref) => (
                  <li key={ref.chave}>
                    {ref.nf ? (
                      <button
                        type="button"
                        className="saida-referencia-btn"
                        onClick={() => onSelecionarReferencia(ref.nf!.id)}
                        disabled={modoPalete}
                      >
                        <span className="saida-referencia-num">NF {ref.numero}</span>
                        <span className="muted saida-referencia-emit"> · {ref.nf.emitente || '—'}</span>
                        <NfLocalizacaoBadge nf={ref.nf} />
                        <span className="saida-referencia-acao">Dar saída ›</span>
                      </button>
                    ) : (
                      <span className="saida-referencia-indisponivel muted">
                        NF {ref.numero} — sem estoque no sistema
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {aguardandoVinculo && (
            <div className="saida-vinculo-origem">
              <p className="muted saida-vinculo-intro">
                {referencias.length > 0
                  ? 'Ou escolha manualmente a NF de origem no estoque:'
                  : 'Vincule à NF de origem no estoque:'}
              </p>
              {notasOrigem.length === 0 ? (
                <p className="error">Nenhuma NF com estoque endereçado no sistema.</p>
              ) : (
                <>
                  <select
                    className="input-nf saida-vinculo-select"
                    value={origemSelecionadaId}
                    onChange={(e) => onOrigemSelecionadaChange(e.target.value)}
                    disabled={modoPalete}
                  >
                    <option value="">Selecione a NF de origem…</option>
                    {notasOrigem.map((nf) => (
                      <option key={nf.id} value={nf.id}>
                        NF {nf.numero} · {nf.emitente || '—'}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn primary full"
                    disabled={!origemSelecionadaId || modoPalete}
                    onClick={onVincularOrigem}
                  >
                    Vincular e listar itens
                  </button>
                </>
              )}
              {buscaErro && <p className="error">{buscaErro}</p>}
            </div>
          )}
        </div>
      )}

      {nfBusca && nfTemEstoqueSaida && itensComEstoque.length > 0 && (
        <div className="sidebar-block nf-detail">
          {origemEstoque === 'stage' && (
            <p className="stage-modo-badge">Saída do stage</p>
          )}
          <div className="nf-detail-head">
            <div>
              <h3 className="nf-detail-title-row">
                {saidaXml ? (
                  <>
                    Saída NF {saidaXml.numero}
                    <span className="muted saida-origem-ref">
                      {' '}
                      · origem NF {nfBusca.numero}
                    </span>
                    <NfLocalizacaoBadge nf={nfBusca} />
                  </>
                ) : (
                  <>
                    NF {nfBusca.numero}
                    <NfLocalizacaoBadge nf={nfBusca} />
                  </>
                )}
              </h3>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setConfirmarCancelar(true)}
            >
              Cancelar saída
            </button>
          </div>

          {vinculoAvisos.length > 0 && (
            <ul className="saida-vinculo-avisos">
              {vinculoAvisos.map((msg) => (
                <li key={msg} className="muted">
                  {msg}
                </li>
              ))}
            </ul>
          )}

          <dl className="meta-list meta-list--nf">
            <div>
              <dt>Emitente (origem)</dt>
              <dd>{nfBusca.emitente || '—'}</dd>
            </div>
            <div>
              <dt>Emissão (origem)</dt>
              <dd>{formatDate(nfBusca.dataEmissao)}</dd>
            </div>
            {nfBusca.serie && (
              <div>
                <dt>Série</dt>
                <dd>{nfBusca.serie}</dd>
              </div>
            )}
          </dl>

          {saidaXml ? (
            <>
              <p className="nf-leitura-subtitle">Totais da NF de saída</p>
              <NfResumoGrid
                nf={{
                  ...nfBusca,
                  pesoBruto: saidaXml.pesoBruto ?? nfBusca.pesoBruto,
                  pesoLiquido: saidaXml.pesoLiquido ?? nfBusca.pesoLiquido,
                  valorTotalNota: saidaXml.valorTotalNota ?? nfBusca.valorTotalNota,
                }}
                compact
              />
            </>
          ) : (
            <>
              <p className="nf-leitura-subtitle">Totais do documento</p>
              <NfResumoGrid nf={nfBusca} compact />
            </>
          )}

          <div className="saida-itens-section-head">
            <div className="saida-itens-section-copy">
              <h4 className="nf-section-title nf-section-title--sm">Itens da saída</h4>
              <p className="muted nf-itens-intro saida-itens-intro">
                {origemEstoque === 'stage'
                  ? 'Clique no item no stage, informe a quantidade e confirme.'
                  : saidaXml
                    ? 'Itens do XML de saída vinculados ao estoque da NF de origem. A quantidade máxima por item segue o XML.'
                    : 'Clique no item que vai sair (linha fica verde). Informe os paletes abaixo de cada item.'}
              </p>
            </div>
            <label className="nf-itens-campo entrada-data-armazenagem-row saida-data-row">
              <span>Data da saída</span>
              <input
                type="date"
                className="input-nf input-nf--compact nf-data-armazenagem-input"
                value={dataSaidaInput}
                onChange={(e) => onDataSaidaChange(e.target.value)}
              />
            </label>
          </div>

          {origemEstoque === 'stage' ? (
            <>
              <ul className="saida-stage-itens">
                {itensComEstoque.map((item) => {
                  const ativo = stageItemIndex === item.index
                  const confirmado = stageConfirmados.some((s) => s.itemIndex === item.index)
                  return (
                    <li key={item.index}>
                      <button
                        type="button"
                        className={`saida-stage-item${ativo ? ' saida-stage-item--active' : ''}${confirmado ? ' saida-stage-item--done' : ''}`}
                        onClick={() => onSelectItemStage(item.index)}
                        disabled={confirmado}
                      >
                        <strong>{item.codigo}</strong>
                        <span className="muted"> — {item.descricao}</span>
                        <span className="saida-stage-qtd">
                          {formatQuantidadeNfe(quantidadeEstoqueItem(item))} {item.unidade}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>

              {stageItemIndex != null && (() => {
                const itemStage = nfBusca.items.find((it) => it.index === stageItemIndex)
                const qtdSaida = parseQuantidadeSaida(stageQtdInput)
                const calcStage =
                  itemStage && qtdSaida != null && qtdSaida > 0
                    ? calcularSaidaStageItem(nfBusca, itemStage, qtdSaida)
                    : null
                const unidadeStage = itemStage ? unidadeEstoqueItem(itemStage) : ''
                return (
                  <div className="item-actions saida-stage-form">
                    {itemStage && (
                      <SaidaItemEntradaResumo
                        nf={nfBusca}
                        item={itemStage}
                        stageConfirmados={stageConfirmados}
                      />
                    )}
                    <label className="nf-itens-campo">
                      <span>Quantidade de saída</span>
                      <input
                        type="text"
                        className="input-nf"
                        value={stageQtdInput}
                        onChange={(e) => onStageQtdChange(e.target.value)}
                      />
                    </label>
                    <div className="saida-item-calculo-grid saida-stage-calculo">
                      <div className="saida-item-campo saida-item-campo--calc">
                        <span className="muted">Saindo</span>
                        <strong className={calcStage ? 'saida-valor--saindo' : undefined}>
                          {calcStage
                            ? `${formatQuantidadeNfe(calcStage.quantidadeSaida)} ${unidadeStage}`
                            : '—'}
                        </strong>
                      </div>
                      <div className="saida-item-campo saida-item-campo--calc">
                        <span className="muted">P. bruto saindo</span>
                        <strong>
                          {calcStage?.pesoBrutoSaida != null
                            ? `${formatPesoBruto(calcStage.pesoBrutoSaida)} kg`
                            : '—'}
                        </strong>
                      </div>
                      <div className="saida-item-campo saida-item-campo--calc">
                        <span className="muted">P. líquido saindo</span>
                        <strong>
                          {calcStage?.pesoLiquidoSaida != null
                            ? `${formatPesoBruto(calcStage.pesoLiquidoSaida)} kg`
                            : '—'}
                        </strong>
                      </div>
                      <div className="saida-item-campo saida-item-campo--calc">
                        <span className="muted">V. total saindo</span>
                        <strong className={calcStage?.valorTotalSaida ? 'saida-valor--saindo' : undefined}>
                          {calcStage?.valorTotalSaida != null
                            ? formatValorNfe(calcStage.valorTotalSaida)
                            : '—'}
                        </strong>
                      </div>
                      <div className="saida-item-campo saida-item-campo--calc">
                        <span className="muted">Sobra</span>
                        <strong className="saida-valor--sobra">
                          {calcStage
                            ? `${formatQuantidadeNfe(calcStage.quantidadeSobra)} ${unidadeStage}`
                            : '—'}
                        </strong>
                      </div>
                    </div>
                    {selecaoErro && <p className="error">{selecaoErro}</p>}
                    <button type="button" className="btn primary full" onClick={onConfirmarItemStage}>
                      Confirmar item
                    </button>
                  </div>
                )
              })()}

              {stageConfirmados.length > 0 && (
                <ul className="saida-stage-confirmados">
                  {stageConfirmados.map((s) => {
                    const item = nfBusca.items.find((it) => it.index === s.itemIndex)
                    if (!item) return null
                    const calc = calcularSaidaStageItem(nfBusca, item, s.quantidadeSaida)
                    return (
                      <li key={s.itemIndex}>
                        <span>
                          {item.codigo} — {formatQuantidadeNfe(s.quantidadeSaida)}{' '}
                          {unidadeEstoqueItem(item)}
                          {calc?.pesoBrutoSaida != null && (
                            <span className="muted"> · {formatPesoBruto(calc.pesoBrutoSaida)} kg</span>
                          )}
                          {calc?.valorTotalSaida != null && (
                            <span className="muted"> · {formatValorNfe(calc.valorTotalSaida)}</span>
                          )}
                        </span>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => onRemoverItemStage(s.itemIndex)}
                        >
                          Remover
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          ) : (
          <SaidaItensTable
            nf={nfBusca}
            items={itensComEstoque}
            limitesPorItem={limitesPorItem}
            activeItemIndex={itemIndex}
            paletesConfirmados={paletesConfirmados}
            paleteAtivo={paleteAtivo}
            paletesConfirmadosIds={paletesConfirmados.map((p) => p.addressId)}
            paletesSelecionadosIds={paletesSelecionados}
            modoPalete={modoPalete}
            qtdPaletesInput={qtdPaletesInput}
            qtdPaletesAlvo={qtdPaletesAlvo}
            selecaoConcluida={selecaoConcluida}
            caixasInput={caixasPalete}
            onSelectItem={onSelectItem}
            onQtdPaletesChange={onQtdPaletesChange}
            onIniciarSelecao={onIniciarSelecao}
            onConfirmarSelecaoPaletes={onConfirmarSelecaoPaletes}
            onCaixasChange={onCaixasPaleteChange}
            onConfirmarPalete={onConfirmarPalete}
            onRemoverPalete={onRemoverPalete}
            selecaoErro={selecaoErro}
          />
          )}

          {origemEstoque !== 'stage' && paletesConfirmados.length > 0 && (
            <SaidaResumoTotal
              nf={nfBusca}
              paletesConfirmados={paletesConfirmados}
              limitesPorItem={limitesPorItem}
            />
          )}

          {(origemEstoque === 'stage' ? stageConfirmados.length > 0 : paletesConfirmados.length > 0) && (
            <div className="item-actions">
              <fieldset className="saida-justificativa">
                <legend className="saida-justificativa-title">Motivo da saída</legend>
                <ul className="saida-justificativa-list">
                  {JUSTIFICATIVAS_SAIDA.map((opt) => (
                    <li key={opt.id}>
                      <label className="saida-justificativa-option">
                        <input
                          type="radio"
                          name="justificativa-saida"
                          value={opt.id}
                          checked={justificativa === opt.id}
                          onChange={() => setJustificativa(opt.id)}
                        />
                        <span>{opt.label}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>

              {selecaoErro && <p className="error">{selecaoErro}</p>}

              <button
                type="button"
                className="btn warning full"
                disabled={!podeFinalizar || !dataSaidaInput.trim()}
                onClick={() => {
                  if (!justificativa || !dataSaidaInput.trim()) return
                  if (origemEstoque === 'stage') onFinalizarSaidaStage(justificativa, dataSaidaInput)
                  else onFinalizarSaida(justificativa, dataSaidaInput)
                }}
              >
                Finalizar saída
              </button>
            </div>
          )}
        </div>
      )}

      {nfBusca && (!nfTemEstoqueSaida || itensComEstoque.length === 0) && (
        <div className="sidebar-block nf-detail">
          <div className="nf-detail-head">
            <h3 className="nf-detail-title-row">
              NF {nfBusca.numero}
              <NfLocalizacaoBadge nf={nfBusca} />
            </h3>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setConfirmarCancelar(true)}
            >
              Cancelar saída
            </button>
          </div>
          <p className="muted sidebar-block">
            {origemEstoque === 'stage'
              ? 'Esta NF não possui itens no stage.'
              : saidaXml
                ? 'Nenhum item do XML foi encontrado com estoque na NF de origem vinculada.'
                : 'Esta NF não possui itens em estoque (posições já liberadas).'}
          </p>
        </div>
      )}

      {confirmarCancelar && (nfBusca || saidaXml) && (
        <div className="confirm-backdrop" onClick={() => setConfirmarCancelar(false)}>
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <h4>Cancelar saída?</h4>
            <p>
              {saidaXml ? (
                <>
                  Saída NF <strong>{saidaXml.numero}</strong>
                  {nfBusca && (
                    <>
                      {' '}
                      (origem NF <strong>{nfBusca.numero}</strong>)
                    </>
                  )}
                </>
              ) : (
                <>
                  NF <strong>{nfBusca?.numero}</strong>
                </>
              )}
            </p>
            <p className="confirm-warn">
              A busca e os paletes confirmados serão descartados. Nenhuma posição será liberada.
            </p>
            <div className="confirm-actions">
              <button type="button" className="btn" onClick={() => setConfirmarCancelar(false)}>
                Voltar
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  onCancelarSaida()
                  setConfirmarCancelar(false)
                  setNumero('')
                }}
              >
                Cancelar saída
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function formatDate(raw: string): string {
  if (!raw) return '—'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10)
  return d.toLocaleString('pt-BR')
}
