# dsh-bgm

Cross-platform system-audio rhythm status for DSH Web.

The plugin captures the default system output independently of the player, so
QQ Music, NetEase Cloud Music, browser playback and other apps use the same
path. The Host reduces raw PCM to RMS/bass/mid/treble/onset frames and publishes
them over a loopback-only SSE endpoint. DSH Web mirrors active conversation
text in a pointer-transparent per-grapheme beat layer. Deep Diving is a
downbeat lane driven by bass/onset, while the latest reasoning, tool or
context-injection row is an independent flow lane driven by mid/treble change.
Streaming summaries continuously join their active wave at its current phase;
they never restart it, and clipped text never enters the lane. Choreography is
composed from trigger order, motion path and attack feel, yielding about 60
downbeat combinations and more than 200 non-repeating flow combinations.

After two reliable beat intervals, the latest activity row becomes a judgement
lane. A glyph launches from its trailing edge toward a fixed leading line at
`lastHit + period`; travel is BPM-locked to `clamp(period * 0.75, 350ms, 900ms)`.
Detected onset confidence grades the arrival as GOOD, GREAT or PERFECT. Hits
build Combo, while an expected beat that misses its timing window resets it.
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
