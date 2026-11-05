import { createClient } from '@supabase/supabase-js'
import { wrapSupabaseClientWithDataProtection } from './supabaseDataProtection'

type UnifiedWindow = Window & {
  __WMS_UNIFIED__?: {
    supabaseUrl?: string
    supabaseAnonKey?: string
    usuario?: string
    isSuperuser?: boolean
  }
}

const DEFAULT_PRO_SUPABASE_URL = 'https://wbqyufalamdsgurejvyz.supabase.co'
const DEFAULT_PRO_SUPABASE_ANON_KEY = 'sb_publishable_G1gT1Fp_sc_ojXyJYKzElA_-fVP80TK'

function resolveCredentials(): { url: string; anonKey: string } {
  const win = typeof window !== 'undefined' ? (window as UnifiedWindow) : undefined
  const url =
    (win?.__WMS_UNIFIED__?.supabaseUrl || (import.meta.env.VITE_SUPABASE_URL as string | undefined) || DEFAULT_PRO_SUPABASE_URL).trim()
  const anonKey =
    (win?.__WMS_UNIFIED__?.supabaseAnonKey || (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || DEFAULT_PRO_SUPABASE_ANON_KEY).trim()
  return { url, anonKey }
}

export function isSupabaseConfigured(): boolean {
  const { url, anonKey } = resolveCredentials()
  return Boolean(url && anonKey)
}

export const supabase: any = (() => {
  const { url, anonKey } = resolveCredentials()
  return wrapSupabaseClientWithDataProtection(createClient(url, anonKey))
})()
