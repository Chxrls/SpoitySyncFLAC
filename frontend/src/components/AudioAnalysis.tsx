import { t } from "@/i18n";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Activity } from "lucide-react";
import type { AnalysisResult } from "@/types/api";
interface AudioAnalysisProps {
    result: AnalysisResult | null;
    analyzing: boolean;
    onAnalyze?: () => void;
    showAnalyzeButton?: boolean;
    filePath?: string;
}
export function AudioAnalysis({ result, analyzing, onAnalyze, showAnalyzeButton = true, filePath }: AudioAnalysisProps) {
    if (analyzing) {
        return (<Card>
                <CardContent className="px-6">
                    <div className="flex items-center justify-center py-8 gap-3">
                        <Spinner />
                        <span className="text-muted-foreground">{t("translation.audioAnalysis.analyzingAudioQuality")}</span>
                    </div>
                </CardContent>
            </Card>);
    }
    if (!result && showAnalyzeButton) {
        return (<Card>
                <CardContent className="px-6">
                    <div className="flex flex-col items-center justify-center py-8 gap-4">
                        <Activity className="h-12 w-12 text-primary"/>
                        <div className="text-center space-y-2">
                            <p className="font-medium">{t("translation.audioAnalysis.audioQualityAnalysis")}</p>
                            <p className="text-sm text-muted-foreground">
                                {t("translation.audioAnalysis.inspectSpectralContentEffectiveQuality")}
                            </p>
                        </div>
                        {onAnalyze && (<Button onClick={onAnalyze}>
                                <Activity className="h-4 w-4"/>
                                {t("translation.audioAnalysis.analyzeAudio")}
                            </Button>)}
                    </div>
                </CardContent>
            </Card>);
    }
    if (!result) {
        return null;
    }
    const formatDuration = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, "0")}`;
    };
    const formatNumber = (num: number) => {
        return num.toFixed(2);
    };
    const formatFileSize = (bytes: number): string => {
        if (bytes === 0)
            return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
    };
    const nyquistFreq = result.sample_rate / 2;
    const totalSamplesText = result.total_samples > 0 ? result.total_samples.toLocaleString() : "N/A";
    const freqResolutionLabel = result.file_type === "MP3" ? t("translation.audioAnalysis.freqResolutionShort") : t("translation.audioAnalysis.freqResolution");
    const hasCodecMeta = result.file_type === "MP3" && (Boolean(result.codec_mode) ||
        typeof result.bitrate_kbps === "number" ||
        typeof result.total_frames === "number" ||
        Boolean(result.codec_version));
    return (<Card className="gap-2">
            <CardHeader className="pb-2">
                {filePath && (<p className="text-sm font-mono break-all text-muted-foreground">{filePath}</p>)}
            </CardHeader>

            <CardContent>
                <div className={`grid grid-cols-1 gap-6 md:grid-cols-2 ${hasCodecMeta ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
                    <div className="space-y-2">
                        <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{t("translation.common.format")}</p>
                        <ul className="text-sm space-y-1">
                            {result.file_type && (<li className="flex justify-between">
                                    <span className="text-muted-foreground">{t("translation.audioAnalysis.type")}</span>
                                    <span className="font-medium font-mono">{result.file_type}</span>
                                </li>)}
                            <li className="flex justify-between">
                                <span className="text-muted-foreground">{t("translation.common.sampleRate")}</span>
                                <span className="font-medium font-mono">{(result.sample_rate / 1000).toFixed(1)} {t("literal.audioAnalysis.khz")}</span>
                            </li>
                            <li className="flex justify-between">
                                <span className="text-muted-foreground">{t("translation.common.bitDepth")}</span>
                                <span className="font-medium font-mono">{result.bit_depth}</span>
                            </li>
                            <li className="flex justify-between">
                                <span className="text-muted-foreground">{t("translation.audioAnalysis.channels")}</span>
                                <span className="font-medium font-mono">{result.channels === 2 ? "Stereo" : result.channels === 1 ? "Mono" : t("translation.migrated.AudioAnalysis.text", { value1: result.channels })}</span>
                            </li>
                            <li className="flex justify-between">
                                <span className="text-muted-foreground">{t("translation.common.duration")}</span>
                                <span className="font-medium font-mono">{formatDuration(result.duration)}</span>
                            </li>
                            {result.file_size > 0 && (<li className="flex justify-between">
                                    <span className="text-muted-foreground">{t("translation.audioAnalysis.size")}</span>
                                    <span className="font-medium font-mono">{formatFileSize(result.file_size)}</span>
                                </li>)}
                        </ul>
                    </div>

                    <div className="space-y-2">
                        <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{t("translation.audioAnalysis.signalAnalytics")}</p>
                        <ul className="text-sm space-y-1">
                            <li className="flex justify-between">
                                <span className="text-muted-foreground">{t("literal.audioAnalysis.nyquist")}</span>
                                <span className="font-medium font-mono">{(nyquistFreq / 1000).toFixed(1)} {t("literal.audioAnalysis.khz")}</span>
                            </li>
                            <li className="flex justify-between">
                                <span className="text-muted-foreground">{t("translation.audioAnalysis.dynamicRange")}</span>
                                <span className="font-medium font-mono">{formatNumber(result.dynamic_range)} {t("literal.audioAnalysis.db")}</span>
                            </li>
                            <li className="flex justify-between">
                                <span className="text-muted-foreground">{t("translation.audioAnalysis.peakAmplitude")}</span>
                                <span className="font-medium font-mono">{formatNumber(result.peak_amplitude)} {t("literal.audioAnalysis.db")}</span>
                            </li>
                            <li className="flex justify-between">
                                <span className="text-muted-foreground">{t("literal.audioAnalysis.rmsLevel")}</span>
                                <span className="font-medium font-mono">{formatNumber(result.rms_level)} {t("literal.audioAnalysis.db")}</span>
                            </li>
                            <li className="flex justify-between">
                                <span className="text-muted-foreground">{t("translation.audioAnalysis.totalSamples")}</span>
                                <span className="font-medium font-mono">{totalSamplesText}</span>
                            </li>
                        </ul>
                    </div>

                    {hasCodecMeta && (<div className="space-y-2">
                            <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{t("translation.audioAnalysis.mp3Meta")}</p>
                            <ul className="text-sm space-y-1">
                                {result.codec_mode && (<li className="flex justify-between">
                                        <span className="text-muted-foreground">{t("translation.audioAnalysis.mode")}</span>
                                        <span className="font-medium font-mono">{result.codec_mode}</span>
                                    </li>)}
                                {typeof result.bitrate_kbps === "number" && (<li className="flex justify-between">
                                        <span className="text-muted-foreground">{t("translation.common.bitrate")}</span>
                                        <span className="font-medium font-mono">{result.bitrate_kbps} {t("literal.audioAnalysis.kbps")}</span>
                                    </li>)}
                                {typeof result.total_frames === "number" && result.total_frames > 0 && (<li className="flex justify-between">
                                        <span className="text-muted-foreground">{t("translation.audioAnalysis.frames")}</span>
                                        <span className="font-medium font-mono">{result.total_frames.toLocaleString()}</span>
                                    </li>)}
                                {result.codec_version && (<li className="flex justify-between">
                                        <span className="text-muted-foreground">{t("translation.audioAnalysis.version")}</span>
                                        <span className="font-medium font-mono">{result.codec_version}</span>
                                    </li>)}
                            </ul>
                        </div>)}

                    {result.spectrum && (() => {
            const frames = result.spectrum.time_slices.length;
            const fftSize = (result.spectrum.freq_bins - 1) * 2;
            const freqRes = result.sample_rate / fftSize;
            return (<div className="space-y-2">
                                <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{t("translation.audioAnalysis.spectrumMeta")}</p>
                                <ul className="text-sm space-y-1">
                                    <li className="flex justify-between">
                                        <span className="text-muted-foreground">{t("translation.audioAnalysis.displayFrames")}</span>
                                        <span className="font-medium font-mono">{frames.toLocaleString()}</span>
                                    </li>
                                    <li className="flex justify-between">
                                        <span className="text-muted-foreground">{t("translation.common.fftSize")}</span>
                                        <span className="font-medium font-mono">{fftSize.toLocaleString()}</span>
                                    </li>
                                    <li className="flex justify-between">
                                        <span className="text-muted-foreground">{freqResolutionLabel}</span>
                                        <span className="font-medium font-mono">{freqRes.toFixed(2)} {t("literal.audioAnalysis.hzBin")}</span>
                                    </li>
                                </ul>
                            </div>);
        })()}
                </div>
            </CardContent>
        </Card>);
}
