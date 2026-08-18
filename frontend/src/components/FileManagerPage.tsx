import { useState, useEffect, useCallback } from "react";
import { t, translateMessage } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { InputWithContext } from "@/components/ui/input-with-context";
import { Checkbox } from "@/components/ui/checkbox";
import { FolderOpen, RefreshCw, FileMusic, ChevronRight, ChevronDown, Pencil, Eye, Folder, Info, FileText, Image, Copy, CircleCheck, CheckSquare, Square, } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { ListDirectoryFiles, PreviewRenameFiles, ReadFileMetadata, ReadImageAsBase64, ReadTextFile, RenameFileTo, RenameFilesByMetadata, SelectFolder } from "../../wailsjs/go/main/App";
import { backend } from "../../wailsjs/go/models";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { getSettings, type TemplateToken } from "@/lib/settings";
import { FormatEditor } from "@/components/FormatEditor";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, } from "@/components/ui/dialog";
import type { AudioMetadata } from "@/types/api";
interface FileNode {
    name: string;
    path: string;
    is_dir: boolean;
    size: number;
    children?: FileNode[];
    expanded?: boolean;
}
type TabType = "track" | "lyric" | "cover";
const FORMAT_PRESETS: Record<string, {
    label: string;
    template: string;
}> = {
    "title": { label: t("translation.common.title"), template: "{title}" },
    "title-artist": { label: "Title - Artist", template: "{title} - {artist}" },
    "artist-title": { label: "Artist - Title", template: "{artist} - {title}" },
    "track-title": { label: "Track. Title", template: "{track}. {title}" },
    "track-title-artist": { label: "Track. Title - Artist", template: "{track}. {title} - {artist}" },
    "track-artist-title": { label: "Track. Artist - Title", template: "{track}. {artist} - {title}" },
    "title-album-artist": { label: "Title - Album Artist", template: "{title} - {album_artist}" },
    "track-title-album-artist": { label: "Track. Title - Album Artist", template: "{track}. {title} - {album_artist}" },
    "artist-album-title": { label: "Artist - Album - Title", template: "{artist} - {album} - {title}" },
    "track-dash-title": { label: "Track - Title", template: "{track} - {title}" },
    "disc-track-title": { label: "Disc-Track. Title", template: "{disc}-{track}. {title}" },
    "disc-track-title-artist": { label: "Disc-Track. Title - Artist", template: "{disc}-{track}. {title} - {artist}" },
    "custom": { label: "Custom...", template: "{title} - {artist}" },
};
const STORAGE_KEY = "spotiflac_file_manager_state";
const DEFAULT_CUSTOM_FORMAT = "{title} - {artist}";
const RENAME_TEMPLATE_VARIABLES: TemplateToken[] = [
    { key: "{title}", description: t("translation.common.trackTitle"), example: "Golden" },
    { key: "{artist}", description: t("translation.fileManager.trackArtist"), example: "HUNTR/X" },
    { key: "{album}", description: t("translation.common.albumName"), example: "KPop Demon Hunters (Soundtrack from the Netflix Film)" },
    { key: "{album_artist}", description: t("translation.common.albumArtist2"), example: "KPop Demon Hunters Cast / HUNTR/X / Saja Boys" },
    { key: "{track}", description: t("translation.common.trackNumber"), example: "04" },
    { key: "{disc}", description: t("translation.common.discNumber"), example: "1" },
    { key: "{year}", description: t("translation.common.releaseYear"), example: "2025" },
    { key: "{date}", description: t("translation.fileManager.releaseDate"), example: "2025-06-20" },
    { key: "{isrc}", description: t("translation.common.trackIsrc"), example: "QZ8BZ2513510" },
    { key: "{upc}", description: t("translation.common.albumUpcBarcode"), example: "00602478398346" },
];
function formatFileSize(bytes: number): string {
    if (bytes === 0)
        return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
export function FileManagerPage() {
    const [rootPath, setRootPath] = useState(() => {
        const settings = getSettings();
        return settings.downloadPath || "";
    });
    const [allFiles, setAllFiles] = useState<FileNode[]>([]);
    const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
    const [loading, setLoading] = useState(false);
    const [activeTab, setActiveTab] = useState<TabType>("track");
    const [renameFormat, setRenameFormat] = useState<string>(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (typeof parsed.renameFormat === "string" && parsed.renameFormat) {
                    return parsed.renameFormat;
                }
                if (parsed.formatPreset === "custom" && parsed.customFormat) {
                    return parsed.customFormat;
                }
                if (parsed.formatPreset && FORMAT_PRESETS[parsed.formatPreset]) {
                    return FORMAT_PRESETS[parsed.formatPreset].template;
                }
            }
        }
        catch {
        }
        return DEFAULT_CUSTOM_FORMAT;
    });
    const [showPreview, setShowPreview] = useState(false);
    const [previewData, setPreviewData] = useState<backend.RenamePreview[]>([]);
    const [renaming, setRenaming] = useState(false);
    const [previewOnly, setPreviewOnly] = useState(false);
    const [showMetadata, setShowMetadata] = useState(false);
    const [metadataFile, setMetadataFile] = useState<string>("");
    const [metadataInfo, setMetadataInfo] = useState<AudioMetadata | null>(null);
    const [loadingMetadata, setLoadingMetadata] = useState(false);
    const [showLyricsPreview, setShowLyricsPreview] = useState(false);
    const [lyricsContent, setLyricsContent] = useState("");
    const [lyricsFile, setLyricsFile] = useState("");
    const [lyricsTab, setLyricsTab] = useState<"synced" | "plain">("synced");
    const [copySuccess, setCopySuccess] = useState(false);
    const [showCoverPreview, setShowCoverPreview] = useState(false);
    const [coverFile, setCoverFile] = useState("");
    const [coverData, setCoverData] = useState("");
    const [showManualRename, setShowManualRename] = useState(false);
    const [manualRenameFile, setManualRenameFile] = useState("");
    const [manualRenameName, setManualRenameName] = useState("");
    const [manualRenaming, setManualRenaming] = useState(false);
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({ renameFormat }));
        }
        catch {
        }
    }, [renameFormat]);
    const filterFilesByType = (nodes: FileNode[], type: TabType): FileNode[] => {
        return nodes
            .map((node) => {
            if (node.is_dir && node.children) {
                const filteredChildren = filterFilesByType(node.children, type);
                if (filteredChildren.length > 0) {
                    return { ...node, children: filteredChildren };
                }
                return null;
            }
            const ext = node.name.toLowerCase();
            if (type === "track" && (ext.endsWith(".flac") || ext.endsWith(".mp3") || ext.endsWith(".m4a")))
                return node;
            if (type === "lyric" && ext.endsWith(".lrc"))
                return node;
            if (type === "cover" && (ext.endsWith(".jpg") || ext.endsWith(".jpeg") || ext.endsWith(".png")))
                return node;
            return null;
        })
            .filter((node): node is FileNode => node !== null);
    };
    const loadFiles = useCallback(async () => {
        if (!rootPath)
            return;
        setLoading(true);
        try {
            const result = await ListDirectoryFiles(rootPath);
            if (!result || !Array.isArray(result)) {
                setAllFiles([]);
                setSelectedFiles(new Set());
                return;
            }
            setAllFiles(result as FileNode[]);
            setSelectedFiles(new Set());
        }
        catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err || "");
            if (!errorMsg.toLowerCase().includes("empty") && !errorMsg.toLowerCase().includes("no file")) {
                toast.error(t("translation.fileManager.failedLoadFiles"), { description: errorMsg ? translateMessage(errorMsg) : t("translation.audioConverter.unknownError") });
            }
            setAllFiles([]);
            setSelectedFiles(new Set());
        }
        finally {
            setLoading(false);
        }
    }, [rootPath]);
    useEffect(() => {
        if (rootPath)
            loadFiles();
    }, [rootPath, loadFiles]);
    const filteredFiles = filterFilesByType(allFiles, activeTab);
    const getAllFilesFlat = (nodes: FileNode[]): FileNode[] => {
        const result: FileNode[] = [];
        for (const node of nodes) {
            if (!node.is_dir)
                result.push(node);
            if (node.children)
                result.push(...getAllFilesFlat(node.children));
        }
        return result;
    };
    const allAudioFiles = getAllFilesFlat(filterFilesByType(allFiles, "track"));
    const allLyricFiles = getAllFilesFlat(filterFilesByType(allFiles, "lyric"));
    const allCoverFiles = getAllFilesFlat(filterFilesByType(allFiles, "cover"));
    const handleSelectFolder = async () => {
        try {
            const path = await SelectFolder(rootPath);
            if (path)
                setRootPath(path);
        }
        catch (err) {
            toast.error(t("translation.fileManager.failedSelectFolder"), { description: err instanceof Error ? translateMessage(err.message) : t("translation.audioConverter.unknownError") });
        }
    };
    const toggleExpand = (path: string) => {
        setAllFiles((prev) => toggleNodeExpand(prev, path));
    };
    const toggleNodeExpand = (nodes: FileNode[], path: string): FileNode[] => {
        return nodes.map((node) => {
            if (node.path === path)
                return { ...node, expanded: !node.expanded };
            if (node.children)
                return { ...node, children: toggleNodeExpand(node.children, path) };
            return node;
        });
    };
    const toggleSelect = (path: string) => {
        setSelectedFiles((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(path))
                newSet.delete(path);
            else
                newSet.add(path);
            return newSet;
        });
    };
    const toggleFolderSelect = (node: FileNode) => {
        const folderFiles = getAllFilesFlat([node]);
        const allSelected = folderFiles.every((f) => selectedFiles.has(f.path));
        setSelectedFiles((prev) => {
            const newSet = new Set(prev);
            if (allSelected)
                folderFiles.forEach((f) => newSet.delete(f.path));
            else
                folderFiles.forEach((f) => newSet.add(f.path));
            return newSet;
        });
    };
    const isFolderSelected = (node: FileNode): boolean | "indeterminate" => {
        const folderFiles = getAllFilesFlat([node]);
        if (folderFiles.length === 0)
            return false;
        const selectedCount = folderFiles.filter((f) => selectedFiles.has(f.path)).length;
        if (selectedCount === 0)
            return false;
        if (selectedCount === folderFiles.length)
            return true;
        return "indeterminate";
    };
    const selectAll = () => setSelectedFiles(new Set(allAudioFiles.map((f) => f.path)));
    const deselectAll = () => setSelectedFiles(new Set());
    const handlePreview = async (isPreviewOnly: boolean) => {
        if (selectedFiles.size === 0) {
            toast.error(t("translation.common.noFilesSelected"));
            return;
        }
        try {
            const result = await PreviewRenameFiles(Array.from(selectedFiles), renameFormat);
            setPreviewData(result);
            setPreviewOnly(isPreviewOnly);
            setShowPreview(true);
        }
        catch (err) {
            toast.error(t("translation.fileManager.failedGeneratePreview"), { description: err instanceof Error ? translateMessage(err.message) : t("translation.audioConverter.unknownError") });
        }
    };
    const handleShowMetadata = async (filePath: string, e: React.MouseEvent) => {
        e.stopPropagation();
        await openMetadataPreview(filePath);
    };
    const openMetadataPreview = async (filePath: string) => {
        setMetadataFile(filePath);
        setLoadingMetadata(true);
        try {
            const metadata = await ReadFileMetadata(filePath);
            setMetadataInfo(metadata as AudioMetadata);
            setShowMetadata(true);
        }
        catch (err) {
            toast.error(t("translation.migrated.FileManagerPage.failedToReadMetadata"), { description: err instanceof Error ? translateMessage(err.message) : t("translation.audioConverter.unknownError") });
            setMetadataInfo(null);
        }
        finally {
            setLoadingMetadata(false);
        }
    };
    const handleShowLyrics = async (filePath: string, e: React.MouseEvent) => {
        e.stopPropagation();
        await openLyricsPreview(filePath);
    };
    const openLyricsPreview = async (filePath: string) => {
        setLyricsFile(filePath);
        setLyricsTab("synced");
        try {
            const content = await ReadTextFile(filePath);
            setLyricsContent(content);
            setShowLyricsPreview(true);
        }
        catch (err) {
            toast.error(t("translation.fileManager.failedReadLyricsFile"), { description: err instanceof Error ? translateMessage(err.message) : t("translation.audioConverter.unknownError") });
        }
    };
    const handleShowCover = async (filePath: string, e: React.MouseEvent) => {
        e.stopPropagation();
        await openCoverPreview(filePath);
    };
    const openCoverPreview = async (filePath: string) => {
        setCoverFile(filePath);
        try {
            const data = await ReadImageAsBase64(filePath);
            setCoverData(data);
            setShowCoverPreview(true);
        }
        catch (err) {
            toast.error(t("translation.fileManager.failedLoadImage"), { description: err instanceof Error ? translateMessage(err.message) : t("translation.audioConverter.unknownError") });
        }
    };
    const getPlainLyrics = (content: string) => {
        return content.split('\n').map(line => line.replace(/^\[[\d:.]+\]\s*/, '')).filter(line => !line.startsWith('[') || line.includes(']')).map(line => line.startsWith('[') ? '' : line).join('\n').trim();
    };
    const formatTimestamp = (timestamp: string): string => {
        const match = timestamp.match(/\[(\d+):(\d+)(?:\.(\d+))?\]/);
        if (!match)
            return timestamp;
        const minutes = parseInt(match[1], 10);
        const seconds = match[2];
        return `${minutes}:${seconds}`;
    };
    const renderSyncedLyrics = (content: string) => {
        if (!content)
            return <div className="text-sm text-muted-foreground">{t("translation.fileManager.noLyricsContent")}</div>;
        const lines = content.split('\n');
        const lineKeyCounts = new Map<string, number>();
        const getLineKey = (baseKey: string) => {
            const count = lineKeyCounts.get(baseKey) ?? 0;
            lineKeyCounts.set(baseKey, count + 1);
            return `${baseKey}-${count}`;
        };
        return lines.map((line) => {
            if (line.match(/^\[(ti|ar|al|by|length|offset):/i))
                return null;
            const match = line.match(/^(\[[\d:.]+\])(.*)$/);
            if (match) {
                const timestamp = match[1];
                const text = match[2].trim();
                if (!text)
                    return null;
                return (<div key={getLineKey(`timestamp-${timestamp}-${text}`)} className="flex items-center gap-2 py-1">
          <Badge variant="secondary" className="font-mono text-xs shrink-0">
            {formatTimestamp(timestamp)}
          </Badge>
          <span className="text-sm">{text}</span>
        </div>);
            }
            if (!line.trim())
                return null;
            return (<div key={getLineKey(`plain-${line}`)} className="py-1">
        <span className="text-sm">{line}</span>
      </div>);
        }).filter(item => item !== null);
    };
    const handleTreeItemKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, activate: () => void) => {
        if (event.key !== "Enter" && event.key !== " ") {
            return;
        }
        event.preventDefault();
        activate();
    };
    const handleCopyLyrics = async () => {
        try {
            const textToCopy = lyricsTab === "synced" ? lyricsContent : getPlainLyrics(lyricsContent);
            await navigator.clipboard.writeText(textToCopy);
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 500);
        }
        catch {
            toast.error(t("translation.fileManager.failedCopyLyrics"));
        }
    };
    const handleManualRename = (filePath: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const fileName = filePath.split(/[/\\]/).pop() || "";
        const nameWithoutExt = fileName.replace(/\.[^.]+$/, "");
        setManualRenameFile(filePath);
        setManualRenameName(nameWithoutExt);
        setShowManualRename(true);
    };
    const handleConfirmManualRename = async () => {
        if (!manualRenameFile || !manualRenameName.trim())
            return;
        setManualRenaming(true);
        try {
            await RenameFileTo(manualRenameFile, manualRenameName.trim());
            toast.success(t("translation.fileManager.fileRenamedSuccessfully"));
            setShowManualRename(false);
            loadFiles();
        }
        catch (err) {
            toast.error(t("translation.fileManager.failedRenameFile"), { description: err instanceof Error ? translateMessage(err.message) : t("translation.audioConverter.unknownError") });
        }
        finally {
            setManualRenaming(false);
        }
    };
    const handleRename = async () => {
        if (selectedFiles.size === 0)
            return;
        setRenaming(true);
        try {
            const result = await RenameFilesByMetadata(Array.from(selectedFiles), renameFormat);
            const successCount = result.filter((r: backend.RenameResult) => r.success).length;
            const failCount = result.filter((r: backend.RenameResult) => !r.success).length;
            if (successCount > 0)
                toast.success(t("translation.fileManager.renameComplete"), { description: t("translation.fileManager.renamed", { count: successCount, failures: failCount > 0 ? t("translation.common.failures", { count: failCount }) : "" }) });
            else
                toast.error(t("translation.fileManager.renameFailed"), { description: t("translation.fileManager.allFailed", { count: failCount }) });
            setShowPreview(false);
            setSelectedFiles(new Set());
            loadFiles();
        }
        catch (err) {
            toast.error(t("translation.fileManager.renameFailed"), { description: err instanceof Error ? translateMessage(err.message) : t("translation.audioConverter.unknownError") });
        }
        finally {
            setRenaming(false);
        }
    };
    const renderTrackTree = (nodes: FileNode[], depth = 0) => {
        return nodes.map((node) => (<div key={node.path}>
      <div className={`flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer ${selectedFiles.has(node.path) ? "bg-primary/10" : ""}`} style={{ paddingLeft: `${depth * 16 + 8}px` }} onClick={() => (node.is_dir ? toggleExpand(node.path) : toggleSelect(node.path))} onKeyDown={(event) => handleTreeItemKeyDown(event, () => (node.is_dir ? toggleExpand(node.path) : toggleSelect(node.path)))} role="button" tabIndex={0} aria-expanded={node.is_dir ? !!node.expanded : undefined} aria-pressed={node.is_dir ? undefined : selectedFiles.has(node.path)}>
        {node.is_dir ? (<>
          <Checkbox checked={isFolderSelected(node) === true} ref={(el) => {
                    if (el)
                        (el as HTMLButtonElement).dataset.state = isFolderSelected(node) === "indeterminate" ? "indeterminate" : isFolderSelected(node) ? "checked" : "unchecked";
                }} onCheckedChange={() => toggleFolderSelect(node)} onClick={(e) => e.stopPropagation()} className="shrink-0 data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground"/>
          {node.expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0"/> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0"/>}
          <Folder className="h-4 w-4 text-yellow-500 shrink-0"/>
        </>) : (<>
          <Checkbox checked={selectedFiles.has(node.path)} onCheckedChange={() => toggleSelect(node.path)} onClick={(e) => e.stopPropagation()} className="shrink-0"/>
          <FileMusic className="h-4 w-4 text-primary shrink-0"/>
        </>)}
        <span className="truncate text-sm flex-1">
          {node.name}
          {node.is_dir && <span className="text-muted-foreground ml-1">({getAllFilesFlat([node]).length})</span>}
        </span>
        {!node.is_dir && (<>
          <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(node.size)}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="p-1 rounded hover:bg-muted shrink-0" onClick={(e) => handleShowMetadata(node.path, e)}>
                <Info className="h-3.5 w-3.5 text-muted-foreground"/>
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("translation.fileManager.viewMetadata")}</TooltipContent>
          </Tooltip>
        </>)}
      </div>
      {node.is_dir && node.expanded && node.children && <div>{renderTrackTree(node.children, depth + 1)}</div>}
    </div>));
    };
    const renderLyricTree = (nodes: FileNode[], depth = 0) => {
        return nodes.map((node) => (<div key={node.path}>
      <div className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer" style={{ paddingLeft: `${depth * 16 + 8}px` }} onClick={(e) => {
                if (node.is_dir) {
                    toggleExpand(node.path);
                    return;
                }
                void handleShowLyrics(node.path, e);
            }} onKeyDown={(event) => handleTreeItemKeyDown(event, () => {
                if (node.is_dir) {
                    toggleExpand(node.path);
                    return;
                }
                void openLyricsPreview(node.path);
            })} role="button" tabIndex={0} aria-expanded={node.is_dir ? !!node.expanded : undefined}>
        {node.is_dir ? (<>
          {node.expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0"/> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0"/>}
          <Folder className="h-4 w-4 text-yellow-500 shrink-0"/>
        </>) : (<FileText className="h-4 w-4 text-blue-500 shrink-0"/>)}
        <span className="truncate text-sm flex-1">
          {node.name}
          {node.is_dir && <span className="text-muted-foreground ml-1">({getAllFilesFlat([node]).length})</span>}
        </span>
        {!node.is_dir && (<>
          <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(node.size)}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="p-1 rounded hover:bg-muted shrink-0" onClick={(e) => handleManualRename(node.path, e)}>
                <Pencil className="h-3.5 w-3.5 text-muted-foreground"/>
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("translation.fileManager.rename")}</TooltipContent>
          </Tooltip>
        </>)}
      </div>
      {node.is_dir && node.expanded && node.children && <div>{renderLyricTree(node.children, depth + 1)}</div>}
    </div>));
    };
    const renderCoverTree = (nodes: FileNode[], depth = 0) => {
        return nodes.map((node) => (<div key={node.path}>
      <div className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50 cursor-pointer" style={{ paddingLeft: `${depth * 16 + 8}px` }} onClick={(e) => {
                if (node.is_dir) {
                    toggleExpand(node.path);
                    return;
                }
                void handleShowCover(node.path, e);
            }} onKeyDown={(event) => handleTreeItemKeyDown(event, () => {
                if (node.is_dir) {
                    toggleExpand(node.path);
                    return;
                }
                void openCoverPreview(node.path);
            })} role="button" tabIndex={0} aria-expanded={node.is_dir ? !!node.expanded : undefined}>
        {node.is_dir ? (<>
          {node.expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0"/> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0"/>}
          <Folder className="h-4 w-4 text-yellow-500 shrink-0"/>
        </>) : (<Image className="h-4 w-4 text-green-500 shrink-0"/>)}
        <span className="truncate text-sm flex-1">
          {node.name}
          {node.is_dir && <span className="text-muted-foreground ml-1">({getAllFilesFlat([node]).length})</span>}
        </span>
        {!node.is_dir && (<>
          <span className="text-xs text-muted-foreground shrink-0">{formatFileSize(node.size)}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="p-1 rounded hover:bg-muted shrink-0" onClick={(e) => handleManualRename(node.path, e)}>
                <Pencil className="h-3.5 w-3.5 text-muted-foreground"/>
              </button>
            </TooltipTrigger>
            <TooltipContent>{t("translation.fileManager.rename")}</TooltipContent>
          </Tooltip>
        </>)}
      </div>
      {node.is_dir && node.expanded && node.children && <div>{renderCoverTree(node.children, depth + 1)}</div>}
    </div>));
    };
    const allSelected = allAudioFiles.length > 0 && selectedFiles.size === allAudioFiles.length;
    const fileScrollArea = (<div className="min-h-0 flex-1 overflow-y-auto p-2 custom-scrollbar">
        {loading ? (<div className="flex items-center justify-center py-8"><Spinner className="h-6 w-6"/></div>) : filteredFiles.length === 0 ? (<div className="text-center py-8 text-muted-foreground">
          {rootPath ? t("translation.migrated.FileManagerPage.noFilesFound", { value1: activeTab }) : t("translation.migrated.FileManagerPage.selectAFolderToBrowse")}
        </div>) : (activeTab === "track" ? renderTrackTree(filteredFiles) :
            activeTab === "lyric" ? renderLyricTree(filteredFiles) :
                renderCoverTree(filteredFiles))}
      </div>);
    const trackActionHeader = (<div className="flex items-center justify-between gap-2 p-2 border-b bg-muted/30 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={allSelected ? deselectAll : selectAll}>
                {allSelected ? <CheckSquare className="h-4 w-4"/> : <Square className="h-4 w-4"/>}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{allSelected ? t("translation.migrated.FileManagerPage.deselectAll") : t("translation.migrated.FileManagerPage.selectAll")}</TooltipContent>
          </Tooltip>
          <span className="text-sm text-muted-foreground truncate">{selectedFiles.size} / {allAudioFiles.length}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="icon" onClick={() => handlePreview(true)} disabled={selectedFiles.size === 0 || loading}>
                <Eye className="h-4 w-4"/>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("translation.common.preview")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" onClick={() => handlePreview(false)} disabled={selectedFiles.size === 0 || loading}>
                <Pencil className="h-4 w-4"/>
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("translation.fileManager.rename")}</TooltipContent>
          </Tooltip>
        </div>
      </div>);
    return (<div className="flex h-[calc(100dvh-5.5rem)] min-h-0 flex-col gap-6 md:h-[calc(100dvh-6.5rem)]">
    <div className="flex items-center justify-between shrink-0">
      <h1 className="text-2xl font-bold">{t("translation.common.fileManager")}</h1>
    </div>


    <div className="flex items-center gap-2 shrink-0">
      <InputWithContext value={rootPath} onChange={(e) => setRootPath(e.target.value)} placeholder={t("translation.fileManager.selectFolder")} className="flex-1"/>
      <Button onClick={handleSelectFolder}>
        <FolderOpen className="h-4 w-4"/>
        {t("translation.common.browse")}
      </Button>
      <Button variant="outline" onClick={loadFiles} disabled={loading || !rootPath}>
        <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}/>
        {t("translation.common.refresh")}
      </Button>
    </div>


    <div className="flex gap-2 border-b shrink-0">
      <Button variant={activeTab === "track" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("track")} className="rounded-b-none">
        <FileMusic className="h-4 w-4"/>
        {t("translation.fileManager.track")}
        {allAudioFiles.length > 0 && (<span className={`font-mono text-xs ${activeTab === "track" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{allAudioFiles.length.toLocaleString("en-US")}</span>)}
      </Button>
      <Button variant={activeTab === "lyric" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("lyric")} className="rounded-b-none">
        <FileText className="h-4 w-4"/>
        {t("translation.fileManager.lyric")}
        {allLyricFiles.length > 0 && (<span className={`font-mono text-xs ${activeTab === "lyric" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{allLyricFiles.length.toLocaleString("en-US")}</span>)}
      </Button>
      <Button variant={activeTab === "cover" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("cover")} className="rounded-b-none">
        <Image className="h-4 w-4"/>
        {t("translation.fileManager.cover")}
        {allCoverFiles.length > 0 && (<span className={`font-mono text-xs ${activeTab === "cover" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{allCoverFiles.length.toLocaleString("en-US")}</span>)}
      </Button>
    </div>


    {activeTab === "track" ? (<div className="grid min-h-0 flex-1 grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="min-w-0 overflow-y-auto lg:border-r lg:border-border lg:pr-6 custom-scrollbar">
        <FormatEditor title={t("translation.fileManager.renameFormat")} value={renameFormat} defaultValue={DEFAULT_CUSTOM_FORMAT} tokens={RENAME_TEMPLATE_VARIABLES} suffix=".flac" placeholder={t("literal.fileManager.titleArtist")} onChange={setRenameFormat}/>
      </div>
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border">
        {trackActionHeader}
        {fileScrollArea}
      </div>
    </div>) : (<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
      {fileScrollArea}
    </div>)}


    <Dialog open={showPreview} onOpenChange={setShowPreview}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col [&>button]:hidden">
        <DialogHeader>
          <DialogTitle>{t("translation.fileManager.renamePreview")}</DialogTitle>
          <DialogDescription>{t("translation.fileManager.reviewChangesBeforeRenamingFiles")}</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto space-y-2 py-4">
          {previewData.map((item) => (<div key={`${item.old_name}-${item.new_name}`} className={`p-3 rounded-lg border ${item.error ? "border-destructive/50 bg-destructive/5" : "border-border"}`}>
            <div className="text-sm">
              <div className="text-muted-foreground break-all">{item.old_name}</div>
              {item.error ? <div className="text-destructive text-xs mt-1">{item.error}</div> : <div className="text-primary font-medium break-all mt-1">→ {item.new_name}</div>}
            </div>
          </div>))}
        </div>
        <DialogFooter>
          {previewOnly ? (<Button onClick={() => setShowPreview(false)}>{t("translation.common.close")}</Button>) : (<>
            <Button variant="outline" onClick={() => setShowPreview(false)}>{t("translation.common.cancel")}</Button>
            <Button onClick={handleRename} disabled={renaming}>
              {renaming ? <><Spinner className="h-4 w-4"/>{t("translation.fileManager.renaming")}</> : <>{t("translation.fileManager.rename")} {previewData.filter((p) => !p.error).length} {t("translation.common.fileTitle", { count: previewData.filter((p) => !p.error).length })}</>}
            </Button>
          </>)}
        </DialogFooter>
      </DialogContent>
    </Dialog>


    <Dialog open={showMetadata} onOpenChange={setShowMetadata}>
      <DialogContent className="max-w-md [&>button]:hidden">
        <DialogHeader>
          <DialogTitle>{t("translation.fileManager.fileMetadata")}</DialogTitle>
          <DialogDescription className="break-all">{metadataFile.split(/[/\\]/).pop()}</DialogDescription>
        </DialogHeader>
        {loadingMetadata ? (<div className="flex items-center justify-center py-8"><Spinner className="h-6 w-6"/></div>) : metadataInfo ? (<div className="space-y-3 py-2">
          <div className="grid grid-cols-[100px_1fr] gap-2 text-sm"><span className="text-muted-foreground">{t("translation.common.title")}</span><span>{metadataInfo.title || "-"}</span></div>
          <div className="grid grid-cols-[100px_1fr] gap-2 text-sm"><span className="text-muted-foreground">{t("translation.common.artist")}</span><span>{metadataInfo.artist || "-"}</span></div>
          <div className="grid grid-cols-[100px_1fr] gap-2 text-sm"><span className="text-muted-foreground">{t("translation.common.album")}</span><span>{metadataInfo.album || "-"}</span></div>
          <div className="grid grid-cols-[100px_1fr] gap-2 text-sm"><span className="text-muted-foreground">{t("translation.common.albumArtist")}</span><span>{metadataInfo.album_artist || "-"}</span></div>
          <div className="grid grid-cols-[100px_1fr] gap-2 text-sm"><span className="text-muted-foreground">{t("translation.fileManager.track2")}</span><span>{metadataInfo.track_number || "-"}</span></div>
          <div className="grid grid-cols-[100px_1fr] gap-2 text-sm"><span className="text-muted-foreground">{t("translation.fileManager.disc")}</span><span>{metadataInfo.disc_number || "-"}</span></div>
          <div className="grid grid-cols-[100px_1fr] gap-2 text-sm"><span className="text-muted-foreground">{t("translation.fileManager.year")}</span><span>{metadataInfo.year ? metadataInfo.year.substring(0, 4) : "-"}</span></div>
          <div className="grid grid-cols-[100px_1fr] gap-2 text-sm"><span className="text-muted-foreground">{t("literal.common.upc")}</span><span>{metadataInfo.upc || "-"}</span></div>
          <div className="grid grid-cols-[100px_1fr] gap-2 text-sm"><span className="text-muted-foreground">ISRC</span><span>{metadataInfo.isrc || "-"}</span></div>
        </div>) : (<div className="text-center py-4 text-muted-foreground">{t("translation.fileManager.noMetadataAvailable")}</div>)}
        <DialogFooter><Button onClick={() => setShowMetadata(false)}>{t("translation.common.close")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>




    <Dialog open={showLyricsPreview} onOpenChange={setShowLyricsPreview}>
      <DialogContent className="max-w-lg max-h-[80vh] overflow-hidden flex flex-col [&>button]:hidden">
        <DialogHeader>
          <DialogTitle>{t("translation.fileManager.lyricsPreview")}</DialogTitle>
          <DialogDescription className="break-all">{lyricsFile.split(/[/\\]/).pop()}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2 border-b pb-2">
          <Button variant={lyricsTab === "synced" ? "default" : "ghost"} size="sm" onClick={() => setLyricsTab("synced")}>{t("translation.common.synced")}</Button>
          <Button variant={lyricsTab === "plain" ? "default" : "ghost"} size="sm" onClick={() => setLyricsTab("plain")}>{t("translation.fileManager.plain")}</Button>
        </div>
        <div className="flex-1 overflow-y-auto py-4">
          {lyricsTab === "synced" ? (<div className="bg-muted/30 p-4 rounded-lg space-y-0">
            {renderSyncedLyrics(lyricsContent)}
          </div>) : (<pre className="text-sm whitespace-pre-wrap font-mono bg-muted/30 p-4 rounded-lg">
            {getPlainLyrics(lyricsContent) || t("translation.fileManager.noLyricsContent")}
          </pre>)}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleCopyLyrics} className="gap-1.5">
            {copySuccess ? <CircleCheck className="h-4 w-4"/> : <Copy className="h-4 w-4"/>}
            {t("translation.common.copy")}
          </Button>
          <Button onClick={() => setShowLyricsPreview(false)}>{t("translation.common.close")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>


    <Dialog open={showCoverPreview} onOpenChange={setShowCoverPreview}>
      <DialogContent className="max-w-lg [&>button]:hidden">
        <DialogHeader>
          <DialogTitle>{t("translation.fileManager.coverPreview")}</DialogTitle>
          <DialogDescription className="break-all">{coverFile.split(/[/\\]/).pop()}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-center p-4">
          {coverData ? <img src={coverData} alt={t("translation.fileManager.cover2")} className="max-w-full max-h-87.5 rounded-lg object-contain"/> : <div className="text-muted-foreground">{t("translation.common.loading")}</div>}
        </div>
        <DialogFooter><Button onClick={() => setShowCoverPreview(false)}>{t("translation.common.close")}</Button></DialogFooter>
      </DialogContent>
    </Dialog>


    <Dialog open={showManualRename} onOpenChange={setShowManualRename}>
      <DialogContent className="max-w-2xl [&>button]:hidden">
        <DialogHeader>
          <DialogTitle>{t("translation.fileManager.renameFile")}</DialogTitle>
          <DialogDescription className="break-all">{manualRenameFile.split(/[/\\]/).pop()}</DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Label htmlFor="newName" className="text-sm">{t("translation.fileManager.newName")}</Label>
          <div className="flex items-center gap-2 mt-2">
            <InputWithContext id="newName" value={manualRenameName} onChange={(e) => setManualRenameName(e.target.value)} placeholder={t("translation.fileManager.enterNewName")} className="flex-1" onKeyDown={(e) => {
            if (e.key === "Enter" && !manualRenaming)
                handleConfirmManualRename();
        }}/>
            <span className="text-sm text-muted-foreground shrink-0">{manualRenameFile.match(/\.[^.]+$/)?.[0] || ""}</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowManualRename(false)} disabled={manualRenaming}>{t("translation.common.cancel")}</Button>
          <Button onClick={handleConfirmManualRename} disabled={manualRenaming || !manualRenameName.trim()}>
            {manualRenaming ? <><Spinner className="h-4 w-4"/>{t("translation.fileManager.renaming")}</> : t("translation.migrated.FileManagerPage.rename")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>);
}
