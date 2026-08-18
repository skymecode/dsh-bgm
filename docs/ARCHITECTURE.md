# dsh-bgm architecture

## Language boundary

The DSH-facing package follows the official DSH rc.7 stack:

- TypeScript for the Host Cordis plugin.
- React + TSX for the DSH Web client.
- `cordis.patch.yml` and the `dsh.bundle` manifest for profile composition.
- The `dsh.client` manifest for browser loading.

Operating-system audio APIs stay behind native helper processes. This prevents
platform libraries from leaking into the DSH process and gives macOS and
Windows independent packaging, permission and crash boundaries.

## Event flow

```text
native helper -> NDJSON -> DSH Host service -> same-origin SSE -> Web client
```

Only reduced rhythm values and media metadata cross the native boundary. Raw
audio samples are analyzed in memory and discarded.
