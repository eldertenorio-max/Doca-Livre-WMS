import type { ContagemDiariaSessao } from './contagemDiariaSessaoTypes'
import type { InventarioSessao } from './inventarioSessaoTypes'
import { ymdSpFromIso } from './inventarioSessaoFinalizeSync'

export function contagemDiariaSessaoFinalizada(s: ContagemDiariaSessao): boolean {
  return s.status === 'fechado' || Boolean(s.dataFim)
}

export function inventarioSessaoFinalizado(s: InventarioSessao): boolean {
  return s.status === 'fechado' || Boolean(s.dataFim)
}

function ymdValido(ymd: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd)
}

/** Datas candidatas para filtro de período (contagem diária). */
export function contagemDiariaDatasReferenciaYmd(s: ContagemDiariaSessao): string[] {
  const out: string[] = []
  const dc = String(s.dataContagem ?? '').slice(0, 10)
  if (ymdValido(dc)) out.push(dc)
  if (s.dataFim) {
    const df = ymdSpFromIso(s.dataFim)
    if (ymdValido(df)) out.push(df)
  }
  const di = ymdSpFromIso(s.dataInicio)
  if (ymdValido(di)) out.push(di)
  return [...new Set(out)]
}

/** Datas candidatas para filtro de período (inventário). */
export function inventarioDatasReferenciaYmd(s: InventarioSessao): string[] {
  const out: string[] = []
  if (s.dataFim) {
    const df = ymdSpFromIso(s.dataFim)
    if (ymdValido(df)) out.push(df)
  }
  const di = ymdSpFromIso(s.dataInicio)
  if (ymdValido(di)) out.push(di)
  return [...new Set(out)]
}

export function sessaoDatasNoPeriodo(
  datas: string[],
  opts: {
    allTime: boolean
    startDate: string
    endDate: string
    useSingleDay: boolean
    singleDay: string
  },
): boolean {
  if (opts.allTime) return true
  if (!datas.length) return false
  if (opts.useSingleDay) return datas.some((ymd) => ymd === opts.singleDay)
  return datas.some((ymd) => ymd >= opts.startDate && ymd <= opts.endDate)
}

type SessaoComStatus = {
  status: 'aberto' | 'fechado'
  dataFim: string | null
}

/** Aplica status/dataFim do cache local quando a sessão foi finalizada neste aparelho. */
export function mergeSessaoStatusComFontesLocais<T extends SessaoComStatus>(
  sessao: T,
  fontes: Array<Partial<T> | null | undefined>,
): T {
  let status = sessao.status
  let dataFim = sessao.dataFim
  for (const fonte of fontes) {
    if (!fonte) continue
    if (fonte.status === 'fechado') {
      status = 'fechado'
      dataFim = fonte.dataFim ?? dataFim
    }
  }
  return { ...sessao, status, dataFim }
}
