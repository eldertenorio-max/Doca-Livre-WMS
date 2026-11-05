import { useState } from 'react'
import { parsePaletesInput } from '../lib/paletes'

type Props = {
  titulo: string
  descricao?: string
  botaoConfirmar: string
  onConfirm: (paletes: number) => void
  onCancel: () => void
  erro?: string | null
}

export function ConsultaPaletesForm({
  titulo,
  descricao,
  botaoConfirmar,
  onConfirm,
  onCancel,
  erro,
}: Props) {
  const [paletes, setPaletes] = useState('1')
  const [erroLocal, setErroLocal] = useState<string | null>(null)

  function handleConfirm() {
    const n = parsePaletesInput(paletes)
    if (n == null || n <= 0) {
      setErroLocal('Informe a quantidade de paletes (número inteiro maior que zero).')
      return
    }
    setErroLocal(null)
    onConfirm(n)
  }

  return (
    <div className="consulta-paletes-form">
      <h4 className="consulta-item-manual-titulo">{titulo}</h4>
      {descricao && <p className="muted consulta-paletes-desc">{descricao}</p>}
      <label className="manual-nf-field">
        <span>Quantidade de paletes</span>
        <input
          type="number"
          min={1}
          step={1}
          className="input-nf"
          value={paletes}
          onChange={(e) => setPaletes(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleConfirm()}
        />
      </label>
      {(erro || erroLocal) && <p className="error">{erro ?? erroLocal}</p>}
      <div className="consulta-item-manual-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancelar
        </button>
        <button type="button" className="btn primary" onClick={handleConfirm}>
          {botaoConfirmar}
        </button>
      </div>
    </div>
  )
}
