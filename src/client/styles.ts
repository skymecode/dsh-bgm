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
  will-change: transform, opacity;
  -webkit-text-fill-color: currentColor;
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
.dsh-bgm-grade,
.dsh-bgm-score,
.dsh-bgm-score-delta {
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

.dsh-bgm-grade {
  transform-origin: 0 50%;
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

.dsh-bgm-note[hidden],
.dsh-bgm-judgement-line[hidden],
.dsh-bgm-combo[hidden],
.dsh-bgm-grade[hidden],
.dsh-bgm-score[hidden],
.dsh-bgm-score-delta[hidden] {
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

@media (prefers-reduced-motion: reduce) {
  .dsh-bgm-glyph { transform: none !important; }
  .dsh-bgm-note,
  .dsh-bgm-judgement-line,
  .dsh-bgm-combo,
  .dsh-bgm-grade,
  .dsh-bgm-score,
  .dsh-bgm-score-delta { display: none !important; }
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
