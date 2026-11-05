export type CellKind = 'disponivel' | 'porta' | 'sem-nivel5' | 'bloqueado'

export type RuaConfig = {
  rua: number
  colunas: number
  porta?: { cols: [number, number]; niveis: [number, number] }
  /** Colunas indisponíveis (intervalo inclusivo), em todos os níveis */
  colunasBloqueadas?: [number, number]
  /** Posições específicas indisponíveis */
  celulasBloqueadas?: { col: number; nivel: number }[]
  /** false = nível 5 existe em todas as colunas (ex.: Câmara 8) */
  semNivel5Inexistente?: boolean
}

export type CamaraConfig = {
  id: number
  tipo: string
  ruas: RuaConfig[]
}

export const CAMARAS: CamaraConfig[] = [
  {
    id: 6,
    tipo: 'Congelado',
    ruas: [
      { rua: 1, colunas: 15 },
      {
        rua: 2,
        colunas: 15,
        colunasBloqueadas: [1, 3],
        porta: { cols: [2, 3], niveis: [1, 2] },
      },
    ],
  },
  {
    id: 7,
    tipo: 'Congelado -20°',
    ruas: [
      { rua: 1, colunas: 15, porta: { cols: [2, 3], niveis: [1, 2] } },
      { rua: 2, colunas: 15, porta: { cols: [2, 3], niveis: [1, 2] } },
    ],
  },
  {
    id: 8,
    tipo: 'Congelado',
    ruas: [
      { rua: 1, colunas: 15, porta: { cols: [2, 3], niveis: [1, 3] } },
      { rua: 2, colunas: 15 },
    ],
  },
  {
    id: 9,
    tipo: 'Congelado',
    ruas: [
      { rua: 1, colunas: 15, celulasBloqueadas: [{ col: 1, nivel: 4 }] },
      { rua: 2, colunas: 15, celulasBloqueadas: [{ col: 1, nivel: 4 }] },
    ],
  },
  {
    id: 10,
    tipo: 'Congelado',
    ruas: [
      { rua: 1, colunas: 15 },
      { rua: 2, colunas: 15 },
    ],
  },
]

export const NIVEIS = [5, 4, 3, 2, 1] as const

/** Mapeamento de ruas antigas → novas (câmaras 7–10 passaram a usar Rua 1 e 2). */
const LEGACY_RUA_REMAP: Record<number, Record<number, number>> = {
  7: { 3: 1, 4: 2 },
  8: { 5: 1, 6: 2 },
  9: { 9: 1, 10: 2 },
  10: { 7: 1, 8: 2 },
}

export function remapLegacyAddressId(id: string): string {
  const p = parseAddressId(id)
  if (!p) return id
  const newRua = LEGACY_RUA_REMAP[p.camara]?.[p.rua]
  if (!newRua) return id
  return makeAddressId(p.camara, newRua, p.nivel, p.col)
}

export function makeAddressId(camara: number, rua: number, nivel: number, col: number): string {
  return `C${camara}-R${rua}-N${nivel}-P${col}`
}

/** Máscara canônica dos três WMS: 06-1-02-3 (câmara-rua-coluna-nível). */
export function toCanonicalAddress(camara: number, rua: number, col: number, nivel: number): string {
  return `${String(camara).padStart(2, '0')}-${rua}-${String(col).padStart(2, '0')}-${nivel}`
}

