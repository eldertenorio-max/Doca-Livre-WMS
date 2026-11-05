export type ProdutoFamilia = {
  id: string
  codigo: string
  nome: string
  ativo: boolean
}

export type ProdutoGrupo = {
  id: string
  familiaId: string
  codigo: string
  nome: string
  ativo: boolean
}

export type ProdutoSubGrupo = {
  id: string
  grupoId: string
  codigo: string
  nome: string
  ativo: boolean
}

const KEY_FAMILIA = 'produto-familias-v1'
const KEY_GRUPO = 'produto-grupos-v1'
const KEY_SUBGRUPO = 'produto-subgrupos-v1'

function read<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

function write<T>(key: string, rows: T[]) {
  localStorage.setItem(key, JSON.stringify(rows))
}

export function listFamilias(): ProdutoFamilia[] {
  return read<ProdutoFamilia>(KEY_FAMILIA).sort((a, b) => a.codigo.localeCompare(b.codigo))
}

export function listGrupos(familiaId?: string): ProdutoGrupo[] {
  const rows = read<ProdutoGrupo>(KEY_GRUPO).sort((a, b) => a.codigo.localeCompare(b.codigo))
  if (!familiaId) return rows
  return rows.filter((r) => r.familiaId === familiaId)
}

export function listSubGrupos(grupoId?: string): ProdutoSubGrupo[] {
  const rows = read<ProdutoSubGrupo>(KEY_SUBGRUPO).sort((a, b) => a.codigo.localeCompare(b.codigo))
  if (!grupoId) return rows
  return rows.filter((r) => r.grupoId === grupoId)
}

export function saveFamilia(row: Omit<ProdutoFamilia, 'id'> & { id?: string }): ProdutoFamilia {
  const all = read<ProdutoFamilia>(KEY_FAMILIA)
  const saved: ProdutoFamilia = {
    id: row.id || crypto.randomUUID(),
    codigo: row.codigo.trim(),
    nome: row.nome.trim(),
    ativo: row.ativo,
  }
  const idx = all.findIndex((r) => r.id === saved.id)
  if (idx >= 0) all[idx] = saved
  else all.push(saved)
  write(KEY_FAMILIA, all)
  return saved
}

export function saveGrupo(row: Omit<ProdutoGrupo, 'id'> & { id?: string }): ProdutoGrupo {
  const all = read<ProdutoGrupo>(KEY_GRUPO)
  const saved: ProdutoGrupo = {
    id: row.id || crypto.randomUUID(),
    familiaId: row.familiaId,
    codigo: row.codigo.trim(),
    nome: row.nome.trim(),
    ativo: row.ativo,
  }
  const idx = all.findIndex((r) => r.id === saved.id)
  if (idx >= 0) all[idx] = saved
  else all.push(saved)
  write(KEY_GRUPO, all)
  return saved
}

export function saveSubGrupo(row: Omit<ProdutoSubGrupo, 'id'> & { id?: string }): ProdutoSubGrupo {
  const all = read<ProdutoSubGrupo>(KEY_SUBGRUPO)
  const saved: ProdutoSubGrupo = {
    id: row.id || crypto.randomUUID(),
    grupoId: row.grupoId,
    codigo: row.codigo.trim(),
    nome: row.nome.trim(),
    ativo: row.ativo,
  }
  const idx = all.findIndex((r) => r.id === saved.id)
  if (idx >= 0) all[idx] = saved
  else all.push(saved)
  write(KEY_SUBGRUPO, all)
  return saved
}

export function deleteFamilia(id: string) {
  const all = read<ProdutoFamilia>(KEY_FAMILIA).filter((r) => r.id !== id)
  write(KEY_FAMILIA, all)
  const grupos = read<ProdutoGrupo>(KEY_GRUPO).filter((r) => r.familiaId !== id)
  write(KEY_GRUPO, grupos)
  const grupoIds = new Set(grupos.map((g) => g.id))
  const sub = read<ProdutoSubGrupo>(KEY_SUBGRUPO).filter((r) => grupoIds.has(r.grupoId))
  write(KEY_SUBGRUPO, sub)
}

export function deleteGrupo(id: string) {
  const all = read<ProdutoGrupo>(KEY_GRUPO).filter((r) => r.id !== id)
  write(KEY_GRUPO, all)
  const sub = read<ProdutoSubGrupo>(KEY_SUBGRUPO).filter((r) => r.grupoId !== id)
  write(KEY_SUBGRUPO, sub)
}

export function deleteSubGrupo(id: string) {
  const all = read<ProdutoSubGrupo>(KEY_SUBGRUPO).filter((r) => r.id !== id)
  write(KEY_SUBGRUPO, all)
}
