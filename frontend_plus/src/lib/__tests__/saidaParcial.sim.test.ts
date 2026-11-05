import { describe, expect, it } from 'vitest'
import {
  LIMITES_SAIDA,
  NF_ID,
  ITEM_INDEX,
  nfEntrada385,
  paletesSaida200,
  persistedEntrada385,
} from './fixtures/cenario385'
import {
  contarEnderecosPersistidos,
  criarMovimentoSaida,
  enderecosLiberadosPorSaidas,
  recuperarEnderecosPerdidos,
} from '../movimentos'
import { normalizePersistedData } from '../persistence'
import {
  aplicarSaidaPaletes,
  distribuirCaixasSaidaEntrePaletes,
  enderecosALiberar,
} from '../saidaParcial'
import {
  mergePersistedData,
  protegerPersistedContraRegressao,
  consolidarRemocoesLocais,
} from '../syncMerge'

describe('Simulação: saída parcial 200 cx / 5 paletes (NF 385 cx, 10 paletes)', () => {
  const nf = nfEntrada385()
  const paletes = paletesSaida200()

  it('distribui 200 caixas entre 5 paletes (40 cada)', () => {
    expect(distribuirCaixasSaidaEntrePaletes(200, 5)).toEqual([40, 40, 40, 40, 40])
    expect(paletes.reduce((s, p) => s + p.quantidadeCaixas, 0)).toBe(200)
  })

  it('libera exatamente os 5 endereços confirmados na saída multi-palete', () => {
    const liberar = enderecosALiberar(nf, paletes, LIMITES_SAIDA)
    expect(liberar).toHaveLength(5)
    expect(liberar.sort()).toEqual(paletes.map((p) => p.addressId).sort())
  })

  it('aplica saída: 10 → 5 posições e saldo 385 → 185 caixas', () => {
    const depois = aplicarSaidaPaletes(nf, paletes, LIMITES_SAIDA)
    const item = depois.items.find((it) => it.index === ITEM_INDEX)!
    expect(item.allocatedAddresses).toHaveLength(5)
    expect(item.quantidade).toBeCloseTo(185, 6)
    const removidos = nf.items[0].allocatedAddresses.filter(
      (a) => !item.allocatedAddresses.includes(a),
    )
    expect(removidos).toHaveLength(5)
    expect(paletes.every((p) => removidos.includes(p.addressId))).toBe(true)
  })

  it('finaliza saída: movimento marca paletes liberados e gravação não repõe endereços', () => {
    const nfDepois = aplicarSaidaPaletes(nf, paletes, LIMITES_SAIDA)
    const liberar = enderecosALiberar(nf, paletes, LIMITES_SAIDA)
    const movSaida = criarMovimentoSaida(
      nf,
      liberar,
      'venda',
      undefined,
      paletes,
      { limitesPorItem: LIMITES_SAIDA },
    )

    expect(movSaida.itens.filter((it) => (it.paletes ?? 0) >= 1)).toHaveLength(5)

    const antesSave = contarEnderecosPersistidos({
      notas: [nfDepois],
      movimentos: [persistedEntrada385().movimentos[0], movSaida],
      notasCanceladas: [],
      emitentes: [],
    })
    expect(antesSave).toBe(5)

    const gravado = normalizePersistedData(
      {
        notas: [nfDepois],
        movimentos: [persistedEntrada385().movimentos[0], movSaida],
        notasCanceladas: [],
        emitentes: [],
      },
      { reparar: false },
    )
    expect(contarEnderecosPersistidos(gravado)).toBe(5)
    expect(gravado.notas[0].items[0].allocatedAddresses).toHaveLength(5)
  })

  it('reload (F5): reparo não restaura posições já liberadas pela saída', () => {
    const nfDepois = aplicarSaidaPaletes(nf, paletes, LIMITES_SAIDA)
    const movEntrada = persistedEntrada385().movimentos[0]
    const movSaida = criarMovimentoSaida(
      nf,
      enderecosALiberar(nf, paletes, LIMITES_SAIDA),
      'venda',
      undefined,
      paletes,
      { limitesPorItem: LIMITES_SAIDA },
    )

    const liberados = enderecosLiberadosPorSaidas([movSaida], NF_ID, ITEM_INDEX)
    expect(liberados.size).toBe(5)

    const itemSemEndereco = {
      ...nfDepois.items[0],
      allocatedAddresses: [] as string[],
    }
    const corrompido = {
      notas: [{ ...nfDepois, items: [itemSemEndereco] }],
      movimentos: [movEntrada, movSaida],
      notasCanceladas: [],
      emitentes: [],
    }

    const reparado = normalizePersistedData(corrompido, { reparar: true })
    const enderecos = reparado.notas[0].items[0].allocatedAddresses

    expect(enderecos).toHaveLength(5)
    for (const addr of liberados) {
      expect(enderecos).not.toContain(addr)
    }
    expect(contarEnderecosPersistidos(reparado)).toBe(5)
  })

  it('reload (F5): DB com 10 posições + movimento saída corrige para 5', () => {
    const nfDepois = aplicarSaidaPaletes(nf, paletes, LIMITES_SAIDA)
    const movEntrada = persistedEntrada385().movimentos[0]
    const movSaida = criarMovimentoSaida(
      nf,
      enderecosALiberar(nf, paletes, LIMITES_SAIDA),
      'venda',
      undefined,
      paletes,
      { limitesPorItem: LIMITES_SAIDA },
    )

    // Simula Supabase desatualizado: endereçamentos ainda com 10 posições.
    const dbDesatualizado = {
      notas: [{ ...nf, items: [{ ...nf.items[0], allocatedAddresses: nf.items[0].allocatedAddresses }] }],
      movimentos: [movEntrada, movSaida],
      notasCanceladas: [],
      emitentes: [],
    }

    const carregado = normalizePersistedData(dbDesatualizado, { reparar: true })
    expect(contarEnderecosPersistidos(carregado)).toBe(5)
    expect(carregado.notas[0].items[0].allocatedAddresses).toHaveLength(5)
  })

  it('persistência: redução de endereços grava estado local sem merge anti-regressão', () => {
    const base = persistedEntrada385()
    const nfDepois = aplicarSaidaPaletes(nf, paletes, LIMITES_SAIDA)
    const movSaida = criarMovimentoSaida(
      nf,
      enderecosALiberar(nf, paletes, LIMITES_SAIDA),
      'venda',
      undefined,
      paletes,
      { limitesPorItem: LIMITES_SAIDA },
    )
    const local = {
      notas: [nfDepois],
      movimentos: [base.movimentos[0], movSaida],
      notasCanceladas: [],
      emitentes: [],
    }

    const viaMerge = normalizePersistedData(
      protegerPersistedContraRegressao(
        local,
        consolidarRemocoesLocais(
          base,
          local,
          mergePersistedData(base, local, base),
        ),
      ),
      { reparar: false },
    )
    const viaDireto = normalizePersistedData(local, { reparar: false })

    expect(contarEnderecosPersistidos(viaMerge)).toBe(5)
    expect(contarEnderecosPersistidos(viaDireto)).toBe(5)
    expect(viaDireto.notas[0].items[0].allocatedAddresses).toHaveLength(5)
  })

  it('saída parcial em 1 palete não libera posição se não esvaziou o palete', () => {
    const unico = paletes[0]
    const parcial = [{ ...unico, quantidadeCaixas: 20 }]
    const liberar = enderecosALiberar(nf, parcial, LIMITES_SAIDA)
    expect(liberar).toHaveLength(0)

    const depois = aplicarSaidaPaletes(nf, parcial, LIMITES_SAIDA)
    expect(depois.items[0].allocatedAddresses).toHaveLength(10)
  })
})

