import type { BgmSnapshot, RhythmFrame } from '../core/types.ts'

function unit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function isFrame(value: unknown): value is RhythmFrame {
  if (typeof value !== 'object' || value === null) return false
  const frame = value as Record<string, unknown>
  return typeof frame.capturedAt === 'number'
    && unit(frame.rms)
    && unit(frame.bass)
    && unit(frame.mid)
    && unit(frame.treble)
    && unit(frame.onset)
}

function parseSnapshot(data: string): BgmSnapshot | undefined {
  let value: unknown
  try {
    value = JSON.parse(data) as unknown
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const snapshot = value as Record<string, unknown>
  if (snapshot.platform !== 'darwin' && snapshot.platform !== 'win32'
    && snapshot.platform !== 'linux' && snapshot.platform !== 'unknown') return undefined
  if (snapshot.status !== 'starting' && snapshot.status !== 'listening'
    && snapshot.status !== 'unsupported' && snapshot.status !== 'permission-denied'
    && snapshot.status !== 'error') return undefined
  if (typeof snapshot.updatedAt !== 'number') return undefined
  if (snapshot.frame !== undefined && !isFrame(snapshot.frame)) return undefined
  if (snapshot.error !== undefined && typeof snapshot.error !== 'string') return undefined
  return value as BgmSnapshot
}

/** Connect to the Host stream without introducing a React render loop at 20 Hz. */
export function subscribeBgm(listener: (snapshot: BgmSnapshot) => void): () => void {
  const source = new EventSource('/api/bgm/events')
  const receive = (event: Event): void => {
    if (!(event instanceof MessageEvent) || typeof event.data !== 'string') return
    const snapshot = parseSnapshot(event.data)
    if (snapshot !== undefined) listener(snapshot)
  }
  source.addEventListener('snapshot', receive)
  return () => {
    source.removeEventListener('snapshot', receive)
    source.close()
  }
}
