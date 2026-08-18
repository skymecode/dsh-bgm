import type { BgmSnapshot, RhythmFrame } from '../core/types.ts'
import { subscribeBgm } from './stream.ts'

type SurfaceKind = 'reasoning' | 'tool' | 'context' | 'deep-diving'
type CueLane = 'downbeat' | 'flow'
type TriggerOrder = 'together' | 'left-right' | 'right-left' | 'center-out'
  | 'edges-in' | 'even-odd' | 'odd-even' | 'shuffle'
type MotionStyle = 'punch' | 'jump' | 'drop' | 'split' | 'converge'
  | 'zigzag' | 'snake' | 'stair-up' | 'stair-down' | 'fan' | 'orbit'
type AttackStyle = 'snap' | 'bounce' | 'hold'

interface ChartStyle {
  readonly order: TriggerOrder
  readonly motion: MotionStyle
  readonly attack: AttackStyle
}

const DOWNBEAT_ORDERS: readonly TriggerOrder[] = ['together', 'center-out', 'edges-in', 'even-odd']
const DOWNBEAT_MOTIONS: readonly MotionStyle[] = ['punch', 'jump', 'drop', 'split', 'converge']
const FLOW_ORDERS: readonly TriggerOrder[] = [
  'left-right', 'right-left', 'center-out', 'edges-in', 'even-odd', 'odd-even', 'shuffle',
]
const FLOW_MOTIONS: readonly MotionStyle[] = [
  'jump', 'drop', 'split', 'converge', 'zigzag', 'snake', 'stair-up', 'stair-down', 'fan', 'orbit',
]
const ATTACKS: readonly AttackStyle[] = ['snap', 'bounce', 'hold']

interface Glyph {
  readonly element: HTMLSpanElement
  readonly centerX: number
  readonly centerY: number
}

interface Surface {
  readonly target: HTMLElement
  readonly kind: SurfaceKind
  readonly glyphs: Glyph[]
  readonly masked: Set<HTMLElement>
  readonly signature: string
}

interface Candidate {
  readonly target: HTMLElement
  readonly kind: SurfaceKind
}

interface WaveCue {
  readonly lane: CueLane
  readonly style: ChartStyle
  readonly seed: number
  readonly energy: number
  readonly startedAt: number
  readonly travelMs: number
  readonly durationMs: number
}

interface PredictedNote {
  readonly element: HTMLSpanElement
  readonly anchor: HTMLElement
  readonly targetAt: number
  readonly judgeX: number
  readonly judgeY: number
}

function hashUnit(seed: number, salt: number): number {
  let value = (seed ^ Math.imul(salt + 1, 0x45d9f3b)) | 0
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b)
  value = Math.imul(value ^ (value >>> 16), 0x45d9f3b)
  return ((value ^ (value >>> 16)) >>> 0) / 0x1_0000_0000
}

function choose<T>(values: readonly T[], seed: number, salt: number): T {
  const selected = values[Math.floor(hashUnit(seed, salt) * values.length)]
  if (selected === undefined) throw new Error('dsh-bgm: empty chart style family')
  return selected
}

function chartStyle(
  lane: CueLane,
  frame: RhythmFrame,
  index: number,
  previousSignature: string,
): { style: ChartStyle; seed: number; signature: string } {
  const seed = Math.abs(Math.floor(
    frame.capturedAt + frame.bass * 997 + frame.mid * 619 + frame.treble * 389 + index * 131,
  ))
  const orders = lane === 'downbeat' ? DOWNBEAT_ORDERS : FLOW_ORDERS
  const motions = lane === 'downbeat' ? DOWNBEAT_MOTIONS : FLOW_MOTIONS
  let style: ChartStyle = {
    order: choose(orders, seed, 0),
    motion: choose(motions, seed, 1),
    attack: choose(ATTACKS, seed, 2),
  }
  let signature = `${style.order}:${style.motion}:${style.attack}`
  if (signature === previousSignature) {
    const motionIndex = (motions.indexOf(style.motion) + 1 + index) % motions.length
    style = { ...style, motion: motions[motionIndex] ?? motions[0] ?? 'jump' }
    signature = `${style.order}:${style.motion}:${style.attack}`
  }
  return { style, seed, signature }
}

interface TextRun {
  readonly node: Text
  readonly parent: HTMLElement
  readonly segments: readonly Intl.SegmentData[]
}

const SOUND_THRESHOLD = 0.025
const SILENCE_HOLD_MS = 700
const STREAM_REFRESH_INTERVAL_MS = 90
const MAX_GLYPHS_PER_SURFACE = 96
const MAX_SEGMENTS_PER_RUN = 180
const EXCLUDED_TEXT = 'script, style, textarea, input, pre, code, svg, canvas, math, .katex, [aria-hidden="true"]'
const ACTIVITY_MARKER = [
  '[data-variant="think"][data-state="running"]',
  '[data-chat-call-id]',
  '[data-chat-flow-kind="context"]',
  '[data-disclosure-row]',
  '[role="status"]',
].join(',')

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function isVisible(rect: DOMRect): boolean {
  return rect.width > 0 && rect.height > 0
    && rect.bottom >= -2 && rect.top <= window.innerHeight + 2
    && rect.right >= -2 && rect.left <= window.innerWidth + 2
}

/** Keep screen-reader-only text accessible without mirroring it visually. */
function isVisuallyPainted(parent: HTMLElement): boolean {
  const computed = getComputedStyle(parent)
  if (computed.display === 'none' || computed.visibility === 'hidden' || computed.opacity === '0') return false
  const rect = parent.getBoundingClientRect()
  const clipped = computed.clip !== 'auto' || computed.clipPath !== 'none'
  const tinyOverflowBox = rect.width <= 2 && rect.height <= 2 && computed.overflow === 'hidden'
  return !clipped && !tinyOverflowBox
}

