import { useState } from 'react'
import { useBodyScrollLock } from '../hooks/useBodyScrollLock'
import { MOTIVOS_REMOCAO_ESTOQUE } from '../lib/motivoRemocaoEstoque'
import { parsePaletesInput } from '../lib/paletes'
import type { AddressId, MotivoRemocaoEstoqueId, NotaFiscal } from '../types'
import { itemNoStage } from '../layout/stage'
import { itemMovimentavel, itensMovimentaveisDaNf } from '../lib/movimentacaoItens'
import { nfTemEstoqueArmazem, nfTemEstoqueStage, itensStageDaNf } from '../lib/stageEstoque'
import { NfDetalheLeitura } from './NfDetalheLeitura'
import { EnderecoDestinoForm } from './EnderecoDestinoForm'
import { MovimentacaoVozControle } from './MovimentacaoVozControle'
import { formatQuantidadeNfe } from '../lib/formatNfeItem'

export type ModoMovimentacao = 'reposicionar' | 'enviar-stage' | 'tirar-stage'

type Props = {
  nfBusca: NotaFiscal | null
  itemIndex: number | null
  pendingCount: number
  stagePendingCount: number
  moveOrigensCount: number
  moveDestinosCount: number
  salvando?: boolean
  vozOrigemAddress: AddressId | null
  vozErro: string | null
  marcandoStage: boolean
  modoMovimentacao: ModoMovimentacao
  onModoMovimentacaoChange: (modo: ModoMovimentacao) => void
  onSelectVozOrigem: (addressId: AddressId, itemIndex: number) => void
  onVozDestino: (transcript: string) => boolean
  onVozErro: (message: string) => void
  onLimparVozErro: () => void
  onPrepareLocalSpeech?: () => void
  onReleaseLocalSpeech?: () => void
  enderecosOcupados: Set<AddressId>
  enderecosSelecionados: Set<AddressId>
  onBuscar: (numero: string) => void
  onSelectItem: (index: number) => void
  onAdicionarEnderecoDestino: (addressId: AddressId) => void
  onSalvar: () => boolean | Promise<boolean>
  onRemoverDoEstoque: (nfId: string, motivo: MotivoRemocaoEstoqueId) => void | Promise<void>
  onCancelarEditar: () => void
  adicionarPosicoesAlvo: number | null
  adicionarPosicoesSelecionadas: number
  onIniciarAdicionarPosicoes: (itemIndex: number, quantidade: number) => void
  onConfirmarAdicionarPosicoes: () => void | Promise<void>
  onCancelarAdicionarPosicoes: () => void
  buscaErro: string | null
}

