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
