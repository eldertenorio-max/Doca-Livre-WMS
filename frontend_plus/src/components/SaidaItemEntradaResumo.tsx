import { buildResumoItemEntradaSaida } from '../lib/resumoItemEntrada'
import type { SaidaItemDraft, SaidaLimitesPorItem, SaidaPaleteDraft } from '../lib/saidaParcial'
import type { NfeItem, NotaFiscal } from '../types'
import { formatPesoBruto, formatQuantidadeNfe, formatValorNfe } from '../lib/formatNfeItem'

type Props = {
  nf: NotaFiscal
  item: NfeItem
  limitesPorItem?: SaidaLimitesPorItem
  paletesConfirmados?: SaidaPaleteDraft[]
  stageConfirmados?: SaidaItemDraft[]
}

function formatDateShort(raw: string | undefined): string {
  if (!raw) return '—'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10)
  return d.toLocaleDateString('pt-BR')
}

export function SaidaItemEntradaResumo({
  nf,
  item,
  limitesPorItem,
  paletesConfirmados,
  stageConfirmados,
}: Props) {
  const r = buildResumoItemEntradaSaida(nf, item, {
    limitesPorItem,
    paletesConfirmados,
    stageConfirmados,
  })

  const meta = [
    r.up && `UP ${r.up}`,
    r.lote && `Lote ${r.lote}`,
    r.dataFabricacao && `Fab. ${formatDateShort(r.dataFabricacao)}`,
    r.dataValidade && `Valid. ${formatDateShort(r.dataValidade)}`,
  ].filter(Boolean)

  return (
    <section className="saida-entrada-resumo" aria-label="Estoque na NF de entrada">
      <div className="saida-entrada-resumo-head">
        <h5 className="saida-entrada-resumo-title">Na entrada (NF {r.nfNumero})</h5>
        {r.dataArmazenagem && (
          <span className="muted saida-entrada-resumo-data">
            Armazenado em {formatDateShort(r.dataArmazenagem)}
          </span>
        )}
      </div>
      <p className="saida-entrada-resumo-produto">
        <strong>{r.codigo || '—'}</strong>
        <span className="muted"> — {r.descricao || '—'}</span>
      </p>
      {meta.length > 0 && (
        <p className="saida-entrada-resumo-meta muted">{meta.join(' · ')}</p>
      )}
      <div className="saida-entrada-resumo-grid">
        <div className="saida-entrada-resumo-card saida-entrada-resumo-card--destaque">
          <span>Disponível para sair</span>
          <strong>
            {formatQuantidadeNfe(r.quantidadeDisponivel)} {r.unidade}
          </strong>
        </div>
        <div className="saida-entrada-resumo-card">
          <span>Total na entrada</span>
          <strong>
            {formatQuantidadeNfe(r.quantidadeEstoque)} {r.unidade}
          </strong>
        </div>
        {r.quantidadeConfirmada > 0 && (
          <div className="saida-entrada-resumo-card">
            <span>Já nesta saída</span>
            <strong className="saida-valor--saindo">
              {formatQuantidadeNfe(r.quantidadeConfirmada)} {r.unidade}
            </strong>
          </div>
        )}
        {r.limiteXml != null && (
          <div className="saida-entrada-resumo-card">
            <span>Limite XML saída</span>
            <strong>
              {formatQuantidadeNfe(r.limiteXml)} {r.unidade}
            </strong>
          </div>
        )}
        <div className="saida-entrada-resumo-card">
          <span>P. bruto</span>
          <strong>{r.pesoBruto != null ? `${formatPesoBruto(r.pesoBruto)} kg` : '—'}</strong>
        </div>
        <div className="saida-entrada-resumo-card">
          <span>P. líquido</span>
          <strong>{r.pesoLiquido != null ? `${formatPesoBruto(r.pesoLiquido)} kg` : '—'}</strong>
        </div>
        {r.valorTotal != null && (
          <div className="saida-entrada-resumo-card">
            <span>V. total item</span>
            <strong>{formatValorNfe(r.valorTotal)}</strong>
          </div>
        )}
        <div className="saida-entrada-resumo-card">
          <span>{r.noStage ? 'Local' : 'Paletes'}</span>
          <strong>{r.noStage ? 'Stage' : r.paletes}</strong>
        </div>
      </div>
    </section>
  )
}
