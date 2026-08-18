import type { BgmSnapshot, RhythmFrame } from '../core/types.ts'
import { subscribeBgm } from './stream.ts'

type SurfaceKind = 'reasoning' | 'tool' | 'context' | 'deep-diving'
type CueLane = 'downbeat' | 'flow'
type HitStrength = 'weak' | 'medium' | 'strong'
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
  readonly glyphCount: number
  readonly streaming: boolean
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
  readonly confidence: number
  readonly strength: HitStrength
  readonly sampleKind: BeatSample['kind']
  readonly comboBoost: boolean
  readonly goldAccent: boolean
  readonly periodMs: number | undefined
  readonly startedAt: number
  readonly travelMs: number
  readonly durationMs: number
  flowTracerShown: boolean
}

interface PredictedNote {
  readonly element: HTMLSpanElement
  readonly anchor: HTMLElement
  readonly targetAt: number
  readonly judgeX: number
  readonly judgeY: number
  readonly landingLeft: number
  readonly landingTop: number
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

/** Detector confidence owns the strength tier; chart order never downgrades it. */
function cueStrength(confidence: number): HitStrength {
  return confidence > 0.7 ? 'strong' : confidence > 0.46 ? 'medium' : 'weak'
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
const QUICK_ACTIVITY_HOLD_MS = 1_600
const DETECTION_LATENCY_COMPENSATION_MS = 30
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
const LIVE_ACTIVITY_SELECTOR = [
  '[data-variant="think"][data-state="running"]',
  '[data-chat-call-id][data-state="running"]',
  '[data-chat-call-id] [data-state="running"]',
].join(',')
const FINAL_STREAM_SELECTOR = '[data-chat-flow-kind="assistant-step"] [data-streaming]'

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

function latestFlow(): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('[data-chat-flow]')]
    .filter(flow => isVisible(flow.getBoundingClientRect()))
    .at(-1)
}

function isFinalAnswerStreaming(): boolean {
  const flows = document.querySelectorAll<HTMLElement>('[data-chat-flow]')
  const flow = flows.item(flows.length - 1) ?? undefined
  return flow !== undefined
    && flow.querySelector(FINAL_STREAM_SELECTOR) !== null
    && flow.querySelector(LIVE_ACTIVITY_SELECTOR) === null
}

function disclosureTarget(root: HTMLElement): HTMLElement {
  return root.querySelector<HTMLElement>('[data-disclosure-row]')
    ?? root.closest<HTMLElement>('[data-disclosure-row]')
    ?? root
}

