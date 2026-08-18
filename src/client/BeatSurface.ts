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

/** Adaptive onset gate with a short refractory window, like a rhythm-game hit lane. */
class BeatDetector {
  private previousBass = 0
  private previousRms = 0
  private averageFlux = 0
  private fluxDeviation = 0
  private lastHitAt = 0
  private readonly intervals: number[] = []

  sample(frame: RhythmFrame, now: number): boolean {
    const bassRise = Math.max(0, frame.bass - this.previousBass)
    const rmsRise = Math.max(0, frame.rms - this.previousRms)
    this.previousBass = frame.bass
    this.previousRms = frame.rms

    const flux = frame.onset * 0.72 + bassRise * 1.35 + rmsRise * 0.55
    const delta = Math.abs(flux - this.averageFlux)
    this.averageFlux = this.averageFlux * 0.9 + flux * 0.1
    this.fluxDeviation = this.fluxDeviation * 0.88 + delta * 0.12
    const threshold = Math.max(0.075, this.averageFlux + this.fluxDeviation * 0.85)
    const sinceHit = now - this.lastHitAt
    const detected = flux >= threshold && sinceHit >= 180
    const period = this.period()
    const predicted = period !== undefined
      && sinceHit >= period * 0.94
      && sinceHit <= period * 1.3
    const softFallback = sinceHit >= 680 && frame.rms > SOUND_THRESHOLD
    if (!detected && !predicted && !softFallback) return false

    if (detected && this.lastHitAt > 0 && sinceHit >= 250 && sinceHit <= 1_000) {
      this.intervals.push(sinceHit)
      if (this.intervals.length > 8) this.intervals.shift()
    }
    this.lastHitAt = now
    return true
  }

  reset(): void {
    this.previousBass = 0
    this.previousRms = 0
    this.averageFlux = 0
    this.fluxDeviation = 0
    this.lastHitAt = 0
    this.intervals.length = 0
  }

  private period(): number | undefined {
    if (this.intervals.length < 2) return undefined
    const sorted = [...this.intervals].sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }
}

/** Mid/treble change detector for the information-flow lane, independent of kick hits. */
class FlowDetector {
  private previousMid = 0
  private previousTreble = 0
  private averageFlux = 0
  private fluxDeviation = 0
  private lastHitAt = 0

  sample(frame: RhythmFrame, now: number): boolean {
    const midDelta = Math.abs(frame.mid - this.previousMid)
    const trebleDelta = Math.abs(frame.treble - this.previousTreble)
    this.previousMid = frame.mid
    this.previousTreble = frame.treble

    const flux = midDelta * 0.9 + trebleDelta * 1.25 + frame.onset * 0.16
    const delta = Math.abs(flux - this.averageFlux)
    this.averageFlux = this.averageFlux * 0.9 + flux * 0.1
    this.fluxDeviation = this.fluxDeviation * 0.86 + delta * 0.14
    const threshold = Math.max(0.052, this.averageFlux + this.fluxDeviation * 0.78)
    const sinceHit = now - this.lastHitAt
    const detected = flux >= threshold && sinceHit >= 220
    const melodicFallback = sinceHit >= 760 && (frame.mid > SOUND_THRESHOLD || frame.treble > SOUND_THRESHOLD)
    if (!detected && !melodicFallback) return false
    this.lastHitAt = now
    return true
  }

  reset(): void {
    this.previousMid = 0
    this.previousTreble = 0
    this.averageFlux = 0
    this.fluxDeviation = 0
    this.lastHitAt = 0
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

  constructor() {
    this.overlay.dataset.dshBgmOverlay = ''
    this.overlay.setAttribute('aria-hidden', 'true')
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
      const downbeatHit = this.beatDetector.sample(frame, now)
      const flowHit = this.flowDetector.sample(frame, now)
      if (!downbeatHit && !flowHit) return
      if (this.refreshFrame !== undefined) cancelAnimationFrame(this.refreshFrame)
      if (this.refreshTimer !== undefined) window.clearTimeout(this.refreshTimer)
      this.refreshFrame = undefined
      this.refreshTimer = undefined
      this.refresh()
      if (downbeatHit) this.startCue('downbeat', frame, now)
      if (flowHit) this.startCue('flow', frame, now)
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
