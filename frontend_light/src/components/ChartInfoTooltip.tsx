const WRAP_CSS = `
.chart-info-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}
.chart-info-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--chart-info-border, rgba(148, 163, 184, 0.45));
  background: var(--chart-info-bg, rgba(30, 41, 59, 0.6));
  color: var(--chart-info-fg, #94a3b8);
  cursor: help;
  font-size: 12px;
  font-weight: 800;
  font-style: italic;
  font-family: Georgia, 'Times New Roman', serif;
  line-height: 1;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
}
.chart-info-btn:hover,
.chart-info-btn:focus-visible {
  color: var(--chart-info-fg-hover, #e2e8f0);
  border-color: var(--chart-info-border-hover, #64748b);
  background: var(--chart-info-bg-hover, rgba(51, 65, 85, 0.85));
  outline: none;
}
.chart-info-wrap:hover .chart-info-tip,
.chart-info-wrap:focus-within .chart-info-tip {
  opacity: 1;
  visibility: visible;
  transform: translateY(0);
}
.chart-info-tip {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 40;
  width: max-content;
  max-width: min(340px, 88vw);
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid var(--chart-info-tip-border, rgba(100, 116, 139, 0.5));
  background: var(--chart-info-tip-bg, rgba(15, 23, 42, 0.97));
  color: var(--chart-info-tip-fg, #cbd5e1);
  font-size: 12px;
  font-weight: 400;
  line-height: 1.45;
  text-align: left;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
  opacity: 0;
  visibility: hidden;
  transform: translateY(-4px);
  transition: opacity 0.15s, transform 0.15s, visibility 0.15s;
  pointer-events: none;
}
`

type Props = {
  text: string
  /** Rótulo para leitores de tela (padrão em português). */
  ariaLabel?: string
}

export default function ChartInfoTooltip({ text, ariaLabel = 'Informação sobre o gráfico' }: Props) {
  if (!text.trim()) return null

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: WRAP_CSS }} />
      <span className="chart-info-wrap">
        <button type="button" className="chart-info-btn" aria-label={ariaLabel} title="">
          i
        </button>
        <span className="chart-info-tip" role="tooltip">
          {text}
        </span>
      </span>
    </>
  )
}
