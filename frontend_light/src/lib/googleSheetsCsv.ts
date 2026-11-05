/** Utilitários para export CSV público do Google Sheets (gviz / export). */

export function parseGoogleSheetsCsv(csvText: string): string[][] {
  const lines = String(csvText || '').split(/\r?\n/).filter((l) => l.trim() !== '')
  const sep = lines[0]?.includes('\t') ? '\t' : ','
  return lines.map((line) => {
    const out: string[] = []
    let cur = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]
      if (ch === '"') {
        const next = line[i + 1]
        if (inQuotes && next === '"') {
          cur += '"'
          i += 1
        } else {
          inQuotes = !inQuotes
        }
      } else if (ch === sep && !inQuotes) {
        out.push(cur.trim())
        cur = ''
      } else {
        cur += ch
      }
    }
    out.push(cur.trim())
    return out
  })
}

export function isGoogleSheetsHtmlResponse(txt: string): boolean {
  return /<html|<!doctype html|sign in|google sheets/i.test(txt)
}

export async function fetchGoogleSheetCsv(
  sheetId: string,
  opts: { gid?: string; sheetName?: string },
): Promise<{ text: string; url: string }> {
  const q = new URLSearchParams()
  if (opts.gid != null && String(opts.gid).trim() !== '') q.set('gid', String(opts.gid))
  if (opts.sheetName != null && String(opts.sheetName).trim() !== '') q.set('sheet', String(opts.sheetName).trim())
  const urls = [
    `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&${q.toString()}`,
    `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&${q.toString()}`,
  ]
  let lastErr = 'Falha ao carregar planilha.'
  for (const url of urls) {
    try {
      const resp = await fetch(url, { cache: 'no-store', credentials: 'omit' })
      const text = await resp.text()
      if (!resp.ok) throw new Error(`Erro HTTP ${resp.status}`)
      if (isGoogleSheetsHtmlResponse(text)) throw new Error('Google retornou tela HTML/login.')
      return { text, url }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : 'Falha.'
    }
  }
  throw new Error(lastErr)
}