describe('Simulação: recuperarEnderecosPerdidos respeita histórico de saída', () => {
  it('não recoloca endereços liberados quando item ficou vazio após saída total do saldo XML', () => {
    const nf = nfEntrada385()
    const paletes = paletesSaida200()
    const movEntrada = persistedEntrada385().movimentos[0]
    const movSaida = criarMovimentoSaida(
      nf,
      enderecosALiberar(nf, paletes, LIMITES_SAIDA),
      'venda',
      undefined,
      paletes,
      { limitesPorItem: LIMITES_SAIDA },
    )

    const data = {
      notas: [
        {
          ...aplicarSaidaPaletes(nf, paletes, LIMITES_SAIDA),
          items: [
            {
              ...aplicarSaidaPaletes(nf, paletes, LIMITES_SAIDA).items[0],
              allocatedAddresses: [],
            },
          ],
        },
      ],
      movimentos: [movEntrada, movSaida],
      notasCanceladas: [],
      emitentes: [],
    }

    const reparado = recuperarEnderecosPerdidos(data)
    const enderecos = reparado.notas[0].items[0].allocatedAddresses
    const liberados = enderecosLiberadosPorSaidas([movSaida], NF_ID, ITEM_INDEX)

    for (const addr of enderecos) {
      expect(liberados.has(addr)).toBe(false)
    }
    expect(enderecos.length).toBeLessThanOrEqual(5)
  })
})
