import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, CircleCheckBig, CheckSquare, ChevronDown, ChevronRight, FileMusic, Folder, FolderOpen, Info, RefreshCw, ScanText, Square, XCircle } from "lucide-react";
import { t, translateMessage } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { InputWithContext } from "@/components/ui/input-with-context";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TagPlusIcon } from "@/components/ui/tag-plus";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { getSettings } from "@/lib/settings";
import { EnrichAudioFiles, GetDefaults, InspectEnrichFile, InspectEnrichFiles, ListDirectoryFiles, SelectFolder } from "../../wailsjs/go/main/App";
type Priority = "url" | "isrc";
interface FileNode {
    name: string;
    path: string;
    is_dir: boolean;
    size: number;
    children?: FileNode[];
    expanded?: boolean;
}
interface EnrichResult {
    file_path: string;
    status: "enriched" | "skipped" | "conflict" | "failed";
    source?: string;
    message?: string;
}
interface MetadataPreview {
    file_path: string;
    title: string;
    artist: string;
    album: string;
    album_artist: string;
    date: string;
    track_number: number;
    total_tracks: number;
    disc_number: number;
    total_discs: number;
    copyright: string;
    publisher: string;
    composer: string;
    isrc: string;
    upc: string;
    genre: string;
    comment: string;
    lyrics_present: boolean;
    eligible: boolean;
    missing_isrc: boolean;
    missing_url: boolean;
    inspection_error?: string;
}
const isAudioFile = (node: FileNode) => !node.is_dir && /\.(flac|mp3|m4a)$/i.test(node.name);
const flattenAudioFiles = (nodes: FileNode[]): FileNode[] => nodes.flatMap((node) => node.is_dir ? flattenAudioFiles(node.children || []) : isAudioFile(node) ? [node] : []);
const canEnrich = (preview: MetadataPreview | undefined, priority: Priority, allowFallback: boolean) => {
    if (!preview || preview.inspection_error)
        return false;
    if (allowFallback)
        return !preview.missing_isrc || !preview.missing_url;
    return priority === "isrc" ? !preview.missing_isrc : !preview.missing_url;
};
const formatFileSize = (bytes: number) => {
    if (bytes === 0)
        return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const unit = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${parseFloat((bytes / Math.pow(1024, unit)).toFixed(1))} ${units[unit]}`;
};
const metadataMissingCount = (preview: MetadataPreview) => [
    preview.title, preview.artist, preview.album, preview.album_artist, preview.date,
    preview.track_number, preview.disc_number, preview.composer, preview.copyright,
    preview.publisher, preview.genre, preview.isrc, preview.upc, preview.comment,
    preview.lyrics_present,
].filter((value) => !value).length;
export function EnrichPage() {
    const [rootPath, setRootPath] = useState(() => getSettings().downloadPath || "");
    const [allFiles, setAllFiles] = useState<FileNode[]>([]);
    const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
    const [priority, setPriority] = useState<Priority>("url");
    const [allowFallback, setAllowFallback] = useState(true);
    const [loading, setLoading] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [scanCompleted, setScanCompleted] = useState(false);
    const [scanProgress, setScanProgress] = useState({ current: 0, total: 0 });
    const [processing, setProcessing] = useState(false);
    const [results, setResults] = useState<EnrichResult[]>([]);
    const [eligibility, setEligibility] = useState<Record<string, MetadataPreview>>({});
    const [previewFile, setPreviewFile] = useState("");
    const [preview, setPreview] = useState<MetadataPreview | null>(null);
    const [previewOpen, setPreviewOpen] = useState(false);
    const [previewLoading, setPreviewLoading] = useState(false);
    const loadFiles = useCallback(async () => {
        if (!rootPath)
            return;
        setLoading(true);
        try {
            const nodes = await ListDirectoryFiles(rootPath) as FileNode[];
            setAllFiles(nodes || []);
            setEligibility({});
            setSelectedFiles(new Set());
            setResults([]);
            setScanCompleted(false);
        }
        catch (error) {
            setAllFiles([]);
            setEligibility({});
            setSelectedFiles(new Set());
            setScanCompleted(false);
            toast.error(t("translation.enrich.failedLoadFiles"), { description: String(error) });
        }
        finally {
            setLoading(false);
        }
    }, [rootPath]);
    const scanFiles = async () => {
        const audio = flattenAudioFiles(allFiles);
        if (audio.length === 0)
            return;
        setScanning(true);
        setScanProgress({ current: 0, total: audio.length });
        try {
            const inspections: MetadataPreview[] = [];
            for (let index = 0; index < audio.length; index++) {
                const result = await InspectEnrichFiles([audio[index].path]) as MetadataPreview[];
                if (result[0])
                    inspections.push(result[0]);
                setScanProgress({ current: index + 1, total: audio.length });
            }
            const inspectionMap = Object.fromEntries(inspections.map((item) => [item.file_path, item]));
            const eligiblePaths = new Set(inspections.filter((item) => canEnrich(item, priority, allowFallback)).map((item) => item.file_path));
            setEligibility(inspectionMap);
            setSelectedFiles(eligiblePaths);
            setScanCompleted(true);
            toast.success(t("translation.enrich.scanCompletedSummary", { value1: eligiblePaths.size, value2: audio.length - eligiblePaths.size, value3: audio.length }));
        }
        catch (error) {
            toast.error(t("translation.enrich.scanFailed"), { description: String(error) });
        }
        finally {
            setScanning(false);
        }
    };
    useEffect(() => {
        const timer = window.setTimeout(() => {
            if (rootPath) {
                void loadFiles();
                return;
            }
            void GetDefaults().then((defaults) => setRootPath(defaults.downloadPath || ""));
        }, 0);
        return () => window.clearTimeout(timer);
    }, [rootPath, loadFiles]);
    const audioFiles = flattenAudioFiles(allFiles);
    const toggleExpand = (path: string) => setAllFiles((nodes) => {
        const update = (items: FileNode[]): FileNode[] => items.map((item) => item.path === path ? { ...item, expanded: !item.expanded } : item.children ? { ...item, children: update(item.children) } : item);
        return update(nodes);
    });
    const toggleFile = (path: string) => setSelectedFiles((current) => {
        const next = new Set(current);
        if (next.has(path))
            next.delete(path);
        else
            next.add(path);
        return next;
    });
    const folderFiles = (node: FileNode) => flattenAudioFiles([node]);
    const eligibleFolderFiles = (node: FileNode) => folderFiles(node).filter((file) => canEnrich(eligibility[file.path], priority, allowFallback));
    const folderState = (node: FileNode): boolean | "indeterminate" => {
        const files = eligibleFolderFiles(node);
        if (files.length === 0)
            return false;
        const count = files.filter((file) => selectedFiles.has(file.path)).length;
        return count === 0 ? false : count === files.length ? true : "indeterminate";
    };
    const toggleFolder = (node: FileNode) => setSelectedFiles((current) => {
        const next = new Set(current);
        const files = eligibleFolderFiles(node);
        const remove = files.every((file) => next.has(file.path));
        files.forEach((file) => remove ? next.delete(file.path) : next.add(file.path));
        return next;
    });
    const selectFolder = async () => {
        try {
            const path = await SelectFolder(rootPath);
            if (path)
                setRootPath(path);
        }
        catch (error) {
            toast.error(t("translation.common.folderSelectionFailed"), { description: String(error) });
        }
    };
    const enrich = async () => {
        const eligibleSelection = [...selectedFiles].filter((filePath) => canEnrich(eligibility[filePath], priority, allowFallback));
        if (eligibleSelection.length === 0)
            return;
        setProcessing(true);
        setResults([]);
        try {
            const response = await EnrichAudioFiles(eligibleSelection, priority, allowFallback) as EnrichResult[];
            setResults(response);
            const successes = response.filter((item) => item.status === "enriched").length;
            toast.success(t("translation.enrich.completedDescription", { value1: successes, value2: response.length }));
        }
        catch (error) {
            toast.error(t("translation.enrich.failed"), { description: String(error) });
        }
        finally {
            setProcessing(false);
        }
    };
    const openPreview = async (filePath: string) => {
        if (!scanCompleted)
            return;
        setPreviewFile(filePath);
        setPreview(null);
        setPreviewOpen(true);
        setPreviewLoading(true);
        try {
            const inspected = await InspectEnrichFile(filePath) as MetadataPreview;
            setPreview(inspected);
            setEligibility((current) => ({ ...current, [filePath]: inspected }));
        }
        catch (error) {
            toast.error(t("translation.enrich.failedReadMetadata"), { description: String(error) });
            setPreviewOpen(false);
        }
        finally {
            setPreviewLoading(false);
        }
    };
    const statusIcon = (status: EnrichResult["status"]) => status === "enriched" ? <CircleCheckBig className="size-4 text-emerald-500"/> : status === "conflict" ? <AlertTriangle className="size-4 text-amber-500"/> : <XCircle className="size-4 text-destructive"/>;
    const unavailableReason = (preview: MetadataPreview) => {
        if (preview.inspection_error)
            return t("translation.enrich.metadataUnreadable");
        if (!allowFallback)
            return priority === "isrc" ? t("translation.enrich.isrcRequiredNoFallback") : t("translation.enrich.urlRequiredNoFallback");
        return t("translation.enrich.identityMissing");
    };
    const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, activate: () => void) => {
        if (event.key !== "Enter" && event.key !== " ")
            return;
        event.preventDefault();
        activate();
    };
    const renderTree = (nodes: FileNode[], depth = 0): ReactNode => nodes.map((node) => {
        const files = node.is_dir ? folderFiles(node) : [];
        if (node.is_dir && files.length === 0)
            return null;
        if (!node.is_dir && !isAudioFile(node))
            return null;
        const result = results.find((item) => item.file_path === node.path);
        const identity = eligibility[node.path];
        const missing = identity ? metadataMissingCount(identity) : null;
        const eligible = node.is_dir ? eligibleFolderFiles(node).length > 0 : canEnrich(identity, priority, allowFallback);
        const activate = () => node.is_dir ? toggleExpand(node.path) : eligible && toggleFile(node.path);
        return <div key={node.path}>
          <div className={`flex items-center gap-2 rounded px-2 py-1.5 hover:bg-muted/50 ${node.is_dir || eligible ? "cursor-pointer" : "cursor-default"} ${!node.is_dir && eligible && selectedFiles.has(node.path) ? "bg-primary/10" : ""}`} style={{ paddingLeft: `${depth * 16 + 8}px` }} onClick={activate} onKeyDown={(event) => handleTreeKeyDown(event, activate)} role={node.is_dir || eligible ? "button" : undefined} tabIndex={node.is_dir || eligible ? 0 : undefined} aria-expanded={node.is_dir ? !!node.expanded : undefined} aria-pressed={!node.is_dir && eligible ? selectedFiles.has(node.path) : undefined}>
            <Checkbox checked={node.is_dir ? folderState(node) : eligible && selectedFiles.has(node.path)} disabled={!eligible} onCheckedChange={() => node.is_dir ? toggleFolder(node) : toggleFile(node.path)} onClick={(event) => event.stopPropagation()} className="shrink-0"/>
            {node.is_dir && (node.expanded ? <ChevronDown className="size-4 shrink-0 text-muted-foreground"/> : <ChevronRight className="size-4 shrink-0 text-muted-foreground"/>)}
            {node.is_dir ? <Folder className="size-4 shrink-0 text-yellow-500"/> : result ? statusIcon(result.status) : identity && !eligible ? <AlertTriangle className="size-4 shrink-0 text-amber-500"/> : <FileMusic className="size-4 shrink-0 text-primary"/>}
            <span className={`min-w-0 flex-1 truncate text-sm ${!node.is_dir && !eligible ? "text-muted-foreground" : ""}`}>{node.name}{node.is_dir && <span className="ml-1 text-muted-foreground">({scanCompleted && <>{eligibleFolderFiles(node).length}/</>}{files.length})</span>}</span>
            {result?.source && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">{result.source}</span>}
            {!node.is_dir && identity && !eligible && <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">{t("translation.enrich.unavailable")}</span>}
            {!node.is_dir && missing !== null && !identity?.inspection_error && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${missing > 0 ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"}`}>{missing} {t("translation.enrich.missing")}</span>}
            {!node.is_dir && <><span className="shrink-0 text-xs text-muted-foreground">{formatFileSize(node.size)}</span>{scanCompleted && <Tooltip><TooltipTrigger asChild><button className="shrink-0 rounded p-1 hover:bg-muted" onClick={(event) => { event.stopPropagation(); void openPreview(node.path); }}><Info className="size-3.5 text-muted-foreground"/></button></TooltipTrigger><TooltipContent>{t("translation.fileManager.viewMetadata")}</TooltipContent></Tooltip>}</>}
          </div>
          {!node.is_dir && result?.message && <p className="truncate pb-1 pl-14 text-xs text-muted-foreground">{translateMessage(result.message)}</p>}
          {node.is_dir && node.expanded && node.children && renderTree(node.children, depth + 1)}
        </div>;
    });
    const eligibleFiles = audioFiles.filter((file) => canEnrich(eligibility[file.path], priority, allowFallback));
    const selectedEligibleFiles = eligibleFiles.filter((file) => selectedFiles.has(file.path));
    const unavailableFiles = scanCompleted ? audioFiles.length - eligibleFiles.length : 0;
    const allSelected = eligibleFiles.length > 0 && selectedEligibleFiles.length === eligibleFiles.length;
    const previewRows = preview ? [
        [t("translation.common.title"), preview.title],
        [t("translation.common.artist"), preview.artist],
        [t("translation.common.album"), preview.album],
        [t("translation.common.albumArtist"), preview.album_artist],
        [t("translation.fileManager.year"), preview.date],
        [t("translation.fileManager.track2"), preview.track_number ? `${preview.track_number}${preview.total_tracks ? ` / ${preview.total_tracks}` : ""}` : ""],
        [t("translation.fileManager.disc"), preview.disc_number ? `${preview.disc_number}${preview.total_discs ? ` / ${preview.total_discs}` : ""}` : ""],
        [t("translation.settings.composer"), preview.composer],
        [t("translation.common.copyright"), preview.copyright],
        [t("translation.enrich.publisher"), preview.publisher],
        [t("translation.settings.genre"), preview.genre],
        [t("literal.common.isrc"), preview.isrc],
        [t("literal.common.upc"), preview.upc],
        [t("translation.enrich.sourceUrl"), preview.comment],
        [t("translation.common.lyrics"), preview.lyrics_present ? t("translation.enrich.embedded") : ""],
    ] : [];
    const missingCount = previewRows.filter(([, value]) => !value).length;
    return <div className="flex h-[calc(100dvh-5.5rem)] min-h-0 flex-col gap-6 md:h-[calc(100dvh-6.5rem)]">
      <div className="flex shrink-0 items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">{t("translation.enrich.title")}</h1>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline">{t("translation.common.settings")}</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 p-2">
            <DropdownMenuLabel>{t("translation.enrich.dataPriority")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={priority} onValueChange={(value) => setPriority(value as Priority)}>
              <DropdownMenuRadioItem value="url">{t("literal.enrich.url")}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="isrc">{t("literal.enrich.isrc")}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <div className="flex items-center justify-between gap-4 px-2 py-2 text-sm">
              <span>{t("translation.enrich.allowFallback")}</span>
              <Switch checked={allowFallback} onCheckedChange={setAllowFallback} aria-label={t("translation.enrich.allowFallback")}/>
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="shrink-0 space-y-2">
        <div className="flex items-center gap-2">
          <InputWithContext value={rootPath} onChange={(event) => setRootPath(event.target.value)} placeholder={t("translation.fileManager.selectFolder")} className="flex-1"/>
          <Tooltip><TooltipTrigger asChild><Button variant="outline" size="icon" onClick={selectFolder} aria-label={t("translation.common.browse")}><FolderOpen className="size-4"/></Button></TooltipTrigger><TooltipContent>{t("translation.common.browse")}</TooltipContent></Tooltip>
          <Button variant="outline" onClick={loadFiles} disabled={loading || !rootPath}><RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`}/>{t("translation.common.refresh")}</Button>
        </div>
        {scanning && <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{t("translation.enrich.scanning")}</span><span className="font-mono tabular-nums">{scanProgress.current} / {scanProgress.total}</span></div>
          <Progress value={scanProgress.total > 0 ? (scanProgress.current / scanProgress.total) * 100 : 0} aria-label={t("translation.enrich.scanning")}/>
        </div>}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
          <div className="flex items-center justify-between gap-2 border-b bg-muted/30 p-2">
            <div className="flex min-w-0 items-center gap-2"><Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon" disabled={eligibleFiles.length === 0} onClick={() => setSelectedFiles(allSelected ? new Set() : new Set(eligibleFiles.map((file) => file.path)))}>{allSelected ? <CheckSquare className="size-4"/> : <Square className="size-4"/>}</Button></TooltipTrigger><TooltipContent>{allSelected ? t("translation.artistInfo.deselectAll") : t("translation.common.selectAll")}</TooltipContent></Tooltip><span className="truncate text-sm text-muted-foreground">{selectedEligibleFiles.length} / {eligibleFiles.length}</span></div>
            {scanCompleted && <span className="truncate text-xs text-muted-foreground">{t("translation.enrich.scanSummary", { value1: eligibleFiles.length, value2: unavailableFiles, value3: audioFiles.length })}</span>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar">{loading ? <div className="flex justify-center py-8"><Spinner className="size-6"/></div> : audioFiles.length === 0 ? <div className="py-8 text-center text-muted-foreground">{t("translation.enrich.noFiles")}</div> : renderTree(allFiles)}</div>
      </div>
      <div className="flex shrink-0 justify-center gap-2">
        <Button variant={scanCompleted ? "outline" : "default"} className="px-4" onClick={scanFiles} disabled={loading || scanning || processing || audioFiles.length === 0}><ScanText className={`size-4 ${scanning ? "animate-pulse" : ""}`}/>{scanning ? t("translation.enrich.scanning") : t("translation.enrich.scan")}</Button>
        {scanCompleted && <Button className="px-4" onClick={enrich} disabled={processing || selectedEligibleFiles.length === 0}>{processing ? <Spinner className="size-4"/> : <TagPlusIcon size={16} animated={false}/>}{processing ? t("translation.enrich.processing") : t("translation.enrich.start")}</Button>}
      </div>
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-md [&>button]:hidden">
          <DialogHeader><DialogTitle className="flex items-center gap-2">{t("translation.enrich.metadataPreview")}{preview && missingCount > 0 && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">{missingCount} {t("translation.enrich.missing")}</span>}</DialogTitle><DialogDescription className="break-all">{previewFile.split(/[/\\]/).pop()}</DialogDescription></DialogHeader>
          {previewLoading ? <div className="flex justify-center py-10"><Spinner className="size-6"/></div> : preview && <>
            {!canEnrich(preview, priority, allowFallback) && <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300"><AlertTriangle className="mt-0.5 size-4 shrink-0"/><span>{unavailableReason(preview)}</span></div>}
            <div className="max-h-[55vh] space-y-3 overflow-y-auto py-2 custom-scrollbar">{previewRows.map(([label, value]) => <div key={label} className="grid grid-cols-[100px_minmax(0,1fr)] gap-2 text-sm"><span className="text-muted-foreground">{label}</span>{value ? <span className="break-words">{value}</span> : <span className="w-fit rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">{t("translation.enrich.missing")}</span>}</div>)}</div>
          </>}
          <DialogFooter><Button onClick={() => setPreviewOpen(false)}>{t("translation.common.close")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>;
}
