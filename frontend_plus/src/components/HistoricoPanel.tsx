import { useMemo, useState, type ReactNode } from 'react'
import type { MovimentoItemSnapshot, MovimentoRegistro, NotaFiscal, NotaFiscalCancelada } from '../types'
import { dadosCanceladaParaHistorico } from '../lib/nfCanceladas'
import { labelJustificativaSaida } from '../lib/justificativaSaida'
import { labelMotivoRemocaoEstoque } from '../lib/motivoRemocaoEstoque'
import { dataEfetivaMovimentoSaida } from '../lib/movimentos'
import { formatAddressLabel } from '../layout/camaras'
import { formatPesoBruto, formatQuantidadeNfe, formatValorNfe } from '../lib/formatNfeItem'

type HistFiltro = 'todos' | 'movimentacao' | 'entrada' | 'saida' | 'canceladas'

type HistItem =
  | { kind: 'movimento'; data: MovimentoRegistro }
  | { kind: 'cancelada'; data: NotaFiscalCancelada }

type Props = {
  movimentos: MovimentoRegistro[]
  canceladas: NotaFiscalCancelada[]
  notas?: NotaFiscal[]
}

const FILTROS: { id: HistFiltro; label: string }[] = [
  { id: 'todos', label: 'Todos' },
  { id: 'movimentacao', label: 'Movimentação' },
  { id: 'entrada', label: 'Entrada' },
  { id: 'saida', label: 'Saída' },
  { id: 'canceladas', label: 'Canceladas' },
]

const TIPO_LABEL: Record<MovimentoRegistro['tipo'], string> = {
  entrada: 'Entrada',
  saida: 'Saída',
  movimentacao: 'Movimentação',
}

export function HistoricoPanel({ movimentos, canceladas, notas = [] }: Props) {
  const [filtro, setFiltro] = useState<HistFiltro>('todos')

  const contagens = useMemo(
    () => ({
      movimentacao: movimentos.filter((m) => m.tipo === 'movimentacao').length,
      entrada: movimentos.filter((m) => m.tipo === 'entrada').length,
      saida: movimentos.filter((m) => m.tipo === 'saida').length,
      canceladas: canceladas.length,
      todos: movimentos.length + canceladas.length,
    }),
    [movimentos, canceladas],
  )

  const itens = useMemo(
    () => buildLista(filtro, movimentos, canceladas, notas),
    [filtro, movimentos, canceladas, notas],
  )

  function filtroLabel(id: HistFiltro, label: string) {
    const count = contagens[id]
    return count > 0 ? `${label} (${count})` : label
  }

  if (contagens.todos === 0) {
    return <p className="muted">Nenhum registro de entrada, saída ou cancelamento ainda.</p>
  }

  return (
    <>
      <div className="hist-filters" role="tablist" aria-label="Filtrar histórico">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filtro === f.id}
            className={`hist-filter ${filtro === f.id ? 'hist-filter--active' : ''}`}
            onClick={() => setFiltro(f.id)}
          >
            {filtroLabel(f.id, f.label)}
          </button>
        ))}
      </div>

      {itens.length === 0 ? (
        <p className="muted">Nenhum registro neste filtro.</p>
      ) : (
        <ul className="hist-list">
          {itens.map((item) =>
            item.kind === 'movimento' ? (
              <MovimentoCard key={`mov-${item.data.id}`} mov={item.data} />
            ) : (
              <CanceladaCard
                key={`can-${item.data.id}`}
                cancelada={item.data}
                notas={notas}
                movimentos={movimentos}
              />
            ),
          )}
        </ul>
      )}
    </>
  )
}

function HistDetalhesColapsaveis({ children }: { children: ReactNode }) {
  const [aberto, setAberto] = useState(false)

  return (
    <div className="hist-detalhes-wrap">
      <button
        type="button"
        className="hist-detalhes-toggle"
        aria-expanded={aberto}
        onClick={() => setAberto((v) => !v)}
      >
        {aberto ? 'Ocultar detalhes' : 'Mostrar detalhes'}
      </button>
      {aberto && <div className="hist-detalhes-body">{children}</div>}
    </div>
  )
}

function MovimentoCard({ mov }: { mov: MovimentoRegistro }) {
  if (mov.tipo === 'saida') return <SaidaMovimentoCard mov={mov} />
  if (mov.tipo === 'movimentacao') return <MovimentacaoMovimentoCard mov={mov} />
  return <EntradaMovimentoCard mov={mov} />
}

