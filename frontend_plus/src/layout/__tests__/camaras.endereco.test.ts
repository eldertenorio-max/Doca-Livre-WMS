import { describe, expect, it } from 'vitest'
import {
  makeAddressId,
  parseAddressId,
  toCanonicalAddress,
} from '../camaras'

describe('máscara canônica de endereço', () => {
  it('mantém o id interno Plus', () => {
    expect(makeAddressId(6, 1, 3, 2)).toBe('C6-R1-N3-P2')
  })

  it('converte para a máscara dos três WMS', () => {
    expect(toCanonicalAddress(6, 1, 2, 3)).toBe('06-1-02-3')
  })

  it('lê id interno, voz e máscara canônica', () => {
    const interno = parseAddressId('C6-R1-N3-P2')
    const voz = parseAddressId('C6-R1-C2-N3')
    const canon = parseAddressId('06-1-02-3')
    expect(interno).toEqual({ camara: 6, rua: 1, nivel: 3, col: 2 })
    expect(voz).toEqual(interno)
    expect(canon).toEqual(interno)
  })

  it('ignora dígito verificador no final', () => {
    expect(parseAddressId('06-1-02-3*47')).toEqual({
      camara: 6,
      rua: 1,
      nivel: 3,
      col: 2,
    })
  })
})
