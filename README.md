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

The first reliable flow pulse bootstraps a 640ms prediction, then measured
intervals continuously refine it. The latest activity row becomes a judgement
lane: a glyph launches from its trailing edge toward a fixed leading line at
`lastHit + period`; travel is BPM-locked to `clamp(period * 0.75, 350ms, 900ms)`.
Detected mid/treble confidence grades the arrival as GOOD, GREAT or PERFECT, so
the note lane and the row wave share one clock while Deep Diving stays on the
bass/onset clock. Hits build Combo and a seven-digit score with local point
bursts plus accuracy. Independent grade words burst from the judgement point,
hit rings expand on successful notes, and 10/25/50 Combo milestones turn the
line gold. An expected pulse that misses its timing window resets Combo.
Very short Bash/Read calls trigger an immediate entry wave and retain only their
latest row for 1.6 seconds, so their rhythm-game feedback survives completion.
Final answers never animate: once the official final-text stream begins, the
visual layer tears down and ignores subsequent token mutations. True downbeats
add only a transient 2.2–4% soft conversation-layer glow; there is no
full-screen white flash.
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
