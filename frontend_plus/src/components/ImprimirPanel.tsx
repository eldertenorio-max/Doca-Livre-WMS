import { useMemo, useState } from 'react'
import { CAMARAS } from '../layout/camaras'

type Props = {
  selectedCamaras: number[]
  onToggleCamara: (id: number) => void
  onSelectAll: () => void
  onClearAll: () => void
  onPrint: (withOccupancy: boolean, orientacao: 'landscape' | 'portrait') => void
}

export function ImprimirPanel({
  selectedCamaras,
  onToggleCamara,
  onSelectAll,
  onClearAll,
  onPrint,
}: Props) {
  const [orientacao, setOrientacao] = useState<'landscape' | 'portrait'>('landscape')
  const totalFolhas = useMemo(() => {
    return CAMARAS.filter((c) => selectedCamaras.includes(c.id)).reduce((s, c) => s + c.ruas.length, 0)
  }, [selectedCamaras])

  const disabled = selectedCamaras.length === 0

  return (
    <div className="imprimir-panel">
      <div className="sidebar-block">
        <div className="imprimir-toolbar">
          <h4>Câmaras</h4>
          <div className="imprimir-toolbar-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={onSelectAll}>
              Todas
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClearAll}>
              Limpar
            </button>
          </div>
        </div>

        <ul className="imprimir-cam-list">
          {CAMARAS.map((cam) => {
            const checked = selectedCamaras.includes(cam.id)
            return (
              <li key={cam.id}>
                <label className="imprimir-cam-item">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggleCamara(cam.id)}
                  />
                  <span>
                    <strong>Câmara {cam.id}</strong>
                    <span className="muted"> · {cam.ruas.length} ruas ({cam.ruas.map((r) => `R${r.rua}`).join(' + ')})</span>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
      </div>

      <div className="sidebar-block">
        <h4>Orientação</h4>
        <div className="imprimir-orientacao">
          <label className="imprimir-orient-item">
            <input
              type="radio"
              name="print-orient"
              checked={orientacao === 'landscape'}
              onChange={() => setOrientacao('landscape')}
            />
            Paisagem (recomendado)
          </label>
          <label className="imprimir-orient-item">
            <input
              type="radio"
              name="print-orient"
              checked={orientacao === 'portrait'}
              onChange={() => setOrientacao('portrait')}
            />
            Retrato
          </label>
        </div>
      </div>
      <div className="imprimir-actions">
        <button
          type="button"
          className="btn primary full"
          disabled={disabled}
          onClick={() => onPrint(true, orientacao)}
        >
          Imprimir mapa preenchido ({totalFolhas} folha{totalFolhas !== 1 ? 's' : ''})
        </button>
        <button
          type="button"
          className="btn full"
          disabled={disabled}
          onClick={() => onPrint(false, orientacao)}
        >
          Imprimir layout em branco ({totalFolhas} folha{totalFolhas !== 1 ? 's' : ''})
        </button>
      </div>
    </div>
  )
}
