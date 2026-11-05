import { normalizeCodigoInternoCompareKey } from './codigoInternoCompare'

/** Item da lista oficial do inventário armazém (1ª–8ª contagem / aba CAMARA-RUA). Fonte única para ordem, descrição e unidade. */
export type ArmazemListaOficialRow = {
  grupo: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  codigo: string
  descricao: string
  unidade: string
}

/** Fallback embutido se a planilha Google não carregar. */
export const ARMAZEM_LISTA_OFICIAL_FALLBACK: readonly ArmazemListaOficialRow[] = [
  // 1° CONTAGEM
  { grupo: 1, codigo: '01.01.0001', descricao: 'MASSA CONGELADA DE PAO FRANCES RAPIDA - 5KG', unidade: 'PT' },
  { grupo: 1, codigo: '01.01.0002', descricao: 'MASSA CONGELADA DE PAO FRANCES MEDIA - 5KG', unidade: 'PT' },
  { grupo: 1, codigo: '01.02.0001', descricao: 'MASSA CONGELADA DE MINI PAO FRANCES RAPIDA - 5KG', unidade: 'PT' },
  { grupo: 1, codigo: '01.02.0003', descricao: 'MASSA CONGELADA DE MINI PAO FRANCES INTEGRAL RAPIDA - 5KG', unidade: 'PT' },
  { grupo: 1, codigo: '01.02.0005', descricao: 'MASSA CONGELADA DE PAO FRANCES INTEGRAL RAPIDA - 5KG', unidade: 'PT' },
  { grupo: 1, codigo: '01.02.0007', descricao: 'MASSA CONGELADA DE PAO FRANCES COM GRAOS RAPIDA - 5KG', unidade: 'PT' },
  { grupo: 1, codigo: '01.04.0008', descricao: 'PAO DE QUEIJO EMPANADO 30G - CX 10KG - 5 UN DE 2KG', unidade: 'CX' },
  { grupo: 1, codigo: '01.04.0009', descricao: 'PAO DE QUEIJO MULTIGRAOS EMPANADO 30G - CX 10KG - 5 UN DE 2KG', unidade: 'CX' },
  { grupo: 1, codigo: '01.10.0003', descricao: 'CIABATTA TRADICINAL LEVIASSA 220G', unidade: 'CX' },
  { grupo: 1, codigo: '01.10.0004', descricao: 'CIABATTA COM GRAOS LEVIASSA', unidade: 'CX' },
  { grupo: 1, codigo: '01.10.0006', descricao: 'MINI BAGUETE FRANCESA LEVIASSA 240 G', unidade: 'CX' },
  { grupo: 1, codigo: '01.02.0011', descricao: 'MASSA CONGELADA DE MINI BAGUETE RAPIDA - 5KG', unidade: 'PT' },
  { grupo: 1, codigo: '01.03.0019', descricao: 'ROSCA LISA (PAO DE LEITE) - CX 10 KG -2 UN DE 5 KG', unidade: 'PT' },
  { grupo: 1, codigo: '02.04.0001', descricao: 'MASSA CONGELADA DE PAO FRANCES BOLA RAPIDA - 5KG', unidade: 'PT' },
  { grupo: 1, codigo: '02.01.0005', descricao: 'CP PAO DE QUEIJO TRADICIONAL - MAX LANCHE', unidade: 'CX' },
  { grupo: 1, codigo: '02.01.0004', descricao: 'CP PAO DE QUEIJO RECHEADO REQUEIJÃO', unidade: 'CX' },
  { grupo: 1, codigo: '01.10.0013', descricao: 'MINI BAGUETE FRANCESA LEVIASSA PT 220G CX 3,17 KG', unidade: 'CX' },
  { grupo: 1, codigo: '01.10.0014', descricao: 'CIABATTA TRADICINAL LEVIASSA PT 220G CX 3,17 KG', unidade: 'CX' },
  { grupo: 1, codigo: '01.04.0066', descricao: 'PAO DE QUEIJO RECHEADO COM REQUEIJÃO 65G - 2KG', unidade: 'CX' },
  // 2° CONTAGEM
  { grupo: 2, codigo: '01.09.0007', descricao: 'CIABATTA HOMEBAKE TRADICIONAL 3,6KG - 12 UNIDADES 300G', unidade: 'CX' },
  { grupo: 2, codigo: '01.09.0008', descricao: 'CIABATTA HOMEBAKE COM GRAOS 3,6KG - 12 UNIDADES 300G', unidade: 'CX' },
  { grupo: 2, codigo: '01.09.0009', descricao: 'MINI PAO ITALIANO HOMEBAKE 4,2KG - 14 UNIDADES 300G', unidade: 'CX' },
  { grupo: 2, codigo: '01.09.0010', descricao: 'MINI BAGUETE LANCHE HOMEBAKE 3,6KG - 12 UNIDADES 300G', unidade: 'CX' },
  { grupo: 2, codigo: '01.09.0012', descricao: 'PAO FRANCES HOMEBAKE 3,24KG - 12 UNIDADES 270G', unidade: 'CX' },
  { grupo: 2, codigo: '01.06.0001', descricao: 'CIABATTA TRADICIONAL - 10UN - PCT 1 KG - CX 4 KG', unidade: 'CX' },
  { grupo: 2, codigo: '01.06.0002', descricao: 'CIABATTA MULTIGRAOS - 10UN - 1KG', unidade: 'CX' },
  { grupo: 2, codigo: '01.06.0059', descricao: 'PAO ITALIANO BOLA 720G - 7 UNIDADES', unidade: 'CX' },
  { grupo: 2, codigo: '02.03.0001', descricao: 'PAO DE SONHO CONGELADO - CX 2,5KG', unidade: 'CX' },
  { grupo: 2, codigo: '02.03.0039', descricao: 'BAGUETE CALABRESA COM CEBOLA CARAMELIZADA 140G', unidade: 'CX' },
  { grupo: 2, codigo: '02.03.0042', descricao: 'BAGUETE PARMESAO PERNIL - CX 10UN', unidade: 'CX' },
  { grupo: 2, codigo: '02.02.0045', descricao: 'RISOLES DE CARNE EMPANADA COM LINHAÇA 150G - FRITO', unidade: 'CX' },
  { grupo: 2, codigo: '02.03.0013', descricao: 'PAO DE MINI SONHO CONGELADO - 100 UN - CX 2,5KG', unidade: 'CX' },
  { grupo: 2, codigo: '01.04.0063', descricao: 'MASSA CONGELADA DE CHIPA QUEIJO CANASTRA 45G - 4KG CX', unidade: 'PT' },
  { grupo: 2, codigo: '01.04.0064', descricao: 'MASSA CONGELADA DE BISCOITO PALITO 3 QUEIJOS 45G - 4KG CX', unidade: 'PT' },
  { grupo: 2, codigo: '02.02.0038', descricao: 'EMPANADA DE CARNE 80G - CX 2.400 - PCT 30 UN', unidade: 'CX' },
  { grupo: 2, codigo: '02.02.0044', descricao: 'RISOLES LAMINADO DE PRESUNTO E QUEIJO FRITO 150G', unidade: 'CX' },
  { grupo: 2, codigo: '02.02.0047', descricao: 'COXINHA PAULISTA DE FRANGO COM REQUEIJÃO FRITA 150G', unidade: 'CX' },
  { grupo: 2, codigo: '02.02.0048', descricao: 'COXINHA PAULISTA DE FRANGO EMPANADA COM ORÉGANO FRITA 150G', unidade: 'CX' },
  { grupo: 2, codigo: '02.02.0049', descricao: 'BIG COXINHA PAULISTA DE FRANGO COM REQUEIJÃO FRITA 240G', unidade: 'CX' },
  // 3° CONTAGEM
  { grupo: 3, codigo: '02.01.0007', descricao: 'MASSA CONGELADA DE PALITO 3 QUEIJOS - CX 12KG - PT 6 UM', unidade: 'CX' },
  { grupo: 3, codigo: '02.02.0034', descricao: 'MASSA CONGELADA DE CROISSANT DE FRANGO COM REQUEIJAO - 12KG', unidade: 'CX' },
  { grupo: 3, codigo: '02.02.0033', descricao: 'MASSA CONGELADA DE CROISSANT DE CHOCOLATE - 12KG', unidade: 'CX' },
  { grupo: 3, codigo: '02.02.0046', descricao: 'EMPADA DE FRANGO MASSA TUNG C/ 12 UND CAIXA C/ 6 PCTS', unidade: 'CX' },
  { grupo: 3, codigo: '02.02.0036', descricao: 'MASSA CONGELADA DE CROISSANT SEM RECHEIO 12KG', unidade: 'CX' },
  { grupo: 3, codigo: '02.02.0035', descricao: 'MASSA CONGELADA DE CROISSANT DE QUEIJO E PRESUNTO FATIADO - 12KG', unidade: 'CX' },
  { grupo: 3, codigo: '02.02.0032', descricao: 'MASSA CONGELADA DE CROISSANT DE 3 QUEIJOS - 11KG', unidade: 'CX' },
  { grupo: 3, codigo: '02.03.1018', descricao: 'CROISSANT TRADICIONAL DE MASSA FOLHADA PREFERMENTADO CONGELADO 70G - 1 PCT DE 3,50KG', unidade: 'CX' },
  { grupo: 3, codigo: '01.04.0014', descricao: 'MASSA CONGELADA DE PAO DE QUEIJO ST MARCHE 30G - CX 8KG - 20 UN DE 400G', unidade: 'CX' },
  { grupo: 3, codigo: '01.04.0025', descricao: 'MASSA CONGELADA DE CHIPA QUEIJO CANASTRA ST MARCHE 45G - 20 PCTS DE 400G', unidade: 'CX' },
  { grupo: 3, codigo: '01.04.0026', descricao: 'MASSA CONGELADA DE BISCOITO PALITO 3 QUEIJOS ST MARCHE 45G - 20 PCTS DE 400G', unidade: 'CX' },
  { grupo: 3, codigo: '01.04.0054', descricao: 'PAO DE QUEIJO RECHEADO DE GOIABADA ST MARCHE 30G - 20 PCTS DE 400G', unidade: 'CX' },
  { grupo: 3, codigo: '01.04.0055', descricao: 'M. CONG. DE PAO DE QUEIJO RECHEADO DE REQUEIJAO ST MARCHE 30G - 20 PCTS DE 400G', unidade: 'CX' },
  { grupo: 3, codigo: '01.06.0058', descricao: 'PAO ITALIANO FILAO - CX 5,04KG - 7 UN DE 720G', unidade: 'CX' },
  { grupo: 3, codigo: '01.06.0022', descricao: 'PAO DE AZEITONA 500G - 3KG', unidade: 'CX' },
  { grupo: 3, codigo: '01.06.0024', descricao: 'PAO DE CALABRESA 500G - 3KG', unidade: 'CX' },
  { grupo: 3, codigo: '01.06.0027', descricao: 'PAO DE 3 CHOCOLATES - 10 UN - 3KG', unidade: 'CX' },
  { grupo: 3, codigo: '01.06.0030', descricao: 'MINI BAGUETE RUSTICA TRADICIONAL - CX 5KG - 2 UN DE 2,5KG', unidade: 'CX' },
  { grupo: 3, codigo: '01.10.0015', descricao: 'CIABATTA COM GRÃOSL LEVIASSA- PT 0,220 KG- CX 2,64 KG- 12 UN', unidade: 'CX' },
  // 4° CONTAGEM
  { grupo: 4, codigo: '02.03.1003', descricao: 'MASSA CONGELADA DE FILAO DE LEITE CAIXA 4X2,5KG 10KG', unidade: 'CX' },
  { grupo: 4, codigo: '02.03.1004', descricao: 'MASSA CONGELADA DE BISNAGUINHA CAIXA 4X2,5KG 10KG', unidade: 'CX' },
  { grupo: 4, codigo: '02.03.1005', descricao: 'MASSA CONGELADA DE BENGALA CAIXA 4X2,5KG 10KG', unidade: 'CX' },
  { grupo: 4, codigo: '02.03.1006', descricao: 'MASSA CONGELADA TATUZÃO CAIXA 4X2,5KG 10KG', unidade: 'CX' },
  { grupo: 4, codigo: '02.03.1007', descricao: 'MASSA CONGELADA TATU CAIXA 4X2,5KG 10KG', unidade: 'CX' },
  { grupo: 4, codigo: '02.03.1008', descricao: 'MASSA CONGELADA ROSCA CARACOL CAIXA 4X2,5KG 10KG', unidade: 'CX' },
  { grupo: 4, codigo: '02.03.1009', descricao: 'MASSA CONGELADA ROSCA TRANÇADA GRANDE CAIXA 4X2,5KG 10KG', unidade: 'CX' },
  { grupo: 4, codigo: '02.03.1010', descricao: 'MASSA CONGELADA DE PÃO DE MILHO CAIXA 4X2,5KG 10KG', unidade: 'CX' },
  { grupo: 4, codigo: '02.03.1011', descricao: 'MASSA CONGELADA DE PÃO DE CEBOLA CAIXA 4X2,5KG 10KG', unidade: 'CX' },
  { grupo: 4, codigo: '02.03.1012', descricao: 'MASSA CONGELADA DE PÃO DE BATATA CAIXA 4X2,5KG 10KG', unidade: 'CX' },
  { grupo: 4, codigo: '02.03.1013', descricao: 'MASSA CONGELADA DE PÃO DA FAZENDA CAIXA 4X2,5KG 10KG', unidade: 'CX' },
  { grupo: 4, codigo: '02.03.1014', descricao: 'MASSA CONGELADA DE HOT DOG CAIXA 4X2,5KG 10KG', unidade: 'CX' },
  { grupo: 4, codigo: '02.03.1015', descricao: 'MASSA CONGELADA DE PÃO DE HAMBURGUÉR CAIXA 4X2,5KG 10KG', unidade: 'CX' },
  { grupo: 4, codigo: '02.03.1016', descricao: 'MASSA CONGELADA DE FORROZINHO COM CREME E CHOCOLATE CAIXA 4X2,5KG 10KG', unidade: 'CX' },
  { grupo: 4, codigo: '02.03.1017', descricao: 'MASSA CONGELADA DE FORROZINHO COM CREME E COCO CAIXA 4X2,5KG 10KG', unidade: 'CX' },
  { grupo: 4, codigo: '01.04.0058', descricao: 'MASSA CONGELADA DE PÃO DE QUEIJO TRAD. PEQUENO- CX 10 KG- 5UN DE 2 KG', unidade: 'CX' },
  { grupo: 4, codigo: '01.04.0062', descricao: 'MASSA CONGELADA DE PÃO DE QUEIJO TRADICIONAL GRANDE - CX 10 KG - 5 UN DE 2 KG', unidade: 'CX' },
  { grupo: 4, codigo: '01.04.0067', descricao: 'MASSA CONGELADA DE PAO DE QUEIJO RECHEADO COM GOIABADA - CX 10 KG – 5 UN DE 2 KG', unidade: 'CX' },
  { grupo: 4, codigo: '01.04.0060', descricao: 'MASSA CONGELADA DE PAO DE QUEIJO RECHEADO COM REQUEIJAO - CX 10 KG - 5 UN DE 2 KG', unidade: 'CX' },
  { grupo: 4, codigo: '01.04.0068', descricao: 'MASSA CONGELADA DE PÃO DE QUEIJO COQUETEL EMPANADO - CX 10KG - 5 UN', unidade: 'CX' },
  { grupo: 4, codigo: '01.04.0061', descricao: 'MASSA CONGELADA DE CHIPA TRADICIONAL - CX 10 KG - 5 UN DE 2 KG', unidade: 'CX' },
] as const

