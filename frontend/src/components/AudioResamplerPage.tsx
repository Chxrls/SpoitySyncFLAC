import { useState, useCallback, useEffect } from "react";
import { t, translateMessage } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Upload, X, CircleCheckBig, AlertCircle, Trash2, FileMusic } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { SelectAudioFiles, SelectFolder, ListAudioFilesInDir, ResampleAudio } from "../../wailsjs/go/main/App";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { OnFileDrop, OnFileDropOff } from "../../wailsjs/runtime/runtime";
import { AudioLinesIcon } from "@/components/ui/audio-lines";
interface AudioFile {
    path: string;
    name: string;
    format: string;
    size: number;
    status: "pending" | "resampling" | "success" | "error";
    error?: string;
    outputPath?: string;
    srcSampleRate?: number;
    srcBitDepth?: number;
}
function formatFileSize(bytes: number): string {
    if (bytes === 0)
        return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
function formatSampleRate(sr: number): string {
    if (!sr)
        return "";
    if (sr === 44100)
        return "44.1kHz";
    if (sr >= 1000)
        return `${sr / 1000}kHz`;
    return `${sr}Hz`;
}
const SAMPLE_RATE_OPTIONS = [
    { value: "44100", label: t("literal.audioResampler.value441khz") },
    { value: "48000", label: t("literal.audioResampler.48khz") },
    { value: "96000", label: t("literal.audioResampler.96khz") },
    { value: "192000", label: t("literal.audioResampler.192khz") },
];
const BIT_DEPTH_OPTIONS = [
    { value: "16", label: t("literal.common.value16Bit") },
    { value: "24", label: t("literal.common.value24Bit") },
];
const STORAGE_KEY = "spotiflac_audio_resampler_state";
export function AudioResamplerPage() {
    const [files, setFiles] = useState<AudioFile[]>(() => {
        try {
            const saved = sessionStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.files && Array.isArray(parsed.files) && parsed.files.length > 0) {
                    return parsed.files;
                }
            }
        }
        catch (err) {
            console.error("Failed to load saved state:", err);
        }
        return [];
    });
    const [sampleRate, setSampleRate] = useState(() => {
        try {
            const saved = sessionStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.sampleRate)
                    return parsed.sampleRate;
            }
        }
        catch (err) {
        }
        return "44100";
    });
    const [bitDepth, setBitDepth] = useState(() => {
        try {
            const saved = sessionStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (parsed.bitDepth)
                    return parsed.bitDepth;
            }
        }
        catch (err) {
        }
        return "16";
    });
    const [resampling, setResampling] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const saveState = useCallback((stateToSave: {
        files: AudioFile[];
        sampleRate: string;
        bitDepth: string;
    }) => {
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
        }
        catch (err) {
            console.error("Failed to save state:", err);
        }
    }, []);
    useEffect(() => {
        saveState({ files, sampleRate, bitDepth });
    }, [files, sampleRate, bitDepth, saveState]);
    const fetchAudioInfo = useCallback(async (paths: string[]) => {
        if (paths.length === 0)
            return;
        try {
            const GetFlacInfoBatch = (window as any)["go"]["main"]["App"]["GetFlacInfoBatch"];
            const infos: Array<{
                path: string;
                sample_rate: number;
                bits_per_sample: number;
            }> = await GetFlacInfoBatch(paths);
            setFiles((prev) => prev.map((f) => {
                const info = infos.find((i) => i.path === f.path || i.path.toLowerCase() === f.path.toLowerCase());
                if (info) {
                    return {
                        ...f,
                        srcSampleRate: info.sample_rate || undefined,
                        srcBitDepth: info.bits_per_sample || undefined,
                    };
                }
                return f;
            }));
        }
        catch (err) {
            console.error("Failed to fetch audio info:", err);
        }
    }, []);
    const handleSelectFiles = async () => {
        try {
            const selectedFiles = await SelectAudioFiles();
            if (selectedFiles && selectedFiles.length > 0) {
                addFiles(selectedFiles);
            }
        }
        catch (err) {
            toast.error(t("translation.common.fileSelectionFailed"), {
                description: err instanceof Error ? translateMessage(err.message) : t("translation.audioConverter.failedSelectFiles"),
            });
        }
    };
    const handleSelectFolder = async () => {
        try {
            const selectedFolder = await SelectFolder("");
            if (selectedFolder) {
                const folderFiles = await ListAudioFilesInDir(selectedFolder);
                if (folderFiles && folderFiles.length > 0) {
                    addFiles(folderFiles.map((f) => f.path));
                }
                else {
                    toast.info(t("translation.common.noAudioFilesFound"), {
                        description: t("translation.audioResampler.noFlacFilesFoundSelected"),
                    });
                }
            }
        }
        catch (err) {
            toast.error(t("translation.common.folderSelectionFailed"), {
                description: err instanceof Error ? translateMessage(err.message) : t("translation.fileManager.failedSelectFolder"),
            });
        }
    };
    const addFiles = useCallback(async (paths: string[]) => {
        const validExtensions = [".flac"];
        const invalidFiles = paths.filter((path) => {
            const ext = path.toLowerCase().slice(path.lastIndexOf("."));
            return !validExtensions.includes(ext);
        });
        if (invalidFiles.length > 0) {
            toast.error(t("translation.common.unsupportedFormat"), {
                description: t("translation.audioResampler.onlyFlacFilesSupportedResampling"),
            });
        }
        const GetFileSizes = (files: string[]): Promise<Record<string, number>> => (window as any)["go"]["main"]["App"]["GetFileSizes"](files);
        const validPaths = paths.filter((path) => {
            const ext = path.toLowerCase().slice(path.lastIndexOf("."));
            return validExtensions.includes(ext);
        });
        const fileSizes = validPaths.length > 0 ? await GetFileSizes(validPaths) : {};
        let newlyAddedPaths: string[] = [];
        setFiles((prev) => {
            const newFiles: AudioFile[] = validPaths
                .filter((path) => !prev.some((f) => f.path === path))
                .map((path) => {
                const name = path.split(/[/\\]/).pop() || path;
                const ext = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
                return {
                    path,
                    name,
                    format: ext,
                    size: fileSizes[path] || 0,
                    status: "pending" as const,
                };
            });
            newlyAddedPaths = newFiles.map((f) => f.path);
            if (newFiles.length > 0) {
                if (paths.length > newFiles.length + invalidFiles.length) {
                    const skipped = paths.length - newFiles.length - invalidFiles.length;
                    toast.info(t("translation.common.someFilesSkipped"), {
                        description: t("translation.resampler.skipped", { count: skipped }),
                    });
                }
                return [...prev, ...newFiles];
            }
            if (validPaths.length > 0 && newFiles.length === 0) {
                toast.info(t("translation.common.noNewFilesAdded"), {
                    description: t("translation.audioResampler.allValidFilesWereAlready"),
                });
            }
            return prev;
        });
        setTimeout(() => {
            if (newlyAddedPaths.length > 0) {
                fetchAudioInfo(newlyAddedPaths);
            }
        }, 50);
    }, [fetchAudioInfo]);
    const handleFileDrop = useCallback(async (_x: number, _y: number, paths: string[]) => {
        setIsDragging(false);
        if (paths.length === 0)
            return;
        addFiles(paths);
    }, [addFiles]);
    useEffect(() => {
        OnFileDrop((x, y, paths) => {
            handleFileDrop(x, y, paths);
        }, true);
        return () => {
            OnFileDropOff();
        };
    }, [handleFileDrop]);
    const removeFile = (path: string) => {
        setFiles((prev) => prev.filter((f) => f.path !== path));
    };
    const clearFiles = () => {
        setFiles([]);
    };
    const handleResample = async () => {
        if (files.length === 0) {
            toast.error(t("translation.common.noFilesSelected"), {
                description: t("translation.audioResampler.pleaseAddFlacFilesResample"),
            });
            return;
        }
        setResampling(true);
        try {
            const inputPaths = files.map((f) => f.path);
            setFiles((prev) => prev.map((f) => {
                if (inputPaths.includes(f.path)) {
                    return { ...f, status: "resampling" as const, error: undefined };
                }
                return f;
            }));
            const results = await ResampleAudio({
                input_files: inputPaths,
                sample_rate: sampleRate,
                bit_depth: bitDepth,
            });
            setFiles((prev) => prev.map((f) => {
                const result = results.find((r: any) => r.input_file === f.path || r.input_file.toLowerCase() === f.path.toLowerCase());
                if (result) {
                    return {
                        ...f,
                        status: result.success ? "success" : "error",
                        error: result.error ? translateMessage(result.error) : undefined,
                        outputPath: result.output_file,
                    };
                }
                return f;
            }));
            const successCount = results.filter((r: any) => r.success).length;
            const failCount = results.filter((r: any) => !r.success).length;
            if (successCount > 0) {
                toast.success(t("translation.audioResampler.resamplingComplete"), {
                    description: t("translation.resampler.success", { count: successCount, failures: failCount > 0 ? t("translation.common.failures", { count: failCount }) : "" }),
                });
            }
            else if (failCount > 0) {
                toast.error(t("translation.audioResampler.resamplingFailed"), {
                    description: t("translation.resampler.allFailed", { count: failCount }),
                });
            }
        }
        catch (err) {
            toast.error(t("translation.audioResampler.resamplingError"), {
                description: err instanceof Error ? translateMessage(err.message) : t("translation.audioConverter.unknownError"),
            });
            setFiles((prev) => prev.map((f) => ({ ...f, status: "error" as const, error: t("translation.audioResampler.resamplingFailed") })));
        }
        finally {
            setResampling(false);
        }
    };
    const getStatusIcon = (status: AudioFile["status"]) => {
        switch (status) {
            case "resampling":
                return <Spinner className="h-4 w-4 text-primary"/>;
            case "success":
                return <CircleCheckBig className="h-4 w-4 text-green-500"/>;
            case "error":
                return <AlertCircle className="h-4 w-4 text-destructive"/>;
            default:
                return <FileMusic className="h-4 w-4 text-muted-foreground"/>;
        }
    };
    const resampleableCount = files.filter((f) => f.status === "pending" || f.status === "success").length;
    const successCount = files.filter((f) => f.status === "success").length;
    return (<div className="flex h-[calc(100dvh-5.5rem)] min-h-0 flex-col gap-6 md:h-[calc(100dvh-6.5rem)]">

        <div className="flex shrink-0 items-center justify-between">
            <h1 className="text-2xl font-bold">{t("translation.common.audioResampler")}</h1>
            {files.length > 0 && (<div className="flex gap-2">
                <Button variant="outline" onClick={handleSelectFiles}>
                    <Upload className="h-4 w-4"/>
                    {t("translation.common.addFiles")}
                </Button>
                <Button variant="outline" onClick={handleSelectFolder}>
                    <Upload className="h-4 w-4"/>
                    {t("translation.common.addFolder")}
                </Button>
                <Button variant="destructive" onClick={clearFiles} disabled={resampling}>
                    <Trash2 className="h-4 w-4"/>
                    {t("translation.common.clearAll")}
                </Button>
            </div>)}
        </div>

        <div className={`flex min-h-0 flex-1 flex-col items-center justify-center overflow-hidden transition-all ${files.length === 0
            ? `rounded-lg border-2 border-dashed ${isDragging ? "border-primary bg-primary/10" : "border-muted-foreground/30"}`
            : "rounded-lg border"}`} onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
        }} onDragLeave={(e) => {
            e.preventDefault();
            setIsDragging(false);
        }} onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
        }} style={{ "--wails-drop-target": "drop" } as React.CSSProperties}>
            {files.length === 0 ? (<>
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
                    <Upload className="h-8 w-8 text-primary"/>
                </div>
                <p className="text-sm text-muted-foreground mb-4 text-center">
                    {isDragging
                ? t("translation.migrated.AudioResamplerPage.dropYourAudioFilesHere")
                : t("translation.migrated.AudioResamplerPage.dragAndDropAudioFilesHereOr")}
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
                    {t("translation.audioResampler.supportedFormatFlac")}
                </p>
            </>) : (<div className="w-full h-full p-6 space-y-4 flex flex-col">
                <div className="space-y-2 pb-4 border-b shrink-0">
                    <div className="flex flex-wrap items-center gap-4">
                        <div className="flex items-center gap-2">
                            <Label className="whitespace-nowrap">{t("translation.common.bitDepth")}</Label>
                            <ToggleGroup type="single" variant="outline" value={bitDepth} onValueChange={(value) => {
                if (value)
                    setBitDepth(value);
            }}>
                                {BIT_DEPTH_OPTIONS.map((option) => (<ToggleGroupItem key={option.value} value={option.value} aria-label={option.label}>
                                        {option.label}
                                    </ToggleGroupItem>))}
                            </ToggleGroup>
                        </div>

                        <div className="flex items-center gap-2">
                            <Label className="whitespace-nowrap">{t("translation.common.sampleRate")}</Label>
                            <ToggleGroup type="single" variant="outline" value={sampleRate} onValueChange={(value) => {
                if (value)
                    setSampleRate(value);
            }}>
                                {SAMPLE_RATE_OPTIONS.map((option) => (<ToggleGroupItem key={option.value} value={option.value} aria-label={option.label}>
                                        {option.label}
                                    </ToggleGroupItem>))}
                            </ToggleGroup>
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-between shrink-0">
                    <div className="text-sm text-muted-foreground">
                        {files.length} {t("translation.common.file", { count: files.length })} • {successCount} {t("translation.audioResampler.resampled")}
                    </div>
                </div>

                <div className="flex-1 space-y-2 overflow-y-auto min-h-0">
                    {files.map((file) => {
                const srcParts: string[] = [];
                if (file.srcBitDepth)
                    srcParts.push(`${file.srcBitDepth}-bit`);
                if (file.srcSampleRate)
                    srcParts.push(formatSampleRate(file.srcSampleRate));
                const srcSpec = srcParts.join(" / ");
                return (<div key={file.path} className="flex items-center gap-3 rounded-lg border p-3">
                                    {getStatusIcon(file.status)}
                                    <div className="flex-1 min-w-0">
                                        <p className="truncate text-sm font-medium">{file.name}</p>
                                        {file.error && (<p className="truncate text-xs text-destructive">
                                                {file.error}
                                            </p>)}
                                    </div>

                                    {srcSpec ? (<span className="text-xs font-medium text-primary bg-primary/10 rounded px-1.5 py-0.5 whitespace-nowrap shrink-0">
                                            {srcSpec}
                                        </span>) : file.status === "pending" ? (<span className="text-xs text-muted-foreground/50 whitespace-nowrap shrink-0">
                                            {t("translation.audioResampler.reading")}
                                        </span>) : null}

                                    <span className="text-xs text-muted-foreground shrink-0">
                                        {formatFileSize(file.size)}
                                    </span>
                                    <span className="text-xs uppercase text-muted-foreground shrink-0">
                                        {file.format}
                                    </span>
                                    {file.status !== "resampling" && (<Button variant="ghost" size="icon" className="shrink-0" onClick={() => removeFile(file.path)} disabled={resampling}>
                                            <X className="h-4 w-4"/>
                                        </Button>)}
                                </div>);
            })}
                </div>

                <div className="flex justify-center pt-4 border-t shrink-0">
                    <Button onClick={handleResample} disabled={resampling || resampleableCount === 0}>
                        {resampling ? (<>
                                <Spinner className="h-4 w-4"/>
                                {t("translation.audioResampler.resampling")}
                            </>) : (<>
                                <AudioLinesIcon size={16} className="text-primary-foreground"/>
                                {t("translation.audioResampler.resample")}{" "}
                                {resampleableCount > 0 ? t("translation.migrated.AudioResamplerPage.text", { value1: resampleableCount, value2: t("translation.common.fileTitle", { count: resampleableCount }) }) : ""}
                            </>)}
                    </Button>
                </div>
            </div>)}
        </div>
    </div>);
}
