export type EnderecoCadastro = {
  id: string
  codigo: string
  camara: number | null
  rua: string
  posicao: number | null
  nivel: number | null
  observacao: string
  ativo: boolean
  createdAt: string
}

const STORAGE_KEY = 'enderecamento-cadastro-v1'

function readAll(): EnderecoCadastro[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as EnderecoCadastro[]) : []
  } catch {
    return []
  }
}

function writeAll(rows: EnderecoCadastro[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
}

export function listEnderecos(): EnderecoCadastro[] {
  return readAll().filter((r) => r.ativo).sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR'))
}

export function listEnderecosTodos(): EnderecoCadastro[] {
  return readAll().sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR'))
}

/** Primeiro segmento numérico do código de endereço (ex.: 11-A-01-1 → 11). */
export function camaraFromEnderecoCodigo(codigo: string): number | null {
  const parts = normalizeEnderecoCodigo(String(codigo ?? '').trim()).split('-')
  const n = Number(parts[0])
  return Number.isFinite(n) ? n : null
}

export function findEnderecoByCodigo(codigo: string): EnderecoCadastro | undefined {
  const q = String(codigo ?? '').trim().toUpperCase()
  if (!q) return undefined
  return readAll().find((r) => r.ativo && r.codigo.trim().toUpperCase() === q)
}

export function saveEndereco(
  input: Omit<EnderecoCadastro, 'id' | 'createdAt'> & { id?: string },
): EnderecoCadastro {
  const all = readAll()
  const now = new Date().toISOString()
  if (input.id) {
    const idx = all.findIndex((r) => r.id === input.id)
    const row: EnderecoCadastro = {
      id: input.id,
      codigo: input.codigo.trim(),
      camara: input.camara,
      rua: input.rua.trim(),
      posicao: input.posicao,
      nivel: input.nivel,
      observacao: input.observacao.trim(),
      ativo: input.ativo,
      createdAt: idx >= 0 ? all[idx].createdAt : now,
    }
    if (idx >= 0) all[idx] = row
    else all.push(row)
    writeAll(all)
    return row
  }
  const row: EnderecoCadastro = {
    id: crypto.randomUUID(),
    codigo: input.codigo.trim(),
    camara: input.camara,
    rua: input.rua.trim(),
    posicao: input.posicao,
    nivel: input.nivel,
    observacao: input.observacao.trim(),
    ativo: input.ativo,
    createdAt: now,
  }
  all.push(row)
  writeAll(all)
  return row
}

export function deleteEndereco(id: string) {
  writeAll(readAll().filter((r) => r.id !== id))
}

export type EnderecoDeleteFiltro = {
  camara?: number
  rua?: string
  nivel?: number
}

function matchEnderecoFiltro(r: EnderecoCadastro, filtro: EnderecoDeleteFiltro): boolean {
  if (filtro.camara != null && r.camara !== filtro.camara) return false
  if (filtro.rua != null && filtro.rua.trim() !== '') {
    const ru = String(r.rua ?? '').trim().toUpperCase()
    if (ru !== filtro.rua.trim().toUpperCase()) return false
  }
  if (filtro.nivel != null && r.nivel !== filtro.nivel) return false
  return true
}

/** Quantos endereços seriam removidos pelo filtro (em uma lista em memória). */
export function contarEnderecosPorFiltroEm(all: EnderecoCadastro[], filtro: EnderecoDeleteFiltro): number {
  return all.filter((r) => matchEnderecoFiltro(r, filtro)).length
}

/** Remove endereços que batem com o filtro (em memória). */
export function deleteEnderecosPorFiltroEm(all: EnderecoCadastro[], filtro: EnderecoDeleteFiltro): EnderecoCadastro[] {
  return all.filter((r) => !matchEnderecoFiltro(r, filtro))
}

export function deleteEnderecoEm(all: EnderecoCadastro[], id: string): EnderecoCadastro[] {
  return all.filter((r) => r.id !== id)
}

export function deleteTodosEnderecosEm(): EnderecoCadastro[] {
  return []
}

export function saveEnderecoEm(
  all: EnderecoCadastro[],
  input: Omit<EnderecoCadastro, 'id' | 'createdAt'> & { id?: string },
): { all: EnderecoCadastro[]; row: EnderecoCadastro } {
  const next = [...all]
  const now = new Date().toISOString()
  if (input.id) {
    const idx = next.findIndex((r) => r.id === input.id)
    const row: EnderecoCadastro = {
      id: input.id,
      codigo: input.codigo.trim(),
      camara: input.camara,
      rua: input.rua.trim(),
      posicao: input.posicao,
      nivel: input.nivel,
      observacao: input.observacao.trim(),
      ativo: input.ativo,
      createdAt: idx >= 0 ? next[idx]!.createdAt : now,
    }
    if (idx >= 0) next[idx] = row
    else next.push(row)
    return { all: next, row }
  }
  const row: EnderecoCadastro = {
    id: crypto.randomUUID(),
    codigo: input.codigo.trim(),
    camara: input.camara,
    rua: input.rua.trim(),
    posicao: input.posicao,
    nivel: input.nivel,
    observacao: input.observacao.trim(),
    ativo: input.ativo,
    createdAt: now,
  }
  next.push(row)
  return { all: next, row }
}

export function saveEnderecosEmLoteEm(
  all: EnderecoCadastro[],
  input: EnderecoLoteInput,
): { all: EnderecoCadastro[]; resultado: EnderecoLoteResultado } {
  const planejados = planejarEnderecosEmLote(input)
  const next = [...all]
  const byCodigo = new Map(next.map((r) => [r.codigo.trim().toUpperCase(), r]))
  const now = new Date().toISOString()
  let criados = 0
  let atualizados = 0
  let ignorados = 0

  for (const p of planejados) {
    const key = p.codigo.trim().toUpperCase()
    const existente = byCodigo.get(key)
    if (existente) {
      if (input.substituirExistentes) {
        existente.camara = p.camara
        existente.rua = p.rua
        existente.posicao = p.posicao
        existente.nivel = p.nivel
        existente.observacao = p.observacao
        existente.ativo = true
        atualizados++
      } else {
        ignorados++
      }
      continue
    }
    const row: EnderecoCadastro = {
      id: crypto.randomUUID(),
      ...p,
      createdAt: now,
    }
    next.push(row)
    byCodigo.set(key, row)
    criados++
  }

  return { all: next, resultado: { criados, atualizados, ignorados, total: planejados.length } }
}

export function listEnderecosAtivosDe(all: EnderecoCadastro[]): EnderecoCadastro[] {
  return [...all].filter((r) => r.ativo).sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR'))
}

/** Quantos endereços seriam removidos pelo filtro. */
export function contarEnderecosPorFiltro(filtro: EnderecoDeleteFiltro): number {
  return readAll().filter((r) => matchEnderecoFiltro(r, filtro)).length
}

/** Remove endereços que batem com o filtro. Retorna quantidade excluída. */
export function deleteEnderecosPorFiltro(filtro: EnderecoDeleteFiltro): number {
  const all = readAll()
  const keep = all.filter((r) => !matchEnderecoFiltro(r, filtro))
  const removed = all.length - keep.length
  if (removed > 0) writeAll(keep)
  return removed
}

/** Remove todos os endereços cadastrados. Retorna quantidade excluída. */
export function deleteTodosEnderecos(): number {
  const n = readAll().length
  if (n > 0) writeAll([])
  return n
}

/** Código legível para bipagem: ex. 11-A-05-3 (câmara 2 dígitos, rua, posição, nível). */
export function buildCodigoEndereco(
  camara: number,
  rua: string,
  posicao: number,
  nivel: number,
): string {
  const r = String(rua ?? '').trim().toUpperCase()
  const pos = Math.max(1, Math.round(posicao))
  const niv = Math.max(1, Math.round(nivel))
  return `${String(camara).padStart(2, '0')}-${r}-${String(pos).padStart(2, '0')}-${niv}`
}

/** Formata digitação/bipagem sem hífens: 21A0302 → 21-A-03-02 */
export function formatEnderecoCodigoInput(raw: string): string {
  const cleaned = String(raw ?? '')
    .replace(/[^\dA-Za-z]/g, '')
    .toUpperCase()
  if (!cleaned) return ''

  let i = 0
  let camara = ''
  while (i < cleaned.length && /\d/u.test(cleaned[i]!)) {
    camara += cleaned[i++]
  }

  let rua = ''
  while (i < cleaned.length && /[A-Z]/u.test(cleaned[i]!)) {
    rua += cleaned[i++]
  }

  let posicao = ''
  while (i < cleaned.length && /\d/u.test(cleaned[i]!) && posicao.length < 2) {
    posicao += cleaned[i++]
  }

  let nivel = ''
  while (i < cleaned.length && /\d/u.test(cleaned[i]!)) {
    nivel += cleaned[i++]
  }

  const parts: string[] = []
  if (camara) parts.push(camara)
  if (rua) parts.push(rua)
  if (posicao) parts.push(posicao)
  if (nivel) parts.push(nivel)
  return parts.join('-')
}

/** Normaliza posição com 2 dígitos ao sair do campo (21-A-3-2 → 21-A-03-2). */
export function normalizeEnderecoCodigo(raw: string): string {
  const parts = formatEnderecoCodigoInput(raw).split('-')
  if (parts.length < 3) return parts.join('-')
  const [camara, rua, posicao, ...rest] = parts
  const out = [camara, rua, posicao!.padStart(2, '0'), ...rest]
  return out.filter(Boolean).join('-')
}

/** Extrai câmara, rua, posição e nível de um código de endereço. */
export function parseEnderecoCodigo(codigo: string): {
  camara: number | null
  rua: string
  posicao: number | null
  nivel: number | null
} {
  const empty = { camara: null, rua: '', posicao: null, nivel: null }
  let raw = String(codigo ?? '').trim().toUpperCase().replace(/\s+/g, '')
  if (!raw) return empty
  if (raw.includes('*')) raw = raw.slice(0, raw.indexOf('*'))

  const plusId = raw.match(/^C(\d+)-R(\d+)-N(\d+)-P(\d+)$/)
  if (plusId) {
    return {
      camara: Number(plusId[1]),
      rua: String(Number(plusId[2])),
      posicao: Number(plusId[4]),
      nivel: Number(plusId[3]),
    }
  }
  const plusVoice = raw.match(/^C(\d+)-R(\d+)-C(\d+)-N(\d+)$/)
  if (plusVoice) {
    return {
      camara: Number(plusVoice[1]),
      rua: String(Number(plusVoice[2])),
      posicao: Number(plusVoice[3]),
      nivel: Number(plusVoice[4]),
    }
  }
  const canon = raw.match(/^(\d{1,2})-([A-Z0-9]{1,3})-(\d{1,2})-(\d{1,2})$/)
  if (canon) {
    return {
      camara: Number(canon[1]),
      rua: canon[2],
      posicao: Number(canon[3]),
      nivel: Number(canon[4]),
    }
  }

  const normalized = normalizeEnderecoCodigo(raw)
  if (!normalized) return empty
  const parts = normalized.split('-')
  const camara = Number(parts[0])
  const rua = (parts[1] ?? '').trim().toUpperCase()
  const posicao = parts[2] != null && parts[2] !== '' ? Number(parts[2]) : null
  const nivel = parts[3] != null && parts[3] !== '' ? Number(parts[3]) : null
  return {
    camara: Number.isFinite(camara) ? camara : null,
    rua,
    posicao: posicao != null && Number.isFinite(posicao) ? posicao : null,
    nivel: nivel != null && Number.isFinite(nivel) ? nivel : null,
  }
}

export type EnderecoLoteInput = {
  camara: number
  rua: string
  nivelDe: number
  nivelAte: number
  posicaoDe: number
  posicaoAte: number
  observacao?: string
  /** true = atualiza código já existente com mesmo texto */
  substituirExistentes?: boolean
}

export type EnderecoLoteResultado = {
  criados: number
  atualizados: number
  ignorados: number
  total: number
}

/** Gera lista de endereços (sem gravar) para prévia. */
export function planejarEnderecosEmLote(input: EnderecoLoteInput): Omit<EnderecoCadastro, 'id' | 'createdAt'>[] {
  const camara = Math.round(input.camara)
  const rua = String(input.rua ?? '').trim().toUpperCase()
  const nDe = Math.min(input.nivelDe, input.nivelAte)
  const nAte = Math.max(input.nivelDe, input.nivelAte)
  const pDe = Math.min(input.posicaoDe, input.posicaoAte)
  const pAte = Math.max(input.posicaoDe, input.posicaoAte)
  const obs = String(input.observacao ?? '').trim()
  const out: Omit<EnderecoCadastro, 'id' | 'createdAt'>[] = []

  for (let nivel = nDe; nivel <= nAte; nivel++) {
    for (let pos = pDe; pos <= pAte; pos++) {
      out.push({
        codigo: buildCodigoEndereco(camara, rua, pos, nivel),
        camara,
        rua,
        posicao: pos,
        nivel,
        observacao: obs,
        ativo: true,
      })
    }
  }
  return out
}

export function saveEnderecosEmLote(input: EnderecoLoteInput): EnderecoLoteResultado {
  const planejados = planejarEnderecosEmLote(input)
  const all = readAll()
  const byCodigo = new Map(all.map((r) => [r.codigo.trim().toUpperCase(), r]))
  const now = new Date().toISOString()
  let criados = 0
  let atualizados = 0
  let ignorados = 0

  for (const p of planejados) {
    const key = p.codigo.trim().toUpperCase()
    const existente = byCodigo.get(key)
    if (existente) {
      if (input.substituirExistentes) {
        existente.camara = p.camara
        existente.rua = p.rua
        existente.posicao = p.posicao
        existente.nivel = p.nivel
        existente.observacao = p.observacao
        existente.ativo = true
        atualizados++
      } else {
        ignorados++
      }
      continue
    }
    const row: EnderecoCadastro = {
      id: crypto.randomUUID(),
      ...p,
      createdAt: now,
    }
    all.push(row)
    byCodigo.set(key, row)
    criados++
  }

  writeAll(all)
  return { criados, atualizados, ignorados, total: planejados.length }
}