export function EditarPosicaoPanel({
  nfBusca,
  itemIndex,
  pendingCount,
  stagePendingCount,
  moveOrigensCount,
  moveDestinosCount,
  salvando = false,
  vozOrigemAddress,
  vozErro,
  marcandoStage,
  modoMovimentacao,
  onModoMovimentacaoChange,
  onSelectVozOrigem,
  onVozDestino,
  onVozErro,
  onLimparVozErro,
  onPrepareLocalSpeech,
  onReleaseLocalSpeech,
  enderecosOcupados,
  enderecosSelecionados,
  onBuscar,
  onSelectItem,
  onAdicionarEnderecoDestino,
  onSalvar,
  onRemoverDoEstoque,
  onCancelarEditar,
  adicionarPosicoesAlvo,
  adicionarPosicoesSelecionadas,
  onIniciarAdicionarPosicoes,
  onConfirmarAdicionarPosicoes,
  onCancelarAdicionarPosicoes,
  buscaErro,
}: Props) {
  const [numero, setNumero] = useState('')
  const [confirmarCancelar, setConfirmarCancelar] = useState(false)
  const [confirmarRemover, setConfirmarRemover] = useState(false)
  const [motivoRemocao, setMotivoRemocao] = useState<MotivoRemocaoEstoqueId | null>(null)
  const [removendoEstoque, setRemovendoEstoque] = useState(false)
  const [modalAdicionar, setModalAdicionar] = useState(false)
  const [qtdPosicoesInput, setQtdPosicoesInput] = useState('')
  const [itemAdicionarIndex, setItemAdicionarIndex] = useState<number | null>(null)
  const [adicionarErro, setAdicionarErro] = useState<string | null>(null)
  useBodyScrollLock(confirmarCancelar || confirmarRemover || modalAdicionar)

  function handleBuscar() {
    onBuscar(numero.trim())
    setNumero('')
  }

  function fecharRemover() {
    setConfirmarRemover(false)
    setMotivoRemocao(null)
  }

  const itensArmazem =
    nfBusca?.items.filter((it) => !itemNoStage(it) && it.allocatedAddresses.length > 0) ?? []

  function abrirModalAdicionar() {
    setAdicionarErro(null)
    setQtdPosicoesInput('')
    const padrao =
      itemIndex != null && itensArmazem.some((it) => it.index === itemIndex)
        ? itemIndex
        : itensArmazem.length === 1
          ? itensArmazem[0].index
          : null
    setItemAdicionarIndex(padrao)
    setModalAdicionar(true)
  }

  function confirmarModalAdicionar() {
    const qtd = parsePaletesInput(qtdPosicoesInput)
    if (!qtd || qtd <= 0) {
      setAdicionarErro('Informe quantas posições deseja adicionar.')
      return
    }
    if (itemAdicionarIndex == null) {
      setAdicionarErro('Selecione o item.')
      return
    }
    onIniciarAdicionarPosicoes(itemAdicionarIndex, qtd)
    setModalAdicionar(false)
    setAdicionarErro(null)
  }

  const adicionandoPosicoes = adicionarPosicoesAlvo != null
  const adicionarCompleto =
    adicionandoPosicoes && adicionarPosicoesSelecionadas === adicionarPosicoesAlvo

  const nfActions = nfBusca ? (
    <div className="nf-detail-actions">
      <button
        type="button"
        className="btn btn-sm"
        onClick={abrirModalAdicionar}
        disabled={itensArmazem.length === 0 || adicionandoPosicoes}
      >
        Adicionar posição
      </button>
      <button
        type="button"
        className="btn btn-danger btn-sm"
        onClick={() => setConfirmarRemover(true)}
        disabled={adicionandoPosicoes}
      >
        Remover do estoque
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => setConfirmarCancelar(true)}
        disabled={adicionandoPosicoes}
      >
        Cancelar edição
      </button>
    </div>
  ) : null

  const nfTemConteudo =
    nfBusca && (nfTemEstoqueArmazem(nfBusca) || nfTemEstoqueStage(nfBusca))

  const itemAtivo =
    nfBusca && itemIndex != null
      ? nfBusca.items.find((it) => it.index === itemIndex) ?? null
      : null
  const itemStage = itemAtivo != null && itemNoStage(itemAtivo)
  const itensStage = nfBusca ? itensStageDaNf(nfBusca) : []
  const temItensStage = itensStage.length > 0
  const tirandoDoStage = modoMovimentacao === 'tirar-stage'
  const restantesDistribuir = Math.max(0, moveOrigensCount - moveDestinosCount)
  const distribuicaoCompleta =
    moveOrigensCount > 0 && moveOrigensCount === moveDestinosCount

  const itensMovimentaveis = nfBusca ? itensMovimentaveisDaNf(nfBusca) : []
  const itensIntroMovimentacao =
    itensMovimentaveis.length > 1
      ? 'Selecione um item na tabela (○). Após confirmar a movimentação, o próximo item é liberado automaticamente.'
      : 'Selecione um item no armazém ou no stage para movimentar.'

  return (
    <>
      <div className="sidebar-block">
        <div className="saida-busca">
          <input
            type="text"
            className="input-nf"
            placeholder="Número da NF"
            value={numero}
            onChange={(e) => setNumero(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleBuscar()}
          />
          <button type="button" className="btn primary" onClick={handleBuscar}>
            Buscar
          </button>
        </div>
        {buscaErro && <p className="error">{buscaErro}</p>}
      </div>

      {nfBusca && nfTemConteudo && (
        <div className="sidebar-block nf-detail">
          <NfDetalheLeitura
            nf={nfBusca}
            actions={nfActions}
            activeItemIndex={itemIndex}
            onSelectItem={onSelectItem}
            selectablePredicate={itemMovimentavel}
            vozOrigemAddress={!marcandoStage && !itemStage ? vozOrigemAddress : null}
            onSelectVozOrigem={
              !marcandoStage && itemIndex != null && !itemStage ? onSelectVozOrigem : undefined
            }
            itensIntro={itensIntroMovimentacao}
          />

          {itemAtivo && itemStage && (
            <>
              <p className="stage-modo-badge">Tirar do STAGE → estoque físico</p>
              <EnderecoDestinoForm
                ocupados={enderecosOcupados}
                selecionados={enderecosSelecionados}
                onConfirmar={onAdicionarEnderecoDestino}
              />
            </>
          )}

          {itemIndex != null && (
            <div className="item-actions">
              {adicionandoPosicoes ? (
                <>
                  <p className="muted movimentacao-adicionar-hint">
                    Marque <strong>{adicionarPosicoesAlvo}</strong> posição
                    {adicionarPosicoesAlvo !== 1 ? 'ões' : ''} no mapa para o item selecionado (
                    <strong>
                      {adicionarPosicoesSelecionadas} / {adicionarPosicoesAlvo}
                    </strong>{' '}
                    selecionada{adicionarPosicoesSelecionadas !== 1 ? 's' : ''}).
                  </p>
                  <button
                    type="button"
                    className="btn success full"
                    onClick={() => void onConfirmarAdicionarPosicoes()}
                    disabled={!adicionarCompleto || salvando}
                  >
                    {salvando ? 'Salvando…' : 'Confirmar novas posições'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost full"
                    onClick={onCancelarAdicionarPosicoes}
                    disabled={salvando}
                  >
                    Cancelar adição
                  </button>
                </>
              ) : itemStage ? (
                <>
                  <p className="muted">
                    {pendingCount} endereço(s) selecionado(s) — use os campos acima ou clique/arraste
                    no painel para marcar posições no armazém físico.
                  </p>
                  <button
                    type="button"
                    className="btn success full"
                    onClick={async () => {
                      const ok = await onSalvar()
                      if (ok) setNumero('')
                    }}
                    disabled={pendingCount === 0 || salvando}
                  >
                    {salvando ? 'Salvando…' : 'Mover para estoque físico'}
                  </button>
                </>
              ) : (
                <>
                  <div className="movimentacao-modo-toggle movimentacao-modo-toggle--3">
                    <button
                      type="button"
                      className={`btn btn-sm ${modoMovimentacao === 'reposicionar' ? 'primary' : ''}`}
                      onClick={() => onModoMovimentacaoChange('reposicionar')}
                    >
                      Reposicionar
                    </button>
                    <button
                      type="button"
                      className={`btn btn-sm ${modoMovimentacao === 'enviar-stage' ? 'primary' : ''}`}
                      onClick={() => onModoMovimentacaoChange('enviar-stage')}
                    >
                      Enviar ao STAGE
                    </button>
                    {temItensStage && (
                      <button
                        type="button"
                        className={`btn btn-sm ${modoMovimentacao === 'tirar-stage' ? 'primary' : ''}`}
                        onClick={() => onModoMovimentacaoChange('tirar-stage')}
                      >
                        Tirar do STAGE
                      </button>
                    )}
                  </div>
                  {tirandoDoStage ? (
                    <>
                      <p className="muted movimentacao-stage-hint">
                        Selecione um item no <strong>stage</strong> na tabela acima ou abaixo:
                      </p>
                      <ul className="movimentacao-stage-picker">
                        {itensStage.map((it) => (
                          <li key={it.index}>
                            <button
                              type="button"
                              className={`btn btn-sm full${itemIndex === it.index ? ' primary' : ''}`}
                              onClick={() => onSelectItem(it.index)}
                            >
                              {it.codigo} — {it.descricao.slice(0, 48)}
                              {it.descricao.length > 48 ? '…' : ''} (
                              {formatQuantidadeNfe(it.quantidade)} {it.unidade})
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : marcandoStage ? (
                    stagePendingCount > 0 ? (
                      <p className="muted movimentacao-stage-hint">
                        {stagePendingCount} palete(s) marcado(s) — clique na área{' '}
                        <strong>STAGE</strong> no mapa para confirmar.
                      </p>
                    ) : (
                      <p className="muted">
                        Clique nos endereços ocupados do item no mapa para marcar envio ao stage.
                      </p>
                    )
                  ) : (
                    <>
                      <div className="movimentacao-distribuicao">
                        <p className="movimentacao-distribuicao-title">Distribuição</p>
                        {moveOrigensCount === 0 ? (
                          <p className="muted">
                            <strong>Passo 1:</strong> clique ou arraste nos quadrados{' '}
                            <strong>ocupados</strong> no mapa para marcar o que vai tirar{' '}
                            <span className="movimentacao-cor-origem">(laranja −)</span>.
                          </p>
                        ) : (
                          <>
                            <p>
                              <strong>{moveOrigensCount}</strong> palete
                              {moveOrigensCount !== 1 ? 's' : ''} para tirar
                            </p>
                            <p>
                              Destinos escolhidos:{' '}
                              <strong>
                                {moveDestinosCount} / {moveOrigensCount}
                              </strong>
                            </p>
                            {restantesDistribuir > 0 ? (
                              <p className="movimentacao-distribuicao-restante">
                                Restam <strong>{restantesDistribuir}</strong> quadrado
                                {restantesDistribuir !== 1 ? 's' : ''} branco
                                {restantesDistribuir !== 1 ? 's' : ''} para colocar{' '}
                                <span className="movimentacao-cor-destino">(azul ✓)</span>
                              </p>
                            ) : (
                              <p className="movimentacao-distribuicao-ok">
                                Distribuição completa — confirme abaixo.
                              </p>
                            )}
                          </>
                        )}
                      </div>
                      <MovimentacaoVozControle
                        origemSelecionada={vozOrigemAddress}
                        onDestinoFalado={onVozDestino}
                        onErro={onVozErro}
                        onLimparErro={onLimparVozErro}
                        onPrepareMic={onPrepareLocalSpeech}
                        onReleaseMic={onReleaseLocalSpeech}
                      />
                      {vozErro && <p className="error movimentacao-erro">{vozErro}</p>}
                      <button
                        type="button"
                        className="btn success full"
                        onClick={async () => {
                          const ok = await onSalvar()
                          if (ok) setNumero('')
                        }}
                        disabled={!distribuicaoCompleta || stagePendingCount > 0 || salvando}
                      >
                        {salvando ? 'Salvando…' : 'Confirmar movimentação'}
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {nfBusca && !nfTemConteudo && (
        <div className="sidebar-block nf-detail">
          <NfDetalheLeitura nf={nfBusca} actions={nfActions} />
          <p className="muted sidebar-block">Esta NF não possui estoque no armazém nem no stage.</p>
        </div>
      )}

      {modalAdicionar && nfBusca && (
        <div className="confirm-backdrop" onClick={() => setModalAdicionar(false)}>
          <div className="confirm-box confirm-box--wide" onClick={(e) => e.stopPropagation()}>
            <h4>Adicionar posições</h4>
            <p>
              NF <strong>{nfBusca.numero}</strong> — informe quantas posições novas deseja
              acrescentar ao item.
            </p>
            {itensArmazem.length > 1 && (
              <label className="consulta-campo">
                <span>Item</span>
                <select
                  className="input-nf"
                  value={itemAdicionarIndex ?? ''}
                  onChange={(e) =>
                    setItemAdicionarIndex(e.target.value ? Number(e.target.value) : null)
                  }
                >
                  <option value="">Selecione…</option>
                  {itensArmazem.map((it) => (
                    <option key={it.index} value={it.index}>
                      {it.codigo} — {it.descricao} ({it.allocatedAddresses.length} pos.)
                    </option>
                  ))}
                </select>
              </label>
            )}
            {itensArmazem.length === 1 && (
              <p className="muted">
                Item: <strong>{itensArmazem[0].codigo}</strong> — {itensArmazem[0].descricao}
              </p>
            )}
            <label className="consulta-campo">
              <span>Quantidade de posições</span>
              <input
                type="text"
                inputMode="numeric"
                className="input-nf"
                placeholder="Ex.: 4"
                value={qtdPosicoesInput}
                onChange={(e) => setQtdPosicoesInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && confirmarModalAdicionar()}
              />
            </label>
            {adicionarErro && <p className="error">{adicionarErro}</p>}
            <div className="confirm-actions">
              <button type="button" className="btn" onClick={() => setModalAdicionar(false)}>
                Voltar
              </button>
              <button type="button" className="btn primary" onClick={confirmarModalAdicionar}>
                Marcar no mapa
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmarRemover && nfBusca && (
        <div className="confirm-backdrop" onClick={fecharRemover}>
          <div className="confirm-box confirm-box--wide" onClick={(e) => e.stopPropagation()}>
            <h4>Remover do estoque?</h4>
            <p>
              NF <strong>{nfBusca.numero}</strong>
            </p>
            <p className="confirm-warn">
              A NF será retirada do painel e os endereços liberados. O registro permanece no
              histórico com o motivo informado.
            </p>
            <fieldset className="saida-justificativa">
              <legend className="saida-justificativa-title">Motivo do erro</legend>
              <ul className="saida-justificativa-list">
                {MOTIVOS_REMOCAO_ESTOQUE.map((opt) => (
                  <li key={opt.id}>
                    <label className="saida-justificativa-option">
                      <input
                        type="radio"
                        name="motivo-remocao-estoque"
                        value={opt.id}
                        checked={motivoRemocao === opt.id}
                        onChange={() => setMotivoRemocao(opt.id)}
                      />
                      <span>{opt.label}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
            <div className="confirm-actions">
              <button type="button" className="btn" onClick={fecharRemover}>
                Voltar
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={!motivoRemocao || removendoEstoque || salvando}
                onClick={() => {
                  if (!motivoRemocao || !nfBusca) return
                  void (async () => {
                    setRemovendoEstoque(true)
                    try {
                      await onRemoverDoEstoque(nfBusca.id, motivoRemocao)
                      fecharRemover()
                      setNumero('')
                    } finally {
                      setRemovendoEstoque(false)
                    }
                  })()
                }}
              >
                {removendoEstoque || salvando ? 'Removendo…' : 'Remover do estoque'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmarCancelar && nfBusca && (
        <div className="confirm-backdrop" onClick={() => setConfirmarCancelar(false)}>
          <div className="confirm-box" onClick={(e) => e.stopPropagation()}>
            <h4>Cancelar edição?</h4>
            <p>
              NF <strong>{nfBusca.numero}</strong>
            </p>
            <p className="confirm-warn">
              {pendingCount > 0 || stagePendingCount > 0
                ? 'As alterações não salvas serão descartadas. As posições já salvas no estoque não mudam.'
                : 'A busca e a seleção de item serão descartadas.'}
            </p>
            <div className="confirm-actions">
              <button type="button" className="btn" onClick={() => setConfirmarCancelar(false)}>
                Voltar
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  onCancelarEditar()
                  setConfirmarCancelar(false)
                  setNumero('')
                }}
              >
                Cancelar edição
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
