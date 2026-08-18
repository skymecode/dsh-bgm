import { spawn, type ChildProcess } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {
  BgmNativeEvent,
  BgmPlatform,
  BgmSnapshot,
  RhythmFrame,
} from '../core/types.ts'

export type SnapshotListener = (snapshot: BgmSnapshot) => void

const STOP_GRACE_MS = 5_000
const RESTART_DELAY_MS = 1_000

function platformOf(value: NodeJS.Platform = process.platform): BgmPlatform {
  if (value === 'darwin' || value === 'win32' || value === 'linux') return value
  return 'unknown'
}

function helperExecutable(): string | undefined {
  const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
  if (process.platform === 'darwin') {
    return join(packageRoot, 'native', 'bin', 'dsh-bgm-helper-macos')
  }
  if (process.platform === 'win32') {
    return join(packageRoot, 'native', 'bin', 'dsh-bgm-helper-windows.exe')
  }
  return undefined
}

function isFiniteUnit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function rhythmFrame(value: unknown): RhythmFrame | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const frame = value as Record<string, unknown>
  if (typeof frame.capturedAt !== 'number' || !Number.isFinite(frame.capturedAt)) return undefined
  if (!isFiniteUnit(frame.rms) || !isFiniteUnit(frame.bass) || !isFiniteUnit(frame.mid)
    || !isFiniteUnit(frame.treble) || !isFiniteUnit(frame.onset)) return undefined
  return frame as unknown as RhythmFrame
}

function nativeEvent(line: string): BgmNativeEvent | undefined {
  let value: unknown
  try {
    value = JSON.parse(line) as unknown
  } catch {
    return undefined
  }
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as Record<string, unknown>
  switch (record.type) {
    case 'ready':
      if ((record.platform === 'darwin' || record.platform === 'win32' || record.platform === 'linux')
        && typeof record.sampleRate === 'number' && typeof record.channels === 'number') {
        return record as unknown as BgmNativeEvent
      }
      return undefined
    case 'rhythm': {
      const frame = rhythmFrame(record.frame)
      return frame === undefined ? undefined : { type: 'rhythm', frame }
    }
    case 'permission':
      return typeof record.granted === 'boolean'
        ? { type: 'permission', granted: record.granted, ...(typeof record.reason === 'string' ? { reason: record.reason } : {}) }
        : undefined
    case 'error':
      return typeof record.code === 'string' && typeof record.message === 'string'
        ? { type: 'error', code: record.code, message: record.message }
        : undefined
    default:
      return undefined
  }
}

/** Lazily starts one platform helper while at least one browser subscribes. */
export class BgmHelperManager {
  private readonly listeners = new Set<SnapshotListener>()
  private child: ChildProcess | undefined
  private stopTimer: NodeJS.Timeout | undefined
  private restartTimer: NodeJS.Timeout | undefined
  private stopping = false
  private snapshotValue: BgmSnapshot = {
    platform: platformOf(),
    status: 'starting',
    updatedAt: Date.now(),
  }

  constructor(private readonly ctx: Context) {}

  snapshot(): BgmSnapshot {
    return this.snapshotValue
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener)
    listener(this.snapshotValue)
    if (this.stopTimer !== undefined) {
      clearTimeout(this.stopTimer)
      this.stopTimer = undefined
    }
    this.ensureStarted()
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0 && this.stopTimer === undefined) {
        this.stopTimer = setTimeout(() => {
          this.stopTimer = undefined
          if (this.listeners.size === 0) this.stop()
        }, STOP_GRACE_MS)
      }
    }
  }

  dispose(): void {
    this.stopping = true
    if (this.stopTimer !== undefined) clearTimeout(this.stopTimer)
    if (this.restartTimer !== undefined) clearTimeout(this.restartTimer)
    this.stopTimer = undefined
    this.restartTimer = undefined
    this.stop()
    this.listeners.clear()
  }

  private publish(patch: Partial<BgmSnapshot>): void {
    this.snapshotValue = { ...this.snapshotValue, ...patch, updatedAt: Date.now() }
    for (const listener of this.listeners) listener(this.snapshotValue)
  }

  private ensureStarted(): void {
    if (this.child !== undefined || this.stopping) return
    const executable = helperExecutable()
    if (executable === undefined) {
      this.publish({ status: 'unsupported', error: `unsupported platform: ${process.platform}` })
      return
    }
    try {
      accessSync(executable, constants.X_OK)
    } catch {
      this.publish({ status: 'error', error: `native helper missing or not executable: ${executable}` })
      return
    }

    this.publish({ status: 'starting', error: undefined, frame: undefined })
    const child = spawn(executable, [], { stdio: ['ignore', 'pipe', 'pipe'] })
    this.child = child

    const stdout = child.stdout
    if (stdout !== null) {
      const lines = createInterface({ input: stdout, crlfDelay: Infinity })
      lines.on('line', (line) => {
        const event = nativeEvent(line)
        if (event === undefined) {
          if (line.trim() !== '') this.ctx.logger.warn(`dsh-bgm: malformed helper line: ${line.slice(0, 240)}`)
          return
        }
        this.handle(event)
      })
    }
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      const message = chunk.trim()
      if (message !== '') this.ctx.logger.warn(`dsh-bgm helper: ${message}`)
    })
    child.on('error', (error) => {
      this.publish({ status: 'error', error: error.message })
    })
    child.on('exit', (code, signal) => {
      if (this.child === child) this.child = undefined
      if (this.stopping || this.listeners.size === 0) return
      this.publish({ status: 'error', error: `native helper exited (${signal ?? code ?? 'unknown'})` })
      this.restartTimer = setTimeout(() => {
        this.restartTimer = undefined
        this.ensureStarted()
      }, RESTART_DELAY_MS)
    })
  }

  private handle(event: BgmNativeEvent): void {
    switch (event.type) {
      case 'ready':
        this.publish({ platform: event.platform, status: 'listening', error: undefined })
        return
      case 'rhythm':
        this.publish({ status: 'listening', frame: event.frame, error: undefined })
        return
      case 'permission':
        this.publish({
          status: event.granted ? 'starting' : 'permission-denied',
          error: event.granted ? undefined : event.reason ?? 'system audio permission denied',
        })
        return
      case 'error':
        this.publish({ status: event.code === 'permission-denied' ? 'permission-denied' : 'error', error: event.message })
        return
      case 'now-playing':
        this.publish({ nowPlaying: event.state })
    }
  }

  private stop(): void {
    if (this.restartTimer !== undefined) clearTimeout(this.restartTimer)
    this.restartTimer = undefined
    const child = this.child
    this.child = undefined
    if (child !== undefined && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  }
}
