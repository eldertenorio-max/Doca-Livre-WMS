import { useMemo, useState } from 'react'
import { formatAddressLabel } from '../layout/camaras'
import {
  inventariarEstoque,
  inventarioParaResultados,
  nfInventarioParaResultados,
  resultadosEstaoDestacados,
  type ConsultaEstoqueResultado,
  type EstoqueNfInventario,
} from '../lib/consultaEstoque'
import type { NotaFiscal } from '../types'

type Props = {
  notas: NotaFiscal[]
  resultadosDestacados: ConsultaEstoqueResultado[]
  onAlternarDestaque: (resultados: ConsultaEstoqueResultado[]) => void
}

type Vista = 'resumido' | 'detalhado'

export function ConsultaEstoqueInventario({
  notas,
  resultadosDestacados,
  onAlternarDestaque,
}: Props) {
  const inventario = useMemo(() => inventariarEstoque(notas), [notas])
  const [vista, setVista] = useState<Vista>('resumido')

  const todosDestacados = useMemo(
    () => resultadosEstaoDestacados(inventarioParaResultados(inventario), resultadosDestacados),
    [inventario, resultadosDestacados],
  )

  if (inventario.totalNotas === 0) {
    return (
      <div className="consulta-inventario-vazio">
        <p className="muted">Nenhum item endereçado no estoque no momento.</p>
      </div>
    )
  }

  function alternarNf(nf: EstoqueNfInventario) {
    onAlternarDestaque(nfInventarioParaResultados(nf))
  }

  function alternarTudo() {
    onAlternarDestaque(inventarioParaResultados(inventario))
  }

  return (
    <div className="consulta-inventario">
      <div className="consulta-inventario-totais">
        <span>
          <strong>{inventario.totalNotas}</strong> NF
        </span>
        <span>
          <strong>{inventario.totalItens}</strong> {inventario.totalItens === 1 ? 'item' : 'itens'}
        </span>
        <span>
          <strong>{inventario.totalEnderecos}</strong>{' '}
          {inventario.totalEnderecos === 1 ? 'posição' : 'posições'}
        </span>
        <span>
          <strong>{inventario.totalPaletes}</strong>{' '}
          {inventario.totalPaletes === 1 ? 'palete' : 'paletes'}
        </span>
      </div>

      <div className="consulta-inventario-toolbar">
        <div className="consulta-inventario-vista" role="tablist" aria-label="Visualização do inventário">
          <button
            type="button"
            role="tab"
            aria-selected={vista === 'resumido'}
            className={`consulta-inventario-vista-btn${vista === 'resumido' ? ' is-active' : ''}`}
            onClick={() => setVista('resumido')}
          >
            Resumido
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={vista === 'detalhado'}
            className={`consulta-inventario-vista-btn${vista === 'detalhado' ? ' is-active' : ''}`}
            onClick={() => setVista('detalhado')}
          >
            Detalhado
          </button>
        </div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={alternarTudo}>
          {todosDestacados ? 'Desestacar tudo' : 'Destacar tudo'}
        </button>
      </div>

      <p className="muted consulta-inventario-dica">
        Clique em uma NF para destacar no mapa — a tela rola até a posição automaticamente.
      </p>

      <ul className={`consulta-inventario-lista consulta-inventario-lista--${vista}`}>
        {inventario.notas.map((nf) => {
          const nfResultados = nfInventarioParaResultados(nf)
          const destacada = resultadosEstaoDestacados(nfResultados, resultadosDestacados)

          return vista === 'resumido' ? (
            <li
              key={nf.nfId}
              className={`consulta-inventario-nf consulta-inventario-nf--resumo consulta-inventario-nf--clickable${destacada ? ' consulta-inventario-nf--destacada' : ''}`}
              role="button"
              tabIndex={0}
              aria-pressed={destacada}
              onClick={() => alternarNf(nf)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  alternarNf(nf)
                }
              }}
            >
              <div className="consulta-inventario-nf-head">
                <div>
                  <p className="consulta-inventario-nf-titulo">
                    <strong>NF {nf.nfNumero}</strong>
                    {nf.serie ? <span className="muted"> · Série {nf.serie}</span> : null}
                  </p>
                  <p className="muted consulta-inventario-nf-sub">
                    {nf.emitente}
                    {nf.dataEmissao ? ` · Emissão ${formatDate(nf.dataEmissao)}` : ''}
                  </p>
                  <p className="consulta-inventario-nf-stats">
                    {nf.itens.length} {nf.itens.length === 1 ? 'item' : 'itens'} · {nf.totalEnderecos}{' '}
                    {nf.totalEnderecos === 1 ? 'posição' : 'posições'} · {nf.totalPaletes}{' '}
                    {nf.totalPaletes === 1 ? 'palete' : 'paletes'}
                    <StatusBadge status={nf.status} />
                  </p>
                </div>
                <span className={`consulta-inventario-destaque-btn${destacada ? ' is-active' : ''}`}>
                  {destacada ? 'Desestacar' : 'Destacar'}
                </span>
              </div>
            </li>
          ) : (
            <li
              key={nf.nfId}
              className={`consulta-inventario-nf consulta-inventario-nf--detalhe${destacada ? ' consulta-inventario-nf--destacada' : ''}`}
            >
              <div
                className="consulta-inventario-nf-head consulta-inventario-nf-head--detalhe consulta-inventario-nf--clickable"
                role="button"
                tabIndex={0}
                aria-pressed={destacada}
                onClick={() => alternarNf(nf)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    alternarNf(nf)
                  }
                }}
              >
                <div>
                  <p className="consulta-inventario-nf-titulo">
                    <strong>NF {nf.nfNumero}</strong>
                    {nf.serie ? <span className="muted"> · Série {nf.serie}</span> : null}
                    <span className="muted"> · {nf.emitente}</span>
                  </p>
                  <p className="consulta-inventario-nf-stats">
                    {nf.itens.length} itens · {nf.totalEnderecos} pos. · {nf.totalPaletes} pal.
                    {nf.dataEmissao ? ` · Emissão ${formatDate(nf.dataEmissao)}` : ''}
                    <StatusBadge status={nf.status} />
                  </p>
                </div>
                <span className={`consulta-inventario-destaque-btn${destacada ? ' is-active' : ''}`}>
                  {destacada ? 'Desestacar' : 'Destacar'}
                </span>
              </div>
              <div className="consulta-inventario-nf-body">
                <ul className="consulta-inventario-itens">
                  {nf.itens.map((item) => (
                    <li key={item.itemIndex} className="consulta-inventario-item">
                      <ItemDetalhe item={item} />
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function StatusBadge({ status }: { status: EstoqueNfInventario['status'] }) {
  if (status !== 'em_andamento') return null
  return <span className="consulta-inventario-badge">Em andamento</span>
}

function ItemDetalhe({ item }: { item: EstoqueNfInventario['itens'][number] }) {
  return (
    <>
      <p className="consulta-inventario-item-titulo">
        <span className="consulta-item-codigo">{item.codigo}</span>
        <span className="muted"> — {item.descricao}</span>
      </p>
      <dl className="consulta-inventario-item-campos">
        <div>
          <dt>Quantidade</dt>
          <dd>
            {item.quantidade} {item.unidade}
          </dd>
        </div>
        {item.paletes != null && (
          <div>
            <dt>Paletes</dt>
            <dd>{item.paletes}</dd>
          </div>
        )}
        {item.lote && (
          <div>
            <dt>Lote</dt>
            <dd>{item.lote}</dd>
          </div>
        )}
        {item.up && (
          <div>
            <dt>UP</dt>
            <dd>{item.up}</dd>
          </div>
        )}
        {item.dataFabricacao && (
          <div>
            <dt>Fabricação</dt>
            <dd>{formatDate(item.dataFabricacao)}</dd>
          </div>
        )}
        {item.dataValidade && (
          <div>
            <dt>Validade</dt>
            <dd>{formatDate(item.dataValidade)}</dd>
          </div>
        )}
      </dl>
      <p className="consulta-inventario-enderecos-label">
        {item.enderecos.length} {item.enderecos.length === 1 ? 'posição' : 'posições'}
        {(() => {
          const paletes = Math.max(item.paletes ?? 0, item.enderecos.length)
          return paletes > 0
            ? ` · ${paletes} ${paletes === 1 ? 'palete' : 'paletes'}`
            : ''
        })()}
        :
      </p>
      <ul className="consulta-enderecos">
        {item.enderecos.map((addr) => (
          <li key={addr}>{formatAddressLabel(addr)}</li>
        ))}
      </ul>
    </>
  )
}

function formatDate(raw: string): string {
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
  if (br) return raw
  return raw
}
