import type { Dispatch, SetStateAction } from 'react'
import { formatContagemLabel, inventarioAbaTitulo } from './inventarioPlanilhaModel'

export { inventarioAbaTitulo, filtrarItensPlanilhaInventario } from './inventarioPlanilhaModel'

export {
  InventarioPlanilhaTabela,
  InventarioPlanilhaArmazemDesktopTable,
  type ChecklistEditDraft,
  type InventarioPlanilhaTabelaProps,
  type InventarioPlanilhaArmazemDesktopTableProps,
} from './InventarioPlanilhaTabela'

type ArmazemGrupoTab = { contagem: number }

/** Abas do inventário (uma página = uma “aba” como na planilha). */
export function InventarioPlanilhaAbas(props: {
  armazemGrupos: ArmazemGrupoTab[]
  checklistPageSafe: number
  setChecklistPage: Dispatch<SetStateAction<number>>
  numeroContagem?: 1 | 2 | 3 | 4
  onNumeroContagemChange?: (n: 1 | 2 | 3 | 4) => void
  numeroContagemDisabled?: boolean
}) {
  const {
    armazemGrupos,
    checklistPageSafe,
    setChecklistPage,
    numeroContagem,
    onNumeroContagemChange,
    numeroContagemDisabled,
  } = props
  return (
    <div style={{ marginTop: 10, marginBottom: 10 }}>
      {numeroContagem != null && onNumeroContagemChange ? (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 10,
            marginBottom: 10,
          }}
        >
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--dis-accent, #c9a227)',
            }}
          >
            Rodada da contagem
            <select
              value={numeroContagem}
              disabled={numeroContagemDisabled}
              onChange={(e) =>
                onNumeroContagemChange(Number(e.target.value) as 1 | 2 | 3 | 4)
              }
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid var(--border, #666)',
                background: 'var(--input-bg, rgba(0,0,0,.2))',
                color: 'var(--text, #eee)',
                fontSize: 13,
                fontWeight: 700,
                minWidth: 150,
              }}
            >
              {([1, 2, 3, 4] as const).map((n) => (
                <option key={n} value={n}>
                  {formatContagemLabel(n)}
                </option>
              ))}
            </select>
          </label>
          <span style={{ fontSize: 11, color: 'var(--text, #888)' }}>
            Alterar o número atualiza toda a lista (todas as abas CAMARA/RUA) para essa rodada.
          </span>
        </div>
      ) : null}
      <div style={{ fontSize: 12, color: 'var(--text, #888)', marginBottom: 8 }}>
        Abas (uma por CAMARA/RUA): troque livremente — a contagem de todos aparece aqui (última gravação por endereço).
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {armazemGrupos.map((g, i) => {
          const active = checklistPageSafe === i + 1
          return (
            <button
              key={g.contagem}
              type="button"
              onClick={() => setChecklistPage(i + 1)}
              style={{
                padding: '8px 12px',
                borderRadius: 10,
                border: active ? '2px solid var(--border, #ccc)' : '1px solid var(--border, #666)',
                background: active ? 'rgba(255,255,255,.1)' : 'transparent',
                color: 'var(--text, #eee)',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: active ? 800 : 600,
                maxWidth: 300,
                textAlign: 'left',
              }}
            >
              {inventarioAbaTitulo(g.contagem)}
            </button>
          )
        })}
      </div>
    </div>
  )
}
