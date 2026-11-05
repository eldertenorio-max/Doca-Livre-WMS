/** Cadastro canônico no Supabase. */
export const TABELA_PRODUTOS = 'Todos os Produtos'

/** Rótulo da lista de produtos usada no inventário (aba Produtos → Todos). */
export const CATALOGO_INVENTARIO_NOME = 'Ultrapao'

export type ProductOption = {
  id: string
  codigo: string
  descricao: string
  unidade_medida: string | null
  data_fabricacao?: string | null
  data_validade?: string | null
  ean?: string | null
  dun?: string | null
  foto_base64?: string | null
  foto_url?: string | null
}

export const CODIGO_NAO_ENCONTRADO_DESCRICAO = '— código não encontrado no cadastro —'

export function isCodigoNaoEncontradoDescricao(desc: string | null | undefined): boolean {
  return String(desc ?? '').trim().startsWith('— código não encontrado')
}

function isUuid(value: string | null | undefined) {
  if (!value) return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function pickFirstString(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const v = row[key]
    if (typeof v === 'string' && v.trim() !== '') return v
  }
  return ''
}

/** Código/descrição podem vir como string ou número do PostgREST. */
function pickFirstCell(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = row[key]
    if (v === null || v === undefined) continue
    if (typeof v === 'number' && !Number.isNaN(v)) return String(v)
    if (typeof v === 'boolean') continue
    if (typeof v === 'string') {
      const t = v.trim()
      if (t !== '') return t
    }
  }
  return ''
}

export function mapRowToProductOption(row: Record<string, unknown>): ProductOption | null {
  const codigo = pickFirstCell(row, ['codigo_interno', 'codigo', 'CÓDIGO', 'cod_produto'])
  if (!codigo) return null
  const descricao =
    pickFirstCell(row, ['descricao', 'DESCRIÇÃO', 'descrição', 'desc_produto']) || 'Produto sem descrição'
  const rawId = row.id
  const id = rawId != null && isUuid(String(rawId)) ? String(rawId) : codigo
  return {
    id,
    codigo,
    descricao,
    unidade_medida: pickFirstString(row, ['unidade_medida', 'unidade', 'UNIDADE', 'und']) || null,
    data_fabricacao: row.data_fabricacao != null ? String(row.data_fabricacao) : null,
    data_validade: row.data_validade != null ? String(row.data_validade) : null,
    ean: row.ean != null ? String(row.ean) : row.EAN != null ? String(row.EAN) : null,
    dun: row.dun != null ? String(row.dun) : row.DUN != null ? String(row.DUN) : null,
    foto_base64: (row.foto_base64 ?? row.FOTO_BASE64 ?? row.fotoBase64) as string | null,
    foto_url: (row.foto_url ?? row.fotoUrl ?? row.foto_url_base ?? row.FOTO_URL) as string | null,
  }
}
