import Foundation
import CoreAudio
import AudioToolbox

final class SystemAudioTap {
    private var tapID = AudioObjectID.unknown
    private var aggregateID = AudioObjectID.unknown
    private var ioProcID: AudioDeviceIOProcID?
    private let queue = DispatchQueue(label: "com.dsh.bgm.audio", qos: .userInteractive)

    private(set) var format = AudioStreamBasicDescription()

    func start(analyzerFactory: (Double) -> RhythmAnalyzer) throws -> RhythmAnalyzer {
        let description = CATapDescription(stereoGlobalTapButExcludeProcesses: [])
        description.uuid = UUID()
        description.muteBehavior = .unmuted

        var createdTap = AudioObjectID.unknown
        var status = AudioHardwareCreateProcessTap(description, &createdTap)
        guard status == noErr else {
            throw HelperError(message: "AudioHardwareCreateProcessTap failed: \(status.fourCC)")
        }
        tapID = createdTap
        format = try tapID.tapFormat()

        let output = try AudioObjectID.defaultSystemOutput()
        let outputUID = try output.deviceUID()
        let aggregateDescription: [String: Any] = [
            kAudioAggregateDeviceNameKey: "dsh-bgm system audio",
            kAudioAggregateDeviceUIDKey: "com.dsh.bgm.aggregate.\(UUID().uuidString)",
            kAudioAggregateDeviceMainSubDeviceKey: outputUID,
            kAudioAggregateDeviceIsPrivateKey: true,
            kAudioAggregateDeviceIsStackedKey: false,
            kAudioAggregateDeviceTapAutoStartKey: true,
            kAudioAggregateDeviceSubDeviceListKey: [[
                kAudioSubDeviceUIDKey: outputUID,
            ]],
            kAudioAggregateDeviceTapListKey: [[
                kAudioSubTapDriftCompensationKey: true,
                kAudioSubTapUIDKey: description.uuid.uuidString,
            ]],
        ]

        var createdAggregate = AudioObjectID.unknown
        status = AudioHardwareCreateAggregateDevice(aggregateDescription as CFDictionary, &createdAggregate)
        guard status == noErr else {
            throw HelperError(message: "AudioHardwareCreateAggregateDevice failed: \(status.fourCC)")
        }
        aggregateID = createdAggregate

        let analyzer = analyzerFactory(format.mSampleRate)
        let streamFormat = format
        status = AudioDeviceCreateIOProcIDWithBlock(&ioProcID, aggregateID, queue) {
            _, inputData, _, _, _ in
            analyzer.consume(inputData, format: streamFormat)
        }
        guard status == noErr else {
            throw HelperError(message: "AudioDeviceCreateIOProcIDWithBlock failed: \(status.fourCC)")
        }
        status = AudioDeviceStart(aggregateID, ioProcID)
        guard status == noErr else {
            throw HelperError(message: "AudioDeviceStart failed: \(status.fourCC)")
        }
        return analyzer
    }

    func stop() {
        if aggregateID.isValid {
            _ = AudioDeviceStop(aggregateID, ioProcID)
            if let ioProcID {
                _ = AudioDeviceDestroyIOProcID(aggregateID, ioProcID)
                self.ioProcID = nil
            }
            _ = AudioHardwareDestroyAggregateDevice(aggregateID)
            aggregateID = .unknown
        }
        if tapID.isValid {
            _ = AudioHardwareDestroyProcessTap(tapID)
            tapID = .unknown
        }
    }

    deinit { stop() }
}
