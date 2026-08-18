import type { RhythmFrame } from '../core/types.ts'

const STORAGE_KEY = 'dsh-bgm:atmosphere'
const BAR_COUNT = 12
const MIN_LANE_WIDTH = 72
const MAX_LANE_WIDTH = 196
const LANE_GAP = 24
const VIEWPORT_EDGE = 16
const LAYOUT_INTERVAL_MS = 600

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

/** Two compositor-only RGB spectrum banks anchored in the composer's empty side gutters. */
export class AtmosphereVisualizer {
  private readonly lanes: readonly [HTMLDivElement, HTMLDivElement]
  private readonly bars: readonly [readonly HTMLSpanElement[], readonly HTMLSpanElement[]]
  private enabledState = initialEnabled()
  private laidOut = false
  private lastLayoutAt = Number.NEGATIVE_INFINITY

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

  render(frame: RhythmFrame, envelope: number): void {
    if (!this.enabledState) return
    const now = performance.now()
    if (now - this.lastLayoutAt >= LAYOUT_INTERVAL_MS) this.layout(now)
    if (!this.laidOut) return

    const energy = clamp(envelope, 0, 1)
    const onset = clamp(frame.onset, 0, 1)
    const laneOpacity = clamp(0.16 + energy * 0.48 + onset * 0.12, 0.16, 0.72)
    const time = frame.capturedAt / 1_000
    for (let side = 0; side < this.lanes.length; side += 1) {
      const lane = this.lanes[side]
      lane.hidden = false
      lane.style.opacity = laneOpacity.toFixed(3)
      const bars = this.bars[side]
      for (let index = 0; index < bars.length; index += 1) {
        const fromInner = side === 0
          ? (bars.length - 1 - index) / Math.max(1, bars.length - 1)
          : index / Math.max(1, bars.length - 1)
        const band = fromInner < 0.5
          ? frame.bass + (frame.mid - frame.bass) * fromInner * 2
          : frame.mid + (frame.treble - frame.mid) * (fromInner - 0.5) * 2
        const ripple = 0.78 + Math.sin(time * (2.4 + onset * 3.2) - fromInner * 5.4) * 0.22
        const height = clamp(0.045 + (band * 0.63 + energy * 0.18 + onset * 0.24) * ripple, 0.045, 0.92)
        const bar = bars[index]
        bar.style.transform = `scaleY(${height.toFixed(3)})`
        bar.style.opacity = clamp(0.34 + band * 0.52 + onset * 0.12, 0.34, 0.92).toFixed(3)
      }
    }
  }

  clear(): void {
    this.laidOut = false
    this.lastLayoutAt = Number.NEGATIVE_INFINITY
    for (const lane of this.lanes) {
      lane.hidden = true
      lane.style.opacity = '0'
    }
    for (const bars of this.bars) {
      for (const bar of bars) {
        bar.style.transform = 'scaleY(.045)'
        bar.style.opacity = '.34'
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
