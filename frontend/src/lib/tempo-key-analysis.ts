export interface TempoKeyResult {
    bpm: number;
    rhythmConfidence: number;
    key: string;
    scale: "major" | "minor";
    keyStrength: number;
}
interface WorkerResultMessage {
    type: "result";
    id: number;
    result: TempoKeyResult;
}
interface WorkerProgressMessage {
    type: "progress";
    id: number;
    progress: number;
    stage: string;
}
interface WorkerErrorMessage {
    type: "error";
    id: number;
    error: string;
}
type WorkerMessage = WorkerResultMessage | WorkerProgressMessage | WorkerErrorMessage;
interface PendingAnalysis {
    resolve: (result: TempoKeyResult) => void;
    reject: (error: Error) => void;
    onProgress?: (progress: number, stage: string) => void;
}
const CAMELOT_MAJOR: Record<string, string> = {
    B: "1B",
    "F#": "2B",
    Gb: "2B",
    "C#": "3B",
    Db: "3B",
    "G#": "4B",
    Ab: "4B",
    "D#": "5B",
    Eb: "5B",
    "A#": "6B",
    Bb: "6B",
    F: "7B",
    C: "8B",
    G: "9B",
    D: "10B",
    A: "11B",
    E: "12B",
};
const CAMELOT_MINOR: Record<string, string> = {
    "G#": "1A",
    Ab: "1A",
    "D#": "2A",
    Eb: "2A",
    "A#": "3A",
    Bb: "3A",
    F: "4A",
    C: "5A",
    G: "6A",
    D: "7A",
    A: "8A",
    E: "9A",
    B: "10A",
    "F#": "11A",
    Gb: "11A",
    "C#": "12A",
    Db: "12A",
};
export class TempoKeyAnalyzer {
    private worker: Worker;
    private nextId = 1;
    private pending = new Map<number, PendingAnalysis>();
    constructor() {
        this.worker = this.createWorker();
    }
    private createWorker(): Worker {
        const worker = new Worker(new URL("../workers/tempo-key.worker.ts", import.meta.url), { type: "module" });
        worker.addEventListener("message", (event: MessageEvent<WorkerMessage>) => {
            const message = event.data;
            const pending = this.pending.get(message.id);
            if (!pending) {
                return;
            }
            if (message.type === "progress") {
                pending.onProgress?.(message.progress, message.stage);
                return;
            }
            this.pending.delete(message.id);
            if (message.type === "result") {
                pending.resolve(message.result);
            }
            else {
                pending.reject(new Error(message.error));
            }
        });
        worker.addEventListener("error", (event) => {
            const error = new Error(event.message || "Tempo and key analysis worker failed");
            for (const pending of this.pending.values()) {
                pending.reject(error);
            }
            this.pending.clear();
        });
        return worker;
    }
    analyze(pcm: ArrayBuffer, sampleRate: number, onProgress?: (progress: number, stage: string) => void): Promise<TempoKeyResult> {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject, onProgress });
            this.worker.postMessage({ type: "analyze", id, pcm, sampleRate }, [pcm]);
        });
    }
    cancelAll(): void {
        this.worker.terminate();
        const error = new DOMException("Analysis cancelled", "AbortError");
        for (const pending of this.pending.values()) {
            pending.reject(error);
        }
        this.pending.clear();
        this.worker = this.createWorker();
    }
    dispose(): void {
        this.worker.terminate();
        const error = new DOMException("Analyzer disposed", "AbortError");
        for (const pending of this.pending.values()) {
            pending.reject(error);
        }
        this.pending.clear();
    }
}
export async function base64PCMToArrayBuffer(base64: string, onProgress?: (progress: number) => void): Promise<ArrayBuffer> {
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    const output = new Uint8Array(Math.floor((base64.length * 3) / 4) - padding);
    const chunkSize = 32768;
    let outputOffset = 0;
    for (let offset = 0; offset < base64.length; offset += chunkSize) {
        const decoded = atob(base64.slice(offset, offset + chunkSize));
        for (let index = 0; index < decoded.length; index++) {
            output[outputOffset++] = decoded.charCodeAt(index);
        }
        if (offset % (chunkSize * 32) === 0) {
            onProgress?.(Math.min(100, Math.round(((offset + chunkSize) / base64.length) * 100)));
            await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        }
    }
    onProgress?.(100);
    return output.buffer;
}
export function camelotCode(key: string, scale: "major" | "minor"): string {
    return (scale === "major" ? CAMELOT_MAJOR : CAMELOT_MINOR)[key] ?? "—";
}
export function normalizeRhythmConfidence(value: number): number {
    return Math.round(Math.max(0, Math.min(1, value / 5.32)) * 100);
}
export function tempoDescription(bpm: number): "slow" | "moderate" | "upbeat" | "fast" {
    if (bpm < 80)
        return "slow";
    if (bpm < 110)
        return "moderate";
    if (bpm < 140)
        return "upbeat";
    return "fast";
}
