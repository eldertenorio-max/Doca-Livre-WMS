export type EntradaItemCampos = {
  up?: string
  lote?: string
  dataFabricacao?: string
  dataValidade?: string
}

export function todayDateInputMax(): string {
  const d = new Date()
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-')
}

export function normalizeDataFabricacao(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  const max = todayDateInputMax()
  return trimmed > max ? max : trimmed
}

export function pickItemCampos(fields: EntradaItemCampos): EntradaItemCampos {
  const out: EntradaItemCampos = {}
  const up = fields.up?.trim()
  const lote = fields.lote?.trim()
  const dataFabricacao = normalizeDataFabricacao(fields.dataFabricacao ?? '')
  const dataValidade = fields.dataValidade?.trim()
  if (up) out.up = up
  if (lote) out.lote = lote
  if (dataFabricacao) out.dataFabricacao = dataFabricacao
  if (dataValidade) out.dataValidade = dataValidade
  return out
}
