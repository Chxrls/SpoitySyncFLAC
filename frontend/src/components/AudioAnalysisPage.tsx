import { useState, useCallback, useRef, useEffect, type ChangeEvent, type CSSProperties, type DragEvent } from "react";
import { t, translateMessage } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Upload, ArrowLeft, Trash2, Download, FolderOpen, X, AlertCircle, CircleCheckBig, FileMusic, ChevronDown, Activity, StopCircle } from "lucide-react";
import { AudioAnalysis } from "@/components/AudioAnalysis";
import { SpectrumVisualization, createSpectrogramDataURL, type SpectrumVisualizationHandle } from "@/components/SpectrumVisualization";
import { useAudioAnalysis } from "@/hooks/useAudioAnalysis";
import type { AnalysisResult } from "@/types/api";
import { loadAudioAnalysisPreferences } from "@/lib/audio-analysis-preferences";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { GetFileSizes, ListAudioFilesInDir, SaveSpectrumImage, SelectFolder } from "../../wailsjs/go/main/App";
import { OnFileDrop, OnFileDropOff } from "../../wailsjs/runtime/runtime";
interface AudioAnalysisPageProps {
    onBack?: () => void;
}
type BatchItemStatus = "pending" | "analyzing" | "success" | "error";
type BatchItemSource = "path" | "browser";
interface BatchAnalysisItem {
    id: string;
    source: BatchItemSource;
    path: string;
    name: string;
    size: number;
    status: BatchItemStatus;
    error?: string;
    result?: AnalysisResult;
    file?: File;
}
interface QueueProgressState {
    completed: number;
    total: number;
    fileName: string;
}
interface AudioAnalysisPageCache {
    items: BatchAnalysisItem[];
    activeItemId: string | null;
}
let audioAnalysisPageCache: AudioAnalysisPageCache = {
    items: [],
    activeItemId: null,
};
const EMPTY_PROGRESS_STATE: QueueProgressState = {
    completed: 0,
    total: 0,
    fileName: "",
};
const SUPPORTED_AUDIO_EXTENSIONS = [".flac", ".mp3", ".m4a", ".aac"];
const SUPPORTED_AUDIO_ACCEPT = [
    ".flac",
    ".mp3",
    ".m4a",
    ".aac",
    "audio/flac",
    "audio/x-flac",
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/x-m4a",
    "audio/aac",
    "audio/aacp",
].join(",");
const SUPPORTED_AUDIO_LABEL = "FLAC, MP3, M4A, or AAC";
function isSupportedAudioPath(filePath: string): boolean {
    const normalized = filePath.toLowerCase();
    return SUPPORTED_AUDIO_EXTENSIONS.some((ext) => normalized.endsWith(ext));
}
function isSupportedAudioFile(file: File): boolean {
    const normalizedName = file.name.toLowerCase();
    const normalizedType = file.type.toLowerCase();
    return (SUPPORTED_AUDIO_EXTENSIONS.some((ext) => normalizedName.endsWith(ext)) ||
        normalizedType === "audio/flac" ||
        normalizedType === "audio/x-flac" ||
        normalizedType === "audio/mpeg" ||
        normalizedType === "audio/mp3" ||
        normalizedType === "audio/mp4" ||
        normalizedType === "audio/x-m4a" ||
        normalizedType === "audio/aac" ||
        normalizedType === "audio/aacp");
}
function isAbsolutePath(filePath: string): boolean {
    return /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(filePath);
}
function fileNameFromPath(filePath: string): string {
    const parts = filePath.split(/[/\\]/);
    return parts[parts.length - 1] || filePath;
}
function browserFileId(file: File): string {
    return `browser:${file.name}:${file.size}:${file.lastModified}`;
}
function downloadDataURL(dataUrl: string, fileName: string): void {
    const link = document.createElement("a");
    link.href = dataUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
function formatFileSize(bytes: number): string {
    if (bytes <= 0) {
        return "0 B";
    }
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const index = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
    return `${parseFloat((bytes / Math.pow(k, index)).toFixed(1))} ${sizes[index]}`;
}
function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}
function itemMetaLine(item: BatchAnalysisItem): string {
    if (item.result) {
        const parts = [
            item.result.file_type ?? "Audio",
            `${(item.result.sample_rate / 1000).toFixed(1)} kHz`,
            formatDuration(item.result.duration),
        ];
        if (typeof item.result.bitrate_kbps === "number" && item.result.bitrate_kbps > 0) {
            parts.push(`${item.result.bitrate_kbps} kbps`);
        }
        return parts.join(" • ");
    }
    switch (item.status) {
        case "analyzing":
            return t("translation.audioAnalysis.analyzingAudioQuality");
        case "error":
            return translateMessage(item.error || t("translation.download.analysisFailed"));
        case "pending":
        default:
            return t("translation.audioAnalysis.queued");
    }
}
function statusIcon(status: BatchItemStatus) {
    switch (status) {
        case "analyzing":
            return <Spinner className="h-4 w-4 text-primary"/>;
        case "success":
            return <CircleCheckBig className="h-4 w-4 text-green-500"/>;
        case "error":
            return <AlertCircle className="h-4 w-4 text-destructive"/>;
        case "pending":
        default:
            return <FileMusic className="h-4 w-4 text-muted-foreground"/>;
    }
}
export function AudioAnalysisPage({ onBack }: AudioAnalysisPageProps) {
    const { analysisProgress, spectrumLoading, spectrumProgress, analyzeFile, analyzeFilePath, cancelAnalysis, loadStoredAnalysis, clearStoredAnalysis, reAnalyzeSpectrum, clearResult, } = useAudioAnalysis();
    const [items, setItems] = useState<BatchAnalysisItem[]>(() => audioAnalysisPageCache.items.map((item) => item.status === "analyzing" ? { ...item, status: "pending" } : item));
    const [activeItemId, setActiveItemId] = useState<string | null>(() => audioAnalysisPageCache.activeItemId);
    const [isDragging, setIsDragging] = useState(false);
    const [isExportingSelected, setIsExportingSelected] = useState(false);
    const [isExportingBatch, setIsExportingBatch] = useState(false);
    const [isBatchRunning, setIsBatchRunning] = useState(false);
    const [exportProgress, setExportProgress] = useState<QueueProgressState>(EMPTY_PROGRESS_STATE);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const spectrumRef = useRef<SpectrumVisualizationHandle>(null);
    const batchRunIdRef = useRef(0);
    const itemsRef = useRef(items);
    const activeItemIdRef = useRef<string | null>(activeItemId);
    useEffect(() => {
        itemsRef.current = items;
        audioAnalysisPageCache = { ...audioAnalysisPageCache, items };
    }, [items]);
    useEffect(() => {
        activeItemIdRef.current = activeItemId;
        audioAnalysisPageCache = { ...audioAnalysisPageCache, activeItemId };
    }, [activeItemId]);
    const setActiveSelection = useCallback((nextId: string | null) => {
        activeItemIdRef.current = nextId;
        setActiveItemId(nextId);
    }, []);
    const activeItem = items.find((item) => item.id === activeItemId) ?? null;
    const successItems = items.filter((item) => item.status === "success" && item.result?.spectrum);
    const pendingItems = items.filter((item) => item.status === "pending");
    const isSingleMode = items.length === 1;
    const isBatchMode = items.length > 1;
    const canResumeBatch = isBatchMode && !isBatchRunning && pendingItems.length > 0;
    const exportPercent = exportProgress.total > 0
        ? Math.round(Math.max(0, Math.min(100, (exportProgress.completed / exportProgress.total) * 100)))
        : 0;
    useEffect(() => {
        if (!activeItem?.result) {
            return;
        }
        loadStoredAnalysis(activeItem.id, activeItem.result, activeItem.path);
    }, [activeItem, loadStoredAnalysis]);
    const runBatchAnalysis = useCallback(async (entries: BatchAnalysisItem[]) => {
        if (entries.length === 0) {
            return;
        }
        const runId = batchRunIdRef.current + 1;
        batchRunIdRef.current = runId;
        setIsBatchRunning(true);
        let successCount = 0;
        let failCount = 0;
        try {
            for (let index = 0; index < entries.length; index++) {
                if (batchRunIdRef.current !== runId) {
                    return;
                }
                const entry = entries[index];
                setActiveSelection(entry.id);
                setItems((prev) => prev.map((item) => item.id === entry.id
                    ? { ...item, status: "analyzing", error: undefined }
                    : item));
                const outcome = entry.source === "browser" && entry.file
                    ? await analyzeFile(entry.file, {
                        analysisKey: entry.id,
                        displayPath: entry.path,
                        suppressToast: true,
                    })
                    : await analyzeFilePath(entry.path, {
                        analysisKey: entry.id,
                        displayPath: entry.path,
                        suppressToast: true,
                    });
                if (batchRunIdRef.current !== runId) {
                    return;
                }
                if (outcome.cancelled) {
                    return;
                }
                if (outcome.result) {
                    const analysisResult = outcome.result;
                    successCount++;
                    setItems((prev) => prev.map((item) => item.id === entry.id
                        ? {
                            ...item,
                            status: "success",
                            error: undefined,
                            result: analysisResult,
                            size: analysisResult.file_size || item.size,
                        }
                        : item));
                    const hasSelectedSuccess = itemsRef.current.some((item) => item.id === activeItemIdRef.current && item.status === "success" && item.result);
                    if (!hasSelectedSuccess) {
                        setActiveSelection(entry.id);
                    }
                }
                else {
                    failCount++;
                    setItems((prev) => prev.map((item) => item.id === entry.id
                        ? {
                            ...item,
                            status: "error",
                            error: outcome.error || t("translation.download.analysisFailed"),
                        }
                        : item));
                    if (!activeItemIdRef.current) {
                        setActiveSelection(entry.id);
                    }
                }
            }
            if (batchRunIdRef.current === runId) {
                if (successCount > 0) {
                    toast.success(t("translation.analysis.batchComplete"), {
                        description: t("translation.analysis.success", { count: successCount, failures: failCount > 0 ? t("translation.common.failures", { count: failCount }) : "" }),
                    });
                }
                else if (failCount > 0) {
                    toast.error(t("translation.analysis.batchFailed"), {
                        description: t("translation.analysis.allFailed", { count: failCount }),
                    });
                }
            }
        }
        finally {
            if (batchRunIdRef.current === runId) {
                setIsBatchRunning(false);
            }
        }
    }, [analyzeFile, analyzeFilePath, setActiveSelection]);
    const ensureIdleQueue = useCallback(() => {
        if (!isBatchRunning) {
            return true;
        }
        toast.info(t("translation.audioAnalysis.analysisProgress"), {
            description: t("translation.audioAnalysis.pleaseWaitCurrentBatchFinish"),
        });
        return false;
    }, [isBatchRunning]);
    const addPathItems = useCallback(async (paths: string[]) => {
        if (!ensureIdleQueue()) {
            return;
        }
        const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
        const invalidCount = uniquePaths.filter((path) => !isSupportedAudioPath(path)).length;
        const validPaths = uniquePaths.filter(isSupportedAudioPath);
        if (invalidCount > 0) {
            toast.error(t("translation.common.unsupportedFormat"), {
                description: t("translation.audioAnalysis.onlyValue1FilesCanBe", { value1: SUPPORTED_AUDIO_LABEL }),
            });
        }
        if (validPaths.length === 0) {
            return;
        }
        const existingIds = new Set(itemsRef.current.map((item) => item.id));
        const newPaths = validPaths.filter((path) => !existingIds.has(path));
        if (newPaths.length === 0) {
            toast.info(t("translation.common.noNewFilesAdded"), {
                description: t("translation.audioAnalysis.allSelectedFilesWereAlready"),
            });
            return;
        }
        const fileSizes = await GetFileSizes(newPaths);
        const newItems = newPaths.map((path) => ({
            id: path,
            source: "path" as const,
            path,
            name: fileNameFromPath(path),
            size: fileSizes[path] || 0,
            status: "pending" as const,
        }));
        if (validPaths.length !== newPaths.length) {
            toast.info(t("translation.common.someFilesSkipped"), {
                description: t("translation.analysis.skipped", { count: newPaths.length - validPaths.length }),
            });
        }
        setItems((prev) => [...prev, ...newItems]);
        if (!activeItemIdRef.current) {
            setActiveSelection(newItems[0]?.id ?? null);
        }
        if (itemsRef.current.length === 0 && newItems.length === 1) {
            void runBatchAnalysis(newItems);
        }
    }, [ensureIdleQueue, runBatchAnalysis, setActiveSelection]);
    const addBrowserFiles = useCallback(async (files: File[]) => {
        if (!ensureIdleQueue()) {
            return;
        }
        const validFiles = files.filter(isSupportedAudioFile);
        const invalidCount = files.length - validFiles.length;
        if (invalidCount > 0) {
            toast.error(t("translation.common.unsupportedFormat"), {
                description: t("translation.audioAnalysis.onlyValue1FilesCanBe", { value1: SUPPORTED_AUDIO_LABEL }),
            });
        }
        if (validFiles.length === 0) {
            return;
        }
        const existingIds = new Set(itemsRef.current.map((item) => item.id));
        const newItems = validFiles
            .map((file) => ({
            id: browserFileId(file),
            source: "browser" as const,
            path: file.name,
            name: file.name,
            size: file.size,
            status: "pending" as const,
            file,
        }))
            .filter((item) => !existingIds.has(item.id));
        if (newItems.length === 0) {
            toast.info(t("translation.common.noNewFilesAdded"), {
                description: t("translation.audioAnalysis.allSelectedFilesWereAlready"),
            });
            return;
        }
        if (validFiles.length !== newItems.length) {
            toast.info(t("translation.common.someFilesSkipped"), {
                description: t("translation.analysis.skipped", { count: newItems.length - validFiles.length }),
            });
        }
        setItems((prev) => [...prev, ...newItems]);
        if (!activeItemIdRef.current) {
            setActiveSelection(newItems[0]?.id ?? null);
        }
        if (itemsRef.current.length === 0 && newItems.length === 1) {
            void runBatchAnalysis(newItems);
        }
    }, [ensureIdleQueue, runBatchAnalysis, setActiveSelection]);
    const handleSelectFiles = useCallback(() => {
        if (!ensureIdleQueue()) {
            return;
        }
        fileInputRef.current?.click();
    }, [ensureIdleQueue]);
    const handleSelectFolder = useCallback(async () => {
        if (!ensureIdleQueue()) {
            return;
        }
        try {
            const selectedFolder = await SelectFolder("");
            if (!selectedFolder) {
                return;
            }
            const folderFiles = await ListAudioFilesInDir(selectedFolder);
            if (!folderFiles || folderFiles.length === 0) {
                toast.info(t("translation.common.noAudioFilesFound"), {
                    description: t("translation.audioAnalysis.noValue1FilesWereFound", { value1: SUPPORTED_AUDIO_LABEL }),
                });
                return;
            }
            await addPathItems(folderFiles.map((file) => file.path));
        }
        catch (err) {
            toast.error(t("translation.common.folderSelectionFailed"), {
                description: err instanceof Error ? translateMessage(err.message) : t("translation.fileManager.failedSelectFolder"),
            });
        }
    }, [addPathItems, ensureIdleQueue]);
    const handleInputChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = "";
        if (files.length === 0) {
            return;
        }
        await addBrowserFiles(files);
    }, [addBrowserFiles]);
    const handleHtmlDrop = useCallback(async (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDragging(false);
        const files = Array.from(event.dataTransfer.files ?? []);
        if (files.length === 0) {
            return;
        }
        await addBrowserFiles(files);
    }, [addBrowserFiles]);
    useEffect(() => {
        OnFileDrop((_x, _y, paths) => {
            setIsDragging(false);
            if (!paths || paths.length === 0) {
                return;
            }
            void addPathItems(paths);
        }, true);
        return () => {
            OnFileDropOff();
        };
    }, [addPathItems]);
    const handleSelectItem = useCallback((itemId: string) => {
        setActiveSelection(itemId);
    }, [setActiveSelection]);
    const handleRemoveItem = useCallback((itemId: string) => {
        if (isBatchRunning || isExportingBatch || isExportingSelected || spectrumLoading) {
            return;
        }
        clearStoredAnalysis(itemId);
        const nextItems = itemsRef.current.filter((item) => item.id !== itemId);
        itemsRef.current = nextItems;
        setItems(nextItems);
        if (activeItemIdRef.current === itemId) {
            const nextActive = nextItems.find((item) => item.status === "success" && item.result) ?? nextItems[0] ?? null;
            setActiveSelection(nextActive?.id ?? null);
            if (!nextActive) {
                clearResult();
            }
        }
    }, [clearResult, clearStoredAnalysis, isBatchRunning, isExportingBatch, isExportingSelected, setActiveSelection, spectrumLoading]);
    const handleClearAll = useCallback(() => {
        if (isExportingBatch || isExportingSelected) {
            return;
        }
        batchRunIdRef.current += 1;
        itemsRef.current = [];
        setItems([]);
        setActiveSelection(null);
        clearStoredAnalysis();
        clearResult();
        setIsBatchRunning(false);
        setExportProgress(EMPTY_PROGRESS_STATE);
        setIsDragging(false);
    }, [clearResult, clearStoredAnalysis, isExportingBatch, isExportingSelected, setActiveSelection]);
    const handleStopBatch = useCallback(() => {
        if (!isBatchRunning) {
            return;
        }
        batchRunIdRef.current += 1;
        cancelAnalysis();
        setIsBatchRunning(false);
        setItems((prev) => prev.map((item) => item.status === "analyzing"
            ? {
                ...item,
                status: "pending",
            }
            : item));
        toast.info(t("translation.audioAnalysis.batchAnalysisStopped"), {
            description: t("translation.audioAnalysis.clickAnalyzeContinueRemainingFiles"),
        });
    }, [cancelAnalysis, isBatchRunning]);
    const handleAnalyzePending = useCallback(() => {
        if (isBatchRunning || isExportingBatch || isExportingSelected || spectrumLoading) {
            return;
        }
        const nextPendingItems = itemsRef.current.filter((item) => item.status === "pending");
        if (nextPendingItems.length === 0) {
            return;
        }
        void runBatchAnalysis(nextPendingItems);
    }, [isBatchRunning, isExportingBatch, isExportingSelected, runBatchAnalysis, spectrumLoading]);
    const handleExportSelected = useCallback(async () => {
        if (!activeItem?.result?.spectrum || !spectrumRef.current) {
            return;
        }
        const dataUrl = spectrumRef.current.getCanvasDataURL();
        if (!dataUrl) {
            toast.error(t("translation.audioAnalysis.exportFailed"), {
                description: t("translation.audioAnalysis.cannotGetCanvasData"),
            });
            return;
        }
        setIsExportingSelected(true);
        try {
            if (activeItem.source === "path" && isAbsolutePath(activeItem.path)) {
                const outPath = await SaveSpectrumImage(activeItem.path, dataUrl);
                toast.success(t("translation.audioAnalysis.pngExported"), {
                    description: t("translation.audioAnalysis.savedValue1", { value1: outPath }),
                });
                return;
            }
            const baseName = activeItem.name.replace(/\.[^/.]+$/, "") || "spectrogram";
            downloadDataURL(dataUrl, `${baseName}_spectrogram.png`);
            toast.success(t("translation.audioAnalysis.pngExported"), {
                description: t("translation.audioAnalysis.spectrogramImageDownloaded"),
            });
        }
        catch (err) {
            toast.error(t("translation.audioAnalysis.exportFailed"), {
                description: err instanceof Error ? translateMessage(err.message) : t("translation.audioAnalysis.failedExportImage"),
            });
        }
        finally {
            setIsExportingSelected(false);
        }
    }, [activeItem]);
    const handleBatchExport = useCallback(async () => {
        const exportableItems = itemsRef.current.filter((item) => item.status === "success" && item.result?.spectrum);
        if (exportableItems.length === 0) {
            toast.error(t("translation.audioAnalysis.nothingExport"), {
                description: t("translation.audioAnalysis.analyzeLeastOneFileSuccessfully"),
            });
            return;
        }
        const preferences = loadAudioAnalysisPreferences();
        setIsExportingBatch(true);
        setExportProgress({
            completed: 0,
            total: exportableItems.length,
            fileName: exportableItems[0]?.name ?? "",
        });
        let successCount = 0;
        let failCount = 0;
        try {
            for (let index = 0; index < exportableItems.length; index++) {
                const item = exportableItems[index];
                const result = item.result;
                if (!result?.spectrum) {
                    failCount++;
                    continue;
                }
                setExportProgress({
                    completed: index,
                    total: exportableItems.length,
                    fileName: item.name,
                });
                try {
                    const dataUrl = await createSpectrogramDataURL({
                        spectrumData: result.spectrum,
                        sampleRate: result.sample_rate,
                        duration: result.duration,
                        freqScale: preferences.freqScale,
                        colorScheme: preferences.colorScheme,
                        fileName: item.name,
                    });
                    if (item.source === "path" && isAbsolutePath(item.path)) {
                        await SaveSpectrumImage(item.path, dataUrl);
                    }
                    else {
                        const baseName = item.name.replace(/\.[^/.]+$/, "") || "spectrogram";
                        downloadDataURL(dataUrl, `${baseName}_spectrogram.png`);
                    }
                    successCount++;
                }
                catch {
                    failCount++;
                }
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
            setExportProgress({
                completed: exportableItems.length,
                total: exportableItems.length,
                fileName: "",
            });
            if (successCount > 0) {
                toast.success(t("translation.audioAnalysis.batchPngExportComplete"), {
                    description: t("translation.analysis.exported", { count: successCount, failures: failCount > 0 ? t("translation.common.failures", { count: failCount }) : "" }),
                });
            }
            else {
                toast.error(t("translation.audioAnalysis.batchPngExportFailed"), {
                    description: t("translation.audioAnalysis.noSpectrogramPngFilesWere"),
                });
            }
        }
        finally {
            setIsExportingBatch(false);
        }
    }, []);
    const handleReAnalyzeSelectedSpectrum = useCallback(async (fftSize: number, windowFunction: string) => {
        if (!activeItem?.result) {
            return;
        }
        const nextResult = await reAnalyzeSpectrum(fftSize, windowFunction);
        if (!nextResult) {
            return;
        }
        setItems((prev) => prev.map((item) => item.id === activeItem.id
            ? {
                ...item,
                result: nextResult,
                status: "success",
                error: undefined,
            }
            : item));
    }, [activeItem, reAnalyzeSpectrum]);
    const batchDetailContent = !activeItem ? (<Card>
            <CardContent className="flex min-h-[320px] items-center justify-center px-6 py-10">
                <p className="text-sm text-muted-foreground">
                    {t("translation.audioAnalysis.selectFileBatchQueueInspect")}
                </p>
            </CardContent>
        </Card>) : activeItem.status === "pending" ? (<div className="flex min-h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
            <Activity className="h-9 w-9 text-primary"/>
            <span>{t("translation.audioAnalysis.fileQueuedWaitingBatchAnalysis")}</span>
        </div>) : activeItem.status === "analyzing" ? (<div className="flex min-h-full items-center justify-center">
            <div className="w-full max-w-md space-y-2">
                <div className="flex items-center justify-between gap-4 text-sm text-muted-foreground">
                    <span className="truncate">{analysisProgress.message || t("translation.audioAnalysis.analyzingAudioQuality")}</span>
                    <span className="shrink-0 tabular-nums">{analysisProgress.percent}%</span>
                </div>
                <Progress value={analysisProgress.percent} className="h-2 w-full"/>
                <p className="truncate text-center text-xs text-muted-foreground">{activeItem.name}</p>
            </div>
        </div>) : activeItem.status === "error" ? (<div className="flex min-h-full items-center justify-center">
            <div className="w-full max-w-md rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                {translateMessage(activeItem.error || t("translation.download.analysisFailed"))}
            </div>
        </div>) : activeItem.status !== "success" || !activeItem.result ? null : (<div className="space-y-4">
            <AudioAnalysis result={activeItem.result} analyzing={false} showAnalyzeButton={false} filePath={activeItem.path}/>

            <SpectrumVisualization ref={spectrumRef} sampleRate={activeItem.result.sample_rate} duration={activeItem.result.duration} spectrumData={activeItem.result.spectrum} fileName={activeItem.name} onReAnalyze={handleReAnalyzeSelectedSpectrum} isAnalyzingSpectrum={spectrumLoading} spectrumProgress={spectrumProgress}/>
        </div>);
    const singleModeContent = !activeItem ? null : activeItem.status === "success" && activeItem.result ? (<div className="mx-auto w-full max-w-6xl space-y-4">
            <AudioAnalysis result={activeItem.result} analyzing={false} showAnalyzeButton={false} filePath={activeItem.path}/>

            <SpectrumVisualization ref={spectrumRef} sampleRate={activeItem.result.sample_rate} duration={activeItem.result.duration} spectrumData={activeItem.result.spectrum} fileName={activeItem.name} onReAnalyze={handleReAnalyzeSelectedSpectrum} isAnalyzingSpectrum={spectrumLoading} spectrumProgress={spectrumProgress}/>
        </div>) : activeItem.status === "analyzing" || activeItem.status === "pending" ? (<div className="flex min-h-full items-center justify-center">
            <div className="w-full max-w-md space-y-2">
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>{activeItem.status === "pending" ? t("translation.migrated.AudioAnalysisPage.preparing") : t("translation.migrated.AudioAnalysisPage.processing")}</span>
                    <span className="tabular-nums">{analysisProgress.percent}%</span>
                </div>
                <Progress value={analysisProgress.percent} className="h-2 w-full"/>
                <p className="text-center text-xs text-muted-foreground">{analysisProgress.message}</p>
            </div>
        </div>) : (<div className="flex min-h-full items-center justify-center">
            <div className="w-full max-w-md rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                {translateMessage(activeItem.error || t("translation.download.analysisFailed"))}
            </div>
        </div>);
    const showSingleModeActions = isSingleMode && activeItem?.status === "success" && activeItem.result;
    return (<div className="flex h-[calc(100dvh-5.5rem)] min-h-0 flex-col gap-6 md:h-[calc(100dvh-6.5rem)]">
            <input ref={fileInputRef} type="file" multiple accept={SUPPORTED_AUDIO_ACCEPT} className="hidden" onChange={handleInputChange}/>

            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-4">
                    {onBack && (<Button variant="ghost" size="icon" onClick={onBack}>
                            <ArrowLeft className="h-5 w-5"/>
                        </Button>)}
                    <h1 className="text-2xl font-bold">{t("translation.common.audioQualityAnalyzer")}</h1>
                </div>

                <div className="flex flex-wrap gap-2">
                    {isBatchMode && isBatchRunning && (<Button onClick={handleStopBatch} variant="destructive" disabled={isExportingBatch || isExportingSelected} className="gap-1.5">
                            <StopCircle className="h-4 w-4"/>
                            {t("translation.common.stop")}
                        </Button>)}
                    {canResumeBatch && (<Button onClick={handleAnalyzePending} disabled={isExportingBatch || isExportingSelected || spectrumLoading}>
                            <Activity className="h-4 w-4"/>
                            {t("translation.audioAnalysis.analyze")}
                        </Button>)}
                    {isBatchMode && (<DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" disabled={isBatchRunning || isExportingBatch || isExportingSelected}>
                                    <Upload className="h-4 w-4 mr-1"/>
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
                    {showSingleModeActions && (<Button onClick={handleExportSelected} variant="outline" disabled={isExportingSelected || spectrumLoading}>
                            <Download className="h-4 w-4 mr-1"/>
                            {isExportingSelected ? t("translation.migrated.AudioAnalysisPage.exporting") : t("translation.migrated.AudioAnalysisPage.exportPNG")}
                        </Button>)}
                    {isBatchMode && (<DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" disabled={successItems.length === 0 || isExportingBatch || isExportingSelected || isBatchRunning || spectrumLoading}>
                                    <Download className="h-4 w-4 mr-1"/>
                                    {isExportingBatch ? t("translation.migrated.AudioAnalysisPage.exporting") : isExportingSelected ? t("translation.migrated.AudioAnalysisPage.exporting") : t("translation.migrated.AudioAnalysisPage.export")}
                                    <ChevronDown className="ml-1 h-4 w-4"/>
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="min-w-[200px]">
                                <DropdownMenuItem onClick={handleExportSelected} className="cursor-pointer" disabled={!activeItem?.result?.spectrum}>
                                    <Download className="h-4 w-4"/>
                                    {t("translation.audioAnalysis.exportSelectedPng")}
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={handleBatchExport} className="cursor-pointer" disabled={successItems.length === 0}>
                                    <Download className="h-4 w-4"/>
                                    {t("translation.audioAnalysis.exportAllPng")}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>)}
                    {showSingleModeActions && (<Button onClick={handleClearAll} variant="destructive" disabled={isExportingSelected}>
                            <Trash2 className="h-4 w-4 mr-1"/>
                            {t("translation.common.clear")}
                        </Button>)}
                    {isBatchMode && (<Button onClick={handleClearAll} variant="destructive" disabled={isExportingBatch || isExportingSelected}>
                            <Trash2 className="h-4 w-4 mr-1"/>
                            {t("translation.common.clear")}
                        </Button>)}
                </div>
            </div>

            {items.length === 0 && (<div className={`flex min-h-0 flex-1 flex-col items-center justify-center rounded-lg border-2 border-dashed transition-all ${isDragging ? "border-primary bg-primary/10" : "border-muted-foreground/30"}`} onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
            }} onDragLeave={(event) => {
                event.preventDefault();
                setIsDragging(false);
            }} onDrop={handleHtmlDrop} style={{ "--wails-drop-target": "drop" } as CSSProperties}>
                    <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                        <Upload className="h-8 w-8 text-primary"/>
                    </div>
                    <p className="text-sm text-muted-foreground mb-4 text-center">
                        {isDragging
                ? t("translation.migrated.AudioAnalysisPage.dropYourAudioFilesHere")
                : t("translation.migrated.AudioAnalysisPage.dragAndDropAudioFilesHereOr")}
                    </p>
                    <div className="flex gap-3">
                        <Button onClick={handleSelectFiles}>
                            <Upload className="h-4 w-4"/>
                            {t("translation.common.selectFiles")}
                        </Button>
                        <Button onClick={handleSelectFolder} variant="outline">
                            <Upload className="h-4 w-4"/>
                            {t("translation.common.selectFolder")}
                        </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-4 text-center">
                        {t("translation.audioAnalysis.supportedFormatsFlacMp3M4a")}
                    </p>
                </div>)}

            {isSingleMode && (<div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 custom-scrollbar">
                    {singleModeContent}
                </div>)}

            {isBatchMode && (<div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border">
                    <div className="flex h-full w-full min-h-0 flex-col gap-4 p-4 md:flex-row">
                        <div className="flex min-h-0 shrink-0 flex-col gap-3 md:w-80 md:border-r md:pr-4">
                            {isExportingBatch && (<div className="shrink-0 space-y-2 rounded-lg border bg-muted/20 p-3">
                                    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                                        <span className="truncate">{exportProgress.fileName || t("translation.migrated.AudioAnalysisPage.preparing")}</span>
                                        <span className="shrink-0 font-mono tabular-nums">
                                            {t("translation.migrated.AudioAnalysisPage.text", { value1: exportProgress.completed, value2: exportProgress.total })}
                                        </span>
                                    </div>
                                    <Progress value={exportPercent} className="h-1.5 w-full"/>
                                </div>)}
                            <div className="flex shrink-0 items-center justify-between gap-3">
                                <p className="text-sm font-medium">{t("translation.common.batchQueue")}</p>
                                <p className="text-xs text-muted-foreground">
                                    {items.length} {t("translation.audioAnalysis.queued")} {" • "}{successItems.length} {t("translation.audioAnalysis.ready")}
                                </p>
                            </div>
                            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                                {items.map((item) => {
                const isActive = item.id === activeItemId;
                return (<div key={item.id} role="button" tabIndex={0} className={`flex w-full cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${isActive ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"}`} onClick={() => handleSelectItem(item.id)} onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            handleSelectItem(item.id);
                        }
                    }}>
                                        <div className="mt-0.5 shrink-0">{statusIcon(item.status)}</div>
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-medium">{item.name}</p>
                                            <p className={`truncate text-xs ${item.status === "error" ? "text-destructive" : "text-muted-foreground"}`}>
                                                {itemMetaLine(item)}
                                            </p>
                                            <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                                                <span>{formatFileSize(item.size)}</span>
                                                <span>{fileNameFromPath(item.path).split(".").pop()?.toUpperCase() || t("translation.audioAnalysis.audio")}</span>
                                            </div>
                                        </div>
                                        <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={(event) => {
                        event.stopPropagation();
                        handleRemoveItem(item.id);
                    }} disabled={isBatchRunning || isExportingBatch || isExportingSelected || spectrumLoading}>
                                            <X className="h-4 w-4"/>
                                        </Button>
                                    </div>);
            })}
                            </div>
                        </div>
                        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1 custom-scrollbar">
                            {batchDetailContent}
                        </div>
                    </div>
                </div>)}
        </div>);
}
