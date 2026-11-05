import { TABLE_CONTAGEM_DIARIA } from './contagensDb'
import {
  buildContagensSelect,
  parseMissingColumnFromError,
  persistAbsentContagensColumns,
  readAbsentContagensColumns,
} from './contagensSelectCompat'
import { supabase } from './supabaseClient'
import { isColumnMissingError } from './supabaseError'

export type PainelContagemDiaria = {
  hojeYmd: string
  itensHoje: number
  conferentesHoje: number
  produtosDistintosHoje: number
  presencaHoje: number
  serieUltimosDias: { label: string; value: number; ymd: string }[]
}

function todaySpYmd(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}

function ymdDaysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)
}

function labelDiaBR(ymd: string): string {
  const [, m, day] = ymd.split('-')
  return `${day}/${m}`
}

type PainelRow = {
  data_contagem: string
  conferente_id: string
  codigo_interno: string
  contagem_rascunho?: boolean
  origem?: string
}

async function fetchPainelRows(desdeYmd: string, hojeYmd: string): Promise<PainelRow[]> {
  let absent = readAbsentContagensColumns(TABLE_CONTAGEM_DIARIA)
  const acc: PainelRow[] = []

  for (let attempt = 0; attempt < 8; attempt++) {
    const selectStr = buildContagensSelect(TABLE_CONTAGEM_DIARIA, absent, [
      'data_contagem',
      'conferente_id',
      'codigo_interno',
      'contagem_rascunho',
      'origem',
    ])

    acc.length = 0
    let queryError: unknown = null

    for (let from = 0; from < 50000; from += 1000) {
      const { data, error } = await supabase
        .from(TABLE_CONTAGEM_DIARIA)
        .select(selectStr)
        .gte('data_contagem', desdeYmd)
        .lte('data_contagem', hojeYmd)
        .range(from, from + 999)

      if (error) {
        queryError = error
        break
      }
      if (!data?.length) break

      for (const r of data) {
        const row = r as PainelRow
        if (row.contagem_rascunho === true) continue
        if (row.origem === 'inventario') continue
        acc.push({
          data_contagem: row.data_contagem,
          conferente_id: row.conferente_id,
          codigo_interno: row.codigo_interno,
        })
      }
      if (data.length < 1000) break
    }

    if (!queryError) return acc
    if (!isColumnMissingError(queryError)) return []

    const col = parseMissingColumnFromError(queryError)
    if (!col || absent.has(col)) return []
    absent.add(col)
    persistAbsentContagensColumns(TABLE_CONTAGEM_DIARIA, absent)
  }

  return acc
}

export async function fetchPainelContagemDiaria(): Promise<PainelContagemDiaria> {
  const hojeYmd = todaySpYmd()
  const desdeYmd = ymdDaysAgo(6)
  const rows = await fetchPainelRows(desdeYmd, hojeYmd)

  const hojeRows = rows.filter((r) => r.data_contagem === hojeYmd)
  const conferentes = new Set(hojeRows.map((r) => r.conferente_id).filter(Boolean))
  const produtos = new Set(hojeRows.map((r) => r.codigo_interno).filter(Boolean))

  const porDia = new Map<string, number>()
  for (let i = 6; i >= 0; i--) {
    porDia.set(ymdDaysAgo(i), 0)
  }
  for (const r of rows) {
    porDia.set(r.data_contagem, (porDia.get(r.data_contagem) ?? 0) + 1)
  }
  const serieUltimosDias = [...porDia.entries()].map(([ymd, value]) => ({
    ymd,
    label: labelDiaBR(ymd),
    value,
  }))

  let presencaHoje = 0
  const { count } = await supabase
    .from('contagem_diaria_presenca')
    .select('conferente_id', { count: 'exact', head: true })
    .eq('data_contagem', hojeYmd)
  if (count != null) presencaHoje = count

  return {
    hojeYmd,
    itensHoje: hojeRows.length,
    conferentesHoje: conferentes.size,
    produtosDistintosHoje: produtos.size,
    presencaHoje,
    serieUltimosDias,
  }
}
