import { describe, expect, it, vi, afterEach } from 'vitest'
import * as ambiente from '../appAmbiente'
import { podeZerarBancoHomologacao, PRESERVADO_ZERAR_HOMOLOG, TABELAS_PRESERVAR_HOMOLOG, TABELAS_ZERAR_HOMOLOG } from '../homologZerarBanco'

describe('podeZerarBancoHomologacao', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('permite somente em homologação', () => {
    vi.spyOn(ambiente, 'isHomologacao').mockReturnValue(true)
    vi.spyOn(ambiente, 'isProducao').mockReturnValue(false)
    expect(podeZerarBancoHomologacao()).toBe(true)
  })

  it('bloqueia em produção', () => {
    vi.spyOn(ambiente, 'isHomologacao').mockReturnValue(false)
    vi.spyOn(ambiente, 'isProducao').mockReturnValue(true)
    expect(podeZerarBancoHomologacao()).toBe(false)
  })

  it('bloqueia quando ambiente não é homolog', () => {
    vi.spyOn(ambiente, 'isHomologacao').mockReturnValue(false)
    vi.spyOn(ambiente, 'isProducao').mockReturnValue(false)
    expect(podeZerarBancoHomologacao()).toBe(false)
  })

  it('não apaga cadastro financeiro nem lógica de cobrança', () => {
    const zeradas = new Set(TABELAS_ZERAR_HOMOLOG.map((t) => t.table))
    for (const preservada of TABELAS_PRESERVAR_HOMOLOG) {
      expect(zeradas.has(preservada)).toBe(false)
    }
    expect(PRESERVADO_ZERAR_HOMOLOG).toMatch(/lógica de cobrança/i)
  })
})
