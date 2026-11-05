import { describe, expect, it } from 'vitest'
import {
  aplicarQuantidadeComercialIrmaos,
  corrigirQuantidadeItemSePeso,
  resolverQuantidadeComercialNfe,
} from '../nfeUnidades'
import type { NfeItem } from '../../types'

describe('resolverQuantidadeComercialNfe', () => {
  it('converte peso KG + qTrib=660 (uTrib=KG) para 660 CX — frango CX VAR', () => {
    const r = resolverQuantidadeComercialNfe({
      qCom: 13697.32,
      uCom: 'KG',
      qTrib: 660,
      uTrib: 'KG',
      descricao: '9369 - FRANGO CONG PCT CX VAR STA CEC',
    })
    expect(r).toEqual({ quantidade: 660, unidade: 'CX' })
  })

  it('converte peso KG + CX20KG na descrição para 660 CX', () => {
    const r = resolverQuantidadeComercialNfe({
      qCom: 13200,
      uCom: 'KG',
      qTrib: 660,
      uTrib: 'KG',
      descricao: '9140 - COXA E SOBRECOXA CARNE FGO CON PCT CX20KG STA CEC',
    })
    expect(r).toEqual({ quantidade: 660, unidade: 'CX' })
  })

  it('deriva caixas pelo vUnTrib quando qTrib repete o peso em KG', () => {
    const r = resolverQuantidadeComercialNfe({
      qCom: 13697.32,
      uCom: 'KG',
      qTrib: 13697.32,
      uTrib: 'KG',
      vUnCom: 6.69,
      vUnTrib: 138.84,
      vProd: 91635.07,
      descricao: '9369 - FRANGO CONG PCT CX VAR STA CEC',
    })
    expect(r).toEqual({ quantidade: 660, unidade: 'CX' })
  })
})

describe('corrigirQuantidadeItemSePeso', () => {
  it('corrige item gravado com quantidade = peso quando há CX20KG na descrição', () => {
    const item: NfeItem = {
      index: 0,
      codigo: '5035900',
      descricao: '9140 - COXA E SOBRECOXA CARNE FGO CON PCT CX20KG STA CEC',
      quantidade: 13200,
      unidade: 'KG',
      allocatedAddresses: [],
      pesoBruto: 13200,
      pesoLiquido: 13200,
    }
    const fixed = corrigirQuantidadeItemSePeso(item)
    expect(fixed.quantidade).toBe(660)
    expect(fixed.unidade).toBe('CX')
    expect(fixed.pesoBruto).toBe(13200)
  })
})

describe('aplicarQuantidadeComercialIrmaos', () => {
  it('CX VAR herda caixas do item CX20KG na mesma NF', () => {
    const items: NfeItem[] = [
      {
        index: 0,
        codigo: '4152168',
        descricao: '9369 - FRANGO CONG PCT CX VAR STA CEC',
        quantidade: 13697.32,
        unidade: 'KG',
        allocatedAddresses: [],
        pesoBruto: 13697.32,
        pesoLiquido: 13697.32,
      },
      {
        index: 1,
        codigo: '5035900',
        descricao: '9140 - COXA E SOBRECOXA CARNE FGO CON PCT CX20KG STA CEC',
        quantidade: 660,
        unidade: 'CX',
        allocatedAddresses: [],
        pesoBruto: 13200,
        pesoLiquido: 13200,
      },
    ]
    aplicarQuantidadeComercialIrmaos(items)
    expect(items[0].quantidade).toBe(660)
    expect(items[0].unidade).toBe('CX')
    expect(items[0].pesoBruto).toBeCloseTo(13697.32)
    expect(items[1].quantidade).toBe(660)
  })

  it('pipeline: resolver falha no CX VAR mas irmaos corrige com dois itens', () => {
    const r1 = resolverQuantidadeComercialNfe({
      qCom: 13697.32,
      uCom: 'KG',
      qTrib: 13697.32,
      uTrib: 'KG',
      vUnCom: 6.69,
      vUnTrib: 6.69,
      vProd: 91635.07,
      descricao: '9369 - FRANGO CONG PCT CX VAR STA CEC',
    })
    const r2 = resolverQuantidadeComercialNfe({
      qCom: 13200,
      uCom: 'KG',
      qTrib: 660,
      uTrib: 'KG',
      descricao: '9140 - COXA E SOBRECOXA CARNE FGO CON PCT CX20KG STA CEC',
    })
    expect(r1.unidade).toBe('KG')
    expect(r2).toEqual({ quantidade: 660, unidade: 'CX' })

    const items: NfeItem[] = [
      {
        index: 0,
        codigo: '4152168',
        descricao: '9369 - FRANGO CONG PCT CX VAR STA CEC',
        quantidade: r1.quantidade,
        unidade: r1.unidade,
        allocatedAddresses: [],
        pesoBruto: 13697.32,
      },
      {
        index: 1,
        codigo: '5035900',
        descricao: '9140 - COXA E SOBRECOXA CARNE FGO CON PCT CX20KG STA CEC',
        quantidade: r2.quantidade,
        unidade: r2.unidade,
        allocatedAddresses: [],
        pesoBruto: 13200,
      },
    ]
    aplicarQuantidadeComercialIrmaos(items)
    expect(items[0].quantidade).toBe(660)
    expect(items[0].unidade).toBe('CX')
  })
})
