# dsh-bgm

Cross-platform system-audio rhythm status for DSH Web.

The plugin captures the default system output independently of the player, so
QQ Music, NetEase Cloud Music, browser playback and other apps use the same
path. The Host reduces raw PCM to RMS/bass/mid/treble/onset frames and publishes
them over a loopback-only SSE endpoint. Stable activity rows use a
pointer-transparent per-grapheme surface, while streaming text remains wholly
React-painted and receives only independent lane effects. Deep Diving is a
downbeat lane driven by bass/onset, while the latest reasoning, tool or
context-injection row is an independent flow lane driven by mid/treble change.
Deep Diving retains about 60 downbeat combinations. Stable activity text is
one continuous BPM-locked wave surface: valley, peak, travelling sine, saw or
centre-out burst.
Every glyph shares one timeline and a smooth position-derived height, so no
character can detach into an independent trajectory. A fast-attack,
slow-release RMS envelope continuously controls flow amplitude, glyph breathing,
note-trail opacity and tracer brightness even between detected hits.
Below a 500ms measured period, moving sine/burst surfaces become more likely;
below 350ms a cue runs two phase cycles. Strong burst hits also emit two short
local rays from the row centre toward its edges, never a page flash.

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
bursts plus accuracy. A flow wave completes its phase over the measured
`period`: high-confidence pulses reach 18–24px, medium pulses 11–15px and weak
or fallback pulses remain a subtle 5–8px. All glyphs compress and rebound on
the same frames without horizontal movement or per-character delay.
Independent
grade words burst from the judgement point, hit rings expand on successful
notes, while the struck note compresses then snaps open in 150–190ms. A 45ms
hitstop pauses only plugin-owned effects—the conversation and page never
freeze. Combo 5/10/25 unlocks stronger local impacts, gold outlines and gold
trails. Milestone words appear at 5/10/25/50. Only an expected pulse that
expires without a nearby detection
resets Combo.
When system audio stays silent for 700ms, a session with at least one judgement
ends on a local 3.2-second result card. It shows the final seven-digit score,
S/A/B/C/D rank, accuracy, PERFECT/GREAT/GOOD/MISS counts and maximum Combo.
The snapshot clears only after the card finishes; resumed audio dismisses and
resets the old result before starting a new session.
Very short Bash/Read calls trigger an immediate entry wave and retain only their
latest row for 1.6 seconds, so their rhythm-game feedback survives completion.
Running/streaming activity stays React-painted: it is never masked or mirrored
per glyph, so token updates cannot restart text animation. Its real DOM row
rises by at most 3px and stretches by at most 1.5% with the volume envelope,
while a local underline, music-note projectile and judgement line carry the
rhythm. Once the row becomes stable, its continuous BPM wave surface is enabled.
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
