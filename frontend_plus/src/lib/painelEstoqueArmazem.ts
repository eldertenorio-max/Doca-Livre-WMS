import { CAMARAS, isClickable, listAllAddresses, parseAddressId } from '../layout/camaras'
import { itemNoStage } from '../layout/stage'
import type { NfeItem, NotaFiscal } from '../types'

export type ResumoCamaraEstoque = {
  camaraId: number
  label: string
  posicoesTotal: number
  posicoesOcupadas: number
  posicoesLivres: number
  valorArmazenado: number
  valorPaletes: number
  ocupacaoPct: number
  qtdItens: number
  qtdNotas: number
}

export type ResumoTotalEstoque = {
  posicoesTotal: number
  posicoesOcupadas: number
  posicoesLivres: number
  paletesArmazenados: number
  valorTotalArmazenado: number
  valorPaletesArmazenado: number
  ocupacaoPct: number
  valorStage: number
}

export type ResumoEstoqueArmazem = {
  camaras: ResumoCamaraEstoque[]
  total: ResumoTotalEstoque
}

function valorPorEndereco(item: NfeItem): number {
  if (item.valorTotal == null || item.valorTotal <= 0) return 0
  const n = item.allocatedAddresses.length
  if (n === 0) return 0
  return item.valorTotal / n
}

export function calcularResumoEstoqueArmazem(notas: NotaFiscal[]): ResumoEstoqueArmazem {
  const porCamara = new Map<
    number,
    { total: number; ocupadas: Set<string>; valor: number; itens: Set<string>; notas: Set<string> }
  >()

  for (const cam of CAMARAS) {
    porCamara.set(cam.id, { total: 0, ocupadas: new Set(), valor: 0, itens: new Set(), notas: new Set() })
  }

  for (const slot of listAllAddresses()) {
    if (!isClickable(slot.kind)) continue
    const bucket = porCamara.get(slot.camara)
    if (bucket) bucket.total++
  }

  let valorTotalArmazenado = 0
  let valorStage = 0
  let paletesOcupadosTotal = 0

  for (const nf of notas) {
    for (const item of nf.items) {
      const temEndereco = item.allocatedAddresses.length > 0
      const noStage = itemNoStage(item)
      if (!temEndereco && !noStage) continue

      valorTotalArmazenado += item.valorTotal ?? 0

      if (noStage) {
        valorStage += item.valorTotal ?? 0
        continue
      }

      const vEnd = valorPorEndereco(item)
      const itemKey = `${nf.id}:${item.index}`
      const camarasDoItem = new Set<number>()
      for (const addr of item.allocatedAddresses) {
        const p = parseAddressId(addr)
        if (!p) continue
        paletesOcupadosTotal++
        const bucket = porCamara.get(p.camara)
        if (bucket) {
          bucket.ocupadas.add(addr)
          bucket.valor += vEnd
          camarasDoItem.add(p.camara)
        }
      }
      for (const camId of camarasDoItem) {
        const bucket = porCamara.get(camId)
        if (bucket) {
          bucket.itens.add(itemKey)
          bucket.notas.add(nf.id)
        }
      }
    }
  }

  const camaras: ResumoCamaraEstoque[] = CAMARAS.map((cam) => {
    const b = porCamara.get(cam.id)!
    const ocupadas = b.ocupadas.size
    const livres = Math.max(0, b.total - ocupadas)
    const pct = b.total > 0 ? (ocupadas / b.total) * 100 : 0
    return {
      camaraId: cam.id,
      label: `Cam. ${cam.id}`,
      posicoesTotal: b.total,
      posicoesOcupadas: ocupadas,
      posicoesLivres: livres,
      valorArmazenado: b.valor,
      valorPaletes: b.valor,
      ocupacaoPct: pct,
      qtdItens: b.itens.size,
      qtdNotas: b.notas.size,
    }
  })

  const posTotal = camaras.reduce((s, c) => s + c.posicoesTotal, 0)
  const posOcup = camaras.reduce((s, c) => s + c.posicoesOcupadas, 0)
  const valorPaletesTotal = camaras.reduce((s, c) => s + c.valorPaletes, 0)

  return {
    camaras,
    total: {
      posicoesTotal: posTotal,
      posicoesOcupadas: posOcup,
      posicoesLivres: Math.max(0, posTotal - posOcup),
      paletesArmazenados: paletesOcupadosTotal,
      valorTotalArmazenado,
      valorPaletesArmazenado: valorPaletesTotal,
      ocupacaoPct: posTotal > 0 ? (posOcup / posTotal) * 100 : 0,
      valorStage,
    },
  }
}
