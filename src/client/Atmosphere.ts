import type { RhythmFrame } from '../core/types.ts'

const STORAGE_KEY = 'dsh-bgm:atmosphere'
const BAR_COUNT = 12
const MIN_LANE_WIDTH = 72
const MAX_LANE_WIDTH = 196
const LANE_GAP = 24
const VIEWPORT_EDGE = 16
const LAYOUT_INTERVAL_MS = 600
const BEAT_DECAY_MS = 280

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

function initialEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

/** Two RGB spectrum banks anchored in the composer's empty side gutters. */
export class AtmosphereVisualizer {
  private readonly lanes: readonly [HTMLDivElement, HTMLDivElement]
  private readonly bars: readonly [readonly HTMLSpanElement[], readonly HTMLSpanElement[]]
  private enabledState = initialEnabled()
  private laidOut = false
  private lastLayoutAt = Number.NEGATIVE_INFINITY
  private beatStartedAt = Number.NEGATIVE_INFINITY
  private beatStrength = 0
  private beatDetected = false

  constructor(overlay: HTMLElement) {
    const left = this.createLane('left')
    const right = this.createLane('right')
    this.lanes = [left.lane, right.lane]
    this.bars = [left.bars, right.bars]
    overlay.prepend(left.lane, right.lane)
  }

  enabled(): boolean {
    return this.enabledState
  }

  setEnabled(enabled: boolean): void {
    this.enabledState = enabled
    try {
      window.localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off')
    } catch {
      // A blocked storage backend must not break the visual toggle itself.
    }
    this.lastLayoutAt = Number.NEGATIVE_INFINITY
    if (!enabled) this.clear()
  }

  /** Feed the adaptive downbeat detector into the otherwise continuous spectrum. */
  pulse(confidence: number, kind: 'detected' | 'fallback'): void {
    if (!this.enabledState) return
    this.beatStartedAt = performance.now()
    this.beatDetected = kind === 'detected'
    const strength = this.beatDetected
      ? 0.58 + clamp(confidence, 0, 1) * 0.42
      : 0.18
    this.beatStrength = Math.max(this.beatStrength * 0.35, strength)
  }

  render(frame: RhythmFrame, envelope: number): void {
    if (!this.enabledState) return
    const now = performance.now()
    if (now - this.lastLayoutAt >= LAYOUT_INTERVAL_MS) this.layout(now)
    if (!this.laidOut) return

    const energy = clamp(envelope, 0, 1)
    const onset = clamp(frame.onset, 0, 1)
    const beatAge = Math.max(0, now - this.beatStartedAt)
    const beatProgress = clamp(beatAge / BEAT_DECAY_MS, 0, 1)
    const beatPulse = beatProgress >= 1
      ? 0
      : this.beatStrength * (1 - beatProgress) ** 2
    // The beat crest starts at the outer edges and travels toward the
    // conversation — 两边往中间.
    const beatTravel = clamp(1 - beatAge / (this.beatDetected ? 230 : BEAT_DECAY_MS), 0, 1)
    if (beatPulse === 0) this.beatStrength = 0
    // Luminous like the MISS/GOOD grade text; one filter per lane keeps this cheap.
    const laneOpacity = clamp(0.45 + energy * 0.3 + onset * 0.06 + beatPulse * 0.14, 0.45, 0.95)
    const time = frame.capturedAt / 1_000
    // 随波逐流: one continuous sine travels along each lane toward the
    // conversation centre; speed follows the loudness envelope.
    const wavePhase = (time * (0.55 + energy * 0.85)) % 1
    for (let side = 0; side < this.lanes.length; side += 1) {
      const lane = this.lanes[side]
      lane.hidden = false
      lane.style.opacity = laneOpacity.toFixed(3)
      lane.style.filter = `brightness(${(1.02 + energy * 0.18 + beatPulse * 0.55).toFixed(3)}) saturate(${(1.05 + beatPulse * 0.35).toFixed(3)})`
      const bars = this.bars[side]
      for (let index = 0; index < bars.length; index += 1) {
        const fromInner = side === 0
          ? (bars.length - 1 - index) / Math.max(1, bars.length - 1)
          : index / Math.max(1, bars.length - 1)
        const band = fromInner < 0.5
          ? frame.bass + (frame.mid - frame.bass) * fromInner * 2
          : frame.mid + (frame.treble - frame.mid) * (fromInner - 0.5) * 2
        const ripple = 0.78 + Math.sin(time * (2.4 + onset * 3.2) - fromInner * 5.4) * 0.22
        const travelCrest = Math.max(0, 1 - Math.abs(fromInner - beatTravel) * 4.4)
        const kickLift = beatPulse * (0.18 + travelCrest * 0.42) * (1 - fromInner * 0.18)
        const base = 0.045 + (band * 0.57 + energy * 0.14 + onset * 0.1) * ripple
        // The spectrum rides on the travelling wave: bars swell and sink in
        // sequence instead of only scaling vertically.
        const flow = 0.5 + 0.5 * Math.sin(Math.PI * 2 * (fromInner + wavePhase))
        const height = clamp(base * (0.4 + flow * 0.9) + kickLift, 0.045, 0.96)
        const bar = bars[index]
        const beatWidth = 1 + beatPulse * travelCrest * 0.18
        bar.style.transform = `scale(${beatWidth.toFixed(3)}, ${height.toFixed(3)})`
        bar.style.opacity = clamp(
          0.55 + band * 0.18 + energy * 0.1 + beatPulse * travelCrest * 0.32,
          0.55,
          0.95,
        ).toFixed(3)
      }
    }
  }