/** Collect the one-line label and summary, bounding long scrolling runs. */
function textRuns(target: HTMLElement): readonly TextRun[] {
  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT)
  const runs: TextRun[] = []
  let current: Node | null
  while ((current = walker.nextNode()) !== null) {
    const node = current as Text
    const parent = node.parentElement
    if (parent === null || parent.closest(EXCLUDED_TEXT) !== null || !isVisuallyPainted(parent)) continue
    if (node.data.trim() === '') continue
    const allSegments = [...segmenter.segment(node.data)]
    const segments = parent.hasAttribute('data-follow-end')
      ? allSegments.slice(-MAX_SEGMENTS_PER_RUN)
      : allSegments.slice(0, MAX_SEGMENTS_PER_RUN)
    if (segments.length === 0) continue
    runs.push({ node, parent, segments })
  }
  return runs
}

interface ClipBounds {
  left: number
  right: number
  top: number
  bottom: number
}

/** Intersect every overflow clip between a text run and its disclosure row. */
function clipBounds(parent: HTMLElement, target: HTMLElement, targetRect: DOMRect): ClipBounds {
  const bounds: ClipBounds = {
    left: targetRect.left,
    right: targetRect.right,
    top: targetRect.top,
    bottom: targetRect.bottom,
  }
  let current: HTMLElement | null = parent
  while (current !== null && target.contains(current)) {
    const computed = getComputedStyle(current)
    const clipsX = computed.overflowX === 'hidden' || computed.overflowX === 'clip'
      || computed.overflowX === 'auto' || computed.overflowX === 'scroll'
    const clipsY = computed.overflowY === 'hidden' || computed.overflowY === 'clip'
      || computed.overflowY === 'auto' || computed.overflowY === 'scroll'
    if (clipsX || clipsY) {
      const rect = current.getBoundingClientRect()
      if (clipsX) {
        bounds.left = Math.max(bounds.left, rect.left)
        bounds.right = Math.min(bounds.right, rect.right)
      }
      if (clipsY) {
        bounds.top = Math.max(bounds.top, rect.top)
        bounds.bottom = Math.min(bounds.bottom, rect.bottom)
      }
    }
    if (current === target) break
    current = current.parentElement
  }
  return bounds
}

function runSignature(run: TextRun): string {
  const followsEnd = run.parent.hasAttribute('data-follow-end')
  const visibleText = followsEnd ? run.node.data.slice(-360) : run.node.data.slice(0, 360)
  return `${run.node.data.length}:${visibleText}:${Math.round(run.parent.scrollLeft)}`
}

function isTransparentColor(color: string): boolean {
  return color === 'transparent' || /^rgba\([^)]*,\s*0(?:\.0+)?\s*\)$/.test(color)
}

function glyphStyle(
  glyph: HTMLSpanElement,
  computed: CSSStyleDeclaration,
  rect: DOMRect,
  kind: SurfaceKind,
): void {
  glyph.style.left = `${rect.left}px`
  glyph.style.top = `${rect.top}px`
  glyph.style.width = `${rect.width}px`
  glyph.style.height = `${rect.height}px`
  glyph.style.color = isTransparentColor(computed.color)
    ? kind === 'deep-diving'
      ? 'var(--dsw-static-deepseek-500, #4d6bfe)'
      : 'var(--dsw-alias-label-primary, currentColor)'
    : computed.color
  glyph.style.setProperty('-webkit-text-fill-color', 'currentColor')
  glyph.style.font = computed.font
  glyph.style.fontKerning = computed.fontKerning
  glyph.style.fontFeatureSettings = computed.fontFeatureSettings
  glyph.style.fontVariationSettings = computed.fontVariationSettings
  glyph.style.letterSpacing = computed.letterSpacing
  glyph.style.lineHeight = computed.lineHeight
  glyph.style.textDecoration = computed.textDecoration
  glyph.style.textTransform = computed.textTransform
  glyph.style.writingMode = computed.writingMode
}