function MovimentoCardShell({
  mov,
  children,
}: {
  mov: MovimentoRegistro
  children: ReactNode
}) {
  const badgeRemovido = mov.excluido && mov.motivoRemocaoEstoque

  return (
    <li className={`hist-card hist-card--${mov.tipo}${mov.excluido ? ' hist-card--excluido' : ''}`}>
      <div className="hist-head">
        <span className={`hist-tipo hist-tipo--${mov.tipo}`}>{TIPO_LABEL[mov.tipo]}</span>
        {mov.excluido && (
          <span className={`hist-excluido-badge${badgeRemovido ? ' hist-excluido-badge--estoque' : ''}`}>
            {badgeRemovido ? 'Removido do estoque' : 'Excluído'}
          </span>
        )}
      </div>
      {children}
    </li>
  )
}

function MovimentoCabecalho({
  mov,
  extra,
}: {
  mov: MovimentoRegistro
  extra?: ReactNode
}) {
  const dataExibicao = rotuloDataMovimento(mov)

  return (
    <>
      <p className="hist-saida-linha">
        <strong>NF {mov.nfNumero}</strong>
        {extra}
        <span className="hist-saida-sep" aria-hidden>
          ·
        </span>
        <span className="muted hist-saida-emitente-inline">{mov.emitente || '—'}</span>
        <span className="hist-saida-sep" aria-hidden>
          ·
        </span>
        <span className="muted">{dataExibicao}</span>
        {mov.excluidoEm && (
          <span className="muted"> · excluído em {formatDate(mov.excluidoEm)}</span>
        )}
      </p>
    </>
  )
}

function HistDocTotais({
  pesoBruto,
  pesoLiquido,
  valorTotal,
}: {
  pesoBruto?: number | null
  pesoLiquido?: number | null
  valorTotal?: number | null
}) {
  if (pesoBruto == null && pesoLiquido == null && valorTotal == null) return null

  return (
    <p className="hist-doc-totais muted">
      {pesoBruto != null && <span>P. bruto {formatPesoBruto(pesoBruto)} kg</span>}
      {pesoLiquido != null && (
        <span>
          {pesoBruto != null ? ' · ' : ''}
          P. líq. {formatPesoBruto(pesoLiquido)} kg
        </span>
      )}
      {valorTotal != null && (
        <span>
          {' · '}
          V. total {formatValorNfe(valorTotal)}
        </span>
      )}
    </p>
  )
}

function EntradaMovimentoCard({ mov }: { mov: MovimentoRegistro }) {
  const totalEnd = mov.itens.reduce((s, it) => s + it.addressIds.length, 0)
  const totalPaletes = mov.itens.reduce((s, it) => s + (it.paletes ?? it.addressIds.length), 0)
  const motivoRemocao = labelMotivoRemocaoEstoque(mov.motivoRemocaoEstoque)

  return (
    <MovimentoCardShell mov={mov}>
      <MovimentoCabecalho
        mov={mov}
        extra={
          motivoRemocao ? (
            <>
              <span className="hist-saida-sep" aria-hidden>
                ·
              </span>
              <span>{motivoRemocao}</span>
            </>
          ) : null
        }
      />
      <p className="hist-saida-resumo muted">
        {mov.itens.length} item(ns)
        {' · '}
        {formatQuantidadeNfe(totalPaletes)} palete(s)
        {' · '}
        {totalEnd} endereço(s)
      </p>
      <HistDetalhesColapsaveis>
        <HistDocTotais
          pesoBruto={mov.pesoBruto}
          pesoLiquido={mov.pesoLiquido}
          valorTotal={mov.valorTotal}
        />
        <HistItensLista itens={mov.itens} modo="entrada" movId={mov.id} />
      </HistDetalhesColapsaveis>
    </MovimentoCardShell>
  )
}

