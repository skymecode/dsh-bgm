# dsh-bgm · DSH 音乐律动插件

中文 | [English](README.en.md)

<p align="center">
  <img src="docs/dsh-bgm-banner.jpg" alt="dsh-bgm 音乐律动与音游反馈" width="100%">
</p>

<p align="center">
  <a href="https://github.com/skymecode/dsh-bgm/releases/latest"><img src="https://img.shields.io/github/v/release/skymecode/dsh-bgm?style=flat-square" alt="Release"></a>
  &nbsp;
  <a href="https://github.com/skymecode/dsh-bgm/actions/workflows/ci.yml"><img src="https://github.com/skymecode/dsh-bgm/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  &nbsp;
  <img src="https://img.shields.io/badge/DSH-0.1.0--rc.7-4f7cff?style=flat-square" alt="DSH 0.1.0-rc.7">
  &nbsp;
  <img src="https://img.shields.io/badge/macOS-14.2%2B-111111?style=flat-square" alt="macOS 14.2+">
  &nbsp;
  <img src="https://img.shields.io/badge/Windows-10%2F11-0078d4?style=flat-square" alt="Windows 10/11">
  &nbsp;
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue?style=flat-square" alt="MIT License"></a>
</p>

<p align="center">
  <strong>让 DSH Web 的思考、工具调用与上下文注入真正进入音乐节奏。</strong><br>
  <em>系统音频采集 · 连续文字波面 · 音游判定 · RGB 氛围柱 · 四幕结算</em>
</p>

<div align="center">

