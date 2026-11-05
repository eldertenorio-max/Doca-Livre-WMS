export function normalizarEmitente(nome: string): string | null {
  const t = nome.trim()
  if (!t) return null
  if (t.toLowerCase() === 'cadastro manual') return null
  return t
}

export function emitenteKey(nome: string): string | null {
  const n = normalizarEmitente(nome)
  return n ? n.toLowerCase() : null
}

export function mesclarEmitentesSugeridos(...listas: string[][]): string[] {
  const seen = new Set<string>()
  const out: string[] = []

  for (const lista of listas) {
    for (const item of lista) {
      const n = normalizarEmitente(item)
      if (!n) continue
      const key = n.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(n)
    }
  }

  return out
}

export function emitentesFromPersisted(data: {
  notas: { emitente: string }[]
  notasCanceladas: { emitente: string }[]
}): string[] {
  return mesclarEmitentesSugeridos(
    data.notas.map((n) => n.emitente),
    data.notasCanceladas.map((c) => c.emitente),
  )
}
