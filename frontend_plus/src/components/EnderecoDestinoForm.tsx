import { useMemo, useState } from 'react'
import {
  ENDERECO_PICKER_VAZIO,
  enderecoFromPicker,
  opcoesCamara,
  opcoesColuna,
  opcoesNivel,
  opcoesRua,
  type EnderecoPickerValores,
} from '../lib/enderecoPicker'
import { formatAddressLabel } from '../layout/camaras'
import type { AddressId } from '../types'

type Props = {
  ocupados: Set<AddressId>
  selecionados: Set<AddressId>
  onConfirmar: (addressId: AddressId) => void
}

export function EnderecoDestinoForm({ ocupados, selecionados, onConfirmar }: Props) {
  const [valores, setValores] = useState<EnderecoPickerValores>({ ...ENDERECO_PICKER_VAZIO })
  const [erro, setErro] = useState<string | null>(null)

  const ruas = useMemo(() => opcoesRua(valores.camara), [valores.camara])
  const cols = useMemo(
    () => opcoesColuna(valores.camara, valores.rua),
    [valores.camara, valores.rua],
  )
  const niveis = useMemo(
    () => opcoesNivel(valores.camara, valores.rua, valores.col, ocupados),
    [valores.camara, valores.rua, valores.col, ocupados],
  )

  function patch(partial: Partial<EnderecoPickerValores>) {
    setErro(null)
    setValores((prev) => {
      const next = { ...prev, ...partial }
      if (partial.camara !== undefined) {
        next.rua = ''
        next.col = ''
        next.nivel = ''
      }
      if (partial.rua !== undefined) {
        next.col = ''
        next.nivel = ''
      }
      if (partial.col !== undefined) {
        next.nivel = ''
      }
      return next
    })
  }

  function handleConfirmar() {
    const id = enderecoFromPicker(valores)
    if (!id) {
      setErro('Preencha câmara, rua, posição e nível.')
      return
    }
    if (ocupados.has(id) && !selecionados.has(id)) {
      setErro('Endereço já ocupado.')
      return
    }
    if (selecionados.has(id)) {
      setErro('Endereço já selecionado.')
      return
    }
    onConfirmar(id)
    setValores({ ...ENDERECO_PICKER_VAZIO })
    setErro(null)
  }

  const preview = enderecoFromPicker(valores)

  return (
    <div className="endereco-destino-form">
      <p className="endereco-destino-title">Endereço de destino (físico)</p>
      <div className="endereco-destino-campos">
        <label className="endereco-destino-campo">
          <span>Câmara</span>
          <select
            className="input-select input-nf--compact"
            value={valores.camara === '' ? '' : String(valores.camara)}
            onChange={(e) =>
              patch({ camara: e.target.value ? Number(e.target.value) : '' })
            }
          >
            <option value="">Selecione…</option>
            {opcoesCamara().map((c) => (
              <option key={c.id} value={c.id}>
                Câmara {c.id} · {c.tipo}
              </option>
            ))}
          </select>
        </label>
        <label className="endereco-destino-campo">
          <span>Rua</span>
          <select
            className="input-select input-nf--compact"
            value={valores.rua === '' ? '' : String(valores.rua)}
            disabled={valores.camara === ''}
            onChange={(e) => patch({ rua: e.target.value ? Number(e.target.value) : '' })}
          >
            <option value="">Selecione…</option>
            {ruas.map((r) => (
              <option key={r} value={r}>
                Rua {r}
              </option>
            ))}
          </select>
        </label>
        <label className="endereco-destino-campo">
          <span>Posição</span>
          <select
            className="input-select input-nf--compact"
            value={valores.col === '' ? '' : String(valores.col)}
            disabled={valores.rua === ''}
            onChange={(e) => patch({ col: e.target.value ? Number(e.target.value) : '' })}
          >
            <option value="">Selecione…</option>
            {cols.map((c) => (
              <option key={c} value={c}>
                Col {c}
              </option>
            ))}
          </select>
        </label>
        <label className="endereco-destino-campo">
          <span>Nível</span>
          <select
            className="input-select input-nf--compact"
            value={valores.nivel === '' ? '' : String(valores.nivel)}
            disabled={valores.col === ''}
            onChange={(e) => patch({ nivel: e.target.value ? Number(e.target.value) : '' })}
          >
            <option value="">Selecione…</option>
            {niveis.map((n) => (
              <option key={n} value={n}>
                Nív {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      {preview && (
        <p className="muted endereco-destino-preview">
          Prévia: <strong>{formatAddressLabel(preview)}</strong>
        </p>
      )}
      {erro && <p className="error">{erro}</p>}
      <button type="button" className="btn primary btn-sm" onClick={handleConfirmar}>
        Adicionar endereço
      </button>
    </div>
  )
}
