import { useEffect, useMemo, useState } from 'react'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { formatAddressLabel } from '../layout/camaras'
import { contagemPaletesItem, rotuloPaletes, rotuloPosicoes } from '../lib/paletes'
import {
  CONSULTA_FILTROS_VAZIOS,
  type ConsultaEstoqueFiltros,
  type ConsultaEstoqueResultado,
  type ConsultaOrigemEstoque,
} from '../lib/consultaEstoque'
import { STAGE_LABEL } from '../layout/stage'
import type { ItemManualInput } from '../lib/adicionarItemNf'
import type { NotaFiscal } from '../types'
import { ConsultaEstoqueInventario } from './ConsultaEstoqueInventario'
import { ConsultaItemManualForm } from './ConsultaItemManualForm'
import { ConsultaPaletesForm } from './ConsultaPaletesForm'
import { NfDetalheLeitura } from './NfDetalheLeitura'

type Props = {
  notas: NotaFiscal[]
  emitentesSugeridos: string[]
  resultados: ConsultaEstoqueResultado[]
  buscaErro: string | null
  onBuscar: (filtros: ConsultaEstoqueFiltros) => void
  onLimpar: () => void
  onAlternarDestaqueInventario: (resultados: ConsultaEstoqueResultado[]) => void
  resultadosDestacados: ConsultaEstoqueResultado[]
  nfAdicionar: NotaFiscal | null
  nfAdicionarErro: string | null
  itemAdicionadoMsg: string | null
  itemManualErro: string | null
  aguardandoEndereco: boolean
  paletesTotal: number | null
  enderecosSelecionados: number
  onBuscarNfAdicionar: (numero: string) => void
  onReplicarItem: (itemIndex: number, paletes: number) => void
  onExcluirItem: (itemIndex: number) => void
  onAdicionarItemManual: (input: ItemManualInput) => void
  onConfirmarEnderecos: () => void
  onCancelarEnderecos: () => void
  onLimparNfAdicionar: () => void
  filtrosAplicados?: ConsultaEstoqueFiltros
  filtrosAplicadosTick?: number
}

