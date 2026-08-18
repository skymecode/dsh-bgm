# macOS helper

Implemented in Swift 6 and compiled by `pnpm run build:native` on macOS.

Platform APIs:

- Core Audio Process Tap for all outgoing-audio analysis.
- 20 Hz RMS, bass, mid, treble and onset frames over the shared NDJSON protocol.

The local build is ad-hoc signed. Release packaging can compile both Apple
Silicon and Intel slices into a universal binary.
