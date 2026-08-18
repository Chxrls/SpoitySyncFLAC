import Essentia from "essentia.js/dist/essentia.js-core.es.js";
import { EssentiaWASM } from "essentia.js/dist/essentia-wasm.es.js";
interface AnalyzeMessage {
    type: "analyze";
    id: number;
    pcm: ArrayBuffer;
    sampleRate: number;
}
interface DisposableVector {
    delete?: () => void;
}
interface RhythmOutput {
    bpm: number;
    confidence: number;
    ticks?: DisposableVector;
    estimates?: DisposableVector;
    bpmIntervals?: DisposableVector;
}
interface KeyOutput {
    key: string;
    scale: string;
    strength: number;
}
const workerScope = self as unknown as {
    postMessage: (message: unknown) => void;
    addEventListener: (type: "message", listener: (event: MessageEvent<AnalyzeMessage>) => void) => void;
};
let essentia: Essentia | null = null;
function postProgress(id: number, progress: number, stage: string): void {
    workerScope.postMessage({ type: "progress", id, progress, stage });
}
function disposeVector(vector: DisposableVector | undefined): void {
    vector?.delete?.();
}
function pcm16ToFloat32(buffer: ArrayBuffer): Float32Array {
    const input = new Int16Array(buffer);
    const output = new Float32Array(input.length);
    for (let index = 0; index < input.length; index++) {
        output[index] = input[index] / 32768;
    }
    return output;
}
workerScope.addEventListener("message", (event) => {
    const message = event.data;
    if (message.type !== "analyze") {
        return;
    }
    const { id, pcm, sampleRate } = message;
    let signal: DisposableVector | undefined;
    let rhythm: RhythmOutput | undefined;
    try {
        postProgress(id, 8, "preparing");
        const samples = pcm16ToFloat32(pcm);
        postProgress(id, 18, "loadingEngine");
        essentia ??= new Essentia(EssentiaWASM);
        signal = essentia.arrayToVector(samples) as DisposableVector;
        postProgress(id, 28, "detectingTempo");
        rhythm = essentia.RhythmExtractor2013(signal, 200, "multifeature", 60) as RhythmOutput;
        postProgress(id, 78, "detectingKey");
        const tonal = essentia.KeyExtractor(signal, true, 4096, 4096, 36, 3500, 60, 25, 0.2, "bgate", sampleRate, 0.0001, 440, "cosine", "hann") as KeyOutput;
        postProgress(id, 98, "finalizing");
        workerScope.postMessage({
            type: "result",
            id,
            result: {
                bpm: rhythm.bpm,
                rhythmConfidence: rhythm.confidence,
                key: tonal.key,
                scale: tonal.scale,
                keyStrength: tonal.strength,
            },
        });
    }
    catch (error) {
        workerScope.postMessage({
            type: "error",
            id,
            error: error instanceof Error ? error.message : String(error),
        });
    }
    finally {
        disposeVector(rhythm?.ticks);
        disposeVector(rhythm?.estimates);
        disposeVector(rhythm?.bpmIntervals);
        disposeVector(signal);
    }
});
export {};
