const BAND_COUNT = 16

function estimatePitch(frame: Float32Array, sampleRate: number): number {
  const minLag = Math.floor(sampleRate / 400)
  const maxLag = Math.floor(sampleRate / 70)
  let bestLag = 0
  let bestCorr = 0

  for (let lag = minLag; lag <= maxLag && lag < frame.length / 2; lag++) {
    let corr = 0
    for (let i = 0; i < frame.length - lag; i++) {
      corr += frame[i] * frame[i + lag]
    }
    if (corr > bestCorr) {
      bestCorr = corr
      bestLag = lag
    }
  }

  return bestLag > 0 ? sampleRate / bestLag : 0
}

function bandEnergy(frame: Float32Array, band: number, bands: number): number {
  const size = Math.floor(frame.length / bands)
  const start = band * size
  let energy = 0
  for (let i = start; i < start + size && i < frame.length; i++) {
    energy += frame[i] * frame[i]
  }
  return Math.sqrt(energy / Math.max(1, size))
}

export async function decodeAudioBlob(blob: Blob): Promise<AudioBuffer> {
  const arrayBuffer = await blob.arrayBuffer()
  if (arrayBuffer.byteLength < 64) {
    throw new Error('Áudio muito curto para análise.')
  }

  const ctx = new AudioContext()
  try {
    return await ctx.decodeAudioData(arrayBuffer.slice(0))
  } finally {
    await ctx.close()
  }
}

export function extractFeaturesFromBuffer(buffer: AudioBuffer): number[] {
  const channel = buffer.getChannelData(0)
  const sampleRate = buffer.sampleRate
  const frameSize = Math.max(256, Math.floor(sampleRate * 0.03))
  const frames = Math.floor(channel.length / frameSize)

  let voicedFrames = 0
  let pitchSum = 0
  let rmsSum = 0
  let zcrSum = 0
  const bandSums = new Array(BAND_COUNT).fill(0)

  for (let f = 0; f < frames; f++) {
    const start = f * frameSize
    const frame = channel.subarray(start, start + frameSize)

    let rms = 0
    let zcr = 0
    for (let i = 0; i < frame.length; i++) {
      rms += frame[i] * frame[i]
      if (i > 0 && (frame[i] >= 0) !== (frame[i - 1] >= 0)) zcr++
    }
    rms = Math.sqrt(rms / frame.length)
    if (rms < 0.008) continue

    voicedFrames++
    rmsSum += rms
    zcrSum += zcr / frame.length

    const pitch = estimatePitch(frame, sampleRate)
    if (pitch > 70 && pitch < 400) pitchSum += pitch

    for (let b = 0; b < BAND_COUNT; b++) {
      bandSums[b] += bandEnergy(frame, b, BAND_COUNT)
    }
  }

  if (voicedFrames === 0) {
    return new Array(3 + BAND_COUNT).fill(0)
  }

  const avgPitch = pitchSum / voicedFrames
  const avgRms = rmsSum / voicedFrames
  const avgZcr = zcrSum / voicedFrames
  const bands = bandSums.map((b) => b / voicedFrames)

  return [avgPitch / 300, avgRms * 10, avgZcr * 100, ...bands]
}

export async function extractVoiceFeatures(blob: Blob): Promise<number[]> {
  const buffer = await decodeAudioBlob(blob)
  return extractFeaturesFromBuffer(buffer)
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length)
  if (len === 0) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export function verifyVoiceMatch(
  profile: number[],
  sample: number[],
  threshold: number,
): { match: boolean; score: number } {
  const score = cosineSimilarity(profile, sample)
  return { match: score >= threshold, score }
}

export async function recordVoiceSample(durationMs = 3200): Promise<Blob> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  })
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : 'audio/webm'
  const recorder = new MediaRecorder(stream, { mimeType })
  const chunks: Blob[] = []

  return new Promise((resolve, reject) => {
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data)
    }
    recorder.onerror = () => {
      stream.getTracks().forEach((t) => t.stop())
      reject(new Error('Erro ao gravar áudio.'))
    }
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      const blob = new Blob(chunks, { type: mimeType })
      if (blob.size < 64) {
        reject(new Error('Nenhum áudio capturado. Verifique o microfone.'))
        return
      }
      resolve(blob)
    }
    recorder.start(200)
    setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop()
    }, durationMs)
  })
}
