import { useMemo } from 'react'
import type { NotaFiscal } from '../types'
import { resumoSaidaNf, type SaidaLimitesPorItem, type SaidaPaleteDraft } from '../lib/saidaParcial'
import { formatAddressLabel } from '../layout/camaras'
import { formatPesoBruto, formatQuantidadeNfe, formatValorNfe } from '../lib/formatNfeItem'

type Props = {
  nf: NotaFiscal
  paletesConfirmados: SaidaPaleteDraft[]
  limitesPorItem?: SaidaLimitesPorItem
}

export function SaidaResumoTotal({ nf, paletesConfirmados, limitesPorItem }: Props) {
  const resumo = useMemo(
    () => resumoSaidaNf(nf, paletesConfirmados, limitesPorItem),
    [nf, paletesConfirmados, limitesPorItem],
  )

  if (resumo.itens.length === 0) return null

  return (
    <section className="saida-resumo-total" aria-labelledby="saida-resumo-total-title">
      <h4 id="saida-resumo-total-title" className="saida-resumo-total-title">
        Resumo total da saída
      </h4>
      <p className="muted saida-resumo-total-intro">
        {resumo.itens.length} item(ns) · {resumo.totalPaletes} palete(s) confirmado(s)
      </p>

      <ul className="saida-resumo-itens">
        {resumo.itens.map((item) => (
          <li key={item.itemIndex} className="saida-resumo-item">
            <div className="saida-resumo-item-head">
              <span className="saida-resumo-item-cod">{item.codigo || '—'}</span>
              <span className="saida-resumo-item-desc" title={item.descricao}>
                {item.descricao || '—'}
              </span>
            </div>
            <ul className="saida-resumo-paletes">
              {item.paletes.map((p) => (
                <li key={p.addressId} className="saida-resumo-palete">
                  <span>{formatAddressLabel(p.addressId)}</span>
                  <span className="muted">
                    {formatQuantidadeNfe(p.quantidadeCaixas)} {item.unidade}
                    {p.pesoBruto != null && (
                      <> · P. br. {formatPesoBruto(p.pesoBruto)} kg</>
                    )}
                    {p.pesoLiquido != null && (
                      <> · P. líq. {formatPesoBruto(p.pesoLiquido)} kg</>
                    )}
                    {p.valor != null && <> · {formatValorNfe(p.valor)}</>}
                  </span>
                </li>
              ))}
            </ul>
            <div className="saida-resumo-item-totais">
              <span>
                <span className="muted">Caixas</span>{' '}
                <strong className="saida-valor--saindo">
                  {formatQuantidadeNfe(item.caixas)} {item.unidade}
                </strong>
              </span>
              {item.pesoBruto > 0 && (
                <span>
                  <span className="muted">P. bruto</span>{' '}
                  <strong>{formatPesoBruto(item.pesoBruto)} kg</strong>
                </span>
              )}
              {item.pesoLiquido > 0 && (
                <span>
                  <span className="muted">P. líquido</span>{' '}
                  <strong>{formatPesoBruto(item.pesoLiquido)} kg</strong>
                </span>
              )}
              {item.valor > 0 && (
                <span>
                  <span className="muted">V. total</span>{' '}
                  <strong className="saida-valor--saindo">{formatValorNfe(item.valor)}</strong>
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>

      <div className="saida-resumo-geral" aria-live="polite">
        <p className="saida-resumo-geral-label">Total saindo</p>
        <div className="saida-totais-resumo saida-totais-resumo--destaque">
          <div>
            <span className="muted">Paletes</span>
            <strong>{resumo.totalPaletes}</strong>
          </div>
          <div>
            <span className="muted">Caixas</span>
            <strong className="saida-valor--saindo">
              {formatQuantidadeNfe(resumo.totalCaixas)}
            </strong>
          </div>
          <div>
            <span className="muted">P. bruto</span>
            <strong>
              {resumo.pesoBruto > 0 ? `${formatPesoBruto(resumo.pesoBruto)} kg` : '—'}
            </strong>
          </div>
          <div>
            <span className="muted">P. líquido</span>
            <strong>
              {resumo.pesoLiquido > 0 ? `${formatPesoBruto(resumo.pesoLiquido)} kg` : '—'}
            </strong>
          </div>
          <div>
            <span className="muted">V. total</span>
            <strong className="saida-valor--saindo">
              {resumo.valor > 0 ? formatValorNfe(resumo.valor) : '—'}
            </strong>
          </div>
        </div>
      </div>
    </section>
  )
}
