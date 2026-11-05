export type CapturaLinhaMobileItem = {
  id: string
  numero: number
  codigo: string
  descricao: string
  quantidade: string
  data?: string
  hora?: string
  camara?: string
  conferente?: string
  endereco?: string
  up?: string
  lote?: string
  fabricacao?: string
  validade?: string
  editando?: boolean
  enderecoRepetido?: boolean
}

type Props = {
  linhas: CapturaLinhaMobileItem[]
  readonly?: boolean
  onEdit?: (id: string) => void
  onDelete?: (id: string) => void
}

function Detalhe({ label, value }: { label: string; value?: string }) {
  const v = value?.trim()
  if (!v || v === '—') return null
  return (
    <span className="inv-cap__linha-detalhe">
      <span className="inv-cap__linha-detalhe-label">{label}</span>
      <span className="inv-cap__linha-detalhe-val">{v}</span>
    </span>
  )
}

export default function CapturaLinhasMobile({ linhas, readonly, onEdit, onDelete }: Props) {
  return (
    <ul className="inv-cap__linhas-mobile" aria-label="Linhas salvas">
      {linhas.map((linha) => (
        <li
          key={linha.id}
          className={`inv-cap__linha-card${linha.editando ? ' inv-cap__linha-card--editando' : ''}${linha.enderecoRepetido ? ' inv-cap__linha-card--endereco-repetido' : ''}`}
        >
          <div className="inv-cap__linha-card-top">
            <span className="inv-cap__linha-card-num">#{linha.numero}</span>
            <span className="inv-cap__linha-card-cod">{linha.codigo}</span>
            <span className="inv-cap__linha-card-qtd">{linha.quantidade}</span>
          </div>
          <p className="inv-cap__linha-card-desc">{linha.descricao || '—'}</p>
          <div className="inv-cap__linha-card-detalhes">
            {linha.data || linha.hora ? (
              <span className="inv-cap__linha-detalhe inv-cap__linha-detalhe--wide">
                <span className="inv-cap__linha-detalhe-label">Registro</span>
                <span className="inv-cap__linha-detalhe-val">
                  {[linha.data, linha.hora].filter(Boolean).join(' · ')}
                </span>
              </span>
            ) : null}
            <Detalhe label="Câm." value={linha.camara} />
            <Detalhe label="Conf." value={linha.conferente} />
            <Detalhe label="End." value={linha.endereco} />
            <Detalhe label="UP" value={linha.up} />
            <Detalhe label="Lote" value={linha.lote} />
            <Detalhe label="Fab." value={linha.fabricacao} />
            <Detalhe label="Val." value={linha.validade} />
          </div>
          {!readonly ? (
            <div className="inv-cap__linha-card-acoes">
              <button type="button" className="inv-cap__linha-btn" onClick={() => onEdit?.(linha.id)}>
                Editar
              </button>
              <button
                type="button"
                className="inv-cap__linha-btn inv-cap__linha-btn--danger"
                onClick={() => onDelete?.(linha.id)}
              >
                Excluir
              </button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  )
}
