# dsh-bgm

面向 DSH Web 的跨平台系统音乐状态与节奏动画插件。

插件直接采集默认系统输出，不依赖具体播放器，因此 QQ 音乐、网易云音乐、浏览器和其他应用共用同一条音频链路。原始 PCM 仅在本机原生助手的内存中计算，随后只把音量、低频、中频、高频和鼓点强度传给 DSH Web，不录音、不落盘。

它不会添加右下角播放器，也不会改变最终回答、背景或页面亮度。Deep Diving 和当前活动行使用两条独立音轨：Deep Diving 由低频鼓点与起音触发，动作短、重、接近音游判定反馈；Think、Read、工具与上下文注入由中高频变化和旋律瞬态触发，形成较慢的信息流编舞。流式摘要持续更新时会接入当前信息波已经走到的相位，而不是重新开始动画；滚动区外的文字不会进入轨道。

动作不再来自少量固定模板，而是组合“触发顺序 × 运动轨迹 × 击打手感”。鼓点轨约有 60 种组合，信息流轨超过 200 种：可组合同时、左右、内外、奇偶或随机顺序，跳起、下落、分裂、聚合、交错、蛇形、阶梯、扇形或环绕轨迹，以及快速、回弹或蓄力手感；同一组合不会连续出现。

鼓点检测得到至少两个可靠拍间隔后，最新活动行左缘会成为判定线。下一拍按 `lastHit + period` 预测，音符提前 `clamp(period × 0.75, 350ms, 900ms)` 从行尾飞向左侧，并在预测拍到达判定线。真实起音落入动态判定窗时按检测置信度显示 GOOD、GREAT 或 PERFECT，连续命中累积 Combo；预测拍超时未检测到起音则显示 MISS 并重置 Combo。

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
