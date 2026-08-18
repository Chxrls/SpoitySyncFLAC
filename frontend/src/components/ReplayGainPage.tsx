import { t, translateMessage } from "@/i18n";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Activity, AlertCircle, AlertTriangle, CircleCheckBig, ChevronDown, CircleHelp, FileMusic, FolderOpen, Gauge, Save, StopCircle, Trash2, Upload, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AudioWaveformIcon } from "@/components/ui/audio-waveform";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { REPLAYGAIN_TARGET_LUFS } from "@/lib/replaygain";
import { AnalyzeReplayGainAlbum, AnalyzeReplayGainFile, CancelReplayGainAnalysis, GetFileSizes, ListAudioFilesInDir, SelectAudioFiles, SelectFolder, WriteReplayGainTags } from "../../wailsjs/go/main/App";
import type { backend } from "../../wailsjs/go/models";
import { OnFileDrop, OnFileDropOff } from "../../wailsjs/runtime/runtime";
type AnalysisState = "pending" | "analyzing" | "success" | "error";
interface ReplayGainItem {
    path: string;
    name: string;
    size: number;
    state: AnalysisState;
    result?: backend.ReplayGainAnalysisResult;
    error?: string;
}
interface AlbumStatistics {
    loudness: number;
    gain: number;
    peak: number;
    truePeak: number;
}
interface ReplayGainPageCache {
    items: ReplayGainItem[];
    activePath: string | null;
    albumMode: boolean;
    albumResult: backend.ReplayGainAnalysisResult | null;
    albumSignature: string;
}
const SUPPORTED_EXTENSIONS = [".flac", ".mp3", ".m4a", ".mp4", ".m4b", ".wav", ".aiff", ".aif", ".ogg", ".opus", ".ape", ".wv", ".mpc"];
const REPLAYGAIN_TARGET = REPLAYGAIN_TARGET_LUFS;
const ERROR_SEPARATOR = " — ";
const LOUDNESS_UNIT = "LUFS";
const GAIN_UNIT = "dB";
const TRUE_PEAK_UNIT = "dBTP";
let replayGainPageCache: ReplayGainPageCache = {
    items: [],
    activePath: null,
    albumMode: false,
    albumResult: null,
    albumSignature: "",
};
const fileNameFromPath = (path: string) => path.split(/[/\\]/).pop() || path;
const albumSignatureFor = (entries: ReplayGainItem[]) => entries.map((entry) => entry.path.toLowerCase()).join("\u0000");
const formatSigned = (value: number, digits = 2) => `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
const formatLoudness = (value: number) => `${value.toFixed(2)} LUFS`;
const formatTruePeak = (value: number) => `${value.toFixed(2)} dBTP`;
const formatRange = (value: number) => `${value.toFixed(2)} LU`;
const formatGain = (value: number) => `${formatSigned(value)} dB`;
function formatFileSize(bytes: number): string {
    if (bytes <= 0)
        return "—";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
function formatDuration(seconds?: number): string {
    if (!seconds || seconds <= 0)
        return "—";
    const minutes = Math.floor(seconds / 60);
    const remaining = Math.floor(seconds % 60);
    return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}
function isSupportedAudioPath(path: string): boolean {
    const normalized = path.toLowerCase();
    return SUPPORTED_EXTENSIONS.some((extension) => normalized.endsWith(extension));
}
function statusIcon(state: AnalysisState) {
    if (state === "analyzing")
        return <Spinner className="h-4 w-4 text-primary"/>;
    if (state === "success")
        return <CircleCheckBig className="h-4 w-4 text-emerald-500"/>;
    if (state === "error")
        return <AlertCircle className="h-4 w-4 text-destructive"/>;
    return <FileMusic className="h-4 w-4 text-muted-foreground"/>;
}
function HelpTooltip({ content }: {
    content: string;
}) {
    return (<Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <button type="button" className="inline-flex shrink-0 cursor-help items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={content}>
          <CircleHelp className="h-3.5 w-3.5"/>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={8} collisionPadding={16} className="max-w-[calc(100vw-2rem)] text-left text-pretty sm:max-w-[32rem]"><p>{content}</p></TooltipContent>
    </Tooltip>);
}
export function ReplayGainPage() {
    const [items, setItems] = useState<ReplayGainItem[]>(() => replayGainPageCache.items.map((item) => item.state === "analyzing" ? { ...item, state: "pending" } : item));
    const [activePath, setActivePath] = useState<string | null>(replayGainPageCache.activePath);
    const [albumMode, setAlbumMode] = useState(replayGainPageCache.albumMode);
    const [albumResult, setAlbumResult] = useState<backend.ReplayGainAnalysisResult | null>(replayGainPageCache.albumResult);
    const [albumSignature, setAlbumSignature] = useState(replayGainPageCache.albumSignature);
    const [analyzing, setAnalyzing] = useState(false);
    const [albumAnalyzing, setAlbumAnalyzing] = useState(false);
    const [writing, setWriting] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [progress, setProgress] = useState({ completed: 0, total: 0, fileName: "" });
    const [writeFailures, setWriteFailures] = useState<backend.ReplayGainWriteResult[]>([]);
    const itemsRef = useRef(items);
    const activePathRef = useRef(activePath);
    const analysisRunRef = useRef(0);
    const albumRunRef = useRef(0);
    useEffect(() => {
        itemsRef.current = items;
        replayGainPageCache = { items, activePath, albumMode, albumResult, albumSignature };
    }, [items, activePath, albumMode, albumResult, albumSignature]);
    useEffect(() => () => {
        analysisRunRef.current++;
        albumRunRef.current++;
        void CancelReplayGainAnalysis();
    }, []);
    const setActiveSelection = useCallback((path: string | null) => {
        activePathRef.current = path;
        setActivePath(path);
    }, []);
    const successfulItems = useMemo(() => items.filter((item) => item.state === "success" && item.result?.success), [items]);
    const albumStatistics = useMemo<AlbumStatistics | null>(() => {
        const currentSignature = albumSignatureFor(successfulItems);
        if (!albumResult?.success || successfulItems.length < 2 || albumSignature !== currentSignature)
            return null;
        const peak = Math.max(...successfulItems.map((item) => item.result?.sample_peak || 0));
        return {
            loudness: albumResult.integrated_loudness,
            gain: REPLAYGAIN_TARGET - albumResult.integrated_loudness,
            peak,
            truePeak: albumResult.true_peak,
        };
    }, [albumResult, albumSignature, successfulItems]);
    const updateItems = useCallback((updater: (current: ReplayGainItem[]) => ReplayGainItem[]) => {
        setItems((current) => {
            const next = updater(current);
            itemsRef.current = next;
            return next;
        });
    }, []);
    const invalidateAlbumAnalysis = useCallback(() => {
        albumRunRef.current++;
        setAlbumResult(null);
        setAlbumSignature("");
    }, []);
    const analyzeAlbum = useCallback(async (entries: ReplayGainItem[]): Promise<backend.ReplayGainAnalysisResult | null> => {
        if (entries.length < 2 || entries.some((entry) => !entry.result?.success))
            return null;
        const signature = albumSignatureFor(entries);
        const runID = ++albumRunRef.current;
        setAlbumAnalyzing(true);
        try {
            const measured = await AnalyzeReplayGainAlbum(entries.map((entry) => entry.path));
            if (albumRunRef.current !== runID)
                return null;
            if (!measured.success)
                throw new Error(measured.error || t("translation.replayGain.albumAnalysisFailed"));
            setAlbumResult(measured);
            setAlbumSignature(signature);
            return measured;
        }
        catch (error) {
            if (albumRunRef.current === runID) {
                setAlbumResult(null);
                setAlbumSignature("");
                toast.error(t("translation.replayGain.albumAnalysisFailed"), { description: String(error) });
            }
            return null;
        }
        finally {
            if (albumRunRef.current === runID)
                setAlbumAnalyzing(false);
        }
    }, []);
    const runAnalysis = useCallback(async (entries: ReplayGainItem[]) => {
        if (entries.length === 0)
            return;
        const runID = ++analysisRunRef.current;
        const paths = new Set(entries.map((entry) => entry.path));
        setAnalyzing(true);
        invalidateAlbumAnalysis();
        setWriteFailures([]);
        updateItems((current) => current.map((item) => paths.has(item.path) ? { ...item, state: "pending", result: undefined, error: undefined } : item));
        setProgress({ completed: 0, total: entries.length, fileName: entries[0]?.name || "" });
        let completed = 0;
        for (const entry of entries) {
            if (analysisRunRef.current !== runID)
                return;
            setActiveSelection(entry.path);
            setProgress({ completed, total: entries.length, fileName: entry.name });
            updateItems((current) => current.map((item) => item.path === entry.path ? { ...item, state: "analyzing" } : item));
            try {
                const result = await AnalyzeReplayGainFile(entry.path);
                if (analysisRunRef.current !== runID)
                    return;
                updateItems((current) => current.map((item) => item.path === entry.path ? {
                    ...item,
                    state: result.success ? "success" : "error",
                    result,
                    error: result.error,
                } : item));
            }
            catch (error) {
                if (analysisRunRef.current !== runID)
                    return;
                updateItems((current) => current.map((item) => item.path === entry.path ? { ...item, state: "error", error: String(error) } : item));
            }
            completed++;
            setProgress({ completed, total: entries.length, fileName: entry.name });
        }
        if (analysisRunRef.current === runID) {
            setAnalyzing(false);
            toast.success(t("translation.replayGain.analysisComplete", { value1: completed }));
            const ready = itemsRef.current.filter((item) => item.state === "success" && item.result?.success);
            if (albumMode && ready.length > 1 && ready.length === itemsRef.current.length)
                void analyzeAlbum(ready);
        }
    }, [albumMode, analyzeAlbum, invalidateAlbumAnalysis, setActiveSelection, updateItems]);
    const addPaths = useCallback(async (paths: string[]) => {
        if (analyzing || albumAnalyzing || writing)
            return;
        const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
        const supportedPaths = uniquePaths.filter(isSupportedAudioPath);
        const skippedCount = uniquePaths.length - supportedPaths.length;
        if (skippedCount > 0) {
            toast.info(t("translation.common.someFilesSkipped"), {
                description: t("translation.replayGain.unsupportedFilesSkipped", { value1: skippedCount }),
            });
        }
        if (supportedPaths.length === 0)
            return;
        const existing = new Set(itemsRef.current.map((item) => item.path.toLowerCase()));
        const newPaths = supportedPaths.filter((path) => !existing.has(path.toLowerCase()));
        if (newPaths.length === 0) {
            toast.info(t("translation.common.noNewFilesAdded"));
            return;
        }
        const sizes = await GetFileSizes(newPaths);
        const additions: ReplayGainItem[] = newPaths.map((path) => ({
            path,
            name: fileNameFromPath(path),
            size: sizes[path] || 0,
            state: "pending",
        }));
        const shouldAutoAnalyze = itemsRef.current.length === 0 && additions.length === 1;
        itemsRef.current = [...itemsRef.current, ...additions];
        setItems((current) => [...current, ...additions]);
        invalidateAlbumAnalysis();
        if (!activePathRef.current)
            setActiveSelection(additions[0]?.path ?? null);
        setWriteFailures([]);
        if (shouldAutoAnalyze)
            void runAnalysis(additions);
    }, [albumAnalyzing, analyzing, invalidateAlbumAnalysis, runAnalysis, setActiveSelection, writing]);
    const addFiles = useCallback(async () => {
        try {
            const paths = await SelectAudioFiles();
            await addPaths(paths || []);
        }
        catch (error) {
            toast.error(t("translation.common.fileSelectionFailed"), { description: String(error) });
        }
    }, [addPaths]);
    const addFolder = useCallback(async () => {
        try {
            const folder = await SelectFolder("");
            if (!folder)
                return;
            const files = await ListAudioFilesInDir(folder);
            if (!files || files.length === 0) {
                toast.info(t("translation.common.noAudioFilesFound"));
                return;
            }
            await addPaths(files.map((file) => file.path));
        }
        catch (error) {
            toast.error(t("translation.common.folderSelectionFailed"), { description: String(error) });
        }
    }, [addPaths]);
    useEffect(() => {
        OnFileDrop((_x, _y, paths) => {
            setIsDragging(false);
            void addPaths(paths || []);
        }, true);
        return () => OnFileDropOff();
    }, [addPaths]);
    const stopAnalysis = useCallback(() => {
        analysisRunRef.current++;
        albumRunRef.current++;
        void CancelReplayGainAnalysis();
        setAnalyzing(false);
        setAlbumAnalyzing(false);
        updateItems((current) => current.map((item) => item.state === "analyzing" ? { ...item, state: "pending" } : item));
        toast.info(t("translation.replayGain.analysisStopped"));
    }, [updateItems]);
    const analyzePending = useCallback(() => {
        const pending = itemsRef.current.filter((item) => item.state === "pending" || item.state === "error");
        if (pending.length > 0)
            void runAnalysis(pending);
    }, [runAnalysis]);
    const removeItem = useCallback((path: string) => {
        if (analyzing || writing)
            return;
        const nextItems = itemsRef.current.filter((item) => item.path !== path);
        itemsRef.current = nextItems;
        setItems(nextItems);
        invalidateAlbumAnalysis();
        if (activePathRef.current === path)
            setActiveSelection(nextItems.find((item) => item.state === "success")?.path ?? nextItems[0]?.path ?? null);
    }, [analyzing, invalidateAlbumAnalysis, setActiveSelection, writing]);
    const clearAll = useCallback(() => {
        if (analyzing || writing)
            return;
        itemsRef.current = [];
        setItems([]);
        setActiveSelection(null);
        invalidateAlbumAnalysis();
        setWriteFailures([]);
        setProgress({ completed: 0, total: 0, fileName: "" });
    }, [analyzing, invalidateAlbumAnalysis, setActiveSelection, writing]);
    const changeAlbumMode = useCallback((enabled: boolean) => {
        setAlbumMode(enabled);
        if (!enabled)
            return;
        const ready = itemsRef.current.filter((item) => item.state === "success" && item.result?.success);
        if (ready.length > 1 && ready.length === itemsRef.current.length)
            void analyzeAlbum(ready);
    }, [analyzeAlbum]);
    const writeTags = async () => {
        if (successfulItems.length === 0)
            return;
        setConfirmOpen(false);
        setWriting(true);
        setWriteFailures([]);
        try {
            let measuredAlbum = albumStatistics;
            if (albumMode && successfulItems.length > 1 && !measuredAlbum) {
                const measured = await analyzeAlbum(successfulItems);
                if (!measured?.success)
                    return;
                measuredAlbum = {
                    loudness: measured.integrated_loudness,
                    gain: REPLAYGAIN_TARGET - measured.integrated_loudness,
                    peak: Math.max(...successfulItems.map((item) => item.result?.sample_peak || 0)),
                    truePeak: measured.true_peak,
                };
            }
            const entries = successfulItems.map((item) => {
                const result = item.result!;
                const entry: Record<string, string | number> = {
                    file_path: item.path,
                    track_gain_db: REPLAYGAIN_TARGET - result.integrated_loudness,
                    track_peak: result.sample_peak,
                };
                if (albumMode && successfulItems.length > 1 && measuredAlbum) {
                    entry.album_gain_db = measuredAlbum.gain;
                    entry.album_peak = measuredAlbum.peak;
                }
                return entry as unknown as backend.ReplayGainTagWrite;
            });
            const results = await WriteReplayGainTags(entries);
            const failures = results.filter((result) => !result.success);
            setWriteFailures(failures);
            if (results.length > failures.length)
                toast.success(t("translation.replayGain.writeComplete", { value1: results.length - failures.length, value2: results.length }));
            if (failures.length > 0)
                toast.error(t("translation.replayGain.writeFailed", { value1: failures.length }));
        }
        catch (error) {
            toast.error(t("translation.replayGain.writeError"), { description: String(error) });
        }
        finally {
            setWriting(false);
        }
    };
    const activeItem = items.find((item) => item.path === activePath) ?? items[0] ?? null;
    const result = activeItem?.result?.success ? activeItem.result : null;
    const isSingleMode = items.length === 1;
    const isBatchMode = items.length > 1;
    const hasPending = items.some((item) => item.state === "pending" || item.state === "error");
    const busy = analyzing || albumAnalyzing || writing;
    const trackGain = result ? REPLAYGAIN_TARGET - result.integrated_loudness : 0;
    const clippingRisk = Boolean(result && result.true_peak + trackGain > 0);
    const resultContent = result && activeItem ? (<div className="mx-auto w-full max-w-6xl space-y-3">
      <Card className="gap-1 py-4">
        <CardHeader className="gap-1 px-4 pb-1">
          <CardTitle className="text-base">{activeItem.name}</CardTitle>
          <p className="truncate font-mono text-xs text-muted-foreground" title={activeItem.path}>{activeItem.path}</p>
        </CardHeader>
        <CardContent className="px-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("translation.replayGain.integratedLoudness")}</p>
              <div className="flex items-baseline gap-2"><span className="font-mono text-4xl font-bold text-primary">{result.integrated_loudness.toFixed(2)}</span><span className="text-sm font-medium text-muted-foreground">{LOUDNESS_UNIT}</span></div>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("translation.replayGain.recommendedGain")}</p>
              <div className="flex items-center gap-2">
                <div className="flex items-baseline gap-2"><span className="font-mono text-4xl font-bold">{formatSigned(trackGain)}</span><span className="text-sm font-medium text-muted-foreground">{GAIN_UNIT}</span></div>
                {clippingRisk && (<Tooltip delayDuration={150}><TooltipTrigger asChild><Badge tabIndex={0} variant="outline" className="cursor-help border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"><AlertTriangle className="h-3 w-3"/>{t("translation.replayGain.clippingRisk")}</Badge></TooltipTrigger><TooltipContent side="top" className="max-w-72"><p>{t("translation.replayGain.clippingHint")}</p></TooltipContent></Tooltip>)}
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("translation.replayGain.truePeak")}</p>
              <div className="flex items-baseline gap-2"><span className="font-mono text-4xl font-bold">{result.true_peak.toFixed(2)}</span><span className="text-sm font-medium text-muted-foreground">{TRUE_PEAK_UNIT}</span></div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="gap-1 py-4">
        <CardHeader className="px-4 pb-1"><CardTitle className="text-base">{t("translation.replayGain.analysisDetails")}</CardTitle></CardHeader>
        <CardContent className="px-4">
          <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2 lg:gap-6">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <span className="flex items-center gap-1 text-sm text-muted-foreground"><Gauge className="h-4 w-4 text-primary"/>{t("translation.replayGain.targetLoudness")}<HelpTooltip content={t("translation.replayGain.targetHint")}/></span>
                <div className="flex items-baseline gap-1.5"><span className="font-mono text-xl font-semibold">{REPLAYGAIN_TARGET}</span><span className="text-xs font-medium text-muted-foreground">{LOUDNESS_UNIT}</span></div>
              </div>
              {isBatchMode && (<div className="space-y-1.5">
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={albumMode} disabled={busy} onCheckedChange={(checked) => changeAlbumMode(checked === true)}/><span className="font-medium">{t("translation.replayGain.albumMode")}</span><HelpTooltip content={t("translation.replayGain.albumModeHint")}/></label>
                {albumMode && albumAnalyzing && (<div className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner className="h-3.5 w-3.5"/>{t("translation.replayGain.analyzingAlbum")}</div>)}
                {albumMode && albumStatistics && (<p className="text-xs text-muted-foreground">{t("translation.replayGain.averageLoudness")}: {formatLoudness(albumStatistics.loudness)} · {t("translation.replayGain.albumGain")}: {formatGain(albumStatistics.gain)} · {t("translation.replayGain.maximumPeak")}: {formatTruePeak(albumStatistics.truePeak)}</p>)}
              </div>)}
            </div>
            <ul className="space-y-1.5 text-sm">
              <li className="grid grid-cols-[minmax(0,1fr)_max-content] items-center gap-3"><span className="min-w-0 text-muted-foreground">{t("translation.replayGain.loudnessRange")}</span><span className="whitespace-nowrap text-right font-mono font-medium">{formatRange(result.loudness_range)}</span></li>
              <li className="grid grid-cols-[minmax(0,1fr)_max-content] items-center gap-3"><span className="min-w-0 text-muted-foreground">{t("translation.replayGain.threshold")}</span><span className="whitespace-nowrap text-right font-mono font-medium">{formatLoudness(result.threshold)}</span></li>
              <li className="grid grid-cols-[minmax(0,1fr)_max-content] items-center gap-3"><span className="min-w-0 text-muted-foreground">{t("translation.common.duration")}</span><span className="whitespace-nowrap text-right font-mono font-medium">{formatDuration(result.duration)}</span></li>
              <li className="grid grid-cols-[minmax(0,1fr)_max-content] items-center gap-3"><span className="min-w-0 text-muted-foreground">{t("translation.replayGain.fileSize")}</span><span className="whitespace-nowrap text-right font-mono font-medium">{formatFileSize(activeItem.size)}</span></li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {writeFailures.length > 0 && (<Card className="border-destructive/30 bg-destructive/5 py-3"><CardContent className="px-4"><p className="text-sm font-medium text-destructive">{t("translation.replayGain.failedFiles")}</p>{writeFailures.map((failure) => (<p key={failure.file_path} className="mt-1 truncate text-xs text-muted-foreground" title={failure.error}>{fileNameFromPath(failure.file_path)}{ERROR_SEPARATOR}{translateMessage(failure.error || t("translation.replayGain.writeError"))}</p>))}</CardContent></Card>)}
    </div>) : activeItem?.state === "analyzing" ? (<div className="flex min-h-full items-center justify-center">
      <div className="w-full max-w-md space-y-2">
        <div className="flex items-center justify-between text-sm text-muted-foreground"><span>{t("translation.replayGain.analyzing")}</span>{isBatchMode && <span className="font-mono tabular-nums">{progress.completed}/{progress.total}</span>}</div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-primary/20"><div className="h-full w-2/3 animate-pulse rounded-full bg-primary"/></div>
        <p className="truncate text-center text-xs text-muted-foreground">{progress.fileName || activeItem.name}</p>
      </div>
    </div>) : activeItem?.state === "error" ? (<div className="flex min-h-full items-center justify-center">
      <div className="w-full max-w-md space-y-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center text-sm text-destructive"><p>{translateMessage(activeItem.error || t("translation.replayGain.analysisFailed"))}</p>{!analyzing && <Button onClick={analyzePending}>{t("translation.queue.retry")}</Button>}</div>
    </div>) : (<div className="flex min-h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground"><AudioWaveformIcon className="text-primary" size={36}/><span>{t("translation.replayGain.resultsAppearHere")}</span></div>);
    return (<div className="flex h-[calc(100dvh-5.5rem)] min-h-0 flex-col gap-6 md:h-[calc(100dvh-6.5rem)]">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t("translation.replayGain.title")}</h1>
        {items.length > 0 && (<div className="flex flex-wrap items-center gap-2">
          {isBatchMode && (analyzing || albumAnalyzing) && (<Button variant="destructive" onClick={stopAnalysis}><StopCircle className="h-4 w-4"/>{t("translation.common.stop")}</Button>)}
          {!analyzing && !albumAnalyzing && hasPending && (<Button onClick={analyzePending} disabled={writing}><Activity className="h-4 w-4"/>{t("translation.audioAnalysis.analyze")}</Button>)}
          {!analyzing && successfulItems.length > 0 && (<><HelpTooltip content={t("translation.replayGain.tagOnly")}/><Button onClick={() => setConfirmOpen(true)} disabled={busy}>{writing ? <Spinner className="h-4 w-4"/> : <Save className="h-4 w-4"/>}{writing ? t("translation.replayGain.writingTags") : t("translation.replayGain.writeTags")}</Button></>)}
          {isBatchMode && (<DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline" disabled={busy}><Upload className="mr-1 h-4 w-4"/>{t("translation.common.add")}<ChevronDown className="ml-1 h-4 w-4"/></Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="min-w-[180px]"><DropdownMenuItem onClick={() => void addFiles()} className="cursor-pointer"><Upload className="h-4 w-4"/>{t("translation.common.addFiles")}</DropdownMenuItem><DropdownMenuItem onClick={() => void addFolder()} className="cursor-pointer"><FolderOpen className="h-4 w-4"/>{t("translation.common.addFolder")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>)}
          {(isBatchMode || (isSingleMode && !analyzing && !albumAnalyzing && result)) && (<Button variant="destructive" onClick={clearAll} disabled={busy}><Trash2 className="h-4 w-4"/>{t("translation.common.clear")}</Button>)}
        </div>)}
      </div>

      {items.length === 0 && (<div className={`flex min-h-0 flex-1 flex-col items-center justify-center rounded-lg border-2 border-dashed transition-all ${isDragging ? "border-primary bg-primary/10" : "border-muted-foreground/30"}`} onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }} onDragLeave={(event) => { event.preventDefault(); setIsDragging(false); }} onDrop={(event) => { event.preventDefault(); setIsDragging(false); }} style={{ "--wails-drop-target": "drop" } as CSSProperties}>
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted"><Upload className="h-8 w-8 text-primary"/></div>
        <p className="mb-4 text-center text-sm text-muted-foreground">{isDragging ? t("translation.audioAnalysis.dropAudioFilesHere") : t("translation.audioAnalysis.dragDropAudioFilesHere")}</p>
        <div className="flex gap-3"><Button onClick={() => void addFiles()}><Upload className="h-4 w-4"/>{t("translation.common.selectFiles")}</Button><Button onClick={() => void addFolder()} variant="outline"><FolderOpen className="h-4 w-4"/>{t("translation.common.selectFolder")}</Button></div>
        <p className="mt-4 text-center text-xs text-muted-foreground">{t("translation.replayGain.supportedFormats")}</p>
      </div>)}

      {isSingleMode && (<div className="min-h-0 flex-1 overflow-y-auto pr-1 custom-scrollbar">{resultContent}</div>)}

      {isBatchMode && (<div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border">
        <div className="flex h-full w-full min-h-0 flex-col gap-3 p-3 md:flex-row">
          <div className="flex min-h-0 shrink-0 flex-col gap-3 md:w-72 md:border-r md:pr-3">
            <div className="flex shrink-0 items-center justify-between gap-3"><p className="text-sm font-medium">{t("translation.common.batchQueue")}</p><p className="text-xs text-muted-foreground">{t("translation.replayGain.batchSummary", { value1: items.length, value2: t("translation.audioAnalysis.queued"), value3: successfulItems.length, value4: t("translation.audioAnalysis.ready") })}</p></div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
              {items.map((item) => {
                const itemResult = item.result?.success ? item.result : null;
                const statusText = itemResult ? `${formatLoudness(itemResult.integrated_loudness)} · ${formatGain(REPLAYGAIN_TARGET - itemResult.integrated_loudness)}` : item.state === "error" ? translateMessage(item.error || t("translation.replayGain.analysisFailed")) : item.state === "analyzing" ? t("translation.replayGain.analyzing") : t("translation.replayGain.pending");
                return (<div key={item.path} role="button" tabIndex={0} className={`flex w-full cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${activeItem?.path === item.path ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`} onClick={() => setActiveSelection(item.path)} onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setActiveSelection(item.path);
                        }
                    }}>
                  <div className="mt-0.5 shrink-0">{statusIcon(item.state)}</div>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.name}</p><p className={`truncate text-xs ${item.state === "error" ? "text-destructive" : "text-muted-foreground"}`}>{statusText}</p><div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground"><span>{formatFileSize(item.size)}</span><span>{item.name.split(".").pop()?.toUpperCase() || t("translation.audioAnalysis.audio")}</span></div></div>
                  <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label={t("translation.replayGain.removeFile")} onClick={(event) => { event.stopPropagation(); removeItem(item.path); }} disabled={busy}><X className="h-4 w-4"/></Button>
                </div>);
            })}
            </div>
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1 custom-scrollbar">{resultContent}</div>
        </div>
      </div>)}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}><DialogContent className="max-w-md [&>button]:hidden"><DialogHeader><DialogTitle>{t("translation.replayGain.confirmTitle")}</DialogTitle><DialogDescription>{t("translation.replayGain.confirmDescription", { value1: successfulItems.length, value2: REPLAYGAIN_TARGET.toFixed(1) })}</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={() => setConfirmOpen(false)}>{t("translation.common.cancel")}</Button><Button onClick={() => void writeTags()}>{t("translation.replayGain.writeTags")}</Button></DialogFooter></DialogContent></Dialog>
    </div>);
}
