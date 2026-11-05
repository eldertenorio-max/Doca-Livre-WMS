import { describe, expect, it } from 'vitest'
import { CONSULTA_FILTROS_VAZIOS, temFiltroConsulta } from '../consultaEstoque'
import { parseVoiceCommand } from '../parseVoiceCommand'
import { interpretVoiceNaturally } from '../voiceNaturalLanguage'
import { resolveVoiceCommandSync } from '../voiceAiInterpret'

describe('parseVoiceCommand — busca de NF', () => {
  it('trata “pesquise a NF 282672” como consulta de estoque', () => {
    const cmd = parseVoiceCommand('pesquise a NF 282672')
    expect(cmd).toEqual({
      type: 'consultar',
      filtros: { nfNumero: '282672', origem: 'ambos' },
    })
  })

  it('trata “onde está a nota 20835” como consulta', () => {
    const cmd = parseVoiceCommand('onde está a nota 20835')
    expect(cmd).toMatchObject({
      type: 'consultar',
      filtros: { nfNumero: '20835' },
    })
  })

  it('trata “buscar nota 20835” como consulta', () => {
    const cmd = parseVoiceCommand('buscar nota 20835')
    expect(cmd).toMatchObject({
      type: 'consultar',
      filtros: { nfNumero: '20835' },
    })
  })

  it('abre movimentação só quando pedem movimentar/reposicionar', () => {
    expect(parseVoiceCommand('movimentar nota 20835')).toEqual({
      type: 'buscar_nota',
      numero: '20835',
    })
    expect(parseVoiceCommand('reposicionar NF 282672')).toEqual({
      type: 'buscar_nota',
      numero: '282672',
    })
  })

  it('abre saída quando pedem expedir a NF', () => {
    expect(parseVoiceCommand('saída da nota 20835')).toEqual({
      type: 'buscar_saida',
      numero: '20835',
    })
  })
})

describe('interpretVoiceNaturally — consulta antes de abrir tela', () => {
  it('não abre a aba vazia ao consultar uma NF', () => {
    const cmd = interpretVoiceNaturally('consultar a NF 282672')
    expect(cmd).toMatchObject({
      type: 'consultar',
      filtros: { nfNumero: '282672' },
    })
  })
})

describe('resolveVoiceCommandSync', () => {
  it('resolve pesquisa de NF mesmo com frase natural', () => {
    const cmd = resolveVoiceCommandSync('pesquise a NF 282672')
    expect(cmd?.type).toBe('consultar')
    if (cmd?.type === 'consultar') {
      expect(cmd.filtros.nfNumero).toBe('282672')
    }
  })
})

describe('temFiltroConsulta', () => {
  it('não considera origem sozinha como filtro', () => {
    expect(temFiltroConsulta(CONSULTA_FILTROS_VAZIOS)).toBe(false)
    expect(temFiltroConsulta({ ...CONSULTA_FILTROS_VAZIOS, nfNumero: '282672' })).toBe(true)
  })
})
