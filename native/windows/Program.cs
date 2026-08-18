using System.Buffers.Binary;
using System.Text.Json;
using NAudio.Wave;

namespace DshBgmHelper;

internal static class Program
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private static readonly object OutputLock = new();

    public static int Main()
    {
        using var finished = new ManualResetEventSlim(false);
        WasapiLoopbackCapture? capture = null;
        System.Threading.Timer? publisher = null;
        var stopping = false;

        try
        {
            capture = new WasapiLoopbackCapture();
            var analyzer = new RhythmAnalyzer(capture.WaveFormat);
            capture.DataAvailable += (_, eventArgs) =>
                analyzer.Consume(eventArgs.Buffer.AsSpan(0, eventArgs.BytesRecorded));
            capture.RecordingStopped += (_, eventArgs) =>
            {
                if (!stopping && eventArgs.Exception is not null)
                {
                    Emit(new
                    {
                        type = "error",
                        code = "capture-failed",
                        message = eventArgs.Exception.Message,
                    });
                }
                finished.Set();
            };

            Console.CancelKeyPress += (_, eventArgs) =>
            {
                eventArgs.Cancel = true;
                finished.Set();
            };
            AppDomain.CurrentDomain.ProcessExit += (_, _) => finished.Set();

            capture.StartRecording();
            Emit(new
            {
                type = "ready",
                platform = "win32",
                sampleRate = capture.WaveFormat.SampleRate,
                channels = capture.WaveFormat.Channels,
            });
            publisher = new System.Threading.Timer(
                _ => Emit(new { type = "rhythm", frame = analyzer.TakeFrame() }),
                null,
                dueTime: 0,
                period: 50);

            finished.Wait();
            stopping = true;
            publisher.Dispose();
            capture.StopRecording();
            return 0;
        }
        catch (Exception exception)
        {
            Emit(new
            {
                type = "error",
                code = exception.HResult == unchecked((int)0x80070005)
                    ? "permission-denied"
                    : "capture-failed",
                message = exception.Message,
            });
            return 1;
        }
        finally
        {
            publisher?.Dispose();
            capture?.Dispose();
        }
    }

    private static void Emit<T>(T message)
    {
        var line = JsonSerializer.Serialize(message, JsonOptions);
        lock (OutputLock)
        {
            Console.Out.WriteLine(line);
            Console.Out.Flush();
        }
    }
}

internal sealed class RhythmAnalyzer
{
    private static readonly Guid IeeeFloatSubFormat =
        new("00000003-0000-0010-8000-00aa00389b71");

    private readonly object sync = new();
    private readonly WaveFormat format;
    private readonly bool isFloat;
    private readonly double lowAlpha;
    private readonly double midAlpha;
    private double lowState;
    private double midState;
    private double squareSum;
    private double bassSum;
    private double midSum;
    private double trebleSum;
    private long sampleCount;
    private double envelope;

    public RhythmAnalyzer(WaveFormat format)
    {
        this.format = format;
        isFloat = format.Encoding == WaveFormatEncoding.IeeeFloat
            || format is WaveFormatExtensible extensible
                && extensible.SubFormat == IeeeFloatSubFormat;
        lowAlpha = 1 - Math.Exp(-2 * Math.PI * 180 / format.SampleRate);
        midAlpha = 1 - Math.Exp(-2 * Math.PI * 2_500 / format.SampleRate);
    }

    public void Consume(ReadOnlySpan<byte> bytes)
    {
        var sampleBytes = format.BitsPerSample / 8;
        if (sampleBytes <= 0 || format.Channels <= 0) return;
        var frameBytes = sampleBytes * format.Channels;

        lock (sync)
        {
            for (var frameOffset = 0; frameOffset + frameBytes <= bytes.Length; frameOffset += frameBytes)
            {
                double mono = 0;
                for (var channel = 0; channel < format.Channels; channel++)
                {
                    var offset = frameOffset + channel * sampleBytes;
                    mono += ReadSample(bytes.Slice(offset, sampleBytes));
                }
                AnalyzeSample(mono / format.Channels);
            }
        }
    }

    private double ReadSample(ReadOnlySpan<byte> value)
    {
        if (isFloat && format.BitsPerSample == 32)
            return BitConverter.Int32BitsToSingle(BinaryPrimitives.ReadInt32LittleEndian(value));
        if (format.BitsPerSample == 16)
            return BinaryPrimitives.ReadInt16LittleEndian(value) / 32768.0;
        if (format.BitsPerSample == 24)
        {
            var raw = value[0] | value[1] << 8 | value[2] << 16;
            if ((raw & 0x800000) != 0) raw |= unchecked((int)0xff000000);
            return raw / 8_388_608.0;
        }
        if (format.BitsPerSample == 32)
            return BinaryPrimitives.ReadInt32LittleEndian(value) / 2_147_483_648.0;
        return 0;
    }

    private void AnalyzeSample(double raw)
    {
        var sample = double.IsFinite(raw) ? Math.Clamp(raw, -1, 1) : 0;
        lowState += lowAlpha * (sample - lowState);
        midState += midAlpha * (sample - midState);
        var bass = lowState;
        var mid = midState - lowState;
        var treble = sample - midState;
        squareSum += sample * sample;
        bassSum += bass * bass;
        midSum += mid * mid;
        trebleSum += treble * treble;
        sampleCount++;
    }

    public RhythmFrame TakeFrame()
    {
        double rawRms;
        double rawBass;
        double rawMid;
        double rawTreble;
        lock (sync)
        {
            var count = Math.Max(1, sampleCount);
            rawRms = Math.Sqrt(squareSum / count);
            rawBass = Math.Sqrt(bassSum / count);
            rawMid = Math.Sqrt(midSum / count);
            rawTreble = Math.Sqrt(trebleSum / count);
            squareSum = bassSum = midSum = trebleSum = 0;
            sampleCount = 0;
        }

        envelope = envelope * 0.88 + rawRms * 0.12;
        var onset = Math.Max(0, rawRms - envelope);
        return new RhythmFrame(
            DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            Compress(rawRms, 11),
            Compress(rawBass, 18),
            Compress(rawMid, 15),
            Compress(rawTreble, 13),
            Math.Min(1, onset * 36));
    }

    private static double Compress(double value, double gain) =>
        Math.Clamp(1 - Math.Exp(-value * gain), 0, 1);
}

internal sealed record RhythmFrame(
    long CapturedAt,
    double Rms,
    double Bass,
    double Mid,
    double Treble,
    double Onset);
