/** dsh-bgm browser entry: music-reactive DSH conversation surfaces. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { CommandContribution } from '@deepseek-ai/dsh-client-ui-commands/client'
import { BeatSurface } from './BeatSurface.ts'
import { installStyles } from './styles.ts'

export const inject: readonly string[] = ['commandUi']

/** Mount the non-invasive per-grapheme beat layer for DSH's conversation UI. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const disposeStyles = installStyles()
    const beatSurface = new BeatSurface()
    const disposeSurface = beatSurface.mount()
    const atmosphereCommand: CommandContribution = {
      name: 'bgm-atmosphere',
      description: '切换对话区两侧的 RGB 音乐氛围律动柱',
      available: () => true,
      ui: {
        kind: 'popupSelect',
        options: () => Promise.resolve([
          {
            id: 'on',
            label: '开启氛围律动',
            detail: '默认开启；在宽屏对话区两侧显示随系统音乐变化的 RGB 律动柱',
            active: beatSurface.atmosphereEnabled(),
          },
          {
            id: 'off',
            label: '关闭氛围律动',
            detail: '保留文字、判定线与音游反馈，只隐藏两侧 RGB 律动柱',
            active: !beatSurface.atmosphereEnabled(),
          },
        ]),
        onSelect: (option) => { beatSurface.setAtmosphereEnabled(option.id === 'on') },
      },
    }
    const disposeAtmosphereCommand = ctx.commandUi.register(atmosphereCommand)

    return () => {
      disposeAtmosphereCommand()
      disposeSurface()
      disposeStyles()
    }
  }, 'dsh-bgm: conversation beat surface')
}

export { BeatSurface } from './BeatSurface.ts'
