import { AnalyzeReplayGainAlbum, AnalyzeReplayGainFile, WriteReplayGainTags } from "../../wailsjs/go/main/App";
import type { backend } from "../../wailsjs/go/models";
export const REPLAYGAIN_TARGET_LUFS = -18;
export interface AutomaticReplayGainResult {
    requested: number;
    analyzed: number;
    tagged: number;
    albumRequested: boolean;
    albumApplied: boolean;
    errors: string[];
}
interface AnalyzedReplayGainFile {
    path: string;
    result: backend.ReplayGainAnalysisResult;
}
function replayGainError(path: string, error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return `${path}: ${message}`;
}
export async function writeAutomaticReplayGainTags(filePaths: string[], writeAlbumTags: boolean): Promise<AutomaticReplayGainResult> {
    const paths = Array.from(new Set(filePaths.map((path) => path.trim()).filter(Boolean)));
    const analyzedFiles: AnalyzedReplayGainFile[] = [];
    const errors: string[] = [];
    for (const path of paths) {
        try {
            const result = await AnalyzeReplayGainFile(path);
            if (result.success) {
                analyzedFiles.push({ path, result });
            }
            else {
                errors.push(replayGainError(path, result.error || "ReplayGain analysis failed"));
            }
        }
        catch (error) {
            errors.push(replayGainError(path, error));
        }
    }
    const albumRequested = writeAlbumTags && paths.length > 1;
    let albumGainDB: number | undefined;
    let albumPeak: number | undefined;
    if (albumRequested && analyzedFiles.length === paths.length) {
        try {
            const albumResult = await AnalyzeReplayGainAlbum(paths);
            if (albumResult.success) {
                albumGainDB = REPLAYGAIN_TARGET_LUFS - albumResult.integrated_loudness;
                albumPeak = Math.max(...analyzedFiles.map(({ result }) => result.sample_peak));
            }
            else {
                errors.push(albumResult.error || "ReplayGain album analysis failed");
            }
        }
        catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
        }
    }
    if (analyzedFiles.length === 0) {
        return {
            requested: paths.length,
            analyzed: 0,
            tagged: 0,
            albumRequested,
            albumApplied: false,
            errors,
        };
    }
    const entries = analyzedFiles.map(({ path, result }) => {
        const entry: Record<string, string | number> = {
            file_path: path,
            track_gain_db: REPLAYGAIN_TARGET_LUFS - result.integrated_loudness,
            track_peak: result.sample_peak,
        };
        if (albumGainDB !== undefined && albumPeak !== undefined) {
            entry.album_gain_db = albumGainDB;
            entry.album_peak = albumPeak;
        }
        return entry as unknown as backend.ReplayGainTagWrite;
    });
    let tagged = 0;
    try {
        const writeResults = await WriteReplayGainTags(entries);
        for (const result of writeResults) {
            if (result.success) {
                tagged++;
            }
            else {
                errors.push(replayGainError(result.file_path, result.error || "Failed to write ReplayGain tags"));
            }
        }
    }
    catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
    }
    return {
        requested: paths.length,
        analyzed: analyzedFiles.length,
        tagged,
        albumRequested,
        albumApplied: albumGainDB !== undefined && albumPeak !== undefined && tagged > 0,
        errors,
    };
}
