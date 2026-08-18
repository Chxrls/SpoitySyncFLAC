import { useState, useCallback, useEffect } from "react";
import { t, translateMessage } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Upload, X, FileText, FileMusic, Trash2, AlertCircle, Music, Clock, Download, FolderOpen, Save, Undo2, Redo2, Pencil, Type, ScanText, MicVocal } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Progress } from "@/components/ui/progress";
import { ReadEmbeddedLyrics, SelectLyricsFiles, ExtractLyricsToLRC, SelectLyricsFolder, ScanLyricsFolder, SaveLyrics } from "../../wailsjs/go/main/App";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { OnFileDrop, OnFileDropOff } from "../../wailsjs/runtime/runtime";
interface LyricsFile {
    path: string;
    name: string;
    format: string;
    lyrics: string;
    draft: string;
    past: string[];
    future: string[];
    source: string;
    synced: boolean;
    status: "pending" | "loading" | "loaded" | "empty" | "error";
    error?: string;
}
const SUPPORTED_EXTENSIONS = [".lrc", ".txt", ".flac", ".mp3", ".m4a", ".aac", ".opus", ".ogg"];
const EDITABLE_EXTENSIONS = [".lrc", ".txt", ".flac", ".mp3", ".m4a"];
const LRC_TIMESTAMP_RE = /\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/;
const STORAGE_KEY = "spotiflac_lyrics_manager_state";
interface LyricsManagerState {
    files: LyricsFile[];
    selectedPath: string | null;
    editMode: boolean;
}
function loadSavedState(): LyricsManagerState {
    try {
        const saved = sessionStorage.getItem(STORAGE_KEY);
        if (!saved)
            return { files: [], selectedPath: null, editMode: false };
        const parsed = JSON.parse(saved) as Partial<LyricsManagerState>;
        const files = Array.isArray(parsed.files)
            ? parsed.files.filter((file) => file && typeof file.path === "string").map((file) => ({
                ...file,
                status: file.status === "loading" ? "pending" as const : file.status,
            })) as LyricsFile[]
            : [];
        const selectedPath = typeof parsed.selectedPath === "string" && files.some((file) => file.path === parsed.selectedPath)
            ? parsed.selectedPath
            : files[0]?.path ?? null;
        return { files, selectedPath, editMode: parsed.editMode === true };
    }
    catch (error) {
        console.error("Failed to load Lyrics Manager state:", error);
        return { files: [], selectedPath: null, editMode: false };
    }
}
function getExtension(path: string): string {
    const lower = path.toLowerCase();
    const dot = lower.lastIndexOf(".");
    return dot >= 0 ? lower.slice(dot) : "";
}
function isSynced(lyrics: string): boolean {
    return LRC_TIMESTAMP_RE.test(lyrics);
}
function stripTimestamps(lyrics: string): string {
    return lyrics
        .split("\n")
        .map((line) => line.replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, "").trim())
        .filter((line, idx, arr) => line !== "" || (idx > 0 && arr[idx - 1] !== ""))
        .join("\n");
}
export function LyricsManagerPage() {
    const [files, setFiles] = useState<LyricsFile[]>(() => loadSavedState().files);
    const [selectedPath, setSelectedPath] = useState<string | null>(() => loadSavedState().selectedPath);
    const [isDragging, setIsDragging] = useState(false);
    const [extracting, setExtracting] = useState(false);
    const [saving, setSaving] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
    const [editMode, setEditMode] = useState(() => loadSavedState().editMode);
    useEffect(() => {
        try {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ files, selectedPath, editMode } satisfies LyricsManagerState));
        }
        catch (error) {
            console.error("Failed to save Lyrics Manager state:", error);
        }
    }, [files, selectedPath, editMode]);
    const addFiles = useCallback(async (paths: string[]) => {
        const validPaths = paths.filter((path) => SUPPORTED_EXTENSIONS.includes(getExtension(path)));
        if (validPaths.length === 0) {
            if (paths.length > 0) {
                toast.error(t("translation.lyricsManager.unsupportedFiles"), {
                    description: t("translation.lyricsManager.onlyLrcAudioFilesFlac"),
                });
            }
            return;
        }
        const newPaths: string[] = [];
        setFiles((prev) => {
            const toAdd = validPaths.filter((path) => !prev.some((f) => f.path === path));
            newPaths.push(...toAdd);
            const entries: LyricsFile[] = toAdd.map((path) => {
                const name = path.split(/[/\\]/).pop() || path;
                return {
                    path,
                    name,
                    format: getExtension(path).slice(1),
                    lyrics: "",
                    draft: "",
                    past: [],
                    future: [],
                    source: "",
                    synced: false,
                    status: "pending" as const,
                };
            });
            if (entries.length === 0) {
                return prev;
            }
            return [...prev, ...entries];
        });
        setSelectedPath((prev) => prev ?? newPaths[0] ?? null);
    }, []);
    const loadLyricsFile = useCallback(async (path: string) => {
        setFiles((prev) => prev.map((file) => file.path === path ? { ...file, status: "loading" as const, error: undefined } : file));
        try {
            const result = await ReadEmbeddedLyrics(path);
            setFiles((prev) => prev.map((file) => {
                if (file.path !== path)
                    return file;
                if (result.error)
                    return { ...file, status: "empty" as const, error: translateMessage(result.error) };
                return { ...file, lyrics: result.lyrics, draft: result.lyrics, source: result.source, synced: result.synced, status: "loaded" as const };
            }));
        }
        catch (error) {
            setFiles((prev) => prev.map((file) => file.path === path
                ? { ...file, status: "error" as const, error: error instanceof Error ? translateMessage(error.message) : t("translation.fileManager.failedReadLyricsFile") }
                : file));
        }
    }, []);
    const handleScan = async () => {
        if (files.length === 0 || scanning)
            return;
        const targets = files.filter((file) => ![".lrc", ".txt"].includes(getExtension(file.path))).map((file) => file.path);
        if (targets.length === 0)
            return;
        setScanning(true);
        setScanProgress({ current: 0, total: targets.length });
        for (let index = 0; index < targets.length; index++) {
            await loadLyricsFile(targets[index]);
            setScanProgress({ current: index + 1, total: targets.length });
        }
        setScanning(false);
        toast.success(t("translation.enrich.scanCompleted", { value1: targets.length }));
    };
    const handleSelectFile = (file: LyricsFile) => {
        setSelectedPath(file.path);
        if (file.status === "pending" && [".lrc", ".txt"].includes(getExtension(file.path)))
            void loadLyricsFile(file.path);
    };
    const handleSelectFiles = async () => {
        try {
            const selected = await SelectLyricsFiles();
            if (selected && selected.length > 0) {
                addFiles(selected);
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
            const folder = await SelectLyricsFolder();
            if (!folder)
                return;
            const found = await ScanLyricsFolder(folder);
            if (!found || found.length === 0) {
                toast.info(t("translation.lyricsManager.noFilesFound"), {
                    description: t("translation.lyricsManager.noLyricsAudioFilesWere"),
                });
                return;
            }
            addFiles(found);
        }
        catch (err) {
            toast.error(t("translation.lyricsManager.folderScanFailed"), {
                description: err instanceof Error ? translateMessage(err.message) : t("translation.lyricsManager.failedScanFolder"),
            });
        }
    };
    const handleFileDrop = useCallback((_x: number, _y: number, paths: string[]) => {
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
        setFiles((prev) => {
            const next = prev.filter((f) => f.path !== path);
            setSelectedPath((current) => {
                if (current !== path)
                    return current;
                return next[0]?.path ?? null;
            });
            return next;
        });
    };
    const clearFiles = () => {
        setFiles([]);
        setSelectedPath(null);
    };
    const selectedFile = files.find((f) => f.path === selectedPath) || null;
    const isDirty = !!selectedFile && selectedFile.draft !== selectedFile.lyrics;
    const canEdit = !!selectedFile && EDITABLE_EXTENSIONS.includes(getExtension(selectedFile.path));
    const applyEdit = useCallback((path: string, transform: (current: string) => string) => {
        setFiles((prev) => prev.map((f) => {
            if (f.path !== path)
                return f;
            const next = transform(f.draft);
            if (next === f.draft)
                return f;
            return { ...f, draft: next, past: [...f.past, f.draft], future: [] };
        }));
    }, []);
    const handleDraftChange = (value: string) => {
        if (!selectedFile)
            return;
        applyEdit(selectedFile.path, () => value);
    };
    const handleUndo = () => {
        if (!selectedFile)
            return;
        setFiles((prev) => prev.map((f) => {
            if (f.path !== selectedFile.path || f.past.length === 0)
                return f;
            const previous = f.past[f.past.length - 1];
            return { ...f, draft: previous, past: f.past.slice(0, -1), future: [f.draft, ...f.future] };
        }));
    };
    const handleRedo = () => {
        if (!selectedFile)
            return;
        setFiles((prev) => prev.map((f) => {
            if (f.path !== selectedFile.path || f.future.length === 0)
                return f;
            const next = f.future[0];
            return { ...f, draft: next, past: [...f.past, f.draft], future: f.future.slice(1) };
        }));
    };
    const handleConvertToPlain = () => {
        if (!selectedFile)
            return;
        applyEdit(selectedFile.path, (current) => stripTimestamps(current));
    };
    const handleSave = async () => {
        if (!selectedFile || !isDirty)
            return;
        setSaving(true);
        try {
            const result = await SaveLyrics(selectedFile.path, selectedFile.draft);
            if (result.success) {
                setFiles((prev) => prev.map((f) => f.path === selectedFile.path
                    ? { ...f, lyrics: f.draft, synced: isSynced(f.draft) }
                    : f));
                toast.success(t("translation.lyricsManager.lyricsSaved"), { description: selectedFile.name });
            }
            else {
                toast.error(t("translation.lyricsManager.saveFailed"), { description: result.error ? translateMessage(result.error) : t("translation.audioConverter.unknownError") });
            }
        }
        catch (err) {
            toast.error(t("translation.lyricsManager.saveFailed"), {
                description: err instanceof Error ? translateMessage(err.message) : t("translation.audioConverter.unknownError"),
            });
        }
        finally {
            setSaving(false);
        }
    };
    const extractFile = async (file: LyricsFile, overwrite: boolean) => {
        const result = await ExtractLyricsToLRC(file.path, overwrite);
        if (result.success) {
            return { ok: true as const, output: result.output_path };
        }
        if (result.already_exists) {
            return { ok: false as const, alreadyExists: true, output: result.output_path };
        }
        return { ok: false as const, error: result.error ? translateMessage(result.error) : t("translation.lyricsManager.extractFailed") };
    };
    const handleExtractSelected = async () => {
        if (!selectedFile || selectedFile.status !== "loaded")
            return;
        setExtracting(true);
        try {
            const result = await extractFile(selectedFile, false);
            if (result.ok) {
                toast.success(t("translation.lyricsManager.lyricsExtracted"), { description: result.output });
            }
            else if (result.alreadyExists) {
                toast.info(t("translation.lyricsManager.lrcAlreadyExists"), {
                    description: t("translation.lyricsManager.lrcFileSameNameAlready"),
                });
            }
            else {
                toast.error(t("translation.lyricsManager.extractFailed"), { description: result.error });
            }
        }
        catch (err) {
            toast.error(t("translation.lyricsManager.extractFailed"), {
                description: err instanceof Error ? translateMessage(err.message) : t("translation.audioConverter.unknownError"),
            });
        }
        finally {
            setExtracting(false);
        }
    };
    const handleExtractAll = async () => {
        const extractable = files.filter((f) => f.status === "loaded");
        if (extractable.length === 0) {
            toast.error(t("translation.lyricsManager.nothingExtract"), {
                description: t("translation.lyricsManager.noFilesEmbeddedLyricsLoaded"),
            });
            return;
        }
        setExtracting(true);
        let success = 0;
        let skipped = 0;
        let failed = 0;
        for (const file of extractable) {
            try {
                const result = await extractFile(file, false);
                if (result.ok)
                    success++;
                else if (result.alreadyExists)
                    skipped++;
                else
                    failed++;
            }
            catch {
                failed++;
            }
        }
        setExtracting(false);
        if (success > 0) {
            toast.success(t("translation.lyricsManager.lyricsExtracted"), {
                description: t("translation.lyrics.extracted", { count: success, skipped: skipped > 0 ? t("translation.lyrics.skipped", { count: skipped }) : "", failed: failed > 0 ? t("translation.lyrics.failed", { count: failed }) : "" }),
            });
        }
        else if (skipped > 0 && failed === 0) {
            toast.info(t("translation.lyricsManager.alreadyExtracted"), {
                description: t("translation.lyrics.exists", { count: skipped }),
            });
        }
        else {
            toast.error(t("translation.lyricsManager.extractFailed"), {
                description: t("translation.lyrics.extractFailed", { count: failed }),
            });
        }
    };
    const embeddedLoadedCount = files.filter((f) => f.status === "loaded" && f.source === "embedded").length;
    const scannableCount = files.filter((file) => ![".lrc", ".txt"].includes(getExtension(file.path))).length;
    const draftSynced = selectedFile ? isSynced(selectedFile.draft) : false;
    return (<div className="flex h-[calc(100dvh-5.5rem)] min-h-0 flex-col gap-6 md:h-[calc(100dvh-6.5rem)]">
        <div className="shrink-0 space-y-2">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold">{t("translation.common.lyricsManager")}</h1>
            {files.length > 0 && (<div className="flex gap-2">
                <Button onClick={handleScan} disabled={scanning || extracting || saving || scannableCount === 0}>
                    <ScanText className={`h-4 w-4 ${scanning ? "animate-pulse" : ""}`}/>
                    {scanning ? t("translation.enrich.scanning") : t("translation.enrich.scan")}
                </Button>
                <Button variant="outline" onClick={handleSelectFiles} disabled={scanning}>
                    <Upload className="h-4 w-4"/>
                    {t("translation.common.addFiles")}
                </Button>
                <Button variant="outline" onClick={handleSelectFolder} disabled={scanning}>
                    <FolderOpen className="h-4 w-4"/>
                    {t("translation.common.addFolder")}
                </Button>
                {embeddedLoadedCount > 0 && (<Button variant="outline" onClick={handleExtractAll} disabled={extracting || scanning}>
                    {extracting ? <Spinner className="h-4 w-4"/> : <Download className="h-4 w-4"/>}
                    {t("translation.lyricsManager.extractAll")}
                </Button>)}
                <Button variant="destructive" onClick={clearFiles} disabled={extracting || scanning}>
                    <Trash2 className="h-4 w-4"/>
                    {t("translation.common.clearAll")}
                </Button>
            </div>)}
          </div>
          {scanning && (<div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{t("translation.enrich.scanning")}</span><span className="font-mono tabular-nums">{scanProgress.current} / {scanProgress.total}</span></div>
            <Progress value={scanProgress.total > 0 ? (scanProgress.current / scanProgress.total) * 100 : 0} aria-label={t("translation.enrich.scanning")}/>
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
                ? t("translation.migrated.LyricsManagerPage.dropYourFilesHere")
                : t("translation.migrated.LyricsManagerPage.dragAndDropLRCOrAudioFiles")}
                </p>
                <div className="flex gap-2">
                    <Button onClick={handleSelectFiles}>
                        <Upload className="h-4 w-4"/>
                        {t("translation.common.selectFiles")}
                    </Button>
                    <Button onClick={handleSelectFolder} variant="outline">
                        <FolderOpen className="h-4 w-4"/>
                        {t("translation.common.selectFolder")}
                    </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-4 text-center">
                    {t("translation.lyricsManager.readsEmbeddedLyricsFlacMp3")}
                </p>
            </>) : (<div className="w-full h-full p-4 flex flex-col md:flex-row gap-4 min-h-0">

                <div className="md:w-64 shrink-0 flex flex-col gap-2 md:border-r md:pr-4 max-h-48 md:max-h-none overflow-y-auto">
                    {files.map((file) => {
                const isActive = file.path === selectedPath;
                const fileDirty = file.draft !== file.lyrics;
                return (<button key={file.path} onClick={() => handleSelectFile(file)} className={`group flex items-center gap-2 rounded-lg border p-2 text-left transition-colors ${isActive ? "border-primary bg-primary/10" : "hover:bg-muted/60"}`}>
                            {file.status === "loading" ? (<Spinner className="h-4 w-4 shrink-0 text-primary"/>)
                        : file.status === "pending" ? ([".lrc", ".txt"].includes(getExtension(file.path))
                            ? <FileText className="h-4 w-4 shrink-0 text-blue-500"/>
                            : <FileMusic className="h-4 w-4 shrink-0 text-primary"/>)
                            : file.status === "error" || file.status === "empty" ? (<AlertCircle className="h-4 w-4 shrink-0 text-destructive"/>)
                                : ([".lrc", ".txt"].includes(getExtension(file.path))
                                    ? <FileText className="h-4 w-4 shrink-0 text-blue-500"/>
                                    : <FileMusic className="h-4 w-4 shrink-0 text-primary"/>)}
                            <div className="flex-1 min-w-0">
                                <p className="truncate text-xs font-medium">{file.name}{fileDirty ? " *" : ""}</p>
                                <p className="truncate text-[10px] uppercase text-muted-foreground">{file.format}</p>
                            </div>
                            <span role="button" tabIndex={-1} onClick={(e) => { e.stopPropagation(); removeFile(file.path); }} className="opacity-0 group-hover:opacity-100 transition-opacity rounded p-1 hover:bg-muted">
                                <X className="h-3.5 w-3.5"/>
                            </span>
                        </button>);
            })}
                </div>

                <div className="flex-1 min-w-0 flex flex-col min-h-0">
                    {!selectedFile ? (<div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                        {t("translation.lyricsManager.selectFileViewItsLyrics")}
                    </div>) : selectedFile.status === "loading" ? (<div className="flex-1 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                        <Spinner className="h-4 w-4"/>
                        {t("translation.lyricsManager.readingLyrics")}
                    </div>) : selectedFile.status === "pending" ? (<div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
                        <MicVocal className="h-8 w-8 text-primary"/>
                        <span>{t("translation.lyricsManager.scanAudioFirst")}</span>
                    </div>) : selectedFile.status === "error" || selectedFile.status === "empty" ? (<div className="flex-1 flex flex-col items-center justify-center gap-2 text-center px-6">
                        <AlertCircle className="h-8 w-8 text-destructive"/>
                        <p className="text-sm font-medium">{selectedFile.name}</p>
                        <p className="text-xs text-muted-foreground">{selectedFile.error || t("translation.fileManager.noLyricsContent")}</p>
                    </div>) : (<>
                        <div className="flex flex-col gap-2 pb-3 border-b shrink-0">
                            <div className="flex items-center gap-2 min-w-0">
                                <p className="truncate text-sm font-medium flex-1">{selectedFile.name}{isDirty ? " *" : ""}</p>
                                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase shrink-0">
                                    {selectedFile.source === "lrc" ? (<><FileText className="h-3 w-3"/> {t("literal.lyricsManager.lrc")}</>) : (<><Music className="h-3 w-3"/> {t("translation.migrated.LyricsManagerPage.embedded")}</>)}
                                </span>
                                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase shrink-0">
                                    <Clock className="h-3 w-3"/>
                                    {draftSynced ? t("translation.migrated.LyricsManagerPage.synced") : t("translation.migrated.LyricsManagerPage.plain")}
                                </span>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                                {selectedFile.source === "embedded" && (<Button variant="outline" onClick={handleExtractSelected} disabled={extracting}>
                                    {extracting ? <Spinner className="h-4 w-4"/> : <Download className="h-4 w-4"/>}
                                    {t("translation.lyricsManager.extractLrc")}
                                </Button>)}
                                <Button variant={editMode ? "default" : "outline"} onClick={() => setEditMode((v) => !v)} disabled={!canEdit}>
                                    <Pencil className="h-4 w-4"/>
                                    {editMode ? t("translation.migrated.LyricsManagerPage.editing") : t("translation.migrated.LyricsManagerPage.edit")}
                                </Button>
                            </div>
                            {editMode && (<div className="flex items-center gap-2 flex-wrap">
                                <Button variant="outline" onClick={handleConvertToPlain} disabled={!draftSynced}>
                                    <Type className="h-4 w-4"/>
                                    {t("translation.lyricsManager.convertPlain")}
                                </Button>
                                <Button variant="outline" onClick={handleUndo} disabled={selectedFile.past.length === 0}>
                                    <Undo2 className="h-4 w-4"/>
                                    {t("translation.lyricsManager.undo")}
                                </Button>
                                <Button variant="outline" onClick={handleRedo} disabled={selectedFile.future.length === 0}>
                                    <Redo2 className="h-4 w-4"/>
                                    {t("translation.lyricsManager.redo")}
                                </Button>
                                <Button variant="outline" onClick={handleSave} disabled={!isDirty || saving}>
                                    {saving ? <Spinner className="h-4 w-4"/> : <Save className="h-4 w-4"/>}
                                    {t("translation.lyricsManager.save")}
                                </Button>
                            </div>)}
                        </div>
                        <div className="flex-1 overflow-y-auto pt-3 min-h-0">
                            {editMode ? (<Textarea value={selectedFile.draft} onChange={(e) => handleDraftChange(e.target.value)} spellCheck={false} className="h-full min-h-75 resize-none font-mono text-sm leading-relaxed"/>)
                    : (<pre className="whitespace-pre-wrap wrap-break-word font-sans text-sm leading-relaxed text-foreground/90">{selectedFile.draft}</pre>)}
                        </div>
                    </>)}
                </div>
            </div>)}
        </div>
    </div>);
}
