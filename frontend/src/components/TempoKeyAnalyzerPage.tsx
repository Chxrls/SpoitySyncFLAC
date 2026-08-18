import { t, translateMessage } from "@/i18n";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Activity, AlertCircle, ChevronDown, CircleCheckBig, CircleHelp, FileMusic, FolderOpen, KeyRound, StopCircle, Trash2, Upload, X, } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { GaugeIcon } from "@/components/ui/gauge";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { TempoKeyAnalyzer, base64PCMToArrayBuffer, camelotCode, normalizeRhythmConfidence, tempoDescription, type TempoKeyResult, } from "@/lib/tempo-key-analysis";
import { DecodeAudioForTempoKey, GetFileSizes, ListAudioFilesInDir, SelectAudioFiles, SelectFolder } from "../../wailsjs/go/main/App";
import { OnFileDrop, OnFileDropOff } from "../../wailsjs/runtime/runtime";
type AnalysisStatus = "pending" | "decoding" | "analyzing" | "success" | "error";
interface TempoKeyItem {
    id: string;
    path: string;
    name: string;
    size: number;
    duration?: number;
    status: AnalysisStatus;
    progress: number;
    stage?: string;
    result?: TempoKeyResult;
    error?: string;
}
interface PageCache {
    items: TempoKeyItem[];
    activeId: string | null;
}
const SUPPORTED_EXTENSIONS = [".flac", ".mp3", ".m4a", ".aac", ".wav", ".ogg"];
const SUPPORTED_LABEL = "FLAC, MP3, M4A, AAC, WAV, OGG";
let pageCache: PageCache = {
    items: [],
    activeId: null,
};
function fileNameFromPath(path: string): string {
    return path.split(/[/\\]/).pop() || path;
}
function isSupported(path: string): boolean {
    const normalized = path.toLowerCase();
    return SUPPORTED_EXTENSIONS.some((extension) => normalized.endsWith(extension));
}
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
function stageLabel(stage?: string): string {
    switch (stage) {
        case "preparing":
            return t("translation.tempoKey.preparingAudio");
        case "loadingEngine":
            return t("translation.tempoKey.loadingEngine");
        case "detectingTempo":
            return t("translation.tempoKey.detectingTempo");
        case "detectingKey":
            return t("translation.tempoKey.detectingKey");
        case "finalizing":
            return t("translation.tempoKey.finalizing");
        default:
            return t("translation.tempoKey.analyzing");
    }
}
function scaleLabel(scale: "major" | "minor"): string {
    return scale === "major"
        ? t("translation.tempoKey.major")
        : t("translation.tempoKey.minor");
}
function tempoLabel(bpm: number): string {
    switch (tempoDescription(bpm)) {
        case "slow":
            return t("translation.tempoKey.slow");
        case "moderate":
            return t("translation.tempoKey.moderate");
        case "upbeat":
            return t("translation.tempoKey.upbeat");
        case "fast":
            return t("translation.tempoKey.fast");
    }
}
function statusIcon(status: AnalysisStatus) {
    if (status === "decoding" || status === "analyzing") {
        return <Spinner className="h-4 w-4 text-primary"/>;
    }
    if (status === "success") {
        return <CircleCheckBig className="h-4 w-4 text-emerald-500"/>;
    }
    if (status === "error") {
        return <AlertCircle className="h-4 w-4 text-destructive"/>;
    }
    return <FileMusic className="h-4 w-4 text-muted-foreground"/>;
}
function itemStatusText(item: TempoKeyItem): string {
    if (item.status === "success" && item.result) {
        return `${Math.round(item.result.bpm)} ${t("translation.tempoKey.bpm")} · ${item.result.key} ${scaleLabel(item.result.scale)}`;
    }
    if (item.status === "error")
        return item.error ?? t("translation.tempoKey.analysisFailed");
    if (item.status === "decoding" || item.status === "analyzing")
        return stageLabel(item.stage);
    return t("translation.tempoKey.queued");
}
export function TempoKeyAnalyzerPage() {
    const [items, setItems] = useState<TempoKeyItem[]>(() => pageCache.items.map((item) => (item.status === "decoding" || item.status === "analyzing"
        ? { ...item, status: "pending", progress: 0, stage: undefined }
        : item)));
    const [activeId, setActiveId] = useState<string | null>(() => pageCache.activeId);
    const [isDragging, setIsDragging] = useState(false);
    const [isRunning, setIsRunning] = useState(false);
    const itemsRef = useRef(items);
    const activeIdRef = useRef(activeId);
    const runIdRef = useRef(0);
    const analyzerRef = useRef<TempoKeyAnalyzer | null>(null);
    useEffect(() => {
        itemsRef.current = items;
        pageCache = { ...pageCache, items };
    }, [items]);
    useEffect(() => {
        activeIdRef.current = activeId;
        pageCache = { ...pageCache, activeId };
    }, [activeId]);
    useEffect(() => {
        analyzerRef.current = new TempoKeyAnalyzer();
        return () => {
            analyzerRef.current?.dispose();
            analyzerRef.current = null;
        };
    }, []);
    const setActiveSelection = useCallback((id: string | null) => {
        activeIdRef.current = id;
        setActiveId(id);
    }, []);
    const runAnalysis = useCallback(async (entries: TempoKeyItem[]) => {
        if (entries.length === 0 || !analyzerRef.current)
            return;
        const runId = ++runIdRef.current;
        setIsRunning(true);
        let successCount = 0;
        let failureCount = 0;
        try {
            for (const entry of entries) {
                if (runIdRef.current !== runId)
                    return;
                setActiveSelection(entry.id);
                setItems((previous) => previous.map((item) => item.id === entry.id
                    ? { ...item, status: "decoding", progress: 5, stage: "preparing", error: undefined }
                    : item));
                try {
                    const decoded = await DecodeAudioForTempoKey(entry.path);
                    if (runIdRef.current !== runId)
                        return;
                    let pcmBase64 = decoded.pcm_base64;
                    const pcm = await base64PCMToArrayBuffer(pcmBase64, (progress) => {
                        setItems((previous) => previous.map((item) => item.id === entry.id
                            ? { ...item, progress: 8 + Math.round(progress * 0.17) }
                            : item));
                    });
                    pcmBase64 = "";
                    if (runIdRef.current !== runId || !analyzerRef.current)
                        return;
                    setItems((previous) => previous.map((item) => item.id === entry.id
                        ? {
                            ...item,
                            status: "analyzing",
                            progress: 25,
                            stage: "loadingEngine",
                            duration: decoded.duration,
                            size: decoded.file_size || item.size,
                        }
                        : item));
                    const result = await analyzerRef.current.analyze(pcm, decoded.sample_rate, (progress, stage) => {
                        if (runIdRef.current !== runId)
                            return;
                        setItems((previous) => previous.map((item) => item.id === entry.id
                            ? { ...item, progress: 25 + Math.round(progress * 0.75), stage }
                            : item));
                    });
                    if (runIdRef.current !== runId)
                        return;
                    successCount++;
                    setItems((previous) => previous.map((item) => item.id === entry.id
                        ? { ...item, status: "success", progress: 100, stage: undefined, result }
                        : item));
                    if (!activeIdRef.current || !itemsRef.current.some((item) => item.id === activeIdRef.current && item.status === "success")) {
                        setActiveSelection(entry.id);
                    }
                }
                catch (error) {
                    if (runIdRef.current !== runId || (error instanceof DOMException && error.name === "AbortError")) {
                        return;
                    }
                    failureCount++;
                    setItems((previous) => previous.map((item) => item.id === entry.id
                        ? {
                            ...item,
                            status: "error",
                            progress: 0,
                            stage: undefined,
                            error: translateMessage(error instanceof Error ? error.message : String(error)),
                        }
                        : item));
                    if (!activeIdRef.current)
                        setActiveSelection(entry.id);
                }
            }
            if (successCount > 0) {
                toast.success(t("translation.tempoKey.analysisComplete"), {
                    description: t("translation.tempoKey.analyzedFiles", { value1: successCount }),
                });
            }
            if (failureCount > 0) {
                toast.error(t("translation.tempoKey.analysisFailed"), {
                    description: t("translation.tempoKey.failedFiles", { value1: failureCount }),
                });
            }
        }
        finally {
            if (runIdRef.current === runId)
                setIsRunning(false);
        }
    }, [setActiveSelection]);
    const addPaths = useCallback(async (paths: string[]) => {
        if (isRunning) {
            toast.info(t("translation.audioAnalysis.analysisProgress"), {
                description: t("translation.tempoKey.waitForCurrentAnalysis"),
            });
            return;
        }
        const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
        const validPaths = uniquePaths.filter(isSupported);
        const invalidCount = uniquePaths.length - validPaths.length;
        if (invalidCount > 0) {
            toast.error(t("translation.common.unsupportedFormat"), {
                description: t("translation.tempoKey.supportedOnly", { value1: SUPPORTED_LABEL }),
            });
        }
        const existing = new Set(itemsRef.current.map((item) => item.id.toLowerCase()));
        const newPaths = validPaths.filter((path) => !existing.has(path.toLowerCase()));
        if (newPaths.length === 0) {
            if (validPaths.length > 0)
                toast.info(t("translation.common.noNewFilesAdded"));
            return;
        }
        const sizes = await GetFileSizes(newPaths);
        const additions: TempoKeyItem[] = newPaths.map((path) => ({
            id: path,
            path,
            name: fileNameFromPath(path),
            size: sizes[path] || 0,
            status: "pending",
            progress: 0,
        }));
        const shouldAutoAnalyze = itemsRef.current.length === 0 && additions.length === 1;
        setItems((previous) => [...previous, ...additions]);
        if (!activeIdRef.current)
            setActiveSelection(additions[0]?.id ?? null);
        if (shouldAutoAnalyze)
            void runAnalysis(additions);
    }, [isRunning, runAnalysis, setActiveSelection]);
    const handleSelectFiles = useCallback(async () => {
        try {
            const paths = await SelectAudioFiles();
            if (paths?.length)
                await addPaths(paths);
        }
        catch (error) {
            toast.error(t("translation.common.fileSelectionFailed"), {
                description: translateMessage(error instanceof Error ? error.message : String(error)),
            });
        }
    }, [addPaths]);
    const handleSelectFolder = useCallback(async () => {
        try {
            const folder = await SelectFolder("");
            if (!folder)
                return;
            const files = await ListAudioFilesInDir(folder);
            if (!files?.length) {
                toast.info(t("translation.common.noAudioFilesFound"));
                return;
            }
            await addPaths(files.map((file) => file.path));
        }
        catch (error) {
            toast.error(t("translation.common.folderSelectionFailed"), {
                description: translateMessage(error instanceof Error ? error.message : String(error)),
            });
        }
    }, [addPaths]);
    useEffect(() => {
        OnFileDrop((_x, _y, paths) => {
            setIsDragging(false);
            void addPaths(paths);
        }, true);
        return () => OnFileDropOff();
    }, [addPaths]);
    const stopAnalysis = useCallback(() => {
        runIdRef.current++;
        analyzerRef.current?.cancelAll();
        setItems((previous) => previous.map((item) => (item.status === "decoding" || item.status === "analyzing"
            ? { ...item, status: "pending", progress: 0, stage: undefined }
            : item)));
        setIsRunning(false);
        toast.info(t("translation.tempoKey.analysisStopped"));
    }, []);
    const analyzePending = useCallback(() => {
        const pending = itemsRef.current.filter((item) => item.status === "pending" || item.status === "error");
        if (pending.length > 0)
            void runAnalysis(pending);
    }, [runAnalysis]);
    const removeItem = useCallback((id: string) => {
        if (isRunning)
            return;
        const nextItems = itemsRef.current.filter((item) => item.id !== id);
        setItems(nextItems);
        if (activeIdRef.current === id) {
            setActiveSelection(nextItems.find((item) => item.status === "success")?.id ?? nextItems[0]?.id ?? null);
        }
    }, [isRunning, setActiveSelection]);
    const clearAll = useCallback(() => {
        if (isRunning)
            return;
        setItems([]);
        setActiveSelection(null);
    }, [isRunning, setActiveSelection]);
    const activeItem = items.find((item) => item.id === activeId) ?? null;
    const result = activeItem?.result;
    const hasPending = items.some((item) => item.status === "pending" || item.status === "error");
    const isSingleMode = items.length === 1;
    const isBatchMode = items.length > 1;
    const successCount = items.filter((item) => item.status === "success").length;
    const rhythmConfidence = result ? normalizeRhythmConfidence(result.rhythmConfidence) : 0;
    const keyConfidence = result ? Math.round(result.keyStrength * 100) : 0;
    const activeScaleLabel = result ? scaleLabel(result.scale) : "";
    const roundedBpm = result ? Math.round(result.bpm) : 0;
    const resultContent = result && activeItem ? (<div className="mx-auto w-full max-w-6xl space-y-3">
            <Card className="gap-1 py-4">
                <CardHeader className="gap-1 px-4 pb-1">
                    <CardTitle className="text-base">{activeItem.name}</CardTitle>
                    <p className="truncate font-mono text-xs text-muted-foreground" title={activeItem.path}>{activeItem.path}</p>
                </CardHeader>
                <CardContent className="px-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div className="space-y-1.5">
                            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("translation.tempoKey.musicalKey")}</p>
                            <div className="flex items-end gap-3">
                                <span className="font-mono text-4xl font-bold text-primary">{result.key}</span>
                                <span className="pb-1 text-sm font-medium text-muted-foreground">{activeScaleLabel}</span>
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("translation.tempoKey.tempo")}</p>
                            <div className="flex items-baseline gap-2">
                                <span className="font-mono text-4xl font-bold">{roundedBpm}</span>
                                <span className="text-sm font-medium text-muted-foreground">{t("translation.tempoKey.bpm")}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">{tempoLabel(result.bpm)}</p>
                        </div>
                        <div className="space-y-1.5">
                            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("translation.tempoKey.camelot")}</p>
                            <p className="font-mono text-4xl font-bold">{camelotCode(result.key, result.scale)}</p>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <Card className="gap-1 py-4">
                <CardHeader className="px-4 pb-1">
                    <CardTitle className="text-base">{t("translation.tempoKey.analysisDetails")}</CardTitle>
                </CardHeader>
                <CardContent className="px-4">
                    <div className="grid grid-cols-1 items-center gap-5 lg:grid-cols-2 lg:gap-6">
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="flex items-center gap-2 text-muted-foreground">
                                        <KeyRound className="h-4 w-4 text-primary"/>
                                        {t("translation.tempoKey.keyConfidence")}
                                        <Tooltip delayDuration={150}>
                                            <TooltipTrigger asChild>
                                                <span className="inline-flex cursor-help" tabIndex={0} aria-label={t("translation.tempoKey.keyConfidenceHelp")}>
                                                    <CircleHelp className="h-3.5 w-3.5"/>
                                                </span>
                                            </TooltipTrigger>
                                            <TooltipContent side="left" sideOffset={8} collisionPadding={16} className="max-w-[calc(100vw-2rem)] text-left text-pretty sm:max-w-[32rem]">
                                                <p>{t("translation.tempoKey.keyConfidenceHelp")}</p>
                                            </TooltipContent>
                                        </Tooltip>
                                    </span>
                                    <span className="font-mono font-medium">{keyConfidence}%</span>
                                </div>
                                <Progress value={keyConfidence} className="h-2"/>
                            </div>
                            <div className="space-y-1.5">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="flex items-center gap-2 text-muted-foreground">
                                        <Activity className="h-4 w-4 text-primary"/>
                                        {t("translation.tempoKey.beatConfidence")}
                                        <Tooltip delayDuration={150}>
                                            <TooltipTrigger asChild>
                                                <span className="inline-flex cursor-help" tabIndex={0} aria-label={t("translation.tempoKey.beatConfidenceHelp")}>
                                                    <CircleHelp className="h-3.5 w-3.5"/>
                                                </span>
                                            </TooltipTrigger>
                                            <TooltipContent side="left" sideOffset={8} collisionPadding={16} className="max-w-[calc(100vw-2rem)] text-left text-pretty sm:max-w-[32rem]">
                                                <p>{t("translation.tempoKey.beatConfidenceHelp")}</p>
                                            </TooltipContent>
                                        </Tooltip>
                                    </span>
                                    <span className="font-mono font-medium">{rhythmConfidence}%</span>
                                </div>
                                <Progress value={rhythmConfidence} className="h-2"/>
                            </div>
                        </div>
                        <div>
                            <ul className="space-y-1.5 text-sm">
                                <li className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-3"><span className="whitespace-nowrap text-muted-foreground">{t("translation.tempoKey.exactTempo")}</span><span className="whitespace-nowrap text-right font-mono font-medium">{result.bpm.toFixed(2)} {t("translation.tempoKey.bpm")}</span></li>
                                <li className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-3"><span className="whitespace-nowrap text-muted-foreground">{t("translation.common.duration")}</span><span className="whitespace-nowrap text-right font-mono font-medium">{formatDuration(activeItem.duration)}</span></li>
                                <li className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-3"><span className="whitespace-nowrap text-muted-foreground">{t("translation.tempoKey.fileSize")}</span><span className="whitespace-nowrap text-right font-mono font-medium">{formatFileSize(activeItem.size)}</span></li>
                                <li className="grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-3"><span className="whitespace-nowrap text-muted-foreground">{t("translation.tempoKey.analysisRate")}</span><span className="whitespace-nowrap text-right font-mono font-medium">{t("literal.settings.value44Value1Khz")} · {t("literal.audioAnalysis.mono")}</span></li>
                            </ul>
                        </div>
                    </div>
                </CardContent>
            </Card>

        </div>) : activeItem?.status === "decoding" || activeItem?.status === "analyzing" ? (<div className="flex min-h-full items-center justify-center">
            <div className="w-full max-w-md space-y-2">
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>{stageLabel(activeItem.stage)}</span>
                    <span className="font-mono tabular-nums">{activeItem.progress}%</span>
                </div>
                <Progress value={activeItem.progress} className="h-2 w-full"/>
                <p className="truncate text-center text-xs text-muted-foreground">{activeItem.name}</p>
            </div>
        </div>) : activeItem?.status === "error" ? (<div className="flex min-h-full items-center justify-center">
            <div className="w-full max-w-md space-y-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-center text-sm text-destructive">
                <p>{activeItem.error}</p>
                {!isRunning && <Button onClick={analyzePending}>{t("translation.queue.retry")}</Button>}
            </div>
        </div>) : (<div className="flex min-h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
            <GaugeIcon className="text-primary" size={36}/>
            <span>{t("translation.tempoKey.resultsAppearHere")}</span>
        </div>);
    return (<div className="flex h-[calc(100dvh-5.5rem)] min-h-0 flex-col gap-6 md:h-[calc(100dvh-6.5rem)]">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
            <h1 className="text-2xl font-bold">{t("translation.tempoKey.title")}</h1>
            {items.length > 0 && (<div className="flex flex-wrap gap-2">
                {isBatchMode && isRunning && (<Button variant="destructive" onClick={stopAnalysis}>
                    <StopCircle className="h-4 w-4"/>
                    {t("translation.common.stop")}
                </Button>)}
                {!isRunning && hasPending && (<Button onClick={analyzePending}>
                    <Activity className="h-4 w-4"/>
                    {t("translation.audioAnalysis.analyze")}
                </Button>)}
                {isBatchMode && (<DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="outline" disabled={isRunning}>
                            <Upload className="mr-1 h-4 w-4"/>
                            {t("translation.common.add")}
                            <ChevronDown className="ml-1 h-4 w-4"/>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[180px]">
                        <DropdownMenuItem onClick={handleSelectFiles} className="cursor-pointer">
                            <Upload className="h-4 w-4"/>
                            {t("translation.common.addFiles")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={handleSelectFolder} className="cursor-pointer">
                            <FolderOpen className="h-4 w-4"/>
                            {t("translation.common.addFolder")}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>)}
                {(isBatchMode || (isSingleMode && activeItem?.status === "success" && result)) && (<Button variant="destructive" onClick={clearAll} disabled={isRunning}>
                        <Trash2 className="h-4 w-4"/>
                        {t("translation.common.clear")}
                    </Button>)}
            </div>)}
        </div>

        {items.length === 0 && (<div className={`flex min-h-0 flex-1 flex-col items-center justify-center rounded-lg border-2 border-dashed transition-all ${isDragging ? "border-primary bg-primary/10" : "border-muted-foreground/30"}`} onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }} onDragLeave={(event) => { event.preventDefault(); setIsDragging(false); }} onDrop={(event) => { event.preventDefault(); setIsDragging(false); }} style={{ "--wails-drop-target": "drop" } as CSSProperties}>
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                <Upload className="h-8 w-8 text-primary"/>
            </div>
            <p className="mb-4 text-center text-sm text-muted-foreground">
                {isDragging ? t("translation.audioAnalysis.dropAudioFilesHere") : t("translation.audioAnalysis.dragDropAudioFilesHere")}
            </p>
            <div className="flex gap-3">
                <Button onClick={handleSelectFiles}>
                    <Upload className="h-4 w-4"/>
                    {t("translation.common.selectFiles")}
                </Button>
                <Button onClick={handleSelectFolder} variant="outline">
                    <FolderOpen className="h-4 w-4"/>
                    {t("translation.common.selectFolder")}
                </Button>
            </div>
            <p className="mt-4 text-center text-xs text-muted-foreground">{t("translation.tempoKey.supportedFormats")}</p>
        </div>)}

        {isSingleMode && (<div className="min-h-0 flex-1 overflow-y-auto pr-1 custom-scrollbar">{resultContent}</div>)}

        {isBatchMode && (<div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border">
            <div className="flex h-full w-full min-h-0 flex-col gap-4 p-4 md:flex-row">
                <div className="flex min-h-0 shrink-0 flex-col gap-3 md:w-80 md:border-r md:pr-4">
                    <div className="flex shrink-0 items-center justify-between gap-3">
                        <p className="text-sm font-medium">{t("translation.common.batchQueue")}</p>
                        <p className="text-xs text-muted-foreground">{items.length} {t("translation.audioAnalysis.queued")} {" • "}{successCount} {t("translation.audioAnalysis.ready")}</p>
                    </div>
                    <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                        {items.map((item) => (<div key={item.id} role="button" tabIndex={0} className={`flex w-full cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${activeId === item.id ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`} onClick={() => setActiveSelection(item.id)} onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setActiveSelection(item.id);
                    }
                }}>
                            <div className="mt-0.5 shrink-0">{statusIcon(item.status)}</div>
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium">{item.name}</p>
                                <p className={`truncate text-xs ${item.status === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                                    {itemStatusText(item)}
                                </p>
                                <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                                    <span>{formatFileSize(item.size)}</span>
                                    <span>{item.name.split(".").pop()?.toUpperCase() || t("translation.audioAnalysis.audio")}</span>
                                </div>
                            </div>
                            <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={(event) => { event.stopPropagation(); removeItem(item.id); }} disabled={isRunning}>
                                <X className="h-4 w-4"/>
                            </Button>
                        </div>))}
                    </div>
                </div>
                <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1 custom-scrollbar">{resultContent}</div>
            </div>
        </div>)}
    </div>);
}
