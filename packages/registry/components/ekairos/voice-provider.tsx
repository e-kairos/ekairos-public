import * as React from "react"

export type VoiceState = "idle" | "recording" | "paused" | "processing"

type VoiceContextValue = {
  state: VoiceState
  error: string | null
  levels: number[]
  latestLevel: number
  start: () => Promise<void>
  stop: () => Promise<Blob | null>
  pause: () => void
  resume: () => void
  cancel: () => void
}

const VoiceContext = React.createContext<VoiceContextValue | undefined>(undefined)

export function useVoice(): VoiceContextValue {
  const ctx = React.useContext(VoiceContext)
  if (!ctx) {
    throw new Error("useVoice must be used within VoiceProvider")
  }
  return ctx
}

export function VoiceProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<VoiceState>("idle")
  const [error, setError] = React.useState<string | null>(null)
  const [levels, setLevels] = React.useState<number[]>([])
  const latestLevelRef = React.useRef<number>(0)

  const mediaRecorderRef = React.useRef<MediaRecorder | null>(null)
  const mediaStreamRef = React.useRef<MediaStream | null>(null)
  const chunksRef = React.useRef<BlobPart[]>([])
  const rafRef = React.useRef<number | null>(null)
  const audioCtxRef = React.useRef<AudioContext | null>(null)
  const analyserRef = React.useRef<AnalyserNode | null>(null)
  const sourceRef = React.useRef<MediaStreamAudioSourceNode | null>(null)

  React.useEffect(() => {
    return () => {
      try { stopTracks() } catch {}
      try { mediaRecorderRef.current?.stop() } catch {}
      if (rafRef.current) { cancelAnimationFrame(rafRef.current) }
      try { audioCtxRef.current?.close() } catch {}
    }
  }, [])

  function stopTracks() {
    const s = mediaStreamRef.current
    if (s) { s.getTracks().forEach(t => { try { t.stop() } catch {} }) }
    mediaStreamRef.current = null
  }

  function setupAnalyser(stream: MediaStream) {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)() as AudioContext
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.8
    const source = ctx.createMediaStreamSource(stream)
    source.connect(analyser)

    audioCtxRef.current = ctx
    analyserRef.current = analyser
    sourceRef.current = source

    const data = new Uint8Array(analyser.frequencyBinCount)
    const maxPoints = 48

    const loop = () => {
      analyser.getByteTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / data.length)
      const level = Math.max(0, Math.min(1, rms))
      latestLevelRef.current = level
      setLevels(prev => {
        const next = [...prev, level]
        if (next.length > maxPoints) { next.shift() }
        return next
      })
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
  }

  async function start() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream
      setupAnalyser(stream)
      const rec = new MediaRecorder(stream, { mimeType: "audio/webm" })
      chunksRef.current = []
      rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) { chunksRef.current.push(e.data) } }
      mediaRecorderRef.current = rec
      rec.start()
      setState("recording")
    } catch (e) {
      setError(String((e as Error)?.message || e))
      setState("idle")
      throw e
    }
  }

  function pause() {
    const rec = mediaRecorderRef.current
    if (!rec) { return }
    try { rec.pause() } catch {}
    setState("paused")
  }

  function resume() {
    const rec = mediaRecorderRef.current
    if (!rec) { return }
    try { rec.resume() } catch {}
    setState("recording")
  }

  async function stop(): Promise<Blob | null> {
    const rec = mediaRecorderRef.current
    if (!rec) { return null }
    setState("processing")
    const result = await new Promise<Blob | null>((resolve) => {
      rec.onstop = async () => {
        try {
          const inputBlob = new Blob(chunksRef.current, { type: "audio/webm" })
          try {
            const wav24k = await resampleToWav24k(inputBlob)
            resolve(wav24k)
          } catch {
            // Fallback: return original WebM if resample fails
            resolve(inputBlob)
          }
        } finally {
          cleanupAfterStop()
        }
      }
      try { rec.stop() } catch { cleanupAfterStop(); resolve(null) }
    })
    return result
  }

  function cleanupAfterStop() {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null }
    try { audioCtxRef.current?.close() } catch {}
    audioCtxRef.current = null
    analyserRef.current = null
    sourceRef.current = null
    stopTracks()
    mediaRecorderRef.current = null
    chunksRef.current = []
    setLevels([])
    setState("idle")
  }

  function cancel() {
    try {
      const rec = mediaRecorderRef.current
      if (rec && rec.state !== "inactive") {
        try { rec.stop() } catch {}
      }
    } finally {
      cleanupAfterStop()
    }
  }

  const value: VoiceContextValue = React.useMemo(() => ({
    state,
    error,
    levels,
    latestLevel: latestLevelRef.current,
    start,
    stop,
    pause,
    resume,
    cancel,
  }), [state, error, levels])

  return (
    <VoiceContext.Provider value={value}>
      {children}
    </VoiceContext.Provider>
  )
}

async function resampleToWav24k(input: Blob): Promise<Blob> {
  const arrayBuffer = await input.arrayBuffer()
  const AudioCtx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext
  const audioCtx = new AudioCtx()
  const original: AudioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0))
  const channels = original.numberOfChannels || 1
  const duration = original.duration
  const targetSampleRate = 24000
  const frameCount = Math.max(1, Math.ceil(duration * targetSampleRate))
  const offline = new OfflineAudioContext(channels, frameCount, targetSampleRate)
  const src = offline.createBufferSource()
  src.buffer = original
  src.connect(offline.destination)
  src.start(0)
  const rendered = await offline.startRendering()
  const wav = encodeWavPcm16(rendered, targetSampleRate)
  return new Blob([wav], { type: "audio/wav" })
}

function encodeWavPcm16(buffer: AudioBuffer, sampleRate: number): ArrayBuffer {
  const numChannels = buffer.numberOfChannels || 1
  const length = buffer.length
  const interleaved = interleaveChannels(buffer)
  const bytesPerSample = 2
  const blockAlign = numChannels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = interleaved.length * bytesPerSample
  const bufferSize = 44 + dataSize
  const ab = new ArrayBuffer(bufferSize)
  const view = new DataView(ab)

  writeString(view, 0, "RIFF")
  view.setUint32(4, 36 + dataSize, true)
  writeString(view, 8, "WAVE")
  writeString(view, 12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeString(view, 36, "data")
  view.setUint32(40, dataSize, true)

  let offset = 44
  for (let i = 0; i < interleaved.length; i++) {
    const s = Math.max(-1, Math.min(1, interleaved[i]))
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
    offset += 2
  }

  return ab
}

function interleaveChannels(buffer: AudioBuffer): Float32Array {
  const numChannels = buffer.numberOfChannels || 1
  if (numChannels === 1) { return buffer.getChannelData(0) }
  const ch0 = buffer.getChannelData(0)
  const ch1 = buffer.getChannelData(1)
  const length = buffer.length
  const result = new Float32Array(length * 2)
  let idx = 0
  for (let i = 0; i < length; i++) {
    result[idx++] = ch0[i]
    result[idx++] = ch1[i]
  }
  return result
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i))
  }
}



