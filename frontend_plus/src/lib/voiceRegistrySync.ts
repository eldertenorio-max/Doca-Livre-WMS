import { getSupabase, isSupabaseConfigured } from './supabaseClient'
import { MAX_VOICE_PROFILES, type NamedVoiceProfile, type VoiceRegistry } from './voiceProfile'

type VoiceRow = {
  id: string
  name: string
  features: number[] | string
  sample_count: number
  created_at: string
  updated_at: string
}

function mapRow(row: VoiceRow): NamedVoiceProfile | null {
  const features = Array.isArray(row.features)
    ? row.features.map(Number)
    : typeof row.features === 'string'
      ? (JSON.parse(row.features) as number[])
      : []
  if (!features.length) return null
  return {
    id: row.id,
    name: row.name.trim() || 'Sem nome',
    features,
    sampleCount: row.sample_count > 0 ? row.sample_count : 3,
    createdAt: row.created_at,
  }
}

export async function loadVoiceRegistryRemote(): Promise<VoiceRegistry> {
  if (!isSupabaseConfigured()) return { profiles: [] }

  const sb = getSupabase()
  const { data, error } = await sb
    .from('ultrafrio_voz_cadastros')
    .select('*')
    .order('created_at', { ascending: true })

  if (error) {
    if (error.message.includes('does not exist') || error.code === 'PGRST205') {
      return { profiles: [] }
    }
    throw new Error(error.message)
  }

  const profiles = ((data ?? []) as VoiceRow[])
    .map(mapRow)
    .filter((p): p is NamedVoiceProfile => p != null)
    .slice(0, MAX_VOICE_PROFILES)

  return { profiles }
}

export async function saveVoiceRegistryRemote(registry: VoiceRegistry): Promise<void> {
  if (!isSupabaseConfigured()) return

  const sb = getSupabase()
  const profiles = registry.profiles.slice(0, MAX_VOICE_PROFILES)
  const keepIds = profiles.map((p) => p.id)

  const { data: existing, error: listErr } = await sb
    .from('ultrafrio_voz_cadastros')
    .select('id')

  if (listErr) {
    if (listErr.message.includes('does not exist') || listErr.code === 'PGRST205') return
    throw new Error(listErr.message)
  }

  const toDelete = ((existing ?? []) as { id: string }[])
    .map((r) => r.id)
    .filter((id) => !keepIds.includes(id))

  if (toDelete.length) {
    const { error } = await sb.from('ultrafrio_voz_cadastros').delete().in('id', toDelete)
    if (error) throw new Error(error.message)
  }

  for (const profile of profiles) {
    const { error } = await sb.from('ultrafrio_voz_cadastros').upsert({
      id: profile.id,
      name: profile.name,
      features: profile.features,
      sample_count: profile.sampleCount,
      created_at: profile.createdAt,
      updated_at: new Date().toISOString(),
    })
    if (error) throw new Error(error.message)
  }
}

export function mergeVoiceRegistries(local: VoiceRegistry, remote: VoiceRegistry): VoiceRegistry {
  const byId = new Map<string, NamedVoiceProfile>()

  for (const profile of [...remote.profiles, ...local.profiles]) {
    const existing = byId.get(profile.id)
    if (!existing || profile.createdAt >= existing.createdAt) {
      byId.set(profile.id, profile)
    }
  }

  const byName = new Map<string, NamedVoiceProfile>()
  for (const profile of byId.values()) {
    const key = profile.name.trim().toLowerCase()
    if (!key) continue
    const existing = byName.get(key)
    if (!existing || profile.createdAt >= existing.createdAt) {
      byName.set(key, profile)
    }
  }

  return {
    profiles: [...byName.values()]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, MAX_VOICE_PROFILES),
  }
}

export function voiceRegistriesEqual(a: VoiceRegistry, b: VoiceRegistry): boolean {
  if (a.profiles.length !== b.profiles.length) return false

  const sorted = (registry: VoiceRegistry) =>
    [...registry.profiles].sort((x, y) => x.id.localeCompare(y.id))

  const left = sorted(a)
  const right = sorted(b)

  for (let i = 0; i < left.length; i++) {
    const x = left[i]
    const y = right[i]
    if (x.id !== y.id || x.name !== y.name || x.sampleCount !== y.sampleCount) return false
    if (x.features.length !== y.features.length) return false
    for (let j = 0; j < x.features.length; j++) {
      if (Math.abs(x.features[j] - y.features[j]) > 0.0001) return false
    }
  }

  return true
}

export function subscribeVoiceRegistryChanges(onChange: () => void): () => void {
  if (!isSupabaseConfigured()) return () => {}

  const sb = getSupabase()
  const channel = sb
    .channel('ultrafrio-voz-sync')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'ultrafrio_voz_cadastros' },
      () => onChange(),
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onChange()
    })

  return () => {
    void sb.removeChannel(channel)
  }
}