function hasSound(frame: RhythmFrame): boolean {
  return frame.rms > SOUND_THRESHOLD
    || frame.bass > SOUND_THRESHOLD
    || frame.mid > SOUND_THRESHOLD
    || frame.treble > SOUND_THRESHOLD
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

interface BeatSample {
  readonly kind: 'detected' | 'fallback'
  readonly confidence: number
}

/** Adaptive onset gate with a short refractory window, like a rhythm-game hit lane. */
class BeatDetector {
  private previousBass = 0
  private previousRms = 0
  private averageFlux = 0
  private fluxDeviation = 0
  private lastDetectedAtValue = 0
  private lastPulseAt = 0

  sample(frame: RhythmFrame, now: number): BeatSample | undefined {
    const bassRise = Math.max(0, frame.bass - this.previousBass)
    const rmsRise = Math.max(0, frame.rms - this.previousRms)
    this.previousBass = frame.bass
    this.previousRms = frame.rms

    const flux = frame.onset * 0.72 + bassRise * 1.35 + rmsRise * 0.55
    const delta = Math.abs(flux - this.averageFlux)
    this.averageFlux = this.averageFlux * 0.9 + flux * 0.1
    this.fluxDeviation = this.fluxDeviation * 0.88 + delta * 0.12
    const threshold = Math.max(0.075, this.averageFlux + this.fluxDeviation * 0.85)
    const sinceDetected = now - this.lastDetectedAtValue
    const detected = flux >= threshold && sinceDetected >= 180
    if (detected) {
      this.lastDetectedAtValue = now
      this.lastPulseAt = now
      const confidence = clamp(0.42 + (flux - threshold) / Math.max(0.08, threshold * 1.6), 0, 1)
      return { kind: 'detected', confidence }
    }

    if (now - this.lastPulseAt >= 680 && frame.rms > SOUND_THRESHOLD) {
      this.lastPulseAt = now
      return { kind: 'fallback', confidence: 0.2 }
    }
    return undefined
  }

  reset(): void {
    this.previousBass = 0
    this.previousRms = 0
    this.averageFlux = 0
    this.fluxDeviation = 0
    this.lastDetectedAtValue = 0
    this.lastPulseAt = 0
  }
}

/** Mid/treble change detector for the information-flow lane, independent of kick hits. */
class FlowDetector {
  private previousMid = 0
  private previousTreble = 0
  private averageFlux = 0
  private fluxDeviation = 0
  private lastDetectedAtValue = 0
  private lastPulseAt = 0
  private readonly intervals: number[] = []

  sample(frame: RhythmFrame, now: number): BeatSample | undefined {
    const midDelta = Math.abs(frame.mid - this.previousMid)
    const trebleDelta = Math.abs(frame.treble - this.previousTreble)
    this.previousMid = frame.mid
    this.previousTreble = frame.treble

    const flux = midDelta * 0.9 + trebleDelta * 1.25 + frame.onset * 0.16
    const delta = Math.abs(flux - this.averageFlux)
    this.averageFlux = this.averageFlux * 0.9 + flux * 0.1
    this.fluxDeviation = this.fluxDeviation * 0.86 + delta * 0.14
    const threshold = Math.max(0.052, this.averageFlux + this.fluxDeviation * 0.78)
    const sinceDetected = now - this.lastDetectedAtValue
    const detected = flux >= threshold && sinceDetected >= 220
    if (detected) {
      if (this.lastDetectedAtValue > 0 && sinceDetected >= 280 && sinceDetected <= 1_800) {
        this.intervals.push(sinceDetected)
        if (this.intervals.length > 8) this.intervals.shift()
      }
      this.lastDetectedAtValue = now
      this.lastPulseAt = now
      const confidence = clamp(0.4 + (flux - threshold) / Math.max(0.06, threshold * 1.5), 0, 1)
      return { kind: 'detected', confidence }
    }

    const melodicFallback = now - this.lastPulseAt >= 760
      && (frame.mid > SOUND_THRESHOLD || frame.treble > SOUND_THRESHOLD)
    if (!melodicFallback) return undefined
    this.lastPulseAt = now
    return { kind: 'fallback', confidence: 0.2 }
  }

  periodMs(): number | undefined {
    if (this.intervals.length < 2) return undefined
    const sorted = [...this.intervals].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }

  lastDetectedAt(): number | undefined {
    return this.lastDetectedAtValue > 0 ? this.lastDetectedAtValue : undefined
  }

  reset(): void {
    this.previousMid = 0
    this.previousTreble = 0
    this.averageFlux = 0
    this.fluxDeviation = 0
    this.lastDetectedAtValue = 0
    this.lastPulseAt = 0
    this.intervals.length = 0
  }
}

function latestCandidate(candidates: readonly Candidate[]): Candidate | undefined {
  return [...candidates]
    .filter(candidate => isVisible(candidate.target.getBoundingClientRect()))
    .sort((left, right) => {
      const relation = left.target.compareDocumentPosition(right.target)
      if ((relation & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) return -1
      if ((relation & Node.DOCUMENT_POSITION_PRECEDING) !== 0) return 1
      return 0
    })
    .at(-1)
}

function disclosureTarget(root: HTMLElement): HTMLElement {
  return root.querySelector<HTMLElement>('[data-disclosure-row]') ?? root
}

/** At most one current activity row plus the live turn-level Deep Diving row. */
function targetCandidates(): Candidate[] {
  const flows = [...document.querySelectorAll<HTMLElement>('[data-chat-flow]')]
    .filter(flow => isVisible(flow.getBoundingClientRect()))
  const flow = flows.at(-1)
  if (flow === undefined) return []

  const deepDiving = latestCandidate(
    [...flow.querySelectorAll<HTMLElement>('[role="status"]')]
      .filter(target => /^Deep diving/i.test(target.textContent?.trim() ?? ''))
      .map(target => ({ target, kind: 'deep-diving' as const })),
  )

  const liveRows: Candidate[] = []
  for (const root of flow.querySelectorAll<HTMLElement>('[data-variant="think"][data-state="running"]')) {
    liveRows.push({ target: disclosureTarget(root), kind: 'reasoning' })
  }
  for (const root of flow.querySelectorAll<HTMLElement>('[data-chat-call-id] [data-state="running"]')) {
    liveRows.push({ target: disclosureTarget(root), kind: 'tool' })
  }

  let latestActivity = latestCandidate(liveRows)
  if (latestActivity === undefined && deepDiving !== undefined) {
    latestActivity = latestCandidate(
      [...flow.querySelectorAll<HTMLElement>('[data-chat-flow-kind="context"]')]
        .map(root => ({ target: disclosureTarget(root), kind: 'context' as const })),
    )
  }

  const result: Candidate[] = []
  if (latestActivity !== undefined) result.push(latestActivity)
  if (deepDiving !== undefined && deepDiving.target !== latestActivity?.target) result.push(deepDiving)
  return result
}

function nodeHasActivity(node: Node): boolean {
  if (!(node instanceof Element)) return false
  return node.matches(ACTIVITY_MARKER) || node.querySelector(ACTIVITY_MARKER) !== null
}

/**
 * Paint a small pointer-transparent per-grapheme layer over only the current
 * activity row. React retains ownership of every original text node.
 */
export class BeatSurface {
  private readonly overlay = document.createElement('div')
  private readonly judgementLine = document.createElement('div')
  private readonly comboLabel = document.createElement('div')
  private readonly gradeLabel = document.createElement('div')
  private readonly scoreLabel = document.createElement('div')
  private readonly scoreDeltaLabel = document.createElement('div')
  private readonly surfaces = new Map<HTMLElement, Surface>()
  private readonly observer: MutationObserver
  private readonly beatDetector = new BeatDetector()
  private readonly flowDetector = new FlowDetector()
  private disposeStream: (() => void) | undefined
  private refreshFrame: number | undefined
  private refreshTimer: number | undefined
  private silenceTimer: number | undefined
  private lastRefreshAt = 0
  private active = false
  private downbeatIndex = 0
  private flowIndex = 0
  private lastDownbeatStyle = ''
  private lastFlowStyle = ''
  private currentDownbeatCue: WaveCue | undefined
  private currentFlowCue: WaveCue | undefined
  private predictedNote: PredictedNote | undefined
  private predictionTargetAt: number | undefined
  private combo = 0
  private score = 0
  private noteIndex = 0

  constructor() {
    this.overlay.dataset.dshBgmOverlay = ''
    this.overlay.setAttribute('aria-hidden', 'true')
    this.judgementLine.className = 'dsh-bgm-judgement-line'
    this.comboLabel.className = 'dsh-bgm-combo'
    this.gradeLabel.className = 'dsh-bgm-grade'
    this.scoreLabel.className = 'dsh-bgm-score'
    this.scoreDeltaLabel.className = 'dsh-bgm-score-delta'
    this.judgementLine.hidden = true
    this.comboLabel.hidden = true
    this.gradeLabel.hidden = true
    this.scoreLabel.hidden = true
    this.scoreDeltaLabel.hidden = true
    this.scoreLabel.textContent = 'SCORE 0000000'
    this.overlay.append(
      this.judgementLine,
      this.comboLabel,
      this.gradeLabel,
      this.scoreLabel,
      this.scoreDeltaLabel,
    )
    this.observer = new MutationObserver((records) => {
      for (const record of records) {
        if (this.overlay.contains(record.target)) continue
        const touchesSurface = [...this.surfaces.values()]
          .some(surface => surface.target.contains(record.target))
        const changesActivityTree = record.type === 'attributes'
          || (record.type === 'childList' && (
            [...record.addedNodes].some(nodeHasActivity)
            || [...record.removedNodes].some(nodeHasActivity)
          ))
        if (touchesSurface || changesActivityTree) {
          this.scheduleRefresh()
          return
        }
      }
    })
  }

  mount(): () => void {
    document.body.append(this.overlay)
    this.observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-state', 'data-chat-flow-kind'],
    })
    document.addEventListener('scroll', this.scheduleRefresh, true)
    window.addEventListener('resize', this.scheduleRefresh)
    void document.fonts.ready.then(() => { this.scheduleRefresh() })
    this.disposeStream = subscribeBgm(snapshot => { this.receive(snapshot) })
    return () => { this.dispose() }
  }

  private readonly scheduleRefresh = (): void => {
    if (!this.active || this.refreshFrame !== undefined || this.refreshTimer !== undefined) return
    const wait = Math.max(0, STREAM_REFRESH_INTERVAL_MS - (performance.now() - this.lastRefreshAt))
    if (wait > 0) {
      this.refreshTimer = window.setTimeout(() => {
        this.refreshTimer = undefined
        this.queueRefreshFrame()
      }, wait)
      return
    }
    this.queueRefreshFrame()
  }

  private queueRefreshFrame(): void {
    if (!this.active || this.refreshFrame !== undefined) return
    this.refreshFrame = requestAnimationFrame(() => {
      this.refreshFrame = undefined
      this.refresh()
    })
  }

  private receive(snapshot: BgmSnapshot): void {
    const frame = snapshot.status === 'listening' ? snapshot.frame : undefined
    if (frame === undefined) {
      this.deactivate()
      return
    }
    if (hasSound(frame)) {
      if (this.silenceTimer !== undefined) window.clearTimeout(this.silenceTimer)
      this.silenceTimer = undefined
      if (!this.active) {
        this.active = true
        document.documentElement.dataset.dshBgmActive = ''
        this.refresh()
      }
    } else if (this.active && this.silenceTimer === undefined) {
      this.silenceTimer = window.setTimeout(() => {
        this.silenceTimer = undefined
        this.deactivate()
      }, SILENCE_HOLD_MS)
    }
    if (this.active) {
      const now = performance.now()
      const downbeatSample = this.beatDetector.sample(frame, now)
      const flowSample = this.flowDetector.sample(frame, now)
      this.updatePrediction(now, flowSample)
      if (downbeatSample === undefined && flowSample === undefined) return
      if (this.refreshFrame !== undefined) cancelAnimationFrame(this.refreshFrame)
      if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer)
      this.refreshFrame = undefined
      this.refreshTimer = undefined
      this.refresh()
      if (downbeatSample !== undefined) this.startCue('downbeat', frame, now)
      if (flowSample !== undefined) this.startCue('flow', frame, now)
    }
  }

  private refresh(): void {
    if (!this.active) return
    this.lastRefreshAt = performance.now()
    const wanted = targetCandidates()
    const wantedElements = new Set(wanted.map(candidate => candidate.target))
    for (const [target, surface] of this.surfaces) {
      if (!wantedElements.has(target)) {
        this.removeSurface(surface)
        this.surfaces.delete(target)
      }
    }
    for (const candidate of wanted) this.rebuild(candidate)
    this.updateJudgementAnchor()
  }

  private judgementSurface(): Surface | undefined {
    return [...this.surfaces.values()].find(surface => surface.kind !== 'deep-diving')
  }

  private updateJudgementAnchor(): void {
    const surface = this.judgementSurface()
    if (surface === undefined) {
      this.judgementLine.hidden = true
      this.comboLabel.hidden = true
      this.gradeLabel.hidden = true
      this.scoreLabel.hidden = true
      this.scoreDeltaLabel.hidden = true
      this.predictedNote?.element.remove()
      this.predictedNote = undefined
      return
    }
    const rect = surface.target.getBoundingClientRect()
    if (!isVisible(rect)) {
      this.judgementLine.hidden = true
      this.comboLabel.hidden = true
      this.gradeLabel.hidden = true
      this.scoreLabel.hidden = true
      this.scoreDeltaLabel.hidden = true
      this.predictedNote?.element.remove()
      this.predictedNote = undefined
      return
    }
    this.judgementLine.hidden = false
    this.judgementLine.style.left = `${rect.left - 3}px`
    this.judgementLine.style.top = `${rect.top - 5}px`
    this.judgementLine.style.height = `${rect.height + 10}px`
    this.comboLabel.style.left = `${rect.left + 7}px`
    this.comboLabel.style.top = `${rect.top - 17}px`
    this.gradeLabel.style.left = `${rect.left + 7}px`
    this.gradeLabel.style.top = `${rect.bottom + 3}px`
    this.scoreLabel.hidden = false
    this.scoreLabel.style.left = `${Math.max(rect.left + 72, rect.right - 116)}px`
    this.scoreLabel.style.top = `${rect.top - 17}px`
    this.scoreDeltaLabel.style.left = `${Math.max(rect.left + 80, rect.right - 58)}px`
    this.scoreDeltaLabel.style.top = `${rect.bottom + 3}px`
    if (this.predictedNote !== undefined && this.predictedNote.anchor !== surface.target) {
      this.predictedNote.element.remove()
      this.predictedNote = undefined
    }
  }

  private updatePrediction(now: number, sample: BeatSample | undefined): void {
    const periodMs = this.flowDetector.periodMs()
    const detectedAt = this.flowDetector.lastDetectedAt()
    if (periodMs === undefined || detectedAt === undefined) return
    const hitWindow = clamp(periodMs * 0.16, 72, 155)

    if (sample?.kind === 'detected') {
      const note = this.predictedNote
      if (note !== undefined) {
        const timingError = Math.abs(now - note.targetAt)
        if (timingError <= hitWindow) this.resolveHit(sample.confidence)
        else this.resolveMiss(true)
      }
      this.predictionTargetAt = now + periodMs
      return
    }

    let targetAt = this.predictionTargetAt ?? detectedAt + periodMs
    let missFeedbackShown = false
    if (this.predictedNote !== undefined && now > this.predictedNote.targetAt + hitWindow) {
      const missedTargetAt = this.predictedNote.targetAt
      this.resolveMiss(true)
      missFeedbackShown = true
      targetAt = missedTargetAt + periodMs
    }
    while (now > targetAt + hitWindow) {
      if (!missFeedbackShown && this.combo > 0) {
        this.resolveMiss(true)
        missFeedbackShown = true
      }
      targetAt += periodMs
    }
    this.predictionTargetAt = targetAt

    const travelMs = clamp(periodMs * 0.75, 350, 900)
    if (this.predictedNote === undefined && now >= targetAt - travelMs && now < targetAt) {
      this.spawnPredictedNote(targetAt, travelMs, now)
    }
  }

  private spawnPredictedNote(targetAt: number, travelMs: number, now: number): void {
    const surface = this.judgementSurface()
    if (surface === undefined || surface.glyphs.length === 0) return
    this.updateJudgementAnchor()
    const rect = surface.target.getBoundingClientRect()
    if (!isVisible(rect)) return
    const candidates = surface.glyphs.filter(glyph => /[\p{L}\p{N}]/u.test(glyph.element.textContent ?? ''))
    const sources = candidates.length > 0 ? candidates : surface.glyphs
    const reverseIndex = this.noteIndex % sources.length
    const source = sources[sources.length - 1 - reverseIndex] ?? sources.at(-1)
    if (source === undefined) return
    this.noteIndex += 1

    const note = source.element.cloneNode(true) as HTMLSpanElement
    note.className = 'dsh-bgm-note'
    const width = Math.max(8, Number.parseFloat(source.element.style.width) || 8)
    const startX = rect.right - width
    const judgeX = rect.left - width / 2
    const judgeY = Number.parseFloat(source.element.style.top) || rect.top
    note.style.left = `${startX}px`
    note.style.top = `${judgeY}px`
    this.overlay.append(note)
    const remaining = Math.max(1, targetAt - now)
    note.animate([
      { opacity: 0.2, transform: 'translate3d(0, 0, 0) scale(.82)' },
      { opacity: 0.82, offset: 0.72 },
      { opacity: 1, transform: `translate3d(${(judgeX - startX).toFixed(2)}px, 0, 0) scale(1)` },
    ], {
      duration: Math.min(travelMs, remaining),
      easing: 'linear',
      fill: 'forwards',
    })
    this.predictedNote = { element: note, anchor: surface.target, targetAt, judgeX, judgeY }
  }

  private resolveHit(confidence: number): void {
    const note = this.predictedNote
    if (note === undefined) return
    this.predictedNote = undefined
    for (const animation of note.element.getAnimations()) animation.cancel()
    note.element.style.left = `${note.judgeX}px`
    note.element.style.top = `${note.judgeY}px`
    const scale = 1.42 + confidence * 0.48
    const feedback = note.element.animate([
      { opacity: 1, transform: 'scale(1)', color: 'currentColor' },
      { opacity: 1, transform: `scale(${scale.toFixed(2)})`, color: '#fff', offset: 0.34 },
      { opacity: 0, transform: 'scale(.92)', color: '#fff' },
    ], { duration: 360 + confidence * 160, easing: 'cubic-bezier(.16,.84,.3,1)' })
    feedback.onfinish = () => note.element.remove()

    this.combo += 1
    const grade = confidence >= 0.74 ? 'PERFECT' : confidence >= 0.5 ? 'GREAT' : 'GOOD'
    const gradeColor = confidence >= 0.74 ? '#fff' : confidence >= 0.5 ? '#8fd7ff' : '#9cf2c5'
    const basePoints = grade === 'PERFECT' ? 1_000 : grade === 'GREAT' ? 650 : 300
    const comboBonus = Math.min(500, Math.max(0, this.combo - 1) * 25)
    const gainedPoints = basePoints + comboBonus
    this.score = Math.min(9_999_999, this.score + gainedPoints)
    this.showGrade(grade, gradeColor)
    this.showScoreGain(gainedPoints, gradeColor)
    this.comboLabel.hidden = this.combo < 2
    this.comboLabel.textContent = `${this.combo} COMBO`
    const glow = 5 + confidence * 13
    this.judgementLine.animate([
      { opacity: 0.65, transform: 'scaleX(1)', boxShadow: '0 0 0 transparent' },
      { opacity: 1, transform: `scaleX(${(1.8 + confidence).toFixed(2)})`, boxShadow: `0 0 ${glow.toFixed(1)}px #fff`, background: '#fff' },
      { opacity: 0.65, transform: 'scaleX(1)', boxShadow: '0 0 0 transparent' },
    ], { duration: 300 + confidence * 160, easing: 'ease-out' })
  }

  private resolveMiss(showFeedback: boolean): void {
    const note = this.predictedNote
    this.predictedNote = undefined
    if (note !== undefined) {
      for (const animation of note.element.getAnimations()) animation.cancel()
      note.element.style.left = `${note.judgeX}px`
      note.element.style.top = `${note.judgeY}px`
      const fade = note.element.animate([
        { opacity: 0.75, transform: 'scale(1)' },
        { opacity: 0, transform: 'translateY(3px) scale(.72)', color: '#ff7a90' },
      ], { duration: 220, easing: 'ease-out' })
      fade.onfinish = () => note.element.remove()
    }
    this.combo = 0
    this.comboLabel.hidden = true
    if (showFeedback) {
      this.showGrade('MISS', '#ff7a90')
      for (const animation of this.scoreLabel.getAnimations()) animation.cancel()
      this.scoreLabel.animate([
        { transform: 'translateX(0)', color: 'currentColor' },
        { transform: 'translateX(-2px)', color: '#ff7a90', offset: 0.28 },
        { transform: 'translateX(1.5px)', color: '#ff7a90', offset: 0.58 },
        { transform: 'translateX(0)', color: 'currentColor' },
      ], { duration: 210, easing: 'ease-out' })
    }
  }

  private showScoreGain(points: number, color: string): void {
    this.scoreLabel.hidden = false
    this.scoreLabel.textContent = `SCORE ${String(this.score).padStart(7, '0')}`
    for (const animation of this.scoreLabel.getAnimations()) animation.cancel()
    this.scoreLabel.animate([
      { transform: 'scale(1)', filter: 'brightness(1)' },
      { transform: 'scale(1.075)', filter: 'brightness(1.5)', offset: 0.34 },
      { transform: 'scale(1)', filter: 'brightness(1)' },
    ], { duration: 320, easing: 'cubic-bezier(.2,.82,.3,1)' })

    for (const animation of this.scoreDeltaLabel.getAnimations()) animation.cancel()
    this.scoreDeltaLabel.hidden = false
    this.scoreDeltaLabel.textContent = `+${points}`
    this.scoreDeltaLabel.style.color = color
    const animation = this.scoreDeltaLabel.animate([
      { opacity: 0, transform: 'translateY(3px) scale(.88)' },
      { opacity: 1, transform: 'translateY(0) scale(1.08)', offset: 0.28 },
      { opacity: 0, transform: 'translateY(-5px) scale(.96)' },
    ], { duration: 680, easing: 'cubic-bezier(.18,.8,.28,1)' })
    animation.onfinish = () => { this.scoreDeltaLabel.hidden = true }
  }

  private showGrade(text: string, color: string): void {
    for (const animation of this.gradeLabel.getAnimations()) animation.cancel()
    this.gradeLabel.hidden = false
    this.gradeLabel.textContent = text
    this.gradeLabel.style.color = color
    const animation = this.gradeLabel.animate([
      { opacity: 0, transform: 'translateY(-2px) scale(.88)' },
      { opacity: 1, transform: 'translateY(0) scale(1.08)', offset: 0.32 },
      { opacity: 0, transform: 'translateY(3px) scale(.96)' },
    ], { duration: text === 'MISS' ? 520 : 620, easing: 'cubic-bezier(.2,.75,.25,1)' })
    animation.onfinish = () => { this.gradeLabel.hidden = true }
  }

  private rebuild(candidate: Candidate): void {
    const rect = candidate.target.getBoundingClientRect()
    const runs = textRuns(candidate.target)
    const signature = [
      candidate.kind,
      ...runs.map(runSignature),
      Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height),
    ].join('\u0000')
    const previous = this.surfaces.get(candidate.target)
    if (previous?.signature === signature) return
    if (previous !== undefined) this.removeSurface(previous)

    const glyphs: Glyph[] = []
    const masked = new Set<HTMLElement>()
    const range = document.createRange()
    let paintedCount = 0
    for (const run of runs) {
      const computed = getComputedStyle(run.parent)
      const clip = clipBounds(run.parent, candidate.target, rect)
      let paintedRun = false
      for (const segment of run.segments) {
        if (paintedCount >= MAX_GLYPHS_PER_SURFACE) break
        if (segment.segment.trim() === '') continue
        range.setStart(run.node, segment.index)
        range.setEnd(run.node, segment.index + segment.segment.length)
        const glyphRect = range.getBoundingClientRect()
        const centerX = glyphRect.left + glyphRect.width / 2
        const centerY = glyphRect.top + glyphRect.height / 2
        const insideClip = centerX >= clip.left && centerX <= clip.right
          && centerY >= clip.top && centerY <= clip.bottom
        if (!isVisible(glyphRect) || !insideClip) continue
        const element = document.createElement('span')
        element.className = 'dsh-bgm-glyph'
        element.textContent = segment.segment
        glyphStyle(element, computed, glyphRect, candidate.kind)
        this.overlay.append(element)
        glyphs.push({
          element,
          centerX,
          centerY,
        })
        paintedCount += 1
        paintedRun = true
      }
      if (paintedRun) masked.add(run.parent)
    }
    range.detach()
    for (const parent of masked) parent.dataset.dshBgmMasked = ''

    const surface: Surface = {
      target: candidate.target,
      kind: candidate.kind,
      glyphs,
      masked,
      signature,
    }
    this.surfaces.set(candidate.target, surface)
    candidate.target.dataset.dshBgmReactive = candidate.kind
    const cue = surface.kind === 'deep-diving' ? this.currentDownbeatCue : this.currentFlowCue
    const now = performance.now()
    if (cue !== undefined && now < cue.startedAt + cue.travelMs + cue.durationMs) {
      this.animateSurfaceWave(surface, cue, now)
    }
  }

  private startCue(lane: CueLane, frame: RhythmFrame, now: number): void {
    const current = lane === 'downbeat' ? this.currentDownbeatCue : this.currentFlowCue
    const settleRatio = lane === 'downbeat' ? 0.5 : 0.7
    if (current !== undefined
      && now < current.startedAt + current.travelMs + current.durationMs * settleRatio) return

    const index = lane === 'downbeat' ? this.downbeatIndex : this.flowIndex
    const previous = lane === 'downbeat' ? this.lastDownbeatStyle : this.lastFlowStyle
    const chart = chartStyle(lane, frame, index, previous)
    const energy = lane === 'downbeat'
      ? Math.min(1, frame.bass * 0.72 + frame.onset * 0.42 + frame.rms * 0.18)
      : Math.min(1, frame.mid * 0.55 + frame.treble * 0.65 + frame.onset * 0.18)
    const cue: WaveCue = lane === 'downbeat'
      ? {
          lane,
          style: chart.style,
          seed: chart.seed,
          energy,
          startedAt: now,
          travelMs: 90 + energy * 150,
          durationMs: 390 + energy * 140,
        }
      : {
          lane,
          style: chart.style,
          seed: chart.seed,
          energy,
          startedAt: now,
          travelMs: 620 + energy * 300,
          durationMs: 600 + energy * 180,
        }

    if (lane === 'downbeat') {
      this.downbeatIndex += 1
      this.lastDownbeatStyle = chart.signature
      this.currentDownbeatCue = cue
    } else {
      this.flowIndex += 1
      this.lastFlowStyle = chart.signature
      this.currentFlowCue = cue
    }
    for (const surface of this.surfaces.values()) {
      const surfaceLane: CueLane = surface.kind === 'deep-diving' ? 'downbeat' : 'flow'
      if (surfaceLane === lane) this.animateSurfaceWave(surface, cue, now)
    }
  }

  private animateSurfaceWave(surface: Surface, cue: WaveCue, now: number): void {
    const { glyphs } = surface
    if (glyphs.length === 0) return
    const { style, energy, travelMs, durationMs } = cue
    const elapsed = Math.max(0, now - cue.startedAt)
    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    let minY = Number.POSITIVE_INFINITY
    let maxY = Number.NEGATIVE_INFINITY
    for (const glyph of glyphs) {
      minX = Math.min(minX, glyph.centerX)
      maxX = Math.max(maxX, glyph.centerX)
      minY = Math.min(minY, glyph.centerY)
      maxY = Math.max(maxY, glyph.centerY)
    }
    const centerX = (minX + maxX) / 2
    const centerY = (minY + maxY) / 2
    const maxDistance = Math.max(1, Math.hypot(maxX - minX, maxY - minY) / 2)
    const xSpan = Math.max(1, maxX - minX)
    const lift = cue.lane === 'downbeat' ? 4 + energy * 5 : 5 + energy * 5

    for (let index = 0; index < glyphs.length; index += 1) {
      const glyph = glyphs[index]
      if (glyph === undefined) continue
      const distance = Math.min(1, Math.hypot(glyph.centerX - centerX, glyph.centerY - centerY) / maxDistance)
      const horizontal = (glyph.centerX - minX) / xSpan
      const signedCenter = horizontal * 2 - 1
      let progress: number
      switch (style.order) {
        case 'together': progress = 0; break
        case 'right-left': progress = 1 - horizontal; break
        case 'center-out': progress = distance; break
        case 'edges-in': progress = 1 - distance; break
        case 'even-odd': progress = (index % 2) * 0.58 + horizontal * 0.42; break
        case 'odd-even': progress = ((index + 1) % 2) * 0.58 + horizontal * 0.42; break
        case 'shuffle': progress = hashUnit(cue.seed, index + 17); break
        case 'left-right': progress = horizontal; break
      }

      let peakX = 0
      let peakY = -lift
      let peakScale = 1.07 + energy * 0.055
      switch (style.motion) {
        case 'punch':
          peakY = -lift * 0.35
          peakScale = 1.14 + energy * 0.08
          break
        case 'jump':
          peakY = -lift
          break
        case 'drop':
          peakY = lift * 0.78
          break
        case 'split':
          peakX = Math.sign(signedCenter) * (3.5 + energy * 2.5)
          peakY = -lift * 0.55
          break
        case 'converge':
          peakX = -Math.sign(signedCenter) * (3.5 + energy * 2.5)
          peakY = -lift * 0.5
          break
        case 'zigzag':
          peakY = index % 2 === 0 ? -lift : lift * 0.7
          break
        case 'snake':
          peakY = Math.sin(horizontal * Math.PI * 2.5) * lift * 0.9
          peakX = Math.cos(horizontal * Math.PI * 2) * 1.8
          break
        case 'stair-up':
          peakY = -lift * (0.35 + horizontal * 0.65)
          peakX = 1.4
          break
        case 'stair-down':
          peakY = lift * (0.25 + horizontal * 0.55)
          peakX = -1.2
          break
        case 'fan':
          peakX = signedCenter * (3 + energy * 3)
          peakY = -lift * (1 - Math.abs(signedCenter) * 0.35)
          break
        case 'orbit': {
          const angle = horizontal * Math.PI * 2 + hashUnit(cue.seed, 91) * Math.PI
          peakX = Math.cos(angle) * (2.5 + energy * 2)
          peakY = Math.sin(angle) * lift * 0.78
          break
        }
      }
      for (const animation of glyph.element.getAnimations()) animation.cancel()
      const localTime = elapsed - progress * travelMs
      if (localTime >= durationMs) continue
      const rest = 'translate3d(0, 0, 0) scale(1)'
      const press = `translate3d(${(-peakX * 0.18).toFixed(2)}px, ${(peakY > 0 ? -1.1 : 1.4).toFixed(2)}px, 0) scaleX(1.045) scaleY(.9)`
      const peak = `translate3d(${peakX.toFixed(2)}px, ${peakY.toFixed(2)}px, 0) scale(${peakScale.toFixed(3)})`
      const rebound = `translate3d(${(-peakX * 0.16).toFixed(2)}px, ${(-peakY * 0.14).toFixed(2)}px, 0) scaleX(1.025) scaleY(.965)`
      const halfPeak = `translate3d(${(peakX * 0.38).toFixed(2)}px, ${(peakY * 0.38).toFixed(2)}px, 0) scale(${(1 + (peakScale - 1) * 0.42).toFixed(3)})`
      const frames: Keyframe[] = style.attack === 'bounce'
        ? [
            { transform: rest },
            { transform: press, offset: 0.12 },
            { transform: peak, offset: 0.34 },
            { transform: rebound, offset: 0.62 },
            { transform: halfPeak, offset: 0.8 },
            { transform: rest },
          ]
        : style.attack === 'hold'
          ? [
              { transform: rest },
              { transform: press, offset: 0.14 },
              { transform: peak, offset: 0.34 },
              { transform: peak, offset: 0.6 },
              { transform: rebound, offset: 0.82 },
              { transform: rest },
            ]
          : [
              { transform: rest },
              { transform: press, offset: 0.16 },
              { transform: peak, offset: 0.4 },
              { transform: rebound, offset: 0.7 },
              { transform: rest },
            ]
      glyph.element.animate(frames, {
        duration: durationMs,
        delay: progress * travelMs - elapsed,
        easing: 'cubic-bezier(.18,.82,.28,1)',
      })
    }
  }

  private removeSurface(surface: Surface): void {
    for (const glyph of surface.glyphs) glyph.element.remove()
    for (const parent of surface.masked) delete parent.dataset.dshBgmMasked
    for (const parent of surface.target.querySelectorAll<HTMLElement>('[data-dsh-bgm-masked]')) {
      delete parent.dataset.dshBgmMasked
    }
    delete surface.target.dataset.dshBgmReactive
  }

  private deactivate(): void {
    if (!this.active && this.surfaces.size === 0) return
    this.active = false
    delete document.documentElement.dataset.dshBgmActive
    this.beatDetector.reset()
    this.flowDetector.reset()
    this.downbeatIndex = 0
    this.flowIndex = 0
    this.lastDownbeatStyle = ''
    this.lastFlowStyle = ''
    this.currentDownbeatCue = undefined
    this.currentFlowCue = undefined
    this.predictedNote?.element.remove()
    this.predictedNote = undefined
    this.predictionTargetAt = undefined
    this.combo = 0
    this.score = 0
    this.noteIndex = 0
    this.judgementLine.hidden = true
    this.comboLabel.hidden = true
    this.gradeLabel.hidden = true
    this.scoreLabel.hidden = true
    this.scoreLabel.textContent = 'SCORE 0000000'
    this.scoreDeltaLabel.hidden = true
    for (const surface of this.surfaces.values()) this.removeSurface(surface)
    this.surfaces.clear()
  }

  private dispose(): void {
    this.disposeStream?.()
    this.disposeStream = undefined
    this.observer.disconnect()
    document.removeEventListener('scroll', this.scheduleRefresh, true)
    window.removeEventListener('resize', this.scheduleRefresh)
    if (this.refreshFrame !== undefined) cancelAnimationFrame(this.refreshFrame)
    if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer)
    if (this.silenceTimer !== undefined) window.clearTimeout(this.silenceTimer)
    this.refreshFrame = undefined
    this.refreshTimer = undefined
    this.silenceTimer = undefined
    this.deactivate()
    this.overlay.remove()
  }
}
