# dsh-bgm

面向 DSH Web 的跨平台系统音乐状态与节奏动画插件。

插件直接采集默认系统输出，不依赖具体播放器，因此 QQ 音乐、网易云音乐、浏览器和其他应用共用同一条音频链路。原始 PCM 仅在本机原生助手的内存中计算，随后只把音量、低频、中频、高频和鼓点强度传给 DSH Web，不录音、不落盘。

它不会添加右下角播放器，也不会改变最终回答、背景或页面亮度。音乐响起后，只有 Deep Diving 和当前最新一行中稳定的状态标题（如 Think、Read、上下文注入）会以逐字波浪响应；标题后方持续变化的摘要不会进入动画。波动方向按四拍乐句保持稳定，并根据音乐特征在左到右、中心向外、外侧向内、上到下之间切换。

视觉层不改写 React 的文本节点，Markdown、复制、链接和无障碍文本仍由 DSH 官方组件负责；屏幕阅读器专用的“运行中”等隐藏状态不会被错误绘制到对话区。

## 技术栈

- DSH Host：TypeScript + Cordis
- DSH Web：React + TypeScript/TSX
- macOS Helper：Swift 6 + Core Audio Process Tap
- Windows Helper：C# / .NET 8 + WASAPI 回环采集（NAudio 2.3.0）

## 开发

```sh
git clone <repository-url> dsh-bgm
cd dsh-bgm
pnpm install
pnpm run build
```

## 安装到 DSH Web

```sh
dsh plugin --profile web add link:.
```

重启 `dsh web` 后播放系统声音，再发起一次对话即可观察对话区的逐字节奏效果。

macOS 首次启动可能请求“系统音频录制”权限。Windows 版本需要在 Windows 机器上执行一次 `pnpm run build:native`，生成自包含的原生助手。
