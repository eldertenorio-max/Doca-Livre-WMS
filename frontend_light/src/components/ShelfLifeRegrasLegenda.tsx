import type { CSSProperties } from 'react'

type ShelfStatusLegenda = 'Verde' | 'Amarelo' | 'Laranja' | 'Vermelho'

export const SHELF_LIFE_FAIXAS: Array<{
  status: ShelfStatusLegenda
  faixa: string
  descricao: string
  cores: { bg: string; border: string; fg: string; dot: string }
}> = [
  {
    status: 'Verde',
    faixa: '0% a 33,33%',
    descricao: 'Longe do vencimento',
    cores: {
      bg: 'rgba(34, 197, 94, 0.14)',
      border: '#16a34a',
      fg: '#bbf7d0',
      dot: '#22c55e',
    },
  },
  {
    status: 'Amarelo',
    faixa: '33,34% a 60,01%',
    descricao: 'Vencendo em breve',
    cores: {
      bg: 'rgba(234, 179, 8, 0.16)',
      border: '#ca8a04',
      fg: '#fde047',
      dot: '#eab308',
    },
  },
  {
    status: 'Laranja',
    faixa: '60,02% a 80,01%',
    descricao: 'Atenção na validade',
    cores: {
      bg: 'rgba(249, 115, 22, 0.16)',
      border: '#ea580c',
      fg: '#fdba74',
      dot: '#f97316',
    },
  },
  {
    status: 'Vermelho',
    faixa: '80,02% a 99,99%',
    descricao: 'Vencimento crítico',
    cores: {
      bg: 'rgba(239, 68, 68, 0.16)',
      border: '#dc2626',
      fg: '#fecaca',
      dot: '#ef4444',
    },
  },
]

const wrap: CSSProperties = {
  borderRadius: 12,
  border: '1px solid rgba(249, 115, 22, 0.35)',
  background: 'linear-gradient(135deg, rgba(249,115,22,.1) 0%, rgba(15,23,42,.55) 45%, rgba(15,23,42,.75) 100%)',
  padding: '14px 16px',
  display: 'grid',
  gap: 12,
}

const chipGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(168px, 1fr))',
  gap: 10,
}

type Props = {
  /** Exibe nota de que as faixas seguem a planilha CONTROLE SHELF LIFE. */
  sincronizadoPlanilha?: boolean
}

export default function ShelfLifeRegrasLegenda({ sincronizadoPlanilha }: Props) {
  return (
    <div style={wrap} role="region" aria-label="Regras de shelf life">
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: '#fb923c',
              marginBottom: 4,
            }}
          >
            Semáforo shelf life
          </div>
          <div style={{ fontWeight: 800, fontSize: 17, color: '#f8fafc', lineHeight: 1.25 }}>
            Regra por % da vida útil consumida
          </div>
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#94a3b8', maxWidth: 520, lineHeight: 1.45 }}>
            Quanto maior o percentual, mais tempo o produto já passou desde a fabricação em direção ao vencimento.
          </p>
        </div>
        {sincronizadoPlanilha ? (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '5px 10px',
              borderRadius: 999,
              border: '1px solid rgba(249,115,22,.45)',
              color: '#fdba74',
              background: 'rgba(249,115,22,.12)',
              whiteSpace: 'nowrap',
            }}
          >
            Igual à planilha
          </span>
        ) : null}
      </div>

      <div style={chipGrid}>
        {SHELF_LIFE_FAIXAS.map((f) => (
          <div
            key={f.status}
            style={{
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
              padding: '10px 12px',
              borderRadius: 10,
              border: `1px solid ${f.cores.border}`,
              background: f.cores.bg,
              boxShadow: `inset 3px 0 0 ${f.cores.dot}`,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: f.cores.dot,
                marginTop: 4,
                flexShrink: 0,
                boxShadow: `0 0 8px ${f.cores.dot}`,
              }}
            />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 14, color: f.cores.fg }}>{f.status}</div>
              <div style={{ fontSize: 12, color: '#e2e8f0', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>
                {f.faixa}
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{f.descricao}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
