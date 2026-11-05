/** Mensagem legível para erros do Supabase/PostgREST e outros valores em catch. */
export function formatUnknownError(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>
    const msg = typeof o.message === 'string' ? o.message.trim() : ''
    const details = typeof o.details === 'string' ? o.details.trim() : ''
    const hint = typeof o.hint === 'string' ? o.hint.trim() : ''
    const code = o.code != null ? String(o.code) : ''
    const parts: string[] = []
    if (msg) parts.push(msg)
    if (details && details !== msg) parts.push(details)
    if (hint) parts.push(`Dica: ${hint}`)
    if (code && !parts.some((p) => p.includes(code))) parts.push(`(${code})`)
    if (parts.length) return parts.join(' — ')
    try {
      const j = JSON.stringify(e)
      if (j && j !== '{}') return j
    } catch {
      /* ignore */
    }
  }
  if (e == null) return ''
  return String(e)
}

/** Tabela inexistente ou fora do schema cache do PostgREST. */
export function isTableMissingError(e: unknown, tableName?: string): boolean {
  const code =
    e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : ''
  const msg = formatUnknownError(e).toLowerCase()
  const table = tableName?.toLowerCase()
  if (code === '42P01' || code === 'PGRST205') {
    return !table || msg.includes(table)
  }
  if (msg.includes('relation') && msg.includes('does not exist')) {
    return !table || msg.includes(table)
  }
  if (msg.includes('could not find') && msg.includes('table')) {
    return !table || msg.includes(table)
  }
  if (msg.includes('schema cache') && msg.includes('table')) {
    return !table || msg.includes(table)
  }
  return false
}

/** Coluna inexistente ou fora do schema cache do PostgREST — permite tentar payload menor. */
export function isColumnMissingError(e: unknown): boolean {
  const code =
    e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : ''
  const msg = formatUnknownError(e).toLowerCase()
  if (code === '42703' || code === 'PGRST204') return true
  if (msg.includes('does not exist')) return true
  if (msg.includes('schema cache') && msg.includes('column')) return true
  if (msg.includes('could not find') && msg.includes('column')) return true
  if (msg.includes("'column'") || (msg.includes('column') && msg.includes('schema cache'))) return true
  return false
}
