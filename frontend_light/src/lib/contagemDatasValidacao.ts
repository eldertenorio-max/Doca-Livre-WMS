/**
 * Datas em formato YYYY-MM-DD (input type="date").
 * Alinhado à validação ao finalizar a lista em ContagemEstoque.
 */
export function todayYmdLocal(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Valor máximo do input `type="date"` para data de fabricação (hoje, horário local). */
export function maxDataFabricacaoHoje(): string {
  return todayYmdLocal()
}

export function isFabricacaoAposHoje(
  dataFabricacao: string | null | undefined,
  hojeYmd = todayYmdLocal(),
): boolean {
  const dfRaw = String(dataFabricacao ?? '').trim()
  if (!dfRaw || !/^\d{4}-\d{2}-\d{2}$/.test(dfRaw)) return false
  return dfRaw > hojeYmd
}

/** Impede data de fabricação futura ao digitar/selecionar no calendário. */
export function clampDataFabricacaoYmd(value: string, hojeYmd = todayYmdLocal()): string {
  const v = String(value ?? '').trim()
  if (!v) return ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return v
  return v > hojeYmd ? hojeYmd : v
}

/** Vencimento estritamente antes da fabricação. */
export function isVencimentoAntesFabricacao(
  dataFabricacao: string | null | undefined,
  dataValidade: string | null | undefined,
): boolean {
  const dfRaw = String(dataFabricacao ?? '').trim()
  const dvRaw = String(dataValidade ?? '').trim()
  if (!dfRaw || !dvRaw) return false
  return dvRaw < dfRaw
}

export function isDatasProdutoContagemInvalidas(
  dataFabricacao: string | null | undefined,
  dataValidade: string | null | undefined,
): boolean {
  return isFabricacaoAposHoje(dataFabricacao) || isVencimentoAntesFabricacao(dataFabricacao, dataValidade)
}
