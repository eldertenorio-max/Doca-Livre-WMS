import { useMemo, useState } from 'react'
import {
  coletarRelatorioEstoque,
  downloadTextFile,
  gerarCsvItens,
  gerarCsvNotas,
  imprimirRelatorioItens,
  imprimirRelatorioNotas,
  nomeArquivoRelatorio,
  type RelatorioOrigem,
} from '../lib/relatorioEstoque'
import type { NotaFiscal } from '../types'

type Props = {
  notas: NotaFiscal[]
}

const ORIGENS: { id: RelatorioOrigem; label: string; hint: string }[] = [
  { id: 'armazem', label: 'Armazém', hint: 'Itens com posição no mapa' },
  { id: 'stage', label: 'Stage', hint: 'Itens na área de separação' },
  { id: 'todos', label: 'Todos', hint: 'Armazém e stage' },
]

export function RelatorioPanel({ notas }: Props) {
  const [origem, setOrigem] = useState<RelatorioOrigem>('armazem')

  const resumo = useMemo(() => coletarRelatorioEstoque(notas, origem), [notas, origem])
  const vazio = resumo.totalNotas === 0

  return (
    <div className="relatorio-panel">
      <div className="sidebar-block">
        <h4>Origem do estoque</h4>
        <div className="relatorio-origem">
          {ORIGENS.map((o) => (
            <label key={o.id} className="relatorio-origem-item">
              <input
                type="radio"
                name="relatorio-origem"
                checked={origem === o.id}
                onChange={() => setOrigem(o.id)}
              />
              <span>
                <strong>{o.label}</strong>
                <span className="muted"> · {o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="relatorio-resumo" aria-live="polite">
        <article className="relatorio-resumo-card">
          <span className="relatorio-resumo-label">Notas</span>
          <strong className="relatorio-resumo-val">{resumo.totalNotas}</strong>
        </article>
        <article className="relatorio-resumo-card">
          <span className="relatorio-resumo-label">Itens</span>
          <strong className="relatorio-resumo-val">{resumo.totalItens}</strong>
        </article>
        <article className="relatorio-resumo-card">
          <span className="relatorio-resumo-label">Posições</span>
          <strong className="relatorio-resumo-val">{resumo.totalPosicoes}</strong>
        </article>
      </div>

      {vazio ? (
        <p className="relatorio-vazio muted">Nenhum registro encontrado para a origem selecionada.</p>
      ) : (
        <>
          <div className="sidebar-block relatorio-opcao">
            <h4>Notas fiscais armazenadas</h4>
            <div className="relatorio-actions">
              <button
                type="button"
                className="btn primary"
                onClick={() =>
                  downloadTextFile(
                    nomeArquivoRelatorio('notas', origem),
                    gerarCsvNotas(resumo.notas),
                  )
                }
              >
                Baixar CSV ({resumo.totalNotas})
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => imprimirRelatorioNotas(resumo.notas, origem)}
              >
                Imprimir / PDF
              </button>
            </div>
          </div>

          <div className="sidebar-block relatorio-opcao">
            <h4>Itens armazenados</h4>
            <div className="relatorio-actions">
              <button
                type="button"
                className="btn primary"
                onClick={() =>
                  downloadTextFile(
                    nomeArquivoRelatorio('itens', origem),
                    gerarCsvItens(resumo.itens),
                  )
                }
              >
                Baixar CSV ({resumo.totalItens})
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => imprimirRelatorioItens(resumo.itens, origem)}
              >
                Imprimir / PDF
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
