import { formatValorNfe } from '../lib/formatNfeItem'
import type { ResumoCamaraEstoque } from '../lib/painelEstoqueArmazem'

type Props = {
  resumo: ResumoCamaraEstoque
}

export function CamaraStatsCards({ resumo }: Props) {
  const pct = Math.min(100, Math.max(0, resumo.ocupacaoPct))

  return (
    <div className="camara-stats" aria-label={`Resumo da câmara ${resumo.camaraId}`}>
      <article className="camara-stat-card camara-stat-card--valor">
        <span className="camara-stat-label">Valor armazenado</span>
        <strong className="camara-stat-value">{formatValorNfe(resumo.valorArmazenado)}</strong>
      </article>
      <article className="camara-stat-card">
        <span className="camara-stat-label">Itens</span>
        <strong className="camara-stat-value">{resumo.qtdItens}</strong>
      </article>
      <article className="camara-stat-card">
        <span className="camara-stat-label">Notas fiscais</span>
        <strong className="camara-stat-value">{resumo.qtdNotas}</strong>
      </article>
      <article className="camara-stat-card camara-stat-card--livre">
        <span className="camara-stat-label">Posições livres</span>
        <strong className="camara-stat-value">{resumo.posicoesLivres}</strong>
      </article>
      <article className="camara-stat-card camara-stat-card--ocupada">
        <span className="camara-stat-label">Posições ocupadas</span>
        <strong className="camara-stat-value">{resumo.posicoesOcupadas}</strong>
      </article>
      <article className="camara-stat-card camara-stat-card--ocupacao">
        <span className="camara-stat-label">Taxa de ocupação</span>
        <strong className="camara-stat-value">{pct.toFixed(1)}%</strong>
      </article>
    </div>
  )
}