function MovimentacaoMovimentoCard({ mov }: { mov: MovimentoRegistro }) {
  const totalEnd = mov.itens.reduce((s, it) => s + it.addressIds.length, 0)

  return (
    <MovimentoCardShell mov={mov}>
      <MovimentoCabecalho mov={mov} />
      <p className="hist-saida-resumo muted">
        Reposicionamento de {mov.itens.length} item(ns) · {totalEnd} endereço(s)
      </p>
      <HistDetalhesColapsaveis>
        <HistDocTotais
          pesoBruto={mov.pesoBruto}
          pesoLiquido={mov.pesoLiquido}
          valorTotal={mov.valorTotal}
        />
        <HistItensLista itens={mov.itens} modo="movimentacao" movId={mov.id} />
      </HistDetalhesColapsaveis>
    </MovimentoCardShell>
  )
}

function SaidaMovimentoCard({ mov }: { mov: MovimentoRegistro }) {
  const motivo = labelJustificativaSaida(mov.justificativaSaida)
  const totalCaixas = mov.itens.reduce(
    (s, it) => s + (it.quantidadeSaida ?? it.quantidade),
    0,
  )
  const totalPesoBruto = mov.itens.reduce((s, it) => s + (it.pesoBruto ?? 0), 0)
  const totalValor = mov.itens.reduce((s, it) => s + (it.valorTotal ?? 0), 0)
  const posLiberadas = mov.itens.reduce((s, it) => s + (it.paletes ?? 0), 0)
  const unidade = mov.itens[0]?.unidade ?? 'CX'

  return (
    <MovimentoCardShell mov={mov}>
      <MovimentoCabecalho
        mov={mov}
        extra={
          <>
            {mov.nfSaida && (
              <>
                <span className="hist-saida-sep" aria-hidden>
                  ·
                </span>
                <span className="muted">doc. saída NF {mov.nfSaida.numero}</span>
              </>
            )}
            {motivo ? (
              <>
                <span className="hist-saida-sep" aria-hidden>
                  ·
                </span>
                <span>{motivo}</span>
              </>
            ) : null}
          </>
        }
      />
      <p className="hist-saida-resumo muted">
        {formatQuantidadeNfe(totalCaixas)} {unidade} saindo
        {' · '}
        {mov.itens.length} palete(s)
        {posLiberadas > 0 && (
          <>
            {' · '}
            {posLiberadas} pos. liberada(s)
          </>
        )}
      </p>
      <HistDetalhesColapsaveis>
        <HistDocTotais
          pesoBruto={totalPesoBruto > 0 ? totalPesoBruto : mov.pesoBruto}
          pesoLiquido={mov.pesoLiquido}
          valorTotal={totalValor > 0 ? totalValor : mov.valorTotal}
        />
        <HistItensLista itens={mov.itens} modo="saida" movId={mov.id} />
      </HistDetalhesColapsaveis>
    </MovimentoCardShell>
  )
}

function HistItensLista({
  itens,
  modo,
  movId,
}: {
  itens: MovimentoItemSnapshot[]
  modo: 'entrada' | 'saida' | 'movimentacao'
  movId: string
}) {
  if (itens.length === 0) {
    return <p className="muted hist-sem-itens">Sem itens registrados neste movimento.</p>
  }

  return (
    <ul className="hist-saida-itens">
      {itens.map((it, idx) => (
        <HistItemLinha key={`${movId}-${it.itemIndex}-${idx}`} it={it} modo={modo} />
      ))}
    </ul>
  )
}

