import Foundation
import Darwin

private struct ReadyEvent: Encodable {
    let type = "ready"
    let platform = "darwin"
    let sampleRate: Double
    let channels: UInt32
}

private struct RhythmEvent: Encodable {
    let type = "rhythm"
    let frame: RhythmFrame
}

private struct ErrorEvent: Encodable {
    let type = "error"
    let code: String
    let message: String
}

private final class Output: @unchecked Sendable {
    private let queue = DispatchQueue(label: "com.dsh.bgm.output")
    private let encoder = JSONEncoder()

    func send<T: Encodable>(_ value: T) {
        queue.sync {
            guard let data = try? encoder.encode(value) else { return }
            FileHandle.standardOutput.write(data)
            FileHandle.standardOutput.write(Data([0x0a]))
        }
    }
}

@main
struct DshBgmHelper {
    private static let output = Output()
    private static var tap: SystemAudioTap?
    private static var frameTimer: DispatchSourceTimer?
    private static var signalSources: [DispatchSourceSignal] = []

    static func main() {
        do {
            let audioTap = SystemAudioTap()
            let analyzer = try audioTap.start { RhythmAnalyzer(sampleRate: $0) }
            tap = audioTap
            output.send(ReadyEvent(
                sampleRate: audioTap.format.mSampleRate,
                channels: audioTap.format.mChannelsPerFrame
            ))

            let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "com.dsh.bgm.frames"))
            timer.schedule(deadline: .now(), repeating: .milliseconds(50), leeway: .milliseconds(5))
            timer.setEventHandler {
                output.send(RhythmEvent(frame: analyzer.takeFrame()))
            }
            timer.resume()
            frameTimer = timer
            installSignalHandlers()
            dispatchMain()
        } catch {
            output.send(ErrorEvent(code: "audio-start", message: error.localizedDescription))
            exit(1)
        }
    }

    private static func installSignalHandlers() {
        for code in [SIGINT, SIGTERM] {
            signal(code, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: code, queue: .main)
            source.setEventHandler { shutdown() }
            source.resume()
            signalSources.append(source)
        }
    }

    private static func shutdown() {
        frameTimer?.cancel()
        frameTimer = nil
        tap?.stop()
        tap = nil
        exit(0)
    }
}
