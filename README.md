# dsh-bgm

Cross-platform system-audio rhythm status for DSH Web.

The plugin captures the default system output independently of the player, so
QQ Music, NetEase Cloud Music, browser playback and other apps use the same
path. The Host reduces raw PCM to RMS/bass/mid/treble/onset frames and publishes
them over a loopback-only SSE endpoint. DSH Web mirrors active conversation
text in a pointer-transparent per-grapheme beat layer. Deep Diving and the
latest active reasoning, tool or context-injection row form one glyph lane.
Streaming summaries continuously join the active wave at its current phase;
they never restart it, and clipped text never enters the lane. Each slower
wave is allowed to cross most of the row before the next begins. Glyphs compress, rebound and land
in an audio-seeded, non-repeating chart: left-to-right, right-to-left,
inside-out, outside-in, up, down, alternating, snake or split.
Final answers, the page background and brightness remain unchanged.
Each hit is a discrete wave rather than continuous line jitter. Screen-reader
only labels remain accessible and are excluded from the visual mirror. Raw
audio is never persisted or sent to the browser.

- macOS: Swift 6 + Core Audio Process Tap.
- Windows: C#/.NET 8 + WASAPI loopback through NAudio 2.3.0.
- DSH Host/Web: the official TypeScript + React plugin stack.

## Development

```sh
git clone <repository-url> dsh-bgm
cd dsh-bgm
pnpm install
pnpm run build
```

## Install into DSH Web

```sh
dsh plugin --profile web add link:.
```
