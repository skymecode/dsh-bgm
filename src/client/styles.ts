const STYLE_ID = 'dsh-bgm-style'

const stylesheet = `
.dsh-bgm-glyph {
  position: fixed;
  z-index: 2147483000;
  pointer-events: none;
  white-space: pre;
  transform-origin: 50% 100%;
  will-change: transform;
  -webkit-font-smoothing: inherit;
  text-rendering: inherit;
}

.dsh-bgm-note {
  position: fixed;
  z-index: 2147483002;
  pointer-events: none;
  white-space: pre;
  transform-origin: 50% 50%;
  isolation: isolate;
  overflow: visible;
  will-change: transform, opacity, filter;
  -webkit-text-fill-color: currentColor;
  text-shadow:
    3px 0 2px color-mix(in srgb, currentColor 72%, transparent),
    8px 0 5px color-mix(in srgb, currentColor 48%, transparent),
    16px 0 9px color-mix(in srgb, currentColor 22%, transparent),
    0 0 12px color-mix(in srgb, currentColor 78%, transparent);
}

/* Notes travel right-to-left, so the same-color comet trail stays behind them. */
.dsh-bgm-note::before {
  content: '';
  position: absolute;
  z-index: -1;
  left: 48%;
  top: 50%;
  width: 72px;
  height: 4px;
  pointer-events: none;
  border-radius: 999px;
  opacity: .82;
  background: linear-gradient(
    90deg,
    currentColor 0,
    color-mix(in srgb, currentColor 58%, transparent) 28%,
    transparent 100%
  );
  filter: blur(.65px);
  transform: translateY(-50%);
  transform-origin: 0 50%;
}

.dsh-bgm-note--impact::before {
  opacity: 0;
}

.dsh-bgm-judgement-line {
  position: fixed;
  z-index: 2147483001;
  width: 2px;
  min-height: 22px;
  border-radius: 2px;
  opacity: .65;
  background: color-mix(in srgb, var(--dsw-static-deepseek-400, #8fd7ff) 78%, white);
  box-shadow: 0 0 5px color-mix(in srgb, var(--dsw-static-deepseek-400, #8fd7ff) 55%, transparent);
  transform-origin: 50% 50%;
}

.dsh-bgm-combo,
.dsh-bgm-score,
.dsh-bgm-score-delta,
.dsh-bgm-accuracy {
  position: fixed;
  z-index: 2147483002;
  pointer-events: none;
  white-space: nowrap;
  font: 600 10px/12px var(--ds-font-family, system-ui, sans-serif);
  letter-spacing: .04em;
  text-shadow: 0 0 5px currentColor;
}

.dsh-bgm-combo {
  color: var(--dsw-static-deepseek-300, #a9c8ff);
}

.dsh-bgm-grade-float {
  position: fixed;
  z-index: 2147483003;
  pointer-events: none;
  white-space: nowrap;
  font-family: var(--ds-font-family, system-ui, sans-serif);
  font-weight: 700;
  line-height: 1;
  letter-spacing: .06em;
  text-shadow:
    0 0 10px currentColor,
    0 1px 2px rgba(0, 0, 0, .85),
    0 0 1px rgba(0, 0, 0, .9);
  will-change: transform, opacity;
}

.dsh-bgm-hit-ring {
  position: fixed;
  z-index: 2147483002;
  pointer-events: none;
  box-sizing: border-box;
  border: 1.5px solid currentColor;
  border-radius: 50%;
  background: radial-gradient(
    circle,
    color-mix(in srgb, currentColor 24%, transparent) 0,
    color-mix(in srgb, currentColor 8%, transparent) 44%,
    transparent 72%
  );
  box-shadow: 0 0 8px currentColor, inset 0 0 5px currentColor;
  will-change: transform, opacity;
}

.dsh-bgm-hit-ring--echo {
  border-width: 1px;
  box-shadow: 0 0 5px currentColor;
}

.dsh-bgm-hit-particle {
  position: fixed;
  z-index: 2147483004;
  pointer-events: none;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 4px currentColor;
  will-change: transform, opacity;
}

.dsh-bgm-hit-key {
  position: fixed;
  z-index: 2147483002;
  width: 30px;
  pointer-events: none;
  border-radius: 2px 8px 8px 2px;
  background: linear-gradient(90deg, currentColor, transparent 86%);
  transform-origin: 0 50%;
  will-change: transform, opacity;
}

.dsh-bgm-gold-streak {
  position: fixed;
  z-index: 2147483003;
  width: 52px;
  height: 2px;
  pointer-events: none;
  border-radius: 999px;
  background: linear-gradient(90deg, #fff7c2, #ffd76a 38%, transparent);
  box-shadow: 0 0 5px #ffd76a, 0 0 11px color-mix(in srgb, #ffd76a 72%, transparent);
  transform-origin: 0 50%;
  will-change: transform, opacity;
}

.dsh-bgm-flow-ripple {
  position: fixed;
  z-index: 2147483001;
  width: 12px;
  pointer-events: none;
  border-radius: 50%;
  background: linear-gradient(90deg, transparent, currentColor, transparent);
  filter: blur(.4px);
  will-change: transform, opacity;
}

.dsh-bgm-score {
  width: 110px;
  color: var(--dsw-static-deepseek-300, #a9c8ff);
  text-align: right;
  font-variant-numeric: tabular-nums;
  letter-spacing: .075em;
  transform-origin: 100% 50%;
}

.dsh-bgm-score-delta {
  width: 54px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  transform-origin: 100% 50%;
}

.dsh-bgm-accuracy {
  width: 80px;
  color: color-mix(in srgb, var(--dsw-static-deepseek-300, #a9c8ff) 78%, white);
  text-align: right;
  font-variant-numeric: tabular-nums;
  letter-spacing: .035em;
}

.dsh-bgm-note[hidden],
.dsh-bgm-judgement-line[hidden],
.dsh-bgm-combo[hidden],
.dsh-bgm-score[hidden],
.dsh-bgm-score-delta[hidden],
.dsh-bgm-accuracy[hidden] {
  display: none !important;
}

[data-dsh-bgm-overlay] {
  position: fixed;
  inset: 0;
  z-index: 2147482999;
  pointer-events: none;
  overflow: hidden;
  contain: strict;
}

html[data-dsh-bgm-active] [data-dsh-bgm-masked] {
  color: transparent !important;
  -webkit-text-fill-color: transparent !important;
  text-shadow: none !important;
}

/* DSH paints Deep Diving with a gradient clipped into transparent text. The
   gradient must be disabled as well as the text color or it remains as a
   second, shimmering copy underneath the beat glyphs. */
html[data-dsh-bgm-active] [data-dsh-bgm-reactive='deep-diving'][data-dsh-bgm-masked] {
  background-image: none !important;
  animation: none !important;
}

/* Hitstop is local to plugin-owned effects; React text and the page keep moving. */
html[data-dsh-bgm-hitstop] .dsh-bgm-glyph,
html[data-dsh-bgm-hitstop] .dsh-bgm-note,
html[data-dsh-bgm-hitstop] .dsh-bgm-hit-ring,
html[data-dsh-bgm-hitstop] .dsh-bgm-hit-particle,
html[data-dsh-bgm-hitstop] .dsh-bgm-hit-key,
html[data-dsh-bgm-hitstop] .dsh-bgm-gold-streak,
html[data-dsh-bgm-hitstop] .dsh-bgm-flow-ripple,
html[data-dsh-bgm-hitstop] .dsh-bgm-grade-float,
html[data-dsh-bgm-hitstop] .dsh-bgm-judgement-line {
  animation-play-state: paused !important;
}

@media (prefers-reduced-motion: reduce) {
  .dsh-bgm-glyph { transform: none !important; }
  .dsh-bgm-note,
  .dsh-bgm-hit-ring,
  .dsh-bgm-hit-particle,
  .dsh-bgm-hit-key,
  .dsh-bgm-gold-streak,
  .dsh-bgm-flow-ripple,
  .dsh-bgm-judgement-line,
  .dsh-bgm-combo,
  .dsh-bgm-grade-float,
  .dsh-bgm-score,
  .dsh-bgm-score-delta,
  .dsh-bgm-accuracy { display: none !important; }
}
`

/** Install the package-owned stylesheet and return its disposer. */
export function installStyles(): () => void {
  const existing = document.getElementById(STYLE_ID)
  if (existing !== null) return () => {}

  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.plugin = 'dsh-bgm'
  style.textContent = stylesheet
  document.head.append(style)
  return () => style.remove()
}