function HistItemLinha({
  it,
  modo,
}: {
  it: MovimentoItemSnapshot
  modo: 'entrada' | 'saida' | 'movimentacao'
}) {
  const qtd =
    modo === 'saida' ? (it.quantidadeSaida ?? it.quantidade) : it.quantidade
  const parcial = modo === 'saida' && it.paletes === 0 && it.addressIds.length > 0

  return (
    <li className="hist-saida-item">
      <span className="hist-saida-item-cod">{it.codigo || '—'}</span>
      <span className="hist-saida-sep" aria-hidden>
        ·
      </span>
      <span className="hist-saida-item-desc" title={it.descricao}>
        {it.descricao || '—'}
      </span>
      <span className="hist-saida-sep" aria-hidden>
        ·
      </span>
      <span className="hist-saida-item-qtd">
        {formatQuantidadeNfe(qtd)} {it.unidade}
      </span>
      {it.pesoBruto != null && (
        <>
          <span className="hist-saida-sep" aria-hidden>
            ·
          </span>
          <span className="muted">P. br. {formatPesoBruto(it.pesoBruto)}</span>
        </>
      )}
      {it.pesoLiquido != null && (
        <>
          <span className="hist-saida-sep" aria-hidden>
            ·
          </span>
          <span className="muted">P. líq. {formatPesoBruto(it.pesoLiquido)}</span>
        </>
      )}
      {it.valorTotal != null && (
        <>
          <span className="hist-saida-sep" aria-hidden>
            ·
          </span>
          <span>{formatValorNfe(it.valorTotal)}</span>
        </>
      )}
      {modo === 'saida' && it.quantidadeSobra != null && (
        <>
          <span className="hist-saida-sep" aria-hidden>
            ·
          </span>
          <span className="muted hist-saida-item-sobra">
            sobra {formatQuantidadeNfe(it.quantidadeSobra)} {it.unidade}
          </span>
        </>
      )}
      {parcial && <span className="hist-saida-parcial">parcial</span>}
      {(it.lote || it.up || it.dataFabricacao || it.dataValidade || it.paletes != null) && (
        <span className="muted hist-saida-item-meta">
          {it.up && <>UP {it.up}</>}
          {it.up && it.lote && ' · '}
          {it.lote && <>lote {it.lote}</>}
          {(it.up || it.lote) && (it.dataFabricacao || it.dataValidade) && ' · '}
          {it.dataFabricacao && <>fab. {formatDateShort(it.dataFabricacao)}</>}
          {it.dataFabricacao && it.dataValidade && ' · '}
          {it.dataValidade && <>val. {formatDateShort(it.dataValidade)}</>}
          {(it.up || it.lote || it.dataFabricacao || it.dataValidade) && it.paletes != null && ' · '}
          {it.paletes != null && <>{it.paletes} palete(s)</>}
        </span>
      )}
      {it.addressIds.length > 0 && (
        <ul className="hist-item-enderecos">
          {it.addressIds.map((a) => (
            <li key={a}>{formatAddressLabel(a)}</li>
          ))}
        </ul>
      )}
    </li>
  )
}

function CanceladaCard({
  cancelada,
  notas,
  movimentos,
}: {
  cancelada: NotaFiscalCancelada
  notas: NotaFiscal[]
  movimentos: MovimentoRegistro[]
}) {
  const dados = dadosCanceladaParaHistorico(cancelada, notas, movimentos)
  const totalQtd = dados.items.reduce((s, it) => s + it.quantidade, 0)
  const unidade = dados.items[0]?.unidade ?? 'CX'

  return (
    <li className={`hist-card hist-card--cancelada${cancelada.excluido ? ' hist-card--excluido' : ''}`}>
      <div className="hist-head">
        <span className="hist-tipo hist-tipo--cancelada">Cancelada</span>
        {cancelada.excluido && <span className="hist-excluido-badge">Excluído</span>}
      </div>
      <p className="hist-saida-linha">
        <strong>NF {dados.numero}</strong>
        {dados.serie && (
          <>
            <span className="hist-saida-sep" aria-hidden>
              ·
            </span>
            <span className="muted">Série {dados.serie}</span>
          </>
        )}
        <span className="hist-saida-sep" aria-hidden>
          ·
        </span>
        <span className="muted hist-saida-emitente-inline">{dados.emitente || '—'}</span>
        <span className="hist-saida-sep" aria-hidden>
          ·
        </span>
        <span className="muted">
          Emissão {formatDate(dados.dataEmissao)}
        </span>
        <span className="hist-saida-sep" aria-hidden>
          ·
        </span>
        <span className="muted">Registro {formatDate(cancelada.createdAt)}</span>
        {cancelada.excluidoEm && (
          <span className="muted"> · excluído em {formatDate(cancelada.excluidoEm)}</span>
        )}
      </p>
      <p className="hist-saida-resumo muted">
        {dados.items.length} item(ns)
        {totalQtd > 0 && (
          <>
            {' · '}
            {formatQuantidadeNfe(totalQtd)} {unidade}
          </>
        )}
      </p>
      {dados.items.length > 0 ? (
        <HistDetalhesColapsaveis>
          <HistDocTotais
            pesoBruto={dados.pesoBruto}
            pesoLiquido={dados.pesoLiquido}
            valorTotal={dados.valorTotal}
          />
          <ul className="hist-saida-itens">
            {dados.items.map((it) => (
              <li key={`${cancelada.id}-${it.index}`} className="hist-saida-item">
                <span className="hist-saida-item-cod">{it.codigo || '—'}</span>
                <span className="hist-saida-sep" aria-hidden>
                  ·
                </span>
                <span className="hist-saida-item-desc" title={it.descricao}>
                  {it.descricao || '—'}
                </span>
                <span className="hist-saida-sep" aria-hidden>
                  ·
                </span>
                <span className="hist-saida-item-qtd">
                  {formatQuantidadeNfe(it.quantidade)} {it.unidade}
                </span>
                {it.pesoBruto != null && (
                  <>
                    <span className="hist-saida-sep" aria-hidden>
                      ·
                    </span>
                    <span className="muted">P. br. {formatPesoBruto(it.pesoBruto)}</span>
                  </>
                )}
                {it.pesoLiquido != null && (
                  <>
                    <span className="hist-saida-sep" aria-hidden>
                      ·
                    </span>
                    <span className="muted">P. líq. {formatPesoBruto(it.pesoLiquido)}</span>
                  </>
                )}
                {it.valorUnitario != null && (
                  <>
                    <span className="hist-saida-sep" aria-hidden>
                      ·
                    </span>
                    <span className="muted">V. unit. {formatValorNfe(it.valorUnitario)}</span>
                  </>
                )}
                {it.valorTotal != null && (
                  <>
                    <span className="hist-saida-sep" aria-hidden>
                      ·
                    </span>
                    <span>{formatValorNfe(it.valorTotal)}</span>
                  </>
                )}
              </li>
            ))}
          </ul>
          {dados.chave && (
            <p className="hist-chave muted" title={dados.chave}>
              Chave {dados.chave.slice(0, 8)}…{dados.chave.slice(-6)}
            </p>
          )}
          {cancelada.vinculoNfNovaNumero ? (
            <p className="hist-vinculo">
              Vinculada à NF nova <strong>{cancelada.vinculoNfNovaNumero}</strong>
            </p>
          ) : (
            !cancelada.excluido && <p className="hist-hint">Sem vínculo com NF substituta.</p>
          )}
        </HistDetalhesColapsaveis>
      ) : (
        <p className="muted hist-sem-itens">Itens não disponíveis no registro de cancelamento.</p>
      )}
    </li>
  )
}