  clear(): void {
    this.laidOut = false
    this.lastLayoutAt = Number.NEGATIVE_INFINITY
    this.beatStartedAt = Number.NEGATIVE_INFINITY
    this.beatStrength = 0
    this.beatDetected = false
    for (const lane of this.lanes) {
      lane.hidden = true
      lane.style.opacity = '0'
      lane.style.filter = ''
    }
    for (const bars of this.bars) {
      for (const bar of bars) {
        bar.style.transform = 'scale(1, .045)'
        bar.style.opacity = '.55'
      }
    }
  }

  dispose(): void {
    for (const lane of this.lanes) lane.remove()
  }

  private createLane(side: 'left' | 'right'): { lane: HTMLDivElement; bars: readonly HTMLSpanElement[] } {
    const lane = document.createElement('div')
    lane.className = `dsh-bgm-atmosphere dsh-bgm-atmosphere--${side}`
    lane.hidden = true
    const bars: HTMLSpanElement[] = []
    for (let index = 0; index < BAR_COUNT; index += 1) {
      const bar = document.createElement('span')
      bar.className = 'dsh-bgm-atmosphere-bar'
      // Full RGB spectrum: one distinct hue per bar, walking around the wheel.
      bar.style.setProperty('--dsh-bgm-atmosphere-hue', String(188 + index * 17))
      lane.append(bar)
      bars.push(bar)
    }
    return { lane, bars }
  }

  private layout(now: number): void {
    this.lastLayoutAt = now
    const composer = document.querySelector<HTMLElement>('[data-composer-card]')
    if (composer === null) {
      this.hideLanes()
      return
    }
    const rect = composer.getBoundingClientRect()
    const sideSpace = Math.min(rect.left, window.innerWidth - rect.right)
    const laneWidth = Math.min(MAX_LANE_WIDTH, sideSpace - LANE_GAP - VIEWPORT_EDGE)
    const top = Math.max(56, Math.min(window.innerHeight * 0.17, rect.top - 240))
    const laneHeight = Math.min(window.innerHeight * 0.68, rect.top - top - 28)
    if (rect.width <= 0 || laneWidth < MIN_LANE_WIDTH || laneHeight < 220) {
      this.hideLanes()
      return
    }

    const left = this.lanes[0]
    const right = this.lanes[1]
    left.style.left = `${Math.round(rect.left - LANE_GAP - laneWidth)}px`
    right.style.left = `${Math.round(rect.right + LANE_GAP)}px`
    for (const lane of this.lanes) {
      lane.style.top = `${Math.round(top)}px`
      lane.style.width = `${Math.round(laneWidth)}px`
      lane.style.height = `${Math.round(laneHeight)}px`
    }
    this.laidOut = true
  }

  private hideLanes(): void {
    this.laidOut = false
    for (const lane of this.lanes) lane.hidden = true
  }
}
