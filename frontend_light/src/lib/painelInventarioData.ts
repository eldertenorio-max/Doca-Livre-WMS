import { listEnderecos } from './enderecamentoStore'
import type { InventarioSessao } from './inventarioSessaoTypes'

export type PainelInventario = {
  inventariosAbertos: number
  linhasHoje: number
  linhasTotal: number
  enderecosCadastrados: number
  enderecosContadosHoje: number
  serieUltimosDias: { label: string; value: number }[]
}

function todaySpYmd(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}

function labelDiaBR(d: Date): string {
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function ymdFromIso(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)
}

export function buildPainelInventario(invs: InventarioSessao[]): PainelInventario {
  const hoje = todaySpYmd()
  const abertos = invs.filter((i) => i.status === 'aberto')
  let linhasHoje = 0
  let linhasTotal = 0
  const enderecosHoje = new Set<string>()

  for (const inv of invs) {
    for (const ln of inv.linhas) {
      linhasTotal++
      const ymd = ymdFromIso(ln.createdAt)
      if (ymd === hoje) {
        linhasHoje++
        enderecosHoje.add(ln.endereco.trim().toUpperCase())
      }
    }
  }

  const serieUltimosDias: { label: string; value: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d)
    let count = 0
    for (const inv of invs) {
      for (const ln of inv.linhas) {
        if (ymdFromIso(ln.createdAt) === ymd) count++
      }
    }
    serieUltimosDias.push({ label: labelDiaBR(d), value: count })
  }

  return {
    inventariosAbertos: abertos.length,
    linhasHoje,
    linhasTotal,
    enderecosCadastrados: listEnderecos().length,
    enderecosContadosHoje: enderecosHoje.size,
    serieUltimosDias,
  }
}
