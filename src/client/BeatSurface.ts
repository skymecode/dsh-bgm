import type { BgmSnapshot, RhythmFrame } from '../core/types.ts'
import { subscribeBgm } from './stream.ts'

type SurfaceKind = 'reasoning' | 'tool' | 'context' | 'deep-diving'
type WavePattern = 'left-right' | 'inside-out' | 'outside-in' | 'top-down'

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

interface TextRun {
  readonly node: Text
  readonly parent: HTMLElement
  readonly segments: readonly Intl.SegmentData[]
}

const SOUND_THRESHOLD = 0.025
const SILENCE_HOLD_MS = 700
const MAX_GLYPHS_PER_SURFACE = 140
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

function textRuns(target: HTMLElement): readonly TextRun[] {
  const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT)
  const runs: TextRun[] = []
  let count = 0
  let current: Node | null
  while ((current = walker.nextNode()) !== null && count < MAX_GLYPHS_PER_SURFACE) {
    const node = current as Text
    const parent = node.parentElement
    if (parent === null || parent.closest(EXCLUDED_TEXT) !== null || !isVisuallyPainted(parent)) continue
    if (node.data.trim() === '') continue
    const remaining = MAX_GLYPHS_PER_SURFACE - count
    const segments = [...segmenter.segment(node.data)].slice(0, remaining)
    if (segments.length === 0) continue
    runs.push({ node, parent, segments })
    count += segments.length
  }
  return runs
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
  private disposeStream: (() => void) | undefined
  private refreshFrame: number | undefined
  private silenceTimer: number | undefined
  private active = false
  private hitIndex = 0
  private phrasePattern: WavePattern = 'left-right'
  private phraseHitsRemaining = 0

  constructor() {
    this.overlay.dataset.dshBgmOverlay = ''
    this.overlay.setAttribute('aria-hidden', 'true')
    this.observer = new MutationObserver((records) => {
      for (const record of records) {
        if (this.overlay.contains(record.target)) continue
        const touchesSurface = [...this.surfaces.values()].some(surface => (
          surface.target.contains(record.target)
          || (record.type === 'childList' && [...record.removedNodes].some(node => (
            node === surface.target || (node instanceof Element && node.contains(surface.target))
          )))
        ))
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
    if (this.active && this.beatDetector.sample(frame, performance.now())) this.hit(frame)
  }

  private refresh(): void {
    if (!this.active) return
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
    const signature = [
      candidate.kind,
      candidate.target.textContent ?? '',
      Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height),
    ].join('\u0000')
    const previous = this.surfaces.get(candidate.target)
    if (previous?.signature === signature) return
    if (previous !== undefined) this.removeSurface(previous)

    const glyphs: Glyph[] = []
    const masked = new Set<HTMLElement>()
    const range = document.createRange()
    for (const run of textRuns(candidate.target)) {
      const computed = getComputedStyle(run.parent)
      let paintedRun = false
      for (const segment of run.segments) {
        if (segment.segment.trim() === '') continue
        range.setStart(run.node, segment.index)
        range.setEnd(run.node, segment.index + segment.segment.length)
        const glyphRect = range.getBoundingClientRect()
        const insideRow = glyphRect.right >= rect.left && glyphRect.left <= rect.right
          && glyphRect.bottom >= rect.top && glyphRect.top <= rect.bottom
        if (!isVisible(glyphRect) || !insideRow) continue
        const element = document.createElement('span')
        element.className = 'dsh-bgm-glyph'
        element.textContent = segment.segment
        glyphStyle(element, computed, glyphRect, candidate.kind)
        this.overlay.append(element)
        glyphs.push({
          element,
          centerX: glyphRect.left + glyphRect.width / 2,
          centerY: glyphRect.top + glyphRect.height / 2,
        })
        paintedRun = true
      }
      if (paintedRun) masked.add(run.parent)
    }
    range.detach()
    for (const parent of masked) parent.dataset.dshBgmMasked = ''

    this.surfaces.set(candidate.target, {
      target: candidate.target,
      kind: candidate.kind,
      glyphs,
      masked,
      signature,
    })
    candidate.target.dataset.dshBgmReactive = candidate.kind
  }

  private hit(frame: RhythmFrame): void {
    const energy = Math.min(1, (frame.bass + frame.mid + frame.treble) / 2.1)
    const pattern = this.wavePattern(frame)
    this.hitIndex += 1
    for (const surface of this.surfaces.values()) this.animateSurfaceWave(surface, pattern, energy)
  }

  private wavePattern(frame: RhythmFrame): WavePattern {
    if (this.phraseHitsRemaining <= 0) {
      if (frame.onset > 0.62) this.phrasePattern = 'top-down'
      else if (frame.bass > frame.mid + 0.08 && frame.bass > frame.treble + 0.08) this.phrasePattern = 'inside-out'
      else if (frame.treble > frame.mid + 0.08 && frame.treble > frame.bass + 0.08) this.phrasePattern = 'outside-in'
      else {
        const phrases = ['left-right', 'inside-out', 'outside-in', 'top-down'] as const
        this.phrasePattern = phrases[Math.floor(this.hitIndex / 4) % phrases.length] ?? 'left-right'
      }
      this.phraseHitsRemaining = 4
    }
    this.phraseHitsRemaining -= 1
    return this.phrasePattern
  }

  private animateSurfaceWave(surface: Surface, pattern: WavePattern, energy: number): void {
    const { glyphs } = surface
    if (glyphs.length === 0) return
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
    const ySpan = Math.max(1, maxY - minY)
    const travelMs = 120 + energy * 100
    const lift = 2 + energy * 3

    for (const glyph of glyphs) {
      const distance = Math.min(1, Math.hypot(glyph.centerX - centerX, glyph.centerY - centerY) / maxDistance)
      const progress = pattern === 'left-right'
        ? (glyph.centerX - minX) / xSpan
        : pattern === 'top-down'
          ? (glyph.centerY - minY) / ySpan
          : pattern === 'inside-out'
            ? distance
            : 1 - distance
      for (const animation of glyph.element.getAnimations()) animation.cancel()
      glyph.element.animate([
        { transform: 'translate3d(0, 0, 0) scale(1)' },
        {
          transform: `translate3d(0, ${(-lift).toFixed(2)}px, 0) scale(${(1.02 + energy * 0.035).toFixed(3)})`,
          offset: 0.42,
        },
        { transform: 'translate3d(0, 0, 0) scale(1)' },
      ], {
        duration: 210 + energy * 70,
        delay: progress * travelMs,
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
    this.hitIndex = 0
    this.phrasePattern = 'left-right'
    this.phraseHitsRemaining = 0
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
    if (this.silenceTimer !== undefined) window.clearTimeout(this.silenceTimer)
    this.refreshFrame = undefined
    this.silenceTimer = undefined
    this.deactivate()
    this.overlay.remove()
  }
}
