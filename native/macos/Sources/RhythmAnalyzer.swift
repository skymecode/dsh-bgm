import Foundation
import CoreAudio

struct RhythmFrame: Encodable {
    let capturedAt: Double
    let rms: Double
    let bass: Double
    let mid: Double
    let treble: Double
    let onset: Double
}

final class RhythmAnalyzer: @unchecked Sendable {
    private let lock = NSLock()
    private let sampleRate: Double
    private let lowAlpha: Float
    private let midAlpha: Float

    private var lowState: Float = 0
    private var midState: Float = 0
    private var squareSum: Double = 0
    private var bassSum: Double = 0
    private var midSum: Double = 0
    private var trebleSum: Double = 0
    private var sampleCount: Int = 0
    private var envelope: Double = 0

    init(sampleRate: Double) {
        self.sampleRate = sampleRate
        self.lowAlpha = Float(1 - exp(-2 * Double.pi * 180 / sampleRate))
        self.midAlpha = Float(1 - exp(-2 * Double.pi * 2_500 / sampleRate))
    }

    func consume(_ input: UnsafePointer<AudioBufferList>, format: AudioStreamBasicDescription) {
        guard format.mFormatID == kAudioFormatLinearPCM else { return }
        let isFloat = (format.mFormatFlags & kAudioFormatFlagIsFloat) != 0
        let bits = Int(format.mBitsPerChannel)
        let list = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: input))

        lock.lock()
        defer { lock.unlock() }

        for buffer in list {
            guard let data = buffer.mData else { continue }
            let bytes = Int(buffer.mDataByteSize)
            if isFloat && bits == 32 {
                let values = data.bindMemory(to: Float.self, capacity: bytes / MemoryLayout<Float>.size)
                analyze(values, count: bytes / MemoryLayout<Float>.size)
            } else if !isFloat && bits == 16 {
                let values = data.bindMemory(to: Int16.self, capacity: bytes / MemoryLayout<Int16>.size)
                for index in 0..<(bytes / MemoryLayout<Int16>.size) {
                    analyzeSample(Float(values[index]) / Float(Int16.max))
                }
            } else if !isFloat && bits == 32 {
                let values = data.bindMemory(to: Int32.self, capacity: bytes / MemoryLayout<Int32>.size)
                for index in 0..<(bytes / MemoryLayout<Int32>.size) {
                    analyzeSample(Float(values[index]) / Float(Int32.max))
                }
            }
        }
    }

    private func analyze(_ values: UnsafeMutablePointer<Float>, count: Int) {
        for index in 0..<count { analyzeSample(values[index]) }
    }

    private func analyzeSample(_ raw: Float) {
        let sample = raw.isFinite ? max(-1, min(1, raw)) : 0
        lowState += lowAlpha * (sample - lowState)
        midState += midAlpha * (sample - midState)
        let bass = lowState
        let mid = midState - lowState
        let treble = sample - midState
        squareSum += Double(sample * sample)
        bassSum += Double(bass * bass)
        midSum += Double(mid * mid)
        trebleSum += Double(treble * treble)
        sampleCount += 1
    }

    func takeFrame() -> RhythmFrame {
        lock.lock()
        let count = max(1, sampleCount)
        let rawRms = sqrt(squareSum / Double(count))
        let rawBass = sqrt(bassSum / Double(count))
        let rawMid = sqrt(midSum / Double(count))
        let rawTreble = sqrt(trebleSum / Double(count))
        squareSum = 0
        bassSum = 0
        midSum = 0
        trebleSum = 0
        sampleCount = 0
        lock.unlock()

        envelope = envelope * 0.88 + rawRms * 0.12
        let onsetRaw = max(0, rawRms - envelope)
        return RhythmFrame(
            capturedAt: Date().timeIntervalSince1970 * 1_000,
            rms: compressed(rawRms, gain: 11),
            bass: compressed(rawBass, gain: 18),
            mid: compressed(rawMid, gain: 15),
            treble: compressed(rawTreble, gain: 13),
            onset: min(1, onsetRaw * 36)
        )
    }

    private func compressed(_ value: Double, gain: Double) -> Double {
        min(1, max(0, 1 - exp(-value * gain)))
    }
}
