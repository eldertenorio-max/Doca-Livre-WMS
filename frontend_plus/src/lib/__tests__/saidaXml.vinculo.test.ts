import { describe, expect, it } from 'vitest'
import type { NotaFiscal, SaidaXmlDocumento } from '../../types'
import { saidaXmlCorrespondeNf, vincularSaidaXmlOrigem } from '../saidaXml'
import { proximoItemSaidaPendente } from '../saidaParcial'

const nfOrigem = (): NotaFiscal => ({
  id: 'nf1',
  numero: '100',
  serie: '1',
  chave: '1',
  emitente: 'Cliente',
  dataEmissao: '2026-07-01',
  status: 'concluida',
  createdAt: '2026-07-01',
  items: [
    {
      index: 0,
      codigo: 'SKU-A',
      descricao: 'Produto A',
      quantidade: 100,
      unidade: 'CX',
      allocatedAddresses: ['A1', 'A2'],
    },
    {
      index: 1,
      codigo: 'SKU-B',
      descricao: 'Produto B',
      quantidade: 50,
      unidade: 'CX',
      allocatedAddresses: ['B1'],
    },
  ],
})

const xmlDoisItens = (): SaidaXmlDocumento => ({
  numero: '200',
  serie: '1',
  chave: '2',
  emitente: 'Cliente',
  dataEmissao: '2026-07-05',
  items: [
    {
      index: 0,
      codigo: 'SKU-A',
      descricao: 'Produto A',
      quantidade: 40,
      unidade: 'CX',
      allocatedAddresses: [],
    },
    {
      index: 1,
      codigo: 'SKU-B',
      descricao: 'Produto B',
      quantidade: 20,
      unidade: 'CX',
      allocatedAddresses: [],
    },
  ],
})

