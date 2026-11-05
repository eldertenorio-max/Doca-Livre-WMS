export function toDatetimeLocalValue(d: Date) {
  if (!Number.isFinite(d.getTime())) {
    return toDatetimeLocalValue(new Date())
  }
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function toISOStringFromDatetimeLocal(value: string) {
  // `value` vem como "YYYY-MM-DDTHH:mm" e o JS normalmente interpreta como horário local.
  // Convertendo para ISO garantimos que o Supabase receba o timestamptz corretamente.
  const dt = new Date(value)
  if (!Number.isFinite(dt.getTime())) {
    return new Date().toISOString()
  }
  return dt.toISOString()
}

