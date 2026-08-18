# dsh-bgm

Cross-platform system-audio rhythm status for DSH Web.

The plugin captures the default system output independently of the player, so
QQ Music, NetEase Cloud Music, browser playback and other apps use the same
path. The Host reduces raw PCM to RMS/bass/mid/treble/onset frames and publishes
them over a loopback-only SSE endpoint. DSH Web mirrors active conversation
text in a pointer-transparent per-grapheme beat layer. Deep Diving is a
downbeat lane driven by bass/onset, while the latest reasoning, tool or
context-injection row is an independent flow lane driven by mid/treble change.
Streaming summaries continuously join the measured flow chart at its current
phase; they never restart it, and clipped text never enters the lane. Deep
Diving retains about 60 downbeat combinations. Activity rows restore more than
200 left/right, up/down, center-out, edges-in, split/converge and attack-style
combinations, with propagation timing taken from the measured BPM.

The judgement lane stays hidden until two reliable flow intervals establish a
measured period; there is no hard-coded bootstrap tempo. A glyph then launches
from the latest activity row's trailing edge toward a fixed leading line at
`lastHit + period`; travel is BPM-locked to `clamp(period * 0.75, 350ms, 900ms)`.
The cloned glyph accelerates into the line with a same-color comet trail. Hits
stay local to the judgement point: GOOD/GREAT/PERFECT emit 6/8/10 colored
particles plus two colored ripple rings with a low-opacity radial core—never a
white page flash.
Detected mid/treble confidence grades the arrival as GOOD, GREAT or PERFECT;
out-of-window detections silently re-anchor the grid, while melodic fallback
pulses can settle a nearby note as a reduced-confidence GOOD. The note lane and
the row wave share one clock while Deep Diving stays on the bass/onset clock.
Hits build Combo and a seven-digit score with local point
bursts plus accuracy. Flow chart propagation uses
`clamp(period / glyphCount, 18ms, 60ms)` per glyph. Medium pulses run the
selected spatial chart; high-confidence pulses hit the whole row together
using its selected motion, while
weak or fallback pulses retain the scan with a small 5–8px glyph bounce.
Independent
grade words burst from the judgement point, hit rings expand on successful
notes, and Combo 5/10/25 unlocks stronger local impacts, gold outlines and gold
trails. Milestone words appear at 5/10/25/50. Only an expected pulse that
expires without a nearby detection
resets Combo.
Very short Bash/Read calls trigger an immediate entry wave and retain only their
latest row for 1.6 seconds, so their rhythm-game feedback survives completion.
Running/streaming activity stays React-painted: it is never masked or mirrored
per glyph, so token updates cannot restart text animation. During that phase a
small music-note projectile, judgement line and independent row tracer carry
the rhythm. Once the row becomes stable, its full BPM chart choreography is
enabled again.
Final answers never animate: once the official final-text stream begins, the
visual layer tears down and ignores subsequent token mutations. Hits use only
activity-text, judgement-line, ring and small local keycap feedback; the page
and conversation background never pulse or flash.
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