describe('vincularSaidaXmlOrigem', () => {
  it('vincula dois itens distintos do XML às linhas de estoque corretas', () => {
    const v = vincularSaidaXmlOrigem(nfOrigem(), xmlDoisItens(), 'armazem')

    expect(v.itensExibicao).toHaveLength(2)
    expect(v.itensExibicao.map((i) => i.index)).toEqual([0, 1])
    expect(v.limitesPorItem[0]).toBe(40)
    expect(v.limitesPorItem[1]).toBe(20)
    expect(v.avisos).toHaveLength(0)
  })

  it('distribui duas linhas do mesmo código entre itens de origem com o mesmo SKU', () => {
    const origem = nfOrigem()
    origem.items = [
      {
        index: 0,
        codigo: 'SKU-A',
        descricao: 'Lote 1',
        quantidade: 30,
        unidade: 'CX',
        allocatedAddresses: ['A1'],
      },
      {
        index: 1,
        codigo: 'SKU-A',
        descricao: 'Lote 2',
        quantidade: 40,
        unidade: 'CX',
        allocatedAddresses: ['A2'],
      },
    ]
    const doc: SaidaXmlDocumento = {
      ...xmlDoisItens(),
      items: [
        {
          index: 0,
          codigo: 'SKU-A',
          descricao: 'Devolução lote 1',
          quantidade: 30,
          unidade: 'CX',
          allocatedAddresses: [],
        },
        {
          index: 1,
          codigo: 'SKU-A',
          descricao: 'Devolução lote 2',
          quantidade: 25,
          unidade: 'CX',
          allocatedAddresses: [],
        },
      ],
    }

    const v = vincularSaidaXmlOrigem(origem, doc, 'armazem')

    expect(v.itensExibicao).toHaveLength(2)
    expect(v.limitesPorItem[0]).toBe(30)
    expect(v.limitesPorItem[1]).toBe(25)
  })

  it('vincula item no stage quando origem é stage', () => {
    const origem = nfOrigem()
    origem.items = [
      {
        index: 1,
        codigo: '5035900',
        descricao: 'COXA CX20KG',
        quantidade: 330,
        unidade: 'CX',
        allocatedAddresses: [],
        localizacao: 'stage',
        pesoBruto: 6600,
        pesoLiquido: 6600,
      },
    ]
    const doc: SaidaXmlDocumento = {
      ...xmlDoisItens(),
      items: [
        {
          index: 0,
          codigo: '5035900',
          descricao: 'COXA',
          quantidade: 200,
          unidade: 'CX',
          allocatedAddresses: [],
        },
      ],
    }

    expect(vincularSaidaXmlOrigem(origem, doc, 'armazem').itensExibicao).toHaveLength(0)
    const v = vincularSaidaXmlOrigem(origem, doc, 'stage')
    expect(v.itensExibicao).toHaveLength(1)
    expect(v.limitesPorItem[1]).toBe(200)
    expect(v.avisos).toHaveLength(0)
  })

  it('normaliza quantidade KG→CX na origem (NF 5035900)', () => {
    const origem = nfOrigem()
    origem.items = [
      {
        index: 1,
        codigo: '5035900',
        descricao: '9140 - COXA E SOBRECOXA CARNE FGO CON PCT CX20KG STA CEC',
        quantidade: 6600,
        unidade: 'KG',
        allocatedAddresses: ['B1'],
        pesoBruto: 6600,
        pesoLiquido: 6600,
      },
    ]
    const doc: SaidaXmlDocumento = {
      ...xmlDoisItens(),
      items: [
        {
          index: 0,
          codigo: '5035900',
          descricao: 'COXA',
          quantidade: 200,
          unidade: 'CX',
          allocatedAddresses: [],
        },
      ],
    }

    const v = vincularSaidaXmlOrigem(origem, doc, 'armazem')
    expect(v.itensExibicao).toHaveLength(1)
    expect(v.limitesPorItem[1]).toBe(200)
    expect(v.avisos).toHaveLength(0)
  })

  it('NF 211264: vincula 5035900 após saída parcial com quantidade ainda em KG', () => {
    const origem = nfOrigem()
    origem.numero = '211264'
    origem.items = [
      {
        index: 0,
        codigo: '4152168',
        descricao: '9369 - FRANGO CONG PCT CX VAR STA CEC',
        quantidade: 6848.66,
        unidade: 'KG',
        allocatedAddresses: ['A1'],
        pesoBruto: 6848.66,
        pesoLiquido: 6848.66,
      },
      {
        index: 1,
        codigo: '5035900',
        descricao: '9140 - COXA E SOBRECOXA CARNE FGO CON PCT CX20KG STA CEC',
        quantidade: 6600,
        unidade: 'KG',
        allocatedAddresses: ['B1'],
        pesoBruto: 6600,
        pesoLiquido: 6600,
      },
    ]
    const doc: SaidaXmlDocumento = {
      ...xmlDoisItens(),
      items: [
        {
          index: 0,
          codigo: '5035900',
          descricao: 'COXA',
          quantidade: 330,
          unidade: 'CX',
          allocatedAddresses: [],
        },
      ],
    }

    const v = vincularSaidaXmlOrigem(origem, doc, 'armazem')
    expect(v.itensExibicao).toHaveLength(1)
    expect(v.itensExibicao[0]?.codigo).toBe('5035900')
    expect(v.limitesPorItem[1]).toBe(330)
    expect(v.avisos).toHaveLength(0)
  })
})

describe('saidaXmlCorrespondeNf', () => {
  it('retorna true quando só há estoque no stage para o código do XML', () => {
    const origem = nfOrigem()
    origem.items = [
      {
        index: 1,
        codigo: '5035900',
        descricao: 'COXA',
        quantidade: 330,
        unidade: 'CX',
        allocatedAddresses: [],
        localizacao: 'stage',
      },
    ]
    const doc: SaidaXmlDocumento = {
      ...xmlDoisItens(),
      items: [
        {
          index: 0,
          codigo: '5035900',
          descricao: 'COXA',
          quantidade: 100,
          unidade: 'CX',
          allocatedAddresses: [],
        },
      ],
    }
    expect(saidaXmlCorrespondeNf(origem, doc)).toBe(true)
  })
})

describe('proximoItemSaidaPendente', () => {
  it('avança para o segundo item após concluir o primeiro', () => {
    const nf = nfOrigem()
    const itens = nf.items
    const confirmados = [{ addressId: 'A1', itemIndex: 0, quantidadeCaixas: 40 }]
    const limites = { 0: 40, 1: 20 }

    const proximo = proximoItemSaidaPendente(itens, 0, confirmados, limites)

    expect(proximo?.index).toBe(1)
  })
})