export function parseAddressId(id: string): { camara: number; rua: number; nivel: number; col: number } | null {
  const raw = String(id || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
  const base = raw.includes('*') ? raw.slice(0, raw.indexOf('*')) : raw
  const plus = base.match(/^C(\d+)-R(\d+)-N(\d+)-P(\d+)$/)
  if (plus) {
    return {
      camara: Number(plus[1]),
      rua: Number(plus[2]),
      nivel: Number(plus[3]),
      col: Number(plus[4]),
    }
  }
  const voice = base.match(/^C(\d+)-R(\d+)-C(\d+)-N(\d+)$/)
  if (voice) {
    return {
      camara: Number(voice[1]),
      rua: Number(voice[2]),
      col: Number(voice[3]),
      nivel: Number(voice[4]),
    }
  }
  const canon = base.match(/^(\d{1,2})-(\d{1,3})-(\d{1,2})-(\d{1,2})$/)
  if (canon) {
    return {
      camara: Number(canon[1]),
      rua: Number(canon[2]),
      col: Number(canon[3]),
      nivel: Number(canon[4]),
    }
  }
  return null
}

export function formatAddressLabel(id: string): string {
  const p = parseAddressId(id)
  if (!p) return id
  return `Cam. ${p.camara} · Rua ${p.rua} · Col ${p.col} · Nív ${p.nivel}`
}

export function cellKind(
  col: number,
  nivel: number,
  totalCols: number,
  porta?: RuaConfig['porta'],
  semNivel5Inexistente = true,
  colunasBloqueadas?: RuaConfig['colunasBloqueadas'],
  celulasBloqueadas?: RuaConfig['celulasBloqueadas'],
): CellKind {
  if (porta) {
    const [c0, c1] = porta.cols
    const [n0, n1] = porta.niveis
    if (col >= c0 && col <= c1 && nivel >= n0 && nivel <= n1) return 'porta'
  }
  if (celulasBloqueadas?.some((c) => c.col === col && c.nivel === nivel)) return 'bloqueado'
  if (colunasBloqueadas) {
    const [c0, c1] = colunasBloqueadas
    if (col >= c0 && col <= c1) return 'bloqueado'
  }
  if (semNivel5Inexistente && nivel === 5 && col >= totalCols - 1) return 'sem-nivel5'
  return 'disponivel'
}

export function isClickable(kind: CellKind): boolean {
  return kind === 'disponivel'
}

export function listAllAddresses(): { id: string; camara: number; rua: number; nivel: number; col: number; kind: CellKind }[] {
  const out: { id: string; camara: number; rua: number; nivel: number; col: number; kind: CellKind }[] = []
  for (const cam of CAMARAS) {
    for (const rua of cam.ruas) {
      for (const nivel of NIVEIS) {
        for (let col = 1; col <= rua.colunas; col++) {
          const kind = cellKind(
            col,
            nivel,
            rua.colunas,
            rua.porta,
            rua.semNivel5Inexistente !== false,
            rua.colunasBloqueadas,
            rua.celulasBloqueadas,
          )
          out.push({
            id: makeAddressId(cam.id, rua.rua, nivel, col),
            camara: cam.id,
            rua: rua.rua,
            nivel,
            col,
            kind,
          })
        }
      }
    }
  }
  return out
}

/** Recorta um pedaço da imagem da porta para cada célula do grid (versão original). */
export function portaCellBackgroundStyle(
  col: number,
  nivel: number,
  porta: NonNullable<RuaConfig['porta']>,
  imageUrl: string,
): {
  backgroundImage: string
  backgroundSize: string
  backgroundPosition: string
  backgroundRepeat: 'no-repeat'
} | null {
  const [c0, c1] = porta.cols
  const [n0, n1] = porta.niveis
  if (col < c0 || col > c1 || nivel < n0 || nivel > n1) return null

  const colCount = c1 - c0 + 1
  const rowCount = n1 - n0 + 1
  const colIdx = col - c0
  const rowIdx = n1 - nivel
  const xPct = colCount === 1 ? 50 : (colIdx / (colCount - 1)) * 100
  const yPct = rowCount === 1 ? 50 : (rowIdx / (rowCount - 1)) * 100

  return {
    backgroundImage: `url("${imageUrl}")`,
    backgroundSize: `${colCount * 100}% ${rowCount * 100}%`,
    backgroundPosition: `${xPct}% ${yPct}%`,
    backgroundRepeat: 'no-repeat',
  }
}

/** Linhas do rack só nas bordas externas do bloco da porta (sem cruz no meio). */
export function portaCellEdgeClasses(
  col: number,
  nivel: number,
  porta: NonNullable<RuaConfig['porta']>,
): string {
  const [c0] = porta.cols
  const [, n1] = porta.niveis
  const classes: string[] = []
  if (nivel === n1) classes.push('cell--porta-edge-top')
  if (col === c0) classes.push('cell--porta-edge-left')
  return classes.join(' ')
}