function buildLista(
  filtro: HistFiltro,
  movimentos: MovimentoRegistro[],
  canceladas: NotaFiscalCancelada[],
  _notas: NotaFiscal[],
): HistItem[] {
  if (filtro === 'movimentacao') {
    return movimentos
      .filter((m) => m.tipo === 'movimentacao' && !m.excluido)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((data) => ({ kind: 'movimento', data }))
  }

  if (filtro === 'entrada') {
    return movimentos
      .filter((m) => m.tipo === 'entrada')
      .map((data) => ({ kind: 'movimento', data }))
  }

  if (filtro === 'saida') {
    return movimentos
      .filter((m) => m.tipo === 'saida')
      .map((data) => ({ kind: 'movimento', data }))
  }

  if (filtro === 'canceladas') {
    return [...canceladas]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((data) => ({ kind: 'cancelada', data }))
  }

  const merged: { item: HistItem; sort: string }[] = [
    ...movimentos.map((m) => ({
      item: { kind: 'movimento' as const, data: m },
      sort: m.createdAt,
    })),
    ...canceladas.map((c) => ({
      item: { kind: 'cancelada' as const, data: c },
      sort: c.createdAt,
    })),
  ]

  return merged.sort((a, b) => b.sort.localeCompare(a.sort)).map((e) => e.item)
}

function formatDate(raw: string): string {
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw
  return d.toLocaleString('pt-BR')
}

function formatDateShort(raw: string): string {
  if (!raw) return '—'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10)
  return d.toLocaleDateString('pt-BR')
}

function rotuloDataMovimento(mov: MovimentoRegistro): string {
  if (mov.tipo !== 'saida') return formatDate(mov.createdAt)
  const efetiva = dataEfetivaMovimentoSaida(mov)
  const diaSaida = efetiva.slice(0, 10)
  const diaRegistro = mov.createdAt.slice(0, 10)
  if (mov.dataSaida && diaSaida !== diaRegistro) {
    return `Saída ${formatDateShort(efetiva)} · registro ${formatDateShort(mov.createdAt)}`
  }
  return formatDate(efetiva)
}
