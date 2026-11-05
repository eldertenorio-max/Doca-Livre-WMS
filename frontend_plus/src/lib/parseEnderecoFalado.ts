import {
  CAMARAS,
  cellKind,
  isClickable,
  makeAddressId,
  parseAddressId,
} from '../layout/camaras'
import type { AddressId, AddressOccupancy } from '../types'

const PT_NUMBERS: Record<string, number> = {
  zero: 0,
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  três: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  quatorze: 14,
  catorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezessete: 17,
  dezoito: 18,
  dezenove: 19,
  vinte: 20,
}

const CAMARA_KEYS = ['camara', 'camera', 'cam', 'chamara', 'sala']
const RUA_KEYS = ['rua', 'corredor']
const COL_KEYS = ['coluna', 'colunas', 'col', 'posicao', 'pos', 'palete', 'porta']
const NIVEL_KEYS = ['nivel', 'niv', 'andar', 'altura', 'prateleira']

function parseTokenNumber(token: string): number | null {
  const t = token
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^\w]/g, '')
  if (!t) return null
  if (/^\d+$/.test(t)) {
    const n = Number(t)
    return Number.isFinite(n) && n > 0 ? n : null
  }
  const n = PT_NUMBERS[t]
  return n != null && n > 0 ? n : null
}

function normalizeTranscript(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[·.,;!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tryMakeAddress(
  camara: number | null,
  rua: number | null,
  col: number | null,
  nivel: number | null,
): AddressId | null {
  if (camara == null || rua == null || col == null || nivel == null) return null
  return makeAddressId(camara, rua, nivel, col)
}

function extractField(s: string, keywords: string[]): number | null {
  for (const kw of keywords) {
    const re = new RegExp(`(?:^|\\s)${kw}\\s+(\\S+)`, 'i')
    const m = s.match(re)
    if (!m?.[1]) continue
    const n = parseTokenNumber(m[1])
    if (n != null) return n
  }
  return null
}

function extractNumbersInOrder(s: string): number[] {
  const nums: number[] = []
  for (const token of s.split(/\s+/)) {
    const n = parseTokenNumber(token)
    if (n != null) nums.push(n)
  }
  return nums
}

function tryParseFromParts(
  camara: number | null,
  rua: number | null,
  col: number | null,
  nivel: number | null,
): AddressId | null {
  const addr = tryMakeAddress(camara, rua, col, nivel)
  if (!addr || !enderecoCelulaValida(addr)) return null
  return addr
}

/** Interpreta fala ou texto livre como endereço do armazém (ex.: "câmara 6 rua 1 coluna 2 nível 3"). */
export function parseEnderecoFalado(text: string): AddressId | null {
  const raw = text.trim()
  if (!raw) return null

  const idMatch = raw.match(/C(\d+)\s*[-·]\s*R(\d+)\s*[-·]\s*N(\d+)\s*[-·]\s*P(\d+)/i)
  if (idMatch) {
    return tryParseFromParts(
      Number(idMatch[1]),
      Number(idMatch[2]),
      Number(idMatch[4]),
      Number(idMatch[3]),
    )
  }

  const s = normalizeTranscript(raw)

  const byKeyword = tryParseFromParts(
    extractField(s, CAMARA_KEYS),
    extractField(s, RUA_KEYS),
    extractField(s, COL_KEYS),
    extractField(s, NIVEL_KEYS),
  )
  if (byKeyword) return byKeyword

  const patterns = [
    /cam(?:ara|era)?\s*(\w+)\s+rua\s*(\w+)\s+(?:col(?:una)?|pos(?:icao)?|posicao)\s*(\w+)\s+(?:niv(?:el)?)\s*(\w+)/,
    /cam(?:ara|era)?\s*(\w+)\s+rua\s*(\w+)\s+col\s*(\w+)\s+niv\s*(\w+)/,
    /(\w+)\s+rua\s*(\w+)\s+col(?:una)?\s*(\w+)\s+niv(?:el)?\s*(\w+)/,
  ]

  for (const re of patterns) {
    const m = s.match(re)
    if (!m) continue
    const addr = tryParseFromParts(
      parseTokenNumber(m[1]),
      parseTokenNumber(m[2]),
      parseTokenNumber(m[3]),
      parseTokenNumber(m[4]),
    )
    if (addr) return addr
  }

  if (/cam|rua|col|niv|pos|andar/.test(s)) {
    const nums = extractNumbersInOrder(s)
    if (nums.length >= 4) {
      const addr = tryParseFromParts(nums[0], nums[1], nums[2], nums[3])
      if (addr) return addr
    }
  }

  const compact = s.replace(/[^\d]/g, '')
  if (compact.length >= 4 && compact.length <= 6) {
    const digits = compact.split('').map(Number)
    if (digits.length === 4) {
      const addr = tryParseFromParts(digits[0], digits[1], digits[2], digits[3])
      if (addr) return addr
    }
  }

  return null
}

export function enderecoCelulaValida(id: AddressId): boolean {
  const p = parseAddressId(id)
  if (!p) return false
  const cam = CAMARAS.find((c) => c.id === p.camara)
  const rua = cam?.ruas.find((r) => r.rua === p.rua)
  if (!rua || p.col < 1 || p.col > rua.colunas) return false
  const kind = cellKind(
    p.col,
    p.nivel,
    rua.colunas,
    rua.porta,
    rua.semNivel5Inexistente !== false,
    rua.colunasBloqueadas,
    rua.celulasBloqueadas,
  )
  return isClickable(kind)
}

export function validarEnderecoDestinoVoz(
  destId: AddressId,
  occupancy: Map<AddressId, AddressOccupancy>,
  origensMarcadas: Set<AddressId>,
  destinosMarcados: Set<AddressId>,
  origemAtual: AddressId,
): string | null {
  if (destId === origemAtual) return 'O destino deve ser diferente da origem.'
  if (origensMarcadas.has(origemAtual)) return 'Este endereço de origem já foi marcado para mover.'
  if (destinosMarcados.has(destId)) return 'Este destino já foi escolhido para outro palete.'
  if (!enderecoCelulaValida(destId)) return 'Endereço de destino inválido ou indisponível no layout.'

  const occ = occupancy.get(destId)
  if (occ && !origensMarcadas.has(destId)) return 'Endereço de destino já está ocupado.'

  return null
}