[是什么](#是什么) · [一键安装](#一键安装) · [主要效果](#主要效果) · [工作方式](#工作方式) · [隐私与性能](#隐私与性能) · [常见问题](#常见问题) · [开发](#开发)

</div>

> 顶部图片是 dsh-bgm 的品牌视觉横幅，不是伪装成实测截图的 UI 合成图。插件效果是实时动画，静态画面无法完整呈现节拍、波面和命中反馈。

## 是什么

dsh-bgm 是一个直接装入官方 DSH Web profile 的跨平台插件。它监听电脑正在输出的系统声音，而不是适配某个播放器，因此 QQ 音乐、网易云音乐、浏览器、游戏和其他音频应用都走同一条链路。

插件不提供独立播放器，也不会在页面角落放一个普通音柱。它把音乐能量映射到智能体当前正在工作的那一行：Deep Diving 使用低频与起音，Think、Read、Bash、工具调用和上下文注入使用中高频变化；最终回答正文保持稳定可读。

| 能力 | 原生 DSH Web | 安装 dsh-bgm 后 |
| --- | --- | --- |
| 系统音乐感知 | 无 | 默认输出设备的 RMS、低/中/高频与起音 |
| 活动状态 | 静态文字 | 连续 BPM 波面、方向变化与强弱分层 |
| 音游反馈 | 无 | 预测音符、判定线、Combo、Score、Accuracy |
| 宽屏留白 | 空白 | 左右各 12 根 RGB 氛围律动柱 |
| 回答完成 | 正常结束 | 3.2 秒透明四幕结算表演 |
| 播放器兼容 | 需要逐个适配 | 与播放器无关，直接读取系统输出 |

## 一键安装

需要已安装官方 DSH `0.1.0-rc.7`。Release 提供同时包含 macOS 通用原生助手和 Windows x64 自包含助手的预构建包；安装时无需克隆仓库，也无需授权执行 Git `prepare` 脚本。

```sh
dsh plugin --profile web add https://github.com/skymecode/dsh-bgm/releases/latest/download/dsh-bgm.tgz
```

然后重新启动官方 Web UI：

```sh
dsh web
```

播放任意系统声音，再发起一次对话即可。安装命令完全使用 DSH 官方 profile 插件通道；CI 会在每次发布前把同一个 tarball 装入全新的官方 `web` profile，并检查 `dsh-bgm` Host 与 Client 配置层确实挂载。

### 固定版本安装

生产环境建议固定版本，避免 `latest` 在以后指向新版本：

```sh
dsh plugin --profile web add https://github.com/skymecode/dsh-bgm/releases/download/v0.1.0/dsh-bgm.tgz
```

### 卸载

```sh
dsh plugin --profile web remove dsh-bgm
```

### 平台说明

- **macOS**：支持 Apple Silicon 与 Intel，最低 macOS 14.2；首次运行会请求系统音频录制权限。
- **Windows**：支持 Windows 10/11 x64；Release 内置自包含助手，不要求用户另装 .NET。
- **Linux**：当前没有系统回环采集助手，插件会安静地进入 unsupported 状态，不会反复重启。

## 主要效果

### 活动文字变成连续波面

稳定的活动行不是让每个字各自乱跑，而是把整行文字视为一个连续曲面。相邻字共享同一时间轴，按 BPM 形成 valley、peak、行进正弦、斜坡和由内向外 burst；强拍、中拍和弱拍分别使用不同幅度，实时音量包络继续控制拍间呼吸。

流式中的 Think/工具文字不会被逐字复制或反复重建。原始 React 文本照常流式更新，独立节奏层负责整体呼吸、光迹和预测音符，因此不会出现字覆盖整行、跑到上方或把浏览器拖死的问题。

### 音符逼近与局部命中

检测器积累可靠周期后，音符从活动行尾向左侧判定线飞行，飞行时间锁定 BPM。命中点只产生局部反馈：压缩回弹、双环、粒子、判定词飘字和短促 hitstop；页面、对话背景和最终回答不会闪屏。

GOOD / GREAT / PERFECT 会累计 Combo、七位 Score 与 Accuracy。窗外瞬态只重锚节拍，不直接制造 MISS；只有预测拍真正超时才会重置 Combo。

### 左右 RGB 氛围柱

宽屏时，官方对话列外的左右留白会各出现 12 根对称 RGB 频谱柱。它们只更新 GPU 合成层的高度与透明度，不重建 DOM，也不覆盖正文。窄屏或空间不足时自动隐藏。

氛围柱默认开启。点击输入框左下角 `+`，在官方命令菜单中选择 `/bgm-atmosphere`，即可开启或关闭；选择会保存在浏览器本地。

### 四幕音游结算

最终回答完成且本轮产生过判定时，会播放约 3.2 秒的透明结算表演：

1. 七位 SCORE 高速滚动并减速落定；
2. S/A/B/C/D 评级通过局部冲击环与粒子爆发入场；
3. 评级色音符从视口顶部错峰落下；
4. PERFECT、GREAT、GOOD、MISS、ACC 与最大 Combo 逐项点亮。

音乐停止、暂停或切歌只做静默清理，不会突然弹出结算。

## 工作方式

```text
系统默认输出
  ├─ macOS: Core Audio Process Tap
  └─ Windows: WASAPI Loopback / NAudio
              ↓
原生助手在本机内存中计算 RMS / bass / mid / treble / onset
              ↓ loopback-only SSE
DSH Host 插件 ───────────────→ DSH Web Client
                                  ├─ Deep Diving 鼓点轨
                                  ├─ 当前活动行信息流轨
                                  ├─ 判定 / Score / Combo
                                  └─ 左右 RGB 氛围柱
```

Deep Diving 与当前活动行使用两条独立节奏源：前者强调低频鼓点，后者强调旋律与中高频变化。最终回答开始流式输出时，文字与判定层立即暂停；可选的左右氛围柱仍可继续跟随音乐。

## 隐私与性能

- 原始 PCM 只存在于本机原生助手内存中，不录音、不落盘、不上传。
- 浏览器只收到压缩后的五个节奏数值和时间戳。
- SSE 端点只绑定 DSH 本机 Web 服务链路。
- 氛围柱固定为 24 个 DOM 节点，只改变 `transform` 与 `opacity`。
- 流式文字不建立逐字镜像；最终回答正文完全不参与动画。
- `prefers-reduced-motion` 开启时会关闭主要动态效果。

## 常见问题

### 一直显示“等待系统音频”

macOS 请在“系统设置 → 隐私与安全性 → 屏幕与系统音频录制”中允许 DSH 使用系统音频，然后完整退出并重新运行 `dsh web`。Windows 请确认当前默认输出设备正在播放声音。

### QQ 音乐和网易云音乐需要分别适配吗？

不需要。dsh-bgm 读取默认系统输出，只要声音最终通过当前电脑输出设备播放，就使用同一条检测链路。

### 为什么最终回答不跟着跳？

这是有意设计。最终结论承担阅读与复制，流式正文保持稳定；节奏只作用于 Deep Diving、最新活动状态、局部判定和可选的左右氛围柱。

### 安装后如何确认已经挂载？

```sh
dsh web --dump-config
```

输出中应出现 `# == dsh-bgm` 和 `name: dsh-bgm`。也可以在浏览器开发者工具的网络面板确认 `/plugins/dsh-bgm/client.js` 返回成功。

### 如何校验下载包？

每个 GitHub Release 同时发布 `SHA256SUMS.txt`。下载后执行：

```sh
shasum -a 256 -c SHA256SUMS.txt
```

Windows PowerShell 可使用 `Get-FileHash .\dsh-bgm.tgz -Algorithm SHA256` 与文件中的值对照。

## 开发

```sh
git clone https://github.com/skymecode/dsh-bgm.git
cd dsh-bgm
pnpm install
pnpm run typecheck
pnpm run build
dsh plugin --profile web add link:.
```

本地源码安装会按当前系统构建原生助手。GitHub Actions 的 CI 覆盖 TypeScript 类型检查、Host/Client 构建、macOS universal 与 Windows x64 原生构建、npm tarball 内容检查，以及纯净官方 DSH Web profile 的真实挂载。推送 `v*` Tag 后，Release 工作流会组合两个平台的预构建助手，生成稳定资产 `dsh-bgm.tgz` 和校验文件，再创建 GitHub Release。

## 许可证

[MIT](LICENSE)。Windows 音频助手使用 NAudio，第三方许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
