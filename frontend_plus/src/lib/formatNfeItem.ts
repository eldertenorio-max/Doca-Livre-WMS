export function formatValorNfe(value: number | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export function formatPesoBruto(value: number | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  })
}

export function formatQuantidadeNfe(value: number): string {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  })
}
