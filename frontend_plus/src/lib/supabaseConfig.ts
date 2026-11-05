import { applySupabaseCredentials, isSupabaseConfigured } from './supabaseClient'

type RuntimeConfig = {
  url?: string
  anonKey?: string
}

let configPromise: Promise<void> | null = null

export function ensureSupabaseConfig(): Promise<void> {
  if (isSupabaseConfigured()) return Promise.resolve()
  if (!configPromise) {
    configPromise = (async () => {
      try {
        const res = await fetch('/supabase-config.json', { cache: 'no-store' })
        if (!res.ok) return
        const json = (await res.json()) as RuntimeConfig
        if (json.url && json.anonKey) {
          applySupabaseCredentials(json.url, json.anonKey)
        }
      } catch {
        /* modo local sem nuvem */
      }
    })()
  }
  return configPromise
}