export function ConsultaEstoquePanel({
  notas,
  emitentesSugeridos,
  resultados,
  buscaErro,
  onBuscar,
  onLimpar,
  onAlternarDestaqueInventario,
  resultadosDestacados,
  nfAdicionar,
  nfAdicionarErro,
  itemAdicionadoMsg,
  itemManualErro,
  aguardandoEndereco,
  paletesTotal,
  enderecosSelecionados,
  onBuscarNfAdicionar,
  onReplicarItem,
  onExcluirItem,
  onAdicionarItemManual,
  onConfirmarEnderecos,
  onCancelarEnderecos,
  onLimparNfAdicionar,
  filtrosAplicados,
  filtrosAplicadosTick = 0,
}: Props) {
  const [filtros, setFiltros] = useState<ConsultaEstoqueFiltros>(CONSULTA_FILTROS_VAZIOS)
  const [modo, setModo] = useState<'pesquisa' | 'inventario'>('pesquisa')
  const [numeroNf, setNumeroNf] = useState('')
  const [mostrarFormManual, setMostrarFormManual] = useState(false)
  const [replicarDeIndex, setReplicarDeIndex] = useState<number | null>(null)
  const [itemExcluirIndex, setItemExcluirIndex] = useState<number | null>(null)

  useBodyScrollLock(itemExcluirIndex != null)

  useEffect(() => {
    if (!filtrosAplicados) return
    setFiltros(filtrosAplicados)
  }, [filtrosAplicados, filtrosAplicadosTick])

  const itemExcluir =
    nfAdicionar && itemExcluirIndex != null
      ? nfAdicionar.items.find((it) => it.index === itemExcluirIndex) ?? null
      : null

  function patch(partial: Partial<ConsultaEstoqueFiltros>) {
    setFiltros((prev) => ({ ...prev, ...partial }))
  }

  function handleBuscar() {
    onBuscar(filtros)
  }

  function handleLimpar() {
    setFiltros(CONSULTA_FILTROS_VAZIOS)
    onLimpar()
  }

  function handleBuscarNf() {
    onBuscarNfAdicionar(numeroNf.trim())
    setNumeroNf('')
  }

  const agrupados = agruparPorNf(resultados)

  const nfPorId = useMemo(() => new Map(notas.map((n) => [n.id, n])), [notas])

  const enderecosDestaque = useMemo(
    () => new Set(resultados.map((r) => r.addressId)),
    [resultados],
  )

  return (
    <>
      <div className="consulta-modo-tabs" role="tablist" aria-label="Modo da consulta">
        <button
          type="button"
          role="tab"
          aria-selected={modo === 'pesquisa'}
          className={`consulta-modo-tab${modo === 'pesquisa' ? ' is-active' : ''}`}
          onClick={() => setModo('pesquisa')}
        >
          Pesquisa
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={modo === 'inventario'}
          className={`consulta-modo-tab${modo === 'inventario' ? ' is-active' : ''}`}
          onClick={() => setModo('inventario')}
        >
          Inventário completo
        </button>
      </div>

      {modo === 'inventario' ? (
        <div className="sidebar-block">
          <p className="muted consulta-inventario-intro">
            Todas as notas com itens armazenados no painel. Use a visão resumida para uma lista
            rápida ou detalhada para ver lote, datas e posições de cada item.
          </p>
          <ConsultaEstoqueInventario
            notas={notas}
            resultadosDestacados={resultadosDestacados}
            onAlternarDestaque={onAlternarDestaqueInventario}
          />
        </div>
      ) : (
        <>
      <div className="sidebar-block">
        <div className="consulta-filtros">
          <label className="consulta-campo">
            <span>Nota fiscal</span>
            <input
              type="text"
              className="input-nf"
              placeholder="Número da NF"
              value={filtros.nfNumero}
              onChange={(e) => patch({ nfNumero: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && handleBuscar()}
            />
          </label>

          <label className="consulta-campo">
            <span>Item</span>
            <input
              type="text"
              className="input-nf"
              placeholder="Código ou descrição"
              value={filtros.item}
              onChange={(e) => patch({ item: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && handleBuscar()}
            />
          </label>

          <label className="consulta-campo">
            <span>Remetente</span>
            <input
              type="text"
              className="input-nf"
              placeholder="Nome do remetente"
              list="consulta-emitentes"
              value={filtros.remetente}
              onChange={(e) => patch({ remetente: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && handleBuscar()}
            />
            <datalist id="consulta-emitentes">
              {emitentesSugeridos.map((e) => (
                <option key={e} value={e} />
              ))}
            </datalist>
          </label>

          <label className="consulta-campo">
            <span>Lote</span>
            <input
              type="text"
              className="input-nf"
              placeholder="Lote do item"
              value={filtros.lote}
              onChange={(e) => patch({ lote: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && handleBuscar()}
            />
          </label>

          <fieldset className="consulta-origem-fieldset">
            <legend className="consulta-campo-label">Onde pesquisar</legend>
            <div className="consulta-origem-opcoes">
              {(
                [
                  ['armazem', 'Armazém físico'],
                  ['stage', 'Stage (separação)'],
                  ['ambos', 'Ambos'],
                ] as const
              ).map(([id, label]) => (
                <label key={id} className="consulta-origem-option">
                  <input
                    type="radio"
                    name="consulta-origem"
                    checked={filtros.origem === id}
                    onChange={() => patch({ origem: id as ConsultaOrigemEstoque })}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="consulta-actions">
          <button type="button" className="btn primary" onClick={handleBuscar}>
            Pesquisar
          </button>
          <button type="button" className="btn btn-ghost" onClick={handleLimpar}>
            Limpar
          </button>
        </div>

        {buscaErro && <p className="error">{buscaErro}</p>}
      </div>

      {resultados.length > 0 && (
        <div className="sidebar-block consulta-resultados-block">
          <h3>
            {resultados.length}{' '}
            {resultados.some((r) => r.isStage) && !resultados.some((r) => !r.isStage)
              ? resultados.length === 1
                ? 'item no stage'
                : 'itens no stage'
              : resultados.length === 1
                ? 'endereço encontrado'
                : 'endereços encontrados'}
          </h3>
          <ul className="consulta-resultados">
            {agrupados.map((grupo) => {
              const nf = nfPorId.get(grupo.nfId)
              const enderecosGrupo = new Set(grupo.itens.flatMap((it) => it.enderecos))

              return (
                <li key={grupo.nfId} className="consulta-grupo nf-detail">
                  {nf ? (
                    <NfDetalheLeitura
                      nf={nf}
                      highlightAddresses={enderecosDestaque}
                      itensIntro="Endereços destacados em verde correspondem aos filtros da pesquisa."
                    />
                  ) : (
                    <p className="consulta-grupo-titulo">
                      <strong>NF {grupo.nfNumero}</strong>
                      <span className="muted"> · {grupo.emitente}</span>
                    </p>
                  )}

                  <h4 className="nf-section-title nf-section-title--sm consulta-enderecos-titulo">
                    Endereços na pesquisa
                  </h4>
                  <ul className="consulta-grupo-itens">
                    {grupo.itens.map((item) => {
                      const itemNf = nf?.items.find((it) => it.index === item.itemIndex)
                      const paletesItem = itemNf
                        ? contagemPaletesItem(itemNf)
                        : item.enderecos.length

                      return (
                      <li key={`${grupo.nfId}-${item.itemIndex}`}>
                        <span className="consulta-item-codigo">{item.codigo}</span>
                        <span className="muted"> — {item.descricao}</span>
                        {(item.lote || item.up) && (
                          <span className="consulta-item-meta">
                            {item.lote ? ` · Lote ${item.lote}` : ''}
                            {item.up ? ` · UP ${item.up}` : ''}
                          </span>
                        )}
                        {!item.isStage && item.enderecos.length > 0 && (
                          <span className="consulta-item-meta">
                            {' '}
                            · {rotuloPosicoes(item.enderecos.length)} · {rotuloPaletes(paletesItem)}
                          </span>
                        )}
                        <ul className="consulta-enderecos">
                          {item.enderecos.map((addr) => (
                            <li key={addr} className={enderecosGrupo.has(addr) ? 'addr-flagged' : ''}>
                              {item.isStage
                                ? `${STAGE_LABEL} · Stage`
                                : `${formatAddressLabel(addr)} · Físico`}
                            </li>
                          ))}
                        </ul>
                      </li>
                      )
                    })}
                  </ul>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="sidebar-block consulta-adicionar">
        <h3 className="consulta-section-title">Adicionar mais itens em um novo endereço</h3>
        <div className="saida-busca">
          <input
            type="text"
            className="input-nf"
            placeholder="Número da NF"
            value={numeroNf}
            onChange={(e) => setNumeroNf(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleBuscarNf()}
          />
          <button type="button" className="btn primary" onClick={handleBuscarNf}>
            Buscar
          </button>
        </div>
        {nfAdicionarErro && <p className="error">{nfAdicionarErro}</p>}
        {itemAdicionadoMsg && <p className="consulta-sucesso">{itemAdicionadoMsg}</p>}

        {aguardandoEndereco && (
          <div className="consulta-enderecar-box">
            <p className="consulta-enderecar-titulo">Selecione as posições no painel</p>
            <p className="muted consulta-enderecar-texto">
              Clique nas células <strong>disponíveis</strong> (brancas) no mapa ao lado para indicar
              onde o item será guardado. Você deve marcar{' '}
              <strong>
                {paletesTotal ?? 0} posição{paletesTotal === 1 ? '' : 'ões'}
              </strong>{' '}
              — uma para cada palete informado.
            </p>
            <p className="consulta-enderecar-contagem">
              {enderecosSelecionados} de {paletesTotal ?? 0} selecionada(s)
            </p>
            <div className="consulta-enderecar-actions">
              <button type="button" className="btn btn-ghost" onClick={onCancelarEnderecos}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn success"
                onClick={onConfirmarEnderecos}
                disabled={enderecosSelecionados === 0}
              >
                Confirmar posições
              </button>
            </div>
          </div>
        )}

        {nfAdicionar && (
          <div className="consulta-nf-adicionar nf-detail">
            <div className="consulta-nf-adicionar-head">
              <button type="button" className="btn btn-ghost btn-sm" onClick={onLimparNfAdicionar}>
                Limpar
              </button>
            </div>
            <NfDetalheLeitura
              nf={nfAdicionar}
              showItensTable={false}
              showItensTitle={false}
              itensIntro="Replique um item existente ou adicione um item manual:"
            />
            <ul className="consulta-itens-adicionar">
              {nfAdicionar.items.map((item) => {
                const podeExcluir =
                  nfAdicionar.items.length > 1 || item.allocatedAddresses.length === 0
                return (
                <li key={item.index}>
                  <div className="consulta-item-adicionar-row">
                    <div className="consulta-item-adicionar-info">
                      <span className="consulta-item-codigo">{item.codigo}</span>
                      <span className="muted"> — {item.descricao}</span>
                      {(item.lote || item.up) && (
                        <span className="consulta-item-meta">
                          {item.lote ? ` · Lote ${item.lote}` : ''}
                          {item.up ? ` · UP ${item.up}` : ''}
                        </span>
                      )}
                      {item.allocatedAddresses.length > 0 && (
                        <span className="consulta-item-meta">
                          {' '}
                          · {item.allocatedAddresses.length} endereço(s) ·{' '}
                          {contagemPaletesItem(item)} palete(s)
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="consulta-item-remove"
                      title={
                        podeExcluir
                          ? 'Excluir item'
                          : 'O último item com endereços não pode ser excluído'
                      }
                      disabled={!podeExcluir}
                      aria-label="Excluir item"
                      onClick={() => podeExcluir && setItemExcluirIndex(item.index)}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                  <div className="consulta-item-adicionar-actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={aguardandoEndereco}
                      onClick={() => setReplicarDeIndex(item.index)}
                    >
                      Replicar item
                    </button>
                  </div>
                </li>
                )
              })}
            </ul>

            {!mostrarFormManual && replicarDeIndex == null ? (
              <button
                type="button"
                className="btn btn-ghost consulta-btn-adicionar"
                disabled={aguardandoEndereco}
                onClick={() => setMostrarFormManual(true)}
              >
                + Adicionar item manual
              </button>
            ) : replicarDeIndex != null ? (
              <ConsultaPaletesForm
                titulo="Replicar item"
                descricao={
                  nfAdicionar.items.find((it) => it.index === replicarDeIndex)
                    ? `${nfAdicionar.items.find((it) => it.index === replicarDeIndex)!.codigo} — ${nfAdicionar.items.find((it) => it.index === replicarDeIndex)!.descricao}`
                    : undefined
                }
                botaoConfirmar="Replicar e endereçar"
                erro={itemManualErro}
                onCancel={() => setReplicarDeIndex(null)}
                onConfirm={(paletes) => {
                  onReplicarItem(replicarDeIndex, paletes)
                  setReplicarDeIndex(null)
                }}
              />
            ) : (
              <ConsultaItemManualForm
                erro={itemManualErro}
                onCancel={() => setMostrarFormManual(false)}
                onConfirm={(input) => {
                  onAdicionarItemManual(input)
                  setMostrarFormManual(false)
                }}
              />
            )}
          </div>
        )}

      {itemExcluir && nfAdicionar && (
        <div className="confirm-backdrop" onClick={() => setItemExcluirIndex(null)}>
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <h4>Excluir item?</h4>
            <p>
              <strong>{itemExcluir.codigo}</strong>
              <span className="muted"> — {itemExcluir.descricao}</span>
            </p>
            {itemExcluir.allocatedAddresses.length > 0 ? (
              <p className="confirm-warn">
                Este item tem {itemExcluir.allocatedAddresses.length} endereço(s) alocado(s). Eles
                serão liberados no painel.
              </p>
            ) : (
              <p className="muted">A linha será removida da NF {nfAdicionar.numero}.</p>
            )}
            <div className="confirm-actions">
              <button type="button" className="btn" onClick={() => setItemExcluirIndex(null)}>
                Voltar
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  onExcluirItem(itemExcluir.index)
                  setItemExcluirIndex(null)
                }}
              >
                Excluir item
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
        </>
      )}
    </>
  )
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 3h6m-8 4h10m-1 0-.7 12.1a2 2 0 0 1-2 1.9H9.7a2 2 0 0 1-2-1.9L7 7m3 4v5m4-5v5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

type GrupoNf = {
  nfId: string
  nfNumero: string
  emitente: string
  itens: Array<{
    itemIndex: number
    codigo: string
    descricao: string
    lote?: string
    up?: string
    enderecos: string[]
    isStage?: boolean
  }>
}

function agruparPorNf(resultados: ConsultaEstoqueResultado[]): GrupoNf[] {
  const porNf = new Map<string, GrupoNf>()

  for (const r of resultados) {
    let grupo = porNf.get(r.nfId)
    if (!grupo) {
      grupo = { nfId: r.nfId, nfNumero: r.nfNumero, emitente: r.emitente, itens: [] }
      porNf.set(r.nfId, grupo)
    }

    let item = grupo.itens.find((it) => it.itemIndex === r.itemIndex)
    if (!item) {
      item = {
        itemIndex: r.itemIndex,
        codigo: r.codigo,
        descricao: r.descricao,
        ...(r.lote ? { lote: r.lote } : {}),
        ...(r.up ? { up: r.up } : {}),
        ...(r.isStage ? { isStage: true } : {}),
        enderecos: [],
      }
      grupo.itens.push(item)
    }
    if (!item.enderecos.includes(r.addressId)) item.enderecos.push(r.addressId)
  }

  return [...porNf.values()]
}
