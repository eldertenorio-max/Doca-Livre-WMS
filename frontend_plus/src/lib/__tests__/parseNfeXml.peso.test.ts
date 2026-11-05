import { describe, expect, it } from 'vitest'
import { distribuirPesoBrutoNosItens } from '../parseNfeXml'
import type { NfeItem } from '../../types'

describe('distribuirPesoBrutoNosItens', () => {
  it('distribui pesoB do transporte proporcional ao peso liquido dos itens', () => {
    const items: NfeItem[] = [
      {
        index: 0,
        codigo: '4152168',
        descricao: '9369 - FRANGO CONG PCT CX VAR STA CEC',
        quantidade: 660,
        unidade: 'CX',
        allocatedAddresses: [],
        pesoLiquido: 13_697.32,
      },
      {
        index: 1,
        codigo: '5035900',
        descricao: '9140 - COXA E SOBRECOXA CARNE FGO CON PCT CX20KG STA CEC',
        quantidade: 660,
        unidade: 'CX',
        allocatedAddresses: [],
        pesoLiquido: 13_200,
      },
    ]

    distribuirPesoBrutoNosItens(items, { pesoBruto: 27_794.92, pesoLiquido: 26_897.32 })

    const somaBruto = items.reduce((s, it) => s + (it.pesoBruto ?? 0), 0)
    expect(somaBruto).toBeCloseTo(27_794.92, 2)
    expect(items[0].pesoBruto).toBeGreaterThan(items[0].pesoLiquido ?? 0)
    expect(items[1].pesoBruto).toBeGreaterThan(items[1].pesoLiquido ?? 0)
  })
})
