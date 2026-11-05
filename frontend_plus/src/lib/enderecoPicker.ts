import {
  CAMARAS,
  cellKind,
  isClickable,
  makeAddressId,
  NIVEIS,
  type CamaraConfig,
} from '../layout/camaras'
import type { AddressId } from '../types'

export type EnderecoPickerValores = {
  camara: number | ''
  rua: number | ''
  col: number | ''
  nivel: number | ''
}

export const ENDERECO_PICKER_VAZIO: EnderecoPickerValores = {
  camara: '',
  rua: '',
  col: '',
  nivel: '',
}

export function opcoesCamara(): CamaraConfig[] {
  return CAMARAS
}

export function opcoesRua(camaraId: number | ''): number[] {
  if (camaraId === '') return []
  const cam = CAMARAS.find((c) => c.id === camaraId)
  return cam?.ruas.map((r) => r.rua) ?? []
}

export function opcoesColuna(camaraId: number | '', rua: number | ''): number[] {
  if (camaraId === '' || rua === '') return []
  const cam = CAMARAS.find((c) => c.id === camaraId)
  const cfg = cam?.ruas.find((r) => r.rua === rua)
  if (!cfg) return []
  return Array.from({ length: cfg.colunas }, (_, i) => i + 1)
}

export function opcoesNivel(
  camaraId: number | '',
  rua: number | '',
  col: number | '',
  ocupados: Set<AddressId>,
  permitirOcupado?: AddressId,
): number[] {
  if (camaraId === '' || rua === '' || col === '') return []
  const cam = CAMARAS.find((c) => c.id === camaraId)
  const cfg = cam?.ruas.find((r) => r.rua === rua)
  if (!cfg) return []

  const niveis: number[] = []
  for (const nivel of NIVEIS) {
    const kind = cellKind(
      col,
      nivel,
      cfg.colunas,
      cfg.porta,
      cfg.semNivel5Inexistente !== false,
      cfg.colunasBloqueadas,
      cfg.celulasBloqueadas,
    )
    if (!isClickable(kind)) continue
    const id = makeAddressId(camaraId, rua, nivel, col)
    if (!ocupados.has(id) || id === permitirOcupado) niveis.push(nivel)
  }
  return niveis
}

export function enderecoFromPicker(v: EnderecoPickerValores): AddressId | null {
  if (v.camara === '' || v.rua === '' || v.col === '' || v.nivel === '') return null
  return makeAddressId(v.camara, v.rua, v.nivel, v.col)
}

export function pickerFromAddressId(id: AddressId): EnderecoPickerValores {
  const m = id.match(/^C(\d+)-R(\d+)-N(\d+)-P(\d+)$/)
  if (!m) return { ...ENDERECO_PICKER_VAZIO }
  return {
    camara: Number(m[1]),
    rua: Number(m[2]),
    nivel: Number(m[3]),
    col: Number(m[4]),
  }
}
