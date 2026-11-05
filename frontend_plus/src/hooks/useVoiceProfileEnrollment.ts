import { useCallback, useRef, useState } from 'react'
import {
  MAX_VOICE_PROFILES,
  VOICE_ENROLLMENT_SAMPLES,
  addNamedVoiceProfile,
  canAddVoiceProfile,
  type NamedVoiceProfile,
  type VoiceRegistry,
} from '../lib/voiceProfile'
import { extractVoiceFeatures, recordVoiceSample } from '../lib/voiceFeatures'

type Options = {
  registry: VoiceRegistry
  onRegistryChange?: (registry: VoiceRegistry) => void
  onProfileComplete?: (profile: NamedVoiceProfile) => void
}

export function useVoiceProfileEnrollment(options: Options) {
  const [recording, setRecording] = useState(false)
  const [samples, setSamples] = useState<number[][]>([])
  const [error, setError] = useState<string | null>(null)
  const samplesRef = useRef<number[][]>([])
  const recordingLockRef = useRef(false)
  const registryRef = useRef(options.registry)
  const onRegistryChangeRef = useRef(options.onRegistryChange)
  const onCompleteRef = useRef(options.onProfileComplete)

  registryRef.current = options.registry
  onRegistryChangeRef.current = options.onRegistryChange
  onCompleteRef.current = options.onProfileComplete

  const resetSession = useCallback(() => {
    samplesRef.current = []
    setSamples([])
    setError(null)
  }, [])

  const recordSample = useCallback(
    async (name: string) => {
      const trimmedName = name.trim()
      if (!trimmedName) {
        setError('Informe o nome de quem está gravando.')
        return null
      }

      if (!canAddVoiceProfile(registryRef.current) && samplesRef.current.length === 0) {
        setError(`Limite de ${MAX_VOICE_PROFILES} pessoas atingido. Remova alguém para cadastrar outra voz.`)
        return null
      }

      if (recordingLockRef.current) return null

      if (samplesRef.current.length >= VOICE_ENROLLMENT_SAMPLES) {
        setError('Esta gravação já tem 3/3 amostras. Toque em concluir ou reinicie.')
        return null
      }

      recordingLockRef.current = true
      setError(null)
      setRecording(true)

      try {
        const blob = await recordVoiceSample(3500)
        if (!blob || blob.size < 64) {
          setError('Nenhum áudio capturado. Verifique o microfone e fale mais perto.')
          return null
        }

        const features = await extractVoiceFeatures(blob)
        if (features.every((v) => v === 0)) {
          setError('Não detectei voz. Fale "ok estoque" mais perto do microfone.')
          return null
        }

        const next = [...samplesRef.current, features].slice(0, VOICE_ENROLLMENT_SAMPLES)
        samplesRef.current = next
        setSamples(next)

        if (next.length >= VOICE_ENROLLMENT_SAMPLES) {
          const result = addNamedVoiceProfile(registryRef.current, trimmedName, next)
          if (result === 'duplicate') {
            setError(`Já existe uma voz cadastrada com o nome "${trimmedName}".`)
            samplesRef.current = []
            setSamples([])
            return null
          }
          if (result === 'full') {
            setError('Limite de 5 pessoas atingido. Remova alguém antes de cadastrar.')
            samplesRef.current = []
            setSamples([])
            return null
          }
          if (result) {
            registryRef.current = result.registry
            onRegistryChangeRef.current?.(result.registry)
            onCompleteRef.current?.(result.profile)
            samplesRef.current = []
            setSamples([])
          }
        }

        return features
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erro ao gravar amostra.')
        return null
      } finally {
        recordingLockRef.current = false
        setRecording(false)
      }
    },
    [],
  )

  return {
    recording,
    sampleCount: samples.length,
    requiredSamples: VOICE_ENROLLMENT_SAMPLES,
    error,
    recordSample,
    resetSession,
    canAddPerson: canAddVoiceProfile(options.registry),
    personCount: options.registry.profiles.length,
    maxPersons: MAX_VOICE_PROFILES,
  }
}
