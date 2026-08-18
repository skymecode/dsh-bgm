# dsh-bgm

面向 DSH Web 的跨平台系统音乐状态与节奏动画插件。

插件直接采集默认系统输出，不依赖具体播放器，因此 QQ 音乐、网易云音乐、浏览器和其他应用共用同一条音频链路。原始 PCM 仅在本机原生助手的内存中计算，随后只把音量、低频、中频、高频和鼓点强度传给 DSH Web，不录音、不落盘。

它不会添加右下角播放器，也不会让最终回答参与动画；识别到官方最终正文流后会立即拆除视觉层，并忽略后续 token 的 DOM 变化。Deep Diving 和当前活动行使用两条独立音轨：Deep Diving 由低频鼓点与起音触发，动作短、重、接近音游判定反馈；Think、Read、工具与上下文注入由中高频变化和旋律瞬态触发，形成较慢的信息流编舞。流式摘要持续更新时会接入当前信息波已经走到的相位，而不是重新开始动画；滚动区外的文字不会进入轨道。所有反馈只作用于活动文字、判定线、命中环和命中点附近的小块键帽区域，页面与对话背景永远不会随节拍闪烁。

Deep Diving 鼓点轨保留“触发顺序 × 运动轨迹 × 击打手感”的约 60 种组合。信息流轨不再套用固定整行编舞，而是使用一条从行尾向判定线推进的 BPM 乐谱扫描。

信息流至少积累两个可靠拍间隔后才显示判定线，不再使用硬编码的默认速度；下一拍按 `lastHit + period` 预测，带光学拖尾的音符提前 `clamp(period × 0.75, 350ms, 900ms)` 从最新活动行尾飞向左侧，并在预测拍到达判定线。窗外 detected 只会静默重锚节拍网格，不再直接判 MISS；附近的 melodic fallback 会以降权 GOOD 结算。判定音符与活动文字统一使用中高频信息流时钟，Deep Diving 则继续独立使用低频鼓点时钟，两套节奏不在同一行叠加。信息流的逐字间隔严格绑定当前实测周期：`clamp(period / glyphCount, 18ms, 60ms)`，从行尾向左依次推进。中拍逐字点亮并弹起，交替闸门选出的高置信度强拍让所有文字同拍猛敲，弱拍与 fallback 只让轻微的行内扫描痕迹通过，完全不移动、不点亮文字。命中瞬间，局部键帽和判定线会在约 8ms 内硬压、140ms 内回弹，同时产生扩散环。连续命中累积 Combo、七位分数、准确率和局部加分弹字：5 Combo 增强局部冲击，10 Combo 浮现金色描边，25 Combo 增加金色拖尾，并在 5/10/25/50 显示对应里程碑。只有预测拍超时且窗口内确实没有检测时才显示一次 MISS 并重置 Combo。极短的 Bash/Read 会在出现时立即触发一次入场扫描，并只保留最新一行 1.6 秒，让任务完成后仍有足够时间呈现音游反馈。

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