/** At most one current activity row plus the live turn-level Deep Diving row. */
function targetCandidates(): Candidate[] {
  const flow = latestFlow()
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
  const toolRoots = [...flow.querySelectorAll<HTMLElement>('[data-chat-call-id]')]
  for (const root of toolRoots) {
    const running = root.matches('[data-state="running"]')
      || root.querySelector('[data-state="running"]') !== null
    if (running) liveRows.push({ target: disclosureTarget(root), kind: 'tool' })
  }

  let latestActivity = latestCandidate(liveRows)
  if (latestActivity === undefined && deepDiving !== undefined) {
    latestActivity = latestCandidate(
      [
        ...toolRoots.map(root => ({ target: disclosureTarget(root), kind: 'tool' as const })),
        ...[...flow.querySelectorAll<HTMLElement>('[data-chat-flow-kind="context"]')]
          .map(root => ({ target: disclosureTarget(root), kind: 'context' as const })),
      ],
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

function nodeHasFinalStreamMarker(node: Node): boolean {
  if (!(node instanceof Element)) return false
  const selector = '[data-streaming], [data-chat-flow-kind="assistant-step"]'
  return node.matches(selector) || node.querySelector(selector) !== null
}

/** Running activity text remains React-owned and visually untouched while it streams. */
function isStreamingActivity(target: HTMLElement, kind: SurfaceKind): boolean {
  if (kind === 'deep-diving') return false
  const owner = target.closest<HTMLElement>(
    '[data-variant], [data-chat-call-id], [data-chat-flow-kind="context"]',
  ) ?? target
  const marker = '[data-state="running"], [data-streaming]'
  return owner.matches(marker) || owner.querySelector(marker) !== null
}

/**
 * Stable rows get a pointer-transparent per-grapheme layer. Streaming rows
 * remain entirely React-painted and keep only a lightweight rhythm anchor.
 */
export class BeatSurface {
  private readonly overlay = document.createElement('div')
  private readonly judgementLine = document.createElement('div')
  private readonly comboLabel = document.createElement('div')
  private readonly scoreLabel = document.createElement('div')
  private readonly scoreDeltaLabel = document.createElement('div')
  private readonly accuracyLabel = document.createElement('div')
  private readonly surfaces = new Map<HTMLElement, Surface>()
  private readonly observer: MutationObserver
  private readonly beatDetector = new BeatDetector()
  private readonly flowDetector = new FlowDetector()
  private disposeStream: (() => void) | undefined
  private refreshFrame: number | undefined
  private refreshTimer: number | undefined
  private silenceTimer: number | undefined
  private lastFrame: RhythmFrame | undefined
  private retainedActivity: Candidate | undefined
  private retainActivityUntil = 0
  private currentActivityTarget: HTMLElement | undefined
  private finalOutputStreaming = false
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
  private judgedCount = 0
  private accuracyPoints = 0
  private noteIndex = 0
  private judgementIndex = 0
  private lastJudgementStrikeAt = 0
  private lastHitstopAt = 0
  private hitstopTimer: number | undefined
  private hitstopAnimations: Animation[] = []

  constructor() {
    this.overlay.dataset.dshBgmOverlay = ''
    this.overlay.setAttribute('aria-hidden', 'true')
    this.judgementLine.className = 'dsh-bgm-judgement-line'
    this.comboLabel.className = 'dsh-bgm-combo'
    this.scoreLabel.className = 'dsh-bgm-score'
    this.scoreDeltaLabel.className = 'dsh-bgm-score-delta'
    this.accuracyLabel.className = 'dsh-bgm-accuracy'
    this.judgementLine.hidden = true
    this.comboLabel.hidden = true
    this.scoreLabel.hidden = true
    this.scoreDeltaLabel.hidden = true
    this.accuracyLabel.hidden = true
    this.scoreLabel.textContent = 'SCORE 0000000'
    this.accuracyLabel.textContent = 'ACC 100.00%'
    this.overlay.append(
      this.judgementLine,
      this.comboLabel,
      this.scoreLabel,
      this.scoreDeltaLabel,
      this.accuracyLabel,
    )
    this.observer = new MutationObserver((records) => {
      const finalStateMayChange = records.some(record => record.type === 'attributes'
        || (record.type === 'childList' && (
          [...record.addedNodes].some(nodeHasFinalStreamMarker)
          || [...record.removedNodes].some(nodeHasFinalStreamMarker)
        )))
      if (this.finalOutputStreaming && !finalStateMayChange) return
      if (finalStateMayChange) {
        const finalStreaming = isFinalAnswerStreaming()
        if (finalStreaming) {
          if (!this.finalOutputStreaming) {
            this.finalOutputStreaming = true
            this.suspendVisualsForFinal()
          }
          return
        }
        this.finalOutputStreaming = false
      }
      for (const record of records) {
        if (this.overlay.contains(record.target)) continue
        const remembersQuickActivity = this.rememberQuickActivity(record.target)
          || (record.type === 'childList'
            && [...record.addedNodes].some(node => this.rememberQuickActivity(node, true)))
        const touchesSurface = [...this.surfaces.values()]
          .some(surface => surface.target.contains(record.target))
        const changesActivityTree = record.type === 'attributes'
          || (record.type === 'childList' && (
            [...record.addedNodes].some(nodeHasActivity)
            || [...record.removedNodes].some(nodeHasActivity)
          ))
        if (remembersQuickActivity || touchesSurface || changesActivityTree) {
          this.scheduleRefresh()
          return
        }
      }
    })
  }

  private suspendVisualsForFinal(): void {
    if (this.refreshFrame !== undefined) cancelAnimationFrame(this.refreshFrame)
    if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer)
    this.refreshFrame = undefined
    this.refreshTimer = undefined
    this.predictedNote?.element.remove()
    this.predictedNote = undefined
    this.predictionTargetAt = undefined
    this.retainedActivity = undefined
    this.retainActivityUntil = 0
    this.currentActivityTarget = undefined
    this.currentDownbeatCue = undefined
    this.currentFlowCue = undefined
    this.combo = 0
    this.score = 0
    this.judgedCount = 0
    this.accuracyPoints = 0
    this.noteIndex = 0
    this.judgementIndex = 0
    this.lastJudgementStrikeAt = 0
    this.clearHitstop()
    for (const animation of this.judgementLine.getAnimations()) animation.cancel()
    this.judgementLine.hidden = true
    this.comboLabel.hidden = true
    this.scoreLabel.hidden = true
    this.scoreLabel.textContent = 'SCORE 0000000'
    this.scoreDeltaLabel.hidden = true
    this.accuracyLabel.hidden = true
    this.accuracyLabel.textContent = 'ACC 100.00%'
    for (const grade of this.overlay.querySelectorAll('.dsh-bgm-grade-float')) grade.remove()
    for (const ring of this.overlay.querySelectorAll('.dsh-bgm-hit-ring')) ring.remove()
    for (const particle of this.overlay.querySelectorAll('.dsh-bgm-hit-particle')) particle.remove()
    for (const key of this.overlay.querySelectorAll('.dsh-bgm-hit-key')) key.remove()
    for (const streak of this.overlay.querySelectorAll('.dsh-bgm-gold-streak')) streak.remove()
    for (const ripple of this.overlay.querySelectorAll('.dsh-bgm-flow-ripple')) ripple.remove()
    for (const surface of this.surfaces.values()) this.removeSurface(surface)
    this.surfaces.clear()
  }

  private rememberQuickActivity(node: Node, includeDescendant = false): boolean {
    if (!this.active) return false
    const element = node instanceof Element ? node : node.parentElement
    if (element === null) return false
    const root = element.matches('[data-chat-call-id]')
      ? element
      : element.closest('[data-chat-call-id]')
        ?? (includeDescendant ? element.querySelector('[data-chat-call-id]') : null)
    if (!(root instanceof HTMLElement)) return false
    this.retainedActivity = { target: disclosureTarget(root), kind: 'tool' }
    this.retainActivityUntil = performance.now() + QUICK_ACTIVITY_HOLD_MS
    return true
  }

  mount(): () => void {
    document.body.append(this.overlay)
    this.observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-state', 'data-chat-flow-kind', 'data-streaming'],
    })
    document.addEventListener('scroll', this.scheduleRefresh, true)
    window.addEventListener('resize', this.scheduleRefresh)
    void document.fonts.ready.then(() => { this.scheduleRefresh() })
    this.disposeStream = subscribeBgm(snapshot => { this.receive(snapshot) })
    return () => { this.dispose() }
  }

  private readonly scheduleRefresh = (): void => {
    if (!this.active || this.finalOutputStreaming
      || this.refreshFrame !== undefined || this.refreshTimer !== undefined) return
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
    this.lastFrame = frame
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
      if (this.finalOutputStreaming) return
      this.updatePrediction(now, flowSample)
      if (downbeatSample === undefined && flowSample === undefined) return
      if (this.refreshFrame !== undefined) cancelAnimationFrame(this.refreshFrame)
      if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer)
      this.refreshFrame = undefined
      this.refreshTimer = undefined
      this.refresh()
      if (downbeatSample !== undefined) {
        this.startCue('downbeat', frame, now, false, downbeatSample.confidence, downbeatSample.kind)
      }
      if (flowSample !== undefined) {
        this.startCue('flow', frame, now, false, flowSample.confidence, flowSample.kind)
      }
    }
  }

  private refresh(): void {
    if (!this.active || this.finalOutputStreaming) return
    if (isFinalAnswerStreaming()) {
      this.finalOutputStreaming = true
      this.suspendVisualsForFinal()
      return
    }
    const now = performance.now()
    this.lastRefreshAt = now
    const liveWanted = targetCandidates()
    const liveActivity = liveWanted.find(candidate => candidate.kind !== 'deep-diving')
    if (liveActivity !== undefined) {
      this.retainedActivity = liveActivity
      this.retainActivityUntil = now + QUICK_ACTIVITY_HOLD_MS
    }
    const retainedActivity = liveActivity === undefined
      && this.retainedActivity !== undefined
      && now < this.retainActivityUntil
      && this.retainedActivity.target.isConnected
      && isVisible(this.retainedActivity.target.getBoundingClientRect())
      ? this.retainedActivity
      : undefined
    if (liveActivity === undefined && retainedActivity === undefined) this.retainedActivity = undefined
    const wanted = retainedActivity === undefined
      ? liveWanted
      : [retainedActivity, ...liveWanted]
    const wantedElements = new Set(wanted.map(candidate => candidate.target))
    for (const [target, surface] of this.surfaces) {
      if (!wantedElements.has(target)) {
        this.removeSurface(surface)
        this.surfaces.delete(target)
      }
    }
    for (const candidate of wanted) this.rebuild(candidate)
    this.updateJudgementAnchor()
    const activityTarget = this.judgementSurface()?.target
    if (activityTarget !== this.currentActivityTarget) {
      this.currentActivityTarget = activityTarget
      if (activityTarget !== undefined && this.lastFrame !== undefined) {
        this.startCue('flow', this.lastFrame, now, true)
      }
    }
  }

  private judgementSurface(): Surface | undefined {
    return [...this.surfaces.values()].find(surface => surface.kind !== 'deep-diving')
  }

  private updateJudgementAnchor(): void {
    const surface = this.judgementSurface()
    if (surface === undefined) {
      this.judgementLine.hidden = true
      this.comboLabel.hidden = true
      this.scoreLabel.hidden = true
      this.scoreDeltaLabel.hidden = true
      this.accuracyLabel.hidden = true
      this.predictedNote?.element.remove()
      this.predictedNote = undefined
      return
    }
    const rect = surface.target.getBoundingClientRect()
    if (!isVisible(rect)) {
      this.judgementLine.hidden = true
      this.comboLabel.hidden = true
      this.scoreLabel.hidden = true
      this.scoreDeltaLabel.hidden = true
      this.accuracyLabel.hidden = true
      this.predictedNote?.element.remove()
      this.predictedNote = undefined
      return
    }
    if (this.flowDetector.periodMs() === undefined) {
      this.judgementLine.hidden = true
      this.comboLabel.hidden = true
      this.scoreLabel.hidden = true
      this.scoreDeltaLabel.hidden = true
      this.accuracyLabel.hidden = true
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
    this.scoreLabel.hidden = false
    const scoreWidth = Math.min(110, rect.width)
    const accuracyWidth = Math.min(80, rect.width)
    const scoreLeft = rect.right - scoreWidth
    const comboReservedRight = rect.left + 78
    const scoreSharesComboRow = scoreLeft >= comboReservedRight + 8
    const inlineAccuracyLeft = scoreLeft - accuracyWidth - 6
    const accuracySharesComboRow = scoreSharesComboRow
      && inlineAccuracyLeft >= comboReservedRight + 8
    const scoreTop = scoreSharesComboRow ? rect.top - 17 : rect.top - 30
    this.scoreLabel.style.width = `${scoreWidth}px`
    this.scoreLabel.style.left = `${scoreLeft}px`
    this.scoreLabel.style.top = `${scoreTop}px`
    this.accuracyLabel.hidden = false
    this.accuracyLabel.style.width = `${accuracyWidth}px`
    this.accuracyLabel.style.left = `${accuracySharesComboRow ? inlineAccuracyLeft : rect.right - accuracyWidth}px`
    this.accuracyLabel.style.top = `${accuracySharesComboRow ? rect.top - 17 : scoreTop - 13}px`
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
    const hitWindow = clamp(periodMs * 0.22, 120, 220)
    const judgementNow = now + DETECTION_LATENCY_COMPENSATION_MS

    if (sample?.kind === 'detected') {
      const note = this.predictedNote
      if (note !== undefined) {
        const timingError = Math.abs(judgementNow - note.targetAt)
        if (timingError <= hitWindow) this.resolveHit(sample.confidence)
        else {
          note.element.remove()
          this.predictedNote = undefined
        }
      }
      this.predictionTargetAt = now + periodMs
      return
    }

    if (sample?.kind === 'fallback') {
      const note = this.predictedNote
      if (note !== undefined && Math.abs(judgementNow - note.targetAt) <= hitWindow * 1.3) {
        this.resolveHit(0.4)
        this.predictionTargetAt = note.targetAt + periodMs
        return
      }
    }

    let targetAt = this.predictionTargetAt ?? detectedAt + periodMs
    let missFeedbackShown = false
    if (this.predictedNote !== undefined && judgementNow > this.predictedNote.targetAt + hitWindow) {
      const missedTargetAt = this.predictedNote.targetAt
      this.resolveMiss(true)
      missFeedbackShown = true
      targetAt = missedTargetAt + periodMs
    }
    while (judgementNow > targetAt + hitWindow) {
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
    if (surface === undefined) return
    this.updateJudgementAnchor()
    const rect = surface.target.getBoundingClientRect()
    if (!isVisible(rect)) return
    const candidates = surface.glyphs.filter(glyph => /[\p{L}\p{N}]/u.test(glyph.element.textContent ?? ''))
    const sources = candidates.length > 0 ? candidates : surface.glyphs
    const reverseIndex = sources.length > 0 ? this.noteIndex % sources.length : 0
    const source = sources[sources.length - 1 - reverseIndex] ?? sources.at(-1)
    this.noteIndex += 1

    const note = (source?.element.cloneNode(true) as HTMLSpanElement | undefined)
      ?? document.createElement('span')
    note.className = 'dsh-bgm-note'
    const computed = source === undefined ? getComputedStyle(surface.target) : undefined
    if (source === undefined) {
      note.textContent = '♪'
      note.style.display = 'block'
      note.style.fontFamily = computed?.fontFamily ?? 'system-ui, sans-serif'
      note.style.fontWeight = '700'
    }
    const fallbackFontSize = Math.max(12, Number.parseFloat(computed?.fontSize ?? '') || 14)
    const width = source === undefined
      ? fallbackFontSize
      : Math.max(8, Number.parseFloat(source.element.style.width) || 8)
    const height = source === undefined
      ? Math.min(Math.max(14, fallbackFontSize * 1.2), Math.max(14, rect.height))
      : Math.max(8, Number.parseFloat(source.element.style.height) || 8)
    if (source === undefined) {
      note.style.width = `${width}px`
      note.style.height = `${height}px`
      note.style.fontSize = `${fallbackFontSize}px`
      note.style.lineHeight = `${height}px`
      note.style.textAlign = 'center'
    }
    const startX = rect.right - width
    const landingTop = source === undefined
      ? rect.top + (rect.height - height) / 2
      : Number.parseFloat(source.element.style.top) || rect.top
    const judgeX = rect.left
    const judgeY = landingTop + height / 2
    const landingLeft = judgeX - width / 2
    note.style.left = `${startX}px`
    note.style.top = `${landingTop}px`
    note.style.color = this.combo >= 10 ? '#ffd76a' : '#8fd7ff'
    this.overlay.append(note)
    const remaining = Math.max(1, targetAt - now)
    note.animate([
      {
        opacity: 0.16,
        filter: 'brightness(.78) saturate(.88)',
        transform: 'translate3d(0, 0, 0) scale(.72)',
      },
      { opacity: 0.72, offset: 0.68 },
      {
        opacity: 1,
        filter: 'brightness(1.72) saturate(1.18)',
        transform: `translate3d(${(landingLeft - startX).toFixed(2)}px, 0, 0) scale(1.1)`,
      },
    ], {
      duration: Math.min(travelMs, remaining),
      easing: 'cubic-bezier(.64,.03,.9,.4)',
      fill: 'forwards',
    })
    this.predictedNote = {
      element: note,
      anchor: surface.target,
      targetAt,
      judgeX,
      judgeY,
      landingLeft,
      landingTop,
    }
  }

  private resolveHit(confidence: number): void {
    const note = this.predictedNote
    if (note === undefined) return
    this.predictedNote = undefined
    for (const animation of note.element.getAnimations()) animation.cancel()
    note.element.classList.add('dsh-bgm-note--impact')
    note.element.style.left = `${note.landingLeft}px`
    note.element.style.top = `${note.landingTop}px`
    const impactColor = confidence >= 0.74 ? '#ffd76a' : confidence >= 0.5 ? '#8fd7ff' : '#9cf2c5'
    const scale = 1.42 + confidence * 0.48
    const feedback = note.element.animate([
      { opacity: 1, transform: 'scale(1)', color: 'currentColor' },
      { opacity: 1, transform: 'scale(1.05, .86)', color: impactColor, offset: 0.1 },
      {
        opacity: 1,
        transform: `scale(${scale.toFixed(2)}, 1.14)`,
        color: impactColor,
        offset: 0.3,
      },
      { opacity: 1, transform: 'scale(.94)', color: impactColor, offset: 0.58 },
      { opacity: 0, transform: 'scale(.9)', color: impactColor },
    ], { duration: 150 + confidence * 40, easing: 'cubic-bezier(.14,.8,.24,1)' })
    feedback.onfinish = () => note.element.remove()

    this.combo += 1
    const grade = confidence >= 0.74 ? 'PERFECT' : confidence >= 0.5 ? 'GREAT' : 'GOOD'
    const gradeColor = impactColor
    const basePoints = grade === 'PERFECT' ? 1_000 : grade === 'GREAT' ? 650 : 300
    const comboBonus = Math.min(500, Math.max(0, this.combo - 1) * 25)
    const gainedPoints = basePoints + comboBonus
    this.score = Math.min(9_999_999, this.score + gainedPoints)
    this.recordAccuracy(grade === 'PERFECT' ? 1 : grade === 'GREAT' ? 0.82 : 0.55)
    this.showGrade(grade, gradeColor, note.judgeX, note.judgeY + 2)
    this.showHitRing(note.judgeX, note.judgeY + 2, confidence)
    this.showHitParticles(note.judgeX, note.judgeY + 2, confidence)
    const surfaceRect = this.judgementSurface()?.target.getBoundingClientRect()
    this.showKeyStrike(note.judgeX, note.judgeY, surfaceRect?.height ?? 28, confidence)
    if (this.combo >= 25) this.showGoldStreak(note.judgeX, note.judgeY)
    this.showScoreGain(gainedPoints, gradeColor)
    this.comboLabel.hidden = this.combo < 2
    this.comboLabel.textContent = `${this.combo} COMBO`
    this.comboLabel.style.color = this.combo >= 10 ? '#ffd76a' : ''
    const milestoneText = this.combo === 5
      ? 'FEVER ×5'
      : this.combo === 10
        ? 'GOLD MODE!'
        : this.combo === 25
          ? 'GOLD TRAIL!'
          : this.combo === 50 ? 'FULL COMBO!' : undefined
    if (milestoneText !== undefined) {
      this.showGrade(milestoneText, '#ffd76a', note.judgeX, note.judgeY - 18)
    }
    this.strikeJudgementLine(confidence)
    this.triggerHitstop()
  }

  /** Freeze only the plugin-owned rhythm layer for one short impact frame. */
  private triggerHitstop(): void {
    const now = performance.now()
    if (this.lastHitstopAt > 0 && now - this.lastHitstopAt <= 160) return
    this.lastHitstopAt = now
    document.documentElement.dataset.dshBgmHitstop = ''
    this.hitstopAnimations = this.overlay.getAnimations({ subtree: true })
      .filter(animation => animation.playState === 'running')
    for (const animation of this.hitstopAnimations) animation.pause()
    this.hitstopTimer = window.setTimeout(() => { this.clearHitstop(false) }, 45)
  }

  private clearHitstop(resetCooldown = true): void {
    if (this.hitstopTimer !== undefined) window.clearTimeout(this.hitstopTimer)
    this.hitstopTimer = undefined
    delete document.documentElement.dataset.dshBgmHitstop
    for (const animation of this.hitstopAnimations) {
      if (animation.playState === 'paused') animation.play()
    }
    this.hitstopAnimations = []
    if (resetCooldown) this.lastHitstopAt = 0
  }

  private strikeJudgementLine(confidence: number): void {
    if (this.judgementLine.hidden) return
    const now = performance.now()
    if (now - this.lastJudgementStrikeAt < 40) return
    this.lastJudgementStrikeAt = now
    const comboGlow = this.combo >= 5 ? 1.9 : 1
    const glow = (7 + confidence * 13) * comboGlow
    const flashColor = this.combo >= 10 || confidence >= 0.74
      ? '#ffd76a'
      : confidence >= 0.5 ? '#8fd7ff' : '#9cf2c5'
    for (const animation of this.judgementLine.getAnimations()) animation.cancel()
    this.judgementLine.animate([
      { opacity: 0.65, transform: 'scaleX(1) scaleY(1)', boxShadow: '0 0 0 transparent' },
      {
        opacity: 1,
        transform: `scaleX(${(2.1 + confidence * 0.5).toFixed(2)}) scaleY(1.3)`,
        boxShadow: `0 0 ${glow.toFixed(1)}px ${flashColor}`,
        background: flashColor,
        offset: 0.06,
      },
      { opacity: 0.82, transform: 'scaleX(.94) scaleY(.96)', boxShadow: `0 0 ${(glow * 0.4).toFixed(1)}px ${flashColor}`, offset: 0.38 },
      { opacity: 0.72, transform: 'scaleX(1.1) scaleY(1.04)', boxShadow: '0 0 3px currentColor', offset: 0.68 },
      { opacity: 0.65, transform: 'scaleX(1) scaleY(1)', boxShadow: '0 0 0 transparent' },
    ], { duration: 140, easing: 'cubic-bezier(.12,.78,.22,1)' })
  }

  private resolveMiss(showFeedback: boolean): void {
    const note = this.predictedNote
    const fallbackPoint = note === undefined ? this.judgementPoint() : undefined
    this.predictedNote = undefined
    if (note !== undefined) {
      for (const animation of note.element.getAnimations()) animation.cancel()
      note.element.classList.add('dsh-bgm-note--impact')
      note.element.style.left = `${note.landingLeft}px`
      note.element.style.top = `${note.landingTop}px`
      const fade = note.element.animate([
        { opacity: 0.75, transform: 'scale(1)' },
        { opacity: 0, transform: 'translateY(3px) scale(.72)', color: '#ff7a90' },
      ], { duration: 220, easing: 'ease-out' })
      fade.onfinish = () => note.element.remove()
    }
    this.combo = 0
    this.comboLabel.hidden = true
    this.comboLabel.style.color = ''
    this.clearComboAccents()
    if (showFeedback) {
      this.recordAccuracy(0)
      this.flashMissLine()
      const x = note?.judgeX ?? fallbackPoint?.x
      const y = note?.judgeY ?? fallbackPoint?.y
      if (x !== undefined && y !== undefined) this.showGrade('MISS', '#ff7a90', x, y)
      for (const animation of this.scoreLabel.getAnimations()) animation.cancel()
      this.scoreLabel.animate([
        { transform: 'translateX(0)', color: 'currentColor' },
        { transform: 'translateX(-2px)', color: '#ff7a90', offset: 0.28 },
        { transform: 'translateX(1.5px)', color: '#ff7a90', offset: 0.58 },
        { transform: 'translateX(0)', color: 'currentColor' },
      ], { duration: 210, easing: 'ease-out' })
    }
  }

  private flashMissLine(): void {
    if (this.judgementLine.hidden) return
    for (const animation of this.judgementLine.getAnimations()) animation.cancel()
    this.judgementLine.animate([
      { opacity: 0.65, transform: 'scaleX(1)', boxShadow: '0 0 0 transparent' },
      { opacity: 1, transform: 'scaleX(2.25)', boxShadow: '0 0 14px #ff516f', background: '#ff516f', offset: 0.3 },
      { opacity: 0.65, transform: 'scaleX(1)', boxShadow: '0 0 0 transparent' },
    ], { duration: 520, easing: 'cubic-bezier(.18,.72,.24,1)' })
  }

  private recordAccuracy(points: number): void {
    this.judgementIndex += 1
    this.judgedCount += 1
    this.accuracyPoints += points
    const percentage = this.accuracyPoints / this.judgedCount * 100
    this.accuracyLabel.textContent = `ACC ${percentage.toFixed(2)}%`
  }

  private showHitRing(x: number, y: number, confidence: number): void {
    const comboBoost = this.combo >= 5
    const goldAccent = this.combo >= 10
    const color = goldAccent || confidence >= 0.74
      ? '#ffd76a'
      : confidence >= 0.5 ? '#8fd7ff' : '#9cf2c5'
    const size = (confidence >= 0.74 ? 24 : 20) + (comboBoost ? 4 : 0)
    const scale = (confidence >= 0.74 ? 2.65 : 2.2) + (comboBoost ? 0.35 : 0)
    for (let index = 0; index < 2; index += 1) {
      const ring = document.createElement('span')
      ring.className = index === 0 ? 'dsh-bgm-hit-ring' : 'dsh-bgm-hit-ring dsh-bgm-hit-ring--echo'
      ring.style.left = `${x}px`
      ring.style.top = `${y}px`
      ring.style.color = color
      ring.style.width = `${size - index * 4}px`
      ring.style.height = `${size - index * 4}px`
      this.overlay.append(ring)
      const ringScale = scale - index * 0.42
      const animation = ring.animate([
        { opacity: index === 0 ? 0.88 : 0.62, transform: 'translate(-50%, -50%) scale(.42)' },
        { opacity: index === 0 ? 0.5 : 0.4, offset: 0.34 },
        { opacity: 0, transform: `translate(-50%, -50%) scale(${ringScale.toFixed(2)})` },
      ], {
        duration: (confidence >= 0.74 ? 460 : 410) + index * 70,
        delay: index * 28,
        easing: 'cubic-bezier(.12,.7,.22,1)',
      })
      animation.onfinish = () => ring.remove()
    }
  }

  /** Local 6/8/10-particle burst; colors match the judgement and never flash the page. */
  private showHitParticles(x: number, y: number, confidence: number): void {
    const count = confidence >= 0.74 ? 10 : confidence >= 0.5 ? 8 : 6
    const color = confidence >= 0.74 ? '#ffd76a' : confidence >= 0.5 ? '#8fd7ff' : '#9cf2c5'
    const seed = this.judgementIndex * 1_009 + this.combo * 137
    for (let index = 0; index < count; index += 1) {
      const particle = document.createElement('span')
      particle.className = 'dsh-bgm-hit-particle'
      particle.style.left = `${x}px`
      particle.style.top = `${y}px`
      particle.style.color = color
      const size = 2 + hashUnit(seed, index + 31) * 1.4
      particle.style.width = `${size.toFixed(2)}px`
      particle.style.height = `${size.toFixed(2)}px`
      this.overlay.append(particle)

      const angle = index / count * Math.PI * 2 + hashUnit(seed, index + 61) * 0.6
      const distance = 14 + hashUnit(seed, index + 97) * 22
      const deltaX = Math.cos(angle) * distance
      const deltaY = Math.sin(angle) * distance
      const animation = particle.animate([
        { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
        {
          opacity: 0,
          transform: `translate(calc(-50% + ${deltaX.toFixed(1)}px), calc(-50% + ${deltaY.toFixed(1)}px)) scale(.4)`,
          offset: 0.65,
        },
        {
          opacity: 0,
          transform: `translate(calc(-50% + ${(deltaX * 1.15).toFixed(1)}px), calc(-50% + ${(deltaY * 1.15).toFixed(1)}px)) scale(.2)`,
        },
      ], { duration: 420 + confidence * 90, easing: 'cubic-bezier(.14,.75,.24,1)' })
      animation.onfinish = () => particle.remove()
    }
  }

  /** A tiny local keycap at the judge point: hard press in 8ms, then rebound. */
  private showKeyStrike(x: number, y: number, rowHeight: number, confidence: number): void {
    const key = document.createElement('span')
    key.className = 'dsh-bgm-hit-key'
    key.style.left = `${x}px`
    key.style.top = `${y}px`
    key.style.height = `${clamp(rowHeight + 8, 24, 52)}px`
    key.style.color = this.combo >= 10 || confidence >= 0.74
      ? '#ffd76a'
      : confidence >= 0.5 ? '#8fd7ff' : '#9cf2c5'
    this.overlay.append(key)
    const peakOpacity = clamp(0.3 + confidence * 0.28 + (this.combo >= 5 ? 0.12 : 0), 0, 0.72)
    const animation = key.animate([
      { opacity: 0, transform: 'translateY(-50%) scaleX(.35) scaleY(1)' },
      { opacity: peakOpacity, transform: 'translateY(calc(-50% + 1px)) scaleX(1) scaleY(.88)', offset: 0.06 },
      { opacity: peakOpacity * 0.72, transform: 'translateY(calc(-50% - 1px)) scaleX(.86) scaleY(1.12)', offset: 0.36 },
      { opacity: 0, transform: 'translateY(-50%) scaleX(.45) scaleY(1)' },
    ], { duration: 140, easing: 'cubic-bezier(.12,.76,.2,1)' })
    animation.onfinish = () => key.remove()
  }

  private showGoldStreak(x: number, y: number): void {
    const streak = document.createElement('span')
    streak.className = 'dsh-bgm-gold-streak'
    streak.style.left = `${x}px`
    streak.style.top = `${y}px`
    this.overlay.append(streak)
    const animation = streak.animate([
      { opacity: 0, transform: 'translateY(-50%) scaleX(.12)' },
      { opacity: 1, transform: 'translateY(-50%) scaleX(1)', offset: 0.16 },
      { opacity: 0, transform: 'translate3d(34px, -50%, 0) scaleX(1.9)' },
    ], { duration: 280, easing: 'cubic-bezier(.12,.78,.22,1)' })
    animation.onfinish = () => streak.remove()
  }

  private clearComboAccents(): void {
    for (const surface of this.surfaces.values()) {
      for (const glyph of surface.glyphs) glyph.element.style.webkitTextStroke = ''
    }
  }

  private judgementPoint(): { readonly x: number; readonly y: number } | undefined {
    const surface = this.judgementSurface()
    if (surface === undefined) return undefined
    const rect = surface.target.getBoundingClientRect()
    if (!isVisible(rect)) return undefined
    return { x: rect.left, y: rect.top + rect.height / 2 }
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

  private showGrade(text: string, color: string, x: number, y: number): void {
    const element = document.createElement('span')
    element.className = 'dsh-bgm-grade-float'
    element.textContent = text
    element.style.color = color
    element.style.left = `${x}px`
    element.style.top = `${y}px`
    this.overlay.append(element)

    const milestone = text === 'FEVER ×5' || text === 'GOLD MODE!'
      || text === 'GOLD TRAIL!' || text === 'FULL COMBO!'
    const seed = this.judgementIndex * 977 + this.combo * 131 + text.length * 53
    const fullCircle = text === 'MISS'
    const angle = fullCircle
      ? hashUnit(seed, 5) * Math.PI * 2
      : -Math.PI * 0.89 + hashUnit(seed, 5) * Math.PI * 0.78
    const distance = milestone ? 48 + hashUnit(seed, 9) * 24 : 26 + hashUnit(seed, 9) * 30
    const deltaX = Math.cos(angle) * distance
    const deltaY = Math.sin(angle) * distance * 0.8
    const duration = milestone
      ? 1_200
      : text === 'MISS' ? 1_000 : text === 'PERFECT' ? 900 : text === 'GREAT' ? 800 : 700
    const size = milestone ? 20 : text === 'PERFECT' || text === 'MISS' ? 18 : 16
    element.style.fontSize = `${size}px`

    const animation = element.animate([
      { opacity: 0, transform: 'translate(-50%, -50%) scale(.6)' },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1.25)', offset: 0.14 },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1)', offset: 0.34 },
      {
        opacity: 0,
        transform: `translate(calc(-50% + ${deltaX.toFixed(2)}px), calc(-50% + ${deltaY.toFixed(2)}px)) scale(.94)`,
      },
    ], { duration, easing: 'cubic-bezier(.18,.78,.26,1)' })
    animation.onfinish = () => element.remove()
  }

  private rebuild(candidate: Candidate): void {
    const rect = candidate.target.getBoundingClientRect()
    const streaming = isStreamingActivity(candidate.target, candidate.kind)
    // Never walk/segment a growing React text tree. Besides avoiding mirrored
    // glyph churn, this keeps every streaming token update O(1) here.
    const runs = streaming ? [] : textRuns(candidate.target)
    const glyphCount = streaming
      ? Math.min(MAX_GLYPHS_PER_SURFACE, Math.max(1, Math.round(rect.width / 11)))
      : Math.min(
        MAX_GLYPHS_PER_SURFACE,
        runs.reduce((count, run) => count
          + run.segments.filter(segment => segment.segment.trim() !== '').length, 0),
      )
    const signatureParts: Array<string | number> = [
      candidate.kind,
      streaming ? 'streaming' : 'stable',
      Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height),
    ]
    if (streaming) signatureParts.push(glyphCount)
    else signatureParts.push(...runs.map(runSignature))
    const signature = signatureParts.join('\u0000')
    const previous = this.surfaces.get(candidate.target)
    if (previous?.signature === signature) return
    if (previous !== undefined) this.removeSurface(previous)

    const glyphs: Glyph[] = []
    const masked = new Set<HTMLElement>()
    if (!streaming) {
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
    }
    for (const parent of masked) parent.dataset.dshBgmMasked = ''

    const surface: Surface = {
      target: candidate.target,
      kind: candidate.kind,
      glyphs,
      glyphCount,
      streaming,
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

  private startCue(
    lane: CueLane,
    frame: RhythmFrame,
    now: number,
    force = false,
    confidence = 0.5,
    sampleKind: BeatSample['kind'] = 'detected',
  ): void {
    const current = lane === 'downbeat' ? this.currentDownbeatCue : this.currentFlowCue
    if (lane === 'downbeat' && !force && current !== undefined
      && now < current.startedAt + current.travelMs + current.durationMs * 0.5) return

    const periodMs = lane === 'flow' ? this.flowDetector.periodMs() : undefined
    if (lane === 'flow' && periodMs === undefined) return
    if (lane === 'flow') {
      for (const ripple of this.overlay.querySelectorAll('.dsh-bgm-flow-ripple')) ripple.remove()
    }

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
          confidence,
          strength: cueStrength(confidence),
          sampleKind,
          comboBoost: this.combo >= 5,
          goldAccent: this.combo >= 10,
          periodMs,
          startedAt: now,
          travelMs: 90 + energy * 150,
          durationMs: 390 + energy * 140,
          flowTracerShown: false,
        }
      : {
          lane,
          style: chart.style,
          seed: chart.seed,
          energy,
          confidence,
          strength: cueStrength(confidence),
          sampleKind,
          comboBoost: this.combo >= 5,
          goldAccent: this.combo >= 10,
          periodMs,
          startedAt: now,
          travelMs: periodMs ?? 0,
          durationMs: clamp((periodMs ?? 0) * 0.34, 180, 340),
          flowTracerShown: false,
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
    if (cue.lane === 'flow') {
      this.animateFlowScan(surface, cue, now)
      return
    }

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
    const lift = 4 + energy * 5

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

  /** Flow restores arcade chart modes while every propagation step stays BPM-locked. */
  private animateFlowScan(surface: Surface, cue: WaveCue, now: number): void {
    const periodMs = cue.periodMs
    if (periodMs === undefined) return
    const stepMs = clamp(periodMs / Math.max(1, surface.glyphCount), 18, 60)
    const elapsed = Math.max(0, now - cue.startedAt)
    const strong = cue.sampleKind === 'detected' && cue.strength === 'strong'
    const weak = cue.sampleKind === 'fallback' || cue.strength === 'weak'
    if (surface.streaming) {
      this.showFlowRipple(surface, cue, now, stepMs)
      if (strong && elapsed < 50) this.strikeJudgementLine(cue.confidence)
      return
    }

    const glyphs = surface.glyphs
    if (glyphs.length === 0) return
    const directionalRipple = cue.style.order === 'left-right' || cue.style.order === 'right-left'
    if (weak && directionalRipple) this.showFlowRipple(surface, cue, now, stepMs)
    if (strong && elapsed < 50) this.strikeJudgementLine(cue.confidence)

    let minX = Number.POSITIVE_INFINITY
    let maxX = Number.NEGATIVE_INFINITY
    for (const glyph of glyphs) {
      minX = Math.min(minX, glyph.centerX)
      maxX = Math.max(maxX, glyph.centerX)
    }
    const xSpan = Math.max(1, maxX - minX)

    const comboMultiplier = cue.comboBoost ? 1.1 : 1
    const lift = (strong
      ? 18 + cue.energy * 6
      : weak ? 5 + cue.energy * 3 : 11 + cue.energy * 4) * comboMultiplier
    const baseScale = strong ? 1.35 : weak ? 1.12 : 1.24
    const peakScale = 1 + (baseScale - 1) * comboMultiplier
    const durationMs = cue.durationMs
    const rest = 'translate3d(0, 0, 0) scale(1)'
    const peakShadow = cue.goldAccent
      ? '0 0 2px #fff7c2, 0 0 9px #ffd76a'
      : strong
        ? `0 ${(8 + cue.energy * 5).toFixed(1)}px 3px color-mix(in srgb, currentColor 38%, transparent), 0 0 8px color-mix(in srgb, currentColor 55%, transparent)`
        : weak
          ? '0 0 3px color-mix(in srgb, currentColor 30%, #8fd7ff)'
          : '0 0 7px color-mix(in srgb, currentColor 58%, #8fd7ff)'

    for (let index = 0; index < glyphs.length; index += 1) {
      const glyph = glyphs[index]
      if (glyph === undefined) continue
      const horizontal = (glyph.centerX - minX) / xSpan
      const signedCenter = horizontal * 2 - 1
      const centerDistance = Math.min(1, Math.abs(signedCenter))
      let progress: number
      switch (cue.style.order) {
        case 'together': progress = 0; break
        case 'left-right': progress = horizontal; break
        case 'right-left': progress = 1 - horizontal; break
        case 'center-out': progress = centerDistance; break
        case 'edges-in': progress = 1 - centerDistance; break
        case 'even-odd': progress = (index % 2) * 0.58 + horizontal * 0.42; break
        case 'odd-even': progress = ((index + 1) % 2) * 0.58 + horizontal * 0.42; break
        case 'shuffle': progress = hashUnit(cue.seed, index + 17); break
      }

      const direction = Math.sign(signedCenter) || (index % 2 === 0 ? -1 : 1)
      const lateral = clamp(3 + lift * 0.32, 4, 11)
      let peakX = 0
      let peakY = -lift
      switch (cue.style.motion) {
        case 'punch':
          peakY = -lift * 0.42
          break
        case 'jump':
          peakY = -lift
          break
        case 'drop':
          peakY = lift * 0.78
          break
        case 'split':
          peakX = direction * lateral
          peakY = -lift * 0.46
          break
        case 'converge':
          peakX = -direction * lateral
          peakY = -lift * 0.42
          break
        case 'zigzag':
          peakY = index % 2 === 0 ? -lift : lift * 0.72
          break
        case 'snake':
          peakX = Math.cos(horizontal * Math.PI * 2) * lateral * 0.42
          peakY = Math.sin(horizontal * Math.PI * 2.5) * lift * 0.9
          break
        case 'stair-up':
          peakX = lateral * 0.18
          peakY = -lift * (0.34 + horizontal * 0.66)
          break
        case 'stair-down':
          peakX = -lateral * 0.16
          peakY = lift * (0.24 + horizontal * 0.58)
          break
        case 'fan':
          peakX = signedCenter * lateral
          peakY = -lift * (1 - Math.abs(signedCenter) * 0.35)
          break
        case 'orbit': {
          const angle = horizontal * Math.PI * 2 + hashUnit(cue.seed, 91) * Math.PI
          peakX = Math.cos(angle) * lateral * 0.72
          peakY = Math.sin(angle) * lift * 0.82
          break
        }
      }

      for (const animation of glyph.element.getAnimations()) animation.cancel()
      glyph.element.style.webkitTextStroke = cue.goldAccent ? '0.35px #ffd76a' : ''
      const travelMs = stepMs * Math.max(0, glyphs.length - 1)
      const delay = (strong ? 0 : progress * travelMs) - elapsed
      if (delay + durationMs <= 0) continue
      const press = `translate3d(${(-peakX * 0.12).toFixed(2)}px, ${(peakY > 0 ? -1 : 1).toFixed(2)}px, 0) scaleX(1.025) scaleY(.92)`
      const peak = `translate3d(${peakX.toFixed(2)}px, ${peakY.toFixed(2)}px, 0) scale(${peakScale.toFixed(3)})`
      const rebound = `translate3d(${(-peakX * 0.14).toFixed(2)}px, ${(-peakY * 0.12).toFixed(2)}px, 0) scaleX(1.03) scaleY(.97)`
      const halfPeak = `translate3d(${(peakX * 0.36).toFixed(2)}px, ${(peakY * 0.36).toFixed(2)}px, 0) scale(${(1 + (peakScale - 1) * 0.38).toFixed(3)})`
      const restShadow = '0 0 0 transparent'
      const frames: Keyframe[] = cue.style.attack === 'bounce'
        ? [
            { transform: rest, textShadow: restShadow },
            { transform: press, textShadow: restShadow, offset: 0.045 },
            { transform: peak, textShadow: peakShadow, offset: 0.28 },
            { transform: rebound, textShadow: restShadow, offset: 0.56 },
            { transform: halfPeak, textShadow: peakShadow, offset: 0.78 },
            { transform: rest, textShadow: restShadow },
          ]
        : cue.style.attack === 'hold'
          ? [
              { transform: rest, textShadow: restShadow },
              { transform: press, textShadow: restShadow, offset: 0.045 },
              { transform: peak, textShadow: peakShadow, offset: 0.27 },
              { transform: peak, textShadow: peakShadow, offset: 0.56 },
              { transform: rebound, textShadow: restShadow, offset: 0.8 },
              { transform: rest, textShadow: restShadow },
            ]
          : [
              { transform: rest, textShadow: restShadow },
              { transform: press, textShadow: restShadow, offset: 0.045 },
              { transform: peak, textShadow: peakShadow, offset: 0.3 },
              { transform: rebound, textShadow: restShadow, offset: 0.64 },
              { transform: rest, textShadow: restShadow },
            ]
      glyph.element.animate(frames, {
        duration: durationMs,
        delay,
        easing: 'cubic-bezier(.12,.8,.22,1)',
      })
    }
  }

  /** Weak beats keep a subtle tracer behind their small glyph bounce. */
  private showFlowRipple(surface: Surface, cue: WaveCue, now: number, stepMs: number): void {
    if (cue.flowTracerShown) return
    cue.flowTracerShown = true
    const rect = surface.target.getBoundingClientRect()
    if (!isVisible(rect)) return
    const totalMs = clamp((Math.max(1, surface.glyphCount) - 1) * stepMs
      + cue.durationMs * 0.55, 180, 2_500)
    const elapsed = Math.max(0, now - cue.startedAt)
    if (elapsed >= totalMs) return
    const progress = clamp(elapsed / totalMs, 0, 1)
    const leftToRight = cue.style.order === 'left-right'
    const direction = leftToRight ? 1 : -1
    const peakOpacity = cue.strength === 'medium' ? 0.2 : 0.11
    const startOpacity = progress < 0.08
      ? peakOpacity * progress / 0.08
      : peakOpacity * (1 - progress) / 0.92
    const ripple = document.createElement('span')
    ripple.className = 'dsh-bgm-flow-ripple'
    ripple.style.left = `${leftToRight ? rect.left - 6 : rect.right - 6}px`
    ripple.style.top = `${rect.top}px`
    ripple.style.height = `${rect.height}px`
    ripple.style.color = cue.goldAccent ? '#ffd76a' : '#8fd7ff'
    this.overlay.append(ripple)
    const frames: Keyframe[] = [{
      opacity: Math.max(0, startOpacity),
      transform: `translate3d(${(direction * rect.width * progress).toFixed(2)}px, 0, 0)`,
    }]
    if (progress < 0.08) {
      frames.push({
        opacity: peakOpacity,
        transform: `translate3d(${(direction * rect.width * 0.08).toFixed(2)}px, 0, 0)`,
        offset: (0.08 - progress) / (1 - progress),
      })
    }
    frames.push({
      opacity: 0,
      transform: `translate3d(${(direction * (rect.width + 12)).toFixed(2)}px, 0, 0)`,
    })
    const animation = ripple.animate(frames, { duration: totalMs - elapsed, easing: 'linear' })
    animation.onfinish = () => ripple.remove()
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
    this.lastFrame = undefined
    this.retainedActivity = undefined
    this.retainActivityUntil = 0
    this.currentActivityTarget = undefined
    this.combo = 0
    this.score = 0
    this.judgedCount = 0
    this.accuracyPoints = 0
    this.noteIndex = 0
    this.judgementIndex = 0
    this.lastJudgementStrikeAt = 0
    this.clearHitstop()
    this.judgementLine.hidden = true
    this.comboLabel.hidden = true
    this.scoreLabel.hidden = true
    this.scoreLabel.textContent = 'SCORE 0000000'
    this.scoreDeltaLabel.hidden = true
    this.accuracyLabel.hidden = true
    this.accuracyLabel.textContent = 'ACC 100.00%'
    for (const grade of this.overlay.querySelectorAll('.dsh-bgm-grade-float')) grade.remove()
    for (const ring of this.overlay.querySelectorAll('.dsh-bgm-hit-ring')) ring.remove()
    for (const particle of this.overlay.querySelectorAll('.dsh-bgm-hit-particle')) particle.remove()
    for (const key of this.overlay.querySelectorAll('.dsh-bgm-hit-key')) key.remove()
    for (const streak of this.overlay.querySelectorAll('.dsh-bgm-gold-streak')) streak.remove()
    for (const ripple of this.overlay.querySelectorAll('.dsh-bgm-flow-ripple')) ripple.remove()
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
