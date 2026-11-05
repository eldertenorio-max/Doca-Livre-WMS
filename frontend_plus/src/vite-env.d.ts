/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  /** homolog | producao — opcional; hostname também identifica o ambiente */
  readonly VITE_GEMINI_API_KEY?: string
  readonly VITE_HUB_API_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
