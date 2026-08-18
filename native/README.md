# Native helper boundary

The DSH plugin itself stays in the official TypeScript + React stack. Native
helpers are isolated here because system-audio and global media-session APIs
are operating-system facilities.

Each helper writes newline-delimited JSON matching `src/core/types.ts` to
stdout. Raw PCM must remain inside the helper and must never be persisted or
sent to the DSH browser.

- `macos/`: Swift and Core Audio Tap / system Now Playing integration.
- `windows/`: C# and WASAPI loopback / GSMTC integration.
