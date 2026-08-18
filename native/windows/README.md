# Windows helper

Implemented in C# on .NET 8 and published as a self-contained single-file
executable when `pnpm run build:native` runs on Windows.

Platform APIs:

- WASAPI loopback capture for all audio sent to the default output device.
- 20 Hz RMS, bass, mid, treble and onset frames over the shared NDJSON protocol.

NAudio 2.3.0 provides the maintained .NET binding over WASAPI. Raw samples are
analyzed in memory and never written to disk.
