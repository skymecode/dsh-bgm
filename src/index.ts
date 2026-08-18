/**
 * dsh-bgm Host entry. Supervises the platform helper and exposes same-origin
 * state + SSE routes to the DSH Web client.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { BgmHelperManager } from './host/helper-manager.ts'
import { registerBgmRoutes } from './host/routes.ts'

export const name = 'dsh-bgm'

/** The same-origin route registry carries state to the Web client. */
export const inject = ['webServer']

/** DSH/Cordis plugin entry point. */
export function apply(ctx: Context): void {
  const manager = new BgmHelperManager(ctx)
  ctx.effect(() => {
    const disposeRoutes = registerBgmRoutes(ctx, manager)
    return () => {
      disposeRoutes()
      manager.dispose()
    }
  }, 'dsh-bgm: host service')
}

export type {
  BgmHelperStatus,
  BgmNativeEvent,
  BgmPlatform,
  BgmSnapshot,
  NowPlayingState,
  RhythmFrame,
} from './core/types.ts'
