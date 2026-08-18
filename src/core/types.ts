/** Operating systems supported by the native helper boundary. */
export type BgmPlatform = 'darwin' | 'win32' | 'linux' | 'unknown'

/** Best-effort media metadata published by the operating system. */
export interface NowPlayingState {
  readonly platform: BgmPlatform
  readonly sourceId?: string
  readonly sourceName?: string
  readonly title?: string
  readonly artist?: string
  readonly album?: string
  readonly artworkUrl?: string
  readonly durationMs?: number
  readonly positionMs?: number
  readonly playing: boolean
  readonly capturedAt: number
}

/** Reduced audio-analysis frame; raw PCM never crosses this boundary. */
export interface RhythmFrame {
  readonly capturedAt: number
  readonly rms: number
  readonly bass: number
  readonly mid: number
  readonly treble: number
  readonly onset: number
}

/** Host-side lifecycle exposed to the Web client. */
export type BgmHelperStatus =
  | 'starting'
  | 'listening'
  | 'unsupported'
  | 'permission-denied'
  | 'error'

/** Latest state sent by the Host over JSON/SSE. */
export interface BgmSnapshot {
  readonly platform: BgmPlatform
  readonly status: BgmHelperStatus
  readonly nowPlaying?: NowPlayingState
  readonly frame?: RhythmFrame
  readonly error?: string
  readonly updatedAt: number
}

/** Line-delimited event contract emitted by each native helper. */
export type BgmNativeEvent =
  | { readonly type: 'ready'; readonly platform: BgmPlatform; readonly sampleRate: number; readonly channels: number }
  | { readonly type: 'now-playing'; readonly state: NowPlayingState }
  | { readonly type: 'rhythm'; readonly frame: RhythmFrame }
  | { readonly type: 'permission'; readonly granted: boolean; readonly reason?: string }
  | { readonly type: 'error'; readonly code: string; readonly message: string }