/** @deprecated Use `ARMAZEM_LISTA_OFICIAL_FALLBACK` ou `listArmazemListaOficialOrdered()`. */
export const ARMAZEM_LISTA_OFICIAL = ARMAZEM_LISTA_OFICIAL_FALLBACK

let listaAtiva: ArmazemListaOficialRow[] = [...ARMAZEM_LISTA_OFICIAL_FALLBACK]

function buildLookupMap(rows: readonly ArmazemListaOficialRow[]): Map<string, ArmazemListaOficialRow> {
  const m = new Map<string, ArmazemListaOficialRow>()
  for (const row of rows) {
    m.set(row.codigo, row)
    const norm = normalizeCodigoInternoCompareKey(row.codigo)
    if (norm && !m.has(norm)) m.set(norm, row)
  }
  return m
}

let oficialByNorm = buildLookupMap(listaAtiva)

/** Atualiza lista ativa (planilha Base Principal) e mapa de grupos/ordem. */
export function setArmazemListaAtiva(rows: ArmazemListaOficialRow[]): void {
  listaAtiva = rows.length > 0 ? [...rows] : [...ARMAZEM_LISTA_OFICIAL_FALLBACK]
  oficialByNorm = buildLookupMap(listaAtiva)
}

export function lookupArmazemListaOficial(codigo: string): ArmazemListaOficialRow | undefined {
  const t = String(codigo ?? '').trim()
  if (!t) return undefined
  return oficialByNorm.get(t) ?? oficialByNorm.get(normalizeCodigoInternoCompareKey(t))
}

/** Ordem oficial para inventário / contagem armazém (grupos 1–8). */
export function listArmazemListaOficialOrdered(): ArmazemListaOficialRow[] {
  return [...listaAtiva]
}

export function getArmazemListaOficialTotal(): number {
  return listaAtiva.length
}

/** @deprecated Use `getArmazemListaOficialTotal()`. */
export const ARMAZEM_LISTA_OFICIAL_TOTAL = ARMAZEM_LISTA_OFICIAL_FALLBACK.length
