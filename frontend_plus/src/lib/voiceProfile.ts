import { verifyVoiceMatch } from './voiceFeatures'

export type NamedVoiceProfile = {
  id: string
  name: string
  features: number[]
  sampleCount: number
  createdAt: string
}

/** @deprecated Use NamedVoiceProfile */
export type VoiceProfile = NamedVoiceProfile

export type VoiceRegistry = {
  profiles: NamedVoiceProfile[]
}

export const VOICE_REGISTRY_KEY = 'ultrafrio-voice-registry'
export const VOICE_PROFILE_KEY = 'ultrafrio-voice-profile'
export const MAX_VOICE_PROFILES = 5
export const VOICE_ENROLLMENT_SAMPLES = 3
export const VOICE_MATCH_THRESHOLD = 0.55
/** Limiar mais baixo na verificação ao vivo (áudio contínuo com ruído). */
export const VOICE_LIVE_MATCH_THRESHOLD = 0.42

export function createVoiceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `v-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function averageFeatureVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) return []
  const len = vectors[0].length
  const sum = new Array(len).fill(0)
  for (const v of vectors) {
    for (let i = 0; i < len; i++) sum[i] += v[i] ?? 0
  }
  return sum.map((x) => x / vectors.length)
}

function migrateLegacySingleProfile(): NamedVoiceProfile | null {
  try {
    const raw = localStorage.getItem(VOICE_PROFILE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as {
      features?: number[]
      sampleCount?: number
      createdAt?: string
      name?: string
    }
    if (!Array.isArray(parsed.features) || parsed.features.length === 0) return null
    localStorage.removeItem(VOICE_PROFILE_KEY)
    return {
      id: createVoiceId(),
      name: parsed.name?.trim() || 'Usuário',
      features: parsed.features,
      sampleCount: parsed.sampleCount ?? VOICE_ENROLLMENT_SAMPLES,
      createdAt: parsed.createdAt ?? new Date().toISOString(),
    }
  } catch {
    return null
  }
}

function normalizeRegistry(raw: unknown): VoiceRegistry {
  if (!raw || typeof raw !== 'object') return { profiles: [] }
  const profiles = (raw as VoiceRegistry).profiles
  if (!Array.isArray(profiles)) return { profiles: [] }
  return {
    profiles: profiles
      .map((p) => {
        if (!p || !Array.isArray(p.features) || p.features.length === 0) return null
        return {
          id: typeof p.id === 'string' && p.id ? p.id : createVoiceId(),
          name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : 'Sem nome',
          features: p.features,
          sampleCount:
            typeof p.sampleCount === 'number' && p.sampleCount > 0
              ? p.sampleCount
              : VOICE_ENROLLMENT_SAMPLES,
          createdAt: typeof p.createdAt === 'string' ? p.createdAt : new Date().toISOString(),
        } satisfies NamedVoiceProfile
      })
      .filter((p): p is NamedVoiceProfile => p != null)
      .slice(0, MAX_VOICE_PROFILES),
  }
}

export function getStoredVoiceRegistry(): VoiceRegistry {
  let registry: VoiceRegistry = { profiles: [] }
  try {
    const raw = localStorage.getItem(VOICE_REGISTRY_KEY)
    if (raw) registry = normalizeRegistry(JSON.parse(raw))
  } catch {
    /* ignore */
  }

  if (registry.profiles.length === 0) {
    const legacy = migrateLegacySingleProfile()
    if (legacy) {
      registry = { profiles: [legacy] }
      storeVoiceRegistry(registry)
    }
  }

  return registry
}

export function storeVoiceRegistry(registry: VoiceRegistry) {
  try {
    localStorage.setItem(
      VOICE_REGISTRY_KEY,
      JSON.stringify({
        profiles: registry.profiles.slice(0, MAX_VOICE_PROFILES),
      }),
    )
  } catch {
    /* ignore */
  }
}

export function hasRegisteredVoices(registry: VoiceRegistry): boolean {
  return registry.profiles.length > 0
}

export function canAddVoiceProfile(registry: VoiceRegistry): boolean {
  return registry.profiles.length < MAX_VOICE_PROFILES
}

export function findVoiceByName(registry: VoiceRegistry, name: string): NamedVoiceProfile | null {
  const n = name.trim().toLowerCase()
  return registry.profiles.find((p) => p.name.toLowerCase() === n) ?? null
}

export function addNamedVoiceProfile(
  registry: VoiceRegistry,
  name: string,
  samples: number[][],
): { registry: VoiceRegistry; profile: NamedVoiceProfile } | 'duplicate' | 'full' | null {
  const trimmed = name.trim()
  if (!trimmed || samples.length < VOICE_ENROLLMENT_SAMPLES) return null
  if (!canAddVoiceProfile(registry)) return 'full'
  if (findVoiceByName(registry, trimmed)) return 'duplicate'

  const profile: NamedVoiceProfile = {
    id: createVoiceId(),
    name: trimmed,
    features: averageFeatureVectors(samples.slice(0, VOICE_ENROLLMENT_SAMPLES)),
    sampleCount: VOICE_ENROLLMENT_SAMPLES,
    createdAt: new Date().toISOString(),
  }

  const next: VoiceRegistry = {
    profiles: [...registry.profiles, profile].slice(0, MAX_VOICE_PROFILES),
  }
  storeVoiceRegistry(next)
  return { registry: next, profile }
}

export function removeNamedVoiceProfile(registry: VoiceRegistry, id: string): VoiceRegistry {
  const next = { profiles: registry.profiles.filter((p) => p.id !== id) }
  storeVoiceRegistry(next)
  return next
}

export function findBestVoiceMatch(
  profiles: NamedVoiceProfile[],
  sample: number[],
  threshold: number,
): { match: boolean; score: number; profile: NamedVoiceProfile | null } {
  let best: NamedVoiceProfile | null = null
  let bestScore = 0

  for (const profile of profiles) {
    const { score } = verifyVoiceMatch(profile.features, sample, threshold)
    if (score > bestScore) {
      bestScore = score
      best = profile
    }
  }

  return {
    match: bestScore >= threshold,
    score: bestScore,
    profile: best,
  }
}

/** Compatibilidade: retorna a primeira voz cadastrada. */
export function getStoredVoiceProfile(): NamedVoiceProfile | null {
  return getStoredVoiceRegistry().profiles[0] ?? null
}

export function storeVoiceProfile(profile: NamedVoiceProfile | null) {
  if (!profile) {
    storeVoiceRegistry({ profiles: [] })
    return
  }
  storeVoiceRegistry({ profiles: [profile] })
}

export function buildVoiceProfile(name: string, samples: number[][]): NamedVoiceProfile {
  return {
    id: createVoiceId(),
    name: name.trim(),
    features: averageFeatureVectors(samples),
    sampleCount: samples.length,
    createdAt: new Date().toISOString(),
  }
}
