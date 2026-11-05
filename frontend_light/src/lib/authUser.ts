import type { Session } from '@supabase/supabase-js'

type UnifiedWindow = Window & {
  __WMS_UNIFIED__?: {
    usuario?: string
    isSuperuser?: boolean
  }
}

export function isAppAdmin(session: Session | null | undefined): boolean {
  if (typeof window !== 'undefined' && (window as UnifiedWindow).__WMS_UNIFIED__?.isSuperuser) {
    return true
  }
  const u = usernameFromSession(session)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  if (
    u === 'diego.isidoro' ||
    u === 'diego' ||
    u === 'diego isidoro' ||
    u === 'elder' ||
    u === 'elder.tenorio' ||
    u === 'elder tenorio' ||
    u === 'admin' ||
    u.startsWith('diego ') ||
    u.startsWith('elder ')
  ) {
    return true
  }
  const email = (session?.user?.email ?? '').split('@')[0]?.trim().toLowerCase() || ''
  return (
    email === 'diego.isidoro' ||
    email === 'diego' ||
    email === 'elder.tenorio' ||
    email === 'elder'
  )
}

export function usernameFromSession(session: Session | null | undefined): string {
  if (typeof window !== 'undefined') {
    const u = (window as UnifiedWindow).__WMS_UNIFIED__?.usuario?.trim()
    if (u) return u
  }
  if (!session?.user) return 'usuário'
  const meta = session.user.user_metadata as Record<string, unknown> | undefined
  const fromMeta = meta?.username ?? meta?.nome ?? meta?.name
  if (typeof fromMeta === 'string' && fromMeta.trim()) return fromMeta.trim()
  const email = session.user.email ?? ''
  const local = email.split('@')[0]?.trim()
  return local || 'usuário'
}

export type ConferenteRef = { id: string; nome: string }

/** Nome (e id, se cadastrado) do conferente vinculado ao usuário logado. */
export function resolveConferenteDoUsuarioLogado(
  session: Session | null | undefined,
  conferentes: ConferenteRef[],
): ConferenteRef | null {
  const logado = usernameFromSession(session).trim()
  if (!logado || logado === 'usuário') return null
  const exato = conferentes.find((c) => c.nome.trim().toLowerCase() === logado.toLowerCase())
  if (exato) return exato
  return { id: '', nome: logado.toLowerCase() }
}
