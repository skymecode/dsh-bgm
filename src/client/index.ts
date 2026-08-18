/** dsh-bgm browser entry: music-reactive DSH conversation surfaces. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { BeatSurface } from './BeatSurface.ts'
import { installStyles } from './styles.ts'

export const inject: readonly string[] = []

/** Mount the non-invasive per-grapheme beat layer for DSH's conversation UI. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const disposeStyles = installStyles()
    const beatSurface = new BeatSurface()
    const disposeSurface = beatSurface.mount()

    return () => {
      disposeSurface()
      disposeStyles()
    }
  }, 'dsh-bgm: conversation beat surface')
}

export { BeatSurface } from './BeatSurface.ts'
