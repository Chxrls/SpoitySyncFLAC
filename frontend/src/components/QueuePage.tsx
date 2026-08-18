import { t } from "@/i18n";
import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem, PaginationLink, PaginationNext, PaginationPrevious } from "@/components/ui/pagination";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Search, Filter, Trash2, Play, Pause, StopCircle, RotateCcw, CircleCheckBig, XCircle, Music2, Disc3, ListMusic, UserRound, ListOrdered, Eraser, FileCheck } from "lucide-react";
import { clearFinishedQueueItems, clearQueue, removeQueueItem, removeTrackFromQueueItem, retryQueueItem, type QueueItem, type QueueItemType } from "@/lib/queue";
import type { TrackMetadata } from "@/types/api";
const TABS: Array<{
    value: QueueItemType;
    label: string;
    icon: typeof Music2;
}> = [
    { value: "track", label: "translation.common.tracks", icon: Music2 },
    { value: "album", label: "translation.common.albums", icon: Disc3 },
    { value: "playlist", label: "translation.common.playlists", icon: ListMusic },
    { value: "artist", label: "translation.common.artists", icon: UserRound },
];
const ITEMS_PER_PAGE = 50;
type StatusFilter = "all" | "pending" | "running" | "paused" | "done" | "partial" | "skipped" | "failed";
interface QueuePageProps {
    items: QueueItem[];
    isProcessing: boolean;
    isPausing: boolean;
    processingType: QueueItemType | null;
    downloadedTracks: Set<string>;
    failedTracks: Set<string>;
    skippedTracks: Set<string>;
    downloadingTracks: Set<string>;
    onStart: (type?: QueueItemType) => void;
    onPause: (type?: QueueItemType) => void;
    onStop: (type?: QueueItemType) => void;
    isDirectDownloading?: boolean;
    onStopDirect?: () => void;
}
function formatDuration(ms?: number): string {
    if (!ms || ms <= 0)
        return "";
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
function getPaginationPages(current: number, total: number): (number | "ellipsis")[] {
    if (total <= 10)
        return Array.from({ length: total }, (_, i) => i + 1);
    const pages: (number | "ellipsis")[] = [1];
    if (current <= 7) {
        for (let i = 2; i <= 10; i++)
            pages.push(i);
        pages.push("ellipsis");
        pages.push(total);
    }
    else if (current >= total - 7) {
        pages.push("ellipsis");
        for (let i = total - 9; i <= total; i++)
            pages.push(i);
    }
    else {
        pages.push("ellipsis", current - 1, current, current + 1, "ellipsis", total);
    }
    return pages;
}
export function QueuePage({ items, isProcessing, isPausing, processingType, downloadedTracks, failedTracks, skippedTracks, downloadingTracks, onStart, onPause, onStop, isDirectDownloading = false, onStopDirect }: QueuePageProps) {
    const [activeTab, setActiveTab] = useState<QueueItemType>(() => items.find((item) => item.status === "running" || item.status === "paused" || item.status === "pending")?.type || "track");
    const [searchQuery, setSearchQuery] = useState("");
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
    const [currentPage, setCurrentPage] = useState(1);
    const [showClearConfirm, setShowClearConfirm] = useState(false);
    const [expandedIds, setExpandedIds] = useState<string[]>([]);
    const toggleExpanded = (id: string) => {
        setExpandedIds((prev) => prev.includes(id) ? prev.filter((prevId) => prevId !== id) : [...prev, id]);
    };
    const getTrackStatus = (item: QueueItem, track: TrackMetadata): "downloading" | "skipped" | "done" | "failed" | "pending" => {
        const id = track.spotify_id;
        if (!id)
            return "pending";
        if (downloadingTracks.has(id))
            return "downloading";
        if (skippedTracks.has(id))
            return "skipped";
        if (failedTracks.has(id))
            return "failed";
        if (downloadedTracks.has(id))
            return "done";
        return item.trackResults?.[id] ?? "pending";
    };
    const renderTrackStatusIcon = (item: QueueItem, track: TrackMetadata) => {
        switch (getTrackStatus(item, track)) {
            case "downloading":
                return <Spinner className="h-4 w-4"/>;
            case "skipped":
                return <FileCheck className="h-4 w-4 text-yellow-500"/>;
            case "done":
                return <CircleCheckBig className="h-4 w-4 text-green-500"/>;
            case "failed":
                return <XCircle className="h-4 w-4 text-red-500"/>;
            default:
                return <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40"/>;
        }
    };
    const getProgressSummary = (item: QueueItem) => {
        let done = 0;
        let failed = 0;
        for (const track of item.tracks) {
            const status = getTrackStatus(item, track);
            if (status === "done" || status === "skipped")
                done += 1;
            else if (status === "failed")
                failed += 1;
        }
        return { done, failed };
    };
    const tabItems = items.filter((item) => item.type === activeTab);
    const statusMatches = (item: QueueItem) => {
        if (statusFilter === "all")
            return true;
        if (statusFilter === "failed")
            return item.status === "failed" || item.status === "partial" || Object.values(item.trackResults || {}).includes("failed");
        if (statusFilter === "skipped")
            return item.status === "skipped" || Object.values(item.trackResults || {}).includes("skipped");
        return item.status === statusFilter;
    };
    const statusItems = tabItems.filter(statusMatches);
    const filteredItems = searchQuery
        ? statusItems.filter((item) => {
            const query = searchQuery.toLowerCase();
            return (item.name.toLowerCase().includes(query) ||
                item.artist.toLowerCase().includes(query) ||
                item.info.toLowerCase().includes(query));
        })
        : statusItems;
    const pendingCount = items.filter((item) => item.status === "pending").length;
    const pausedCount = items.filter((item) => item.status === "paused").length;
    const runnableCount = pendingCount + pausedCount;
    const tabPendingCount = tabItems.filter((item) => item.status === "pending").length;
    const tabPausedCount = tabItems.filter((item) => item.status === "paused").length;
    const tabRunnableCount = tabPendingCount + tabPausedCount;
    const finishedCount = tabItems.filter((item) => ["done", "partial", "skipped", "failed"].includes(item.status)).length;
    const isTabRunning = isProcessing && processingType === activeTab;
    const totalPages = Math.max(1, Math.ceil(filteredItems.length / ITEMS_PER_PAGE));
    const page = Math.min(currentPage, totalPages);
    const startIndex = (page - 1) * ITEMS_PER_PAGE;
    const paginated = filteredItems.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    const handleTabChange = (value: QueueItemType) => {
        setActiveTab(value);
        setCurrentPage(1);
    };
    const handleStart = (type?: QueueItemType) => {
        const nextType = type || items.find((item) => item.status === "paused" || item.status === "pending")?.type;
        if (nextType) {
            setActiveTab(nextType);
            setCurrentPage(1);
        }
        onStart(type);
    };
    const handleClearTab = () => {
        clearQueue(activeTab);
        setShowClearConfirm(false);
    };
    const renderStatus = (item: QueueItem) => {
        if (item.status === "running") {
            return (<div className="flex items-center justify-center gap-2 text-xs font-medium text-primary">
                    <Spinner className="h-4 w-4"/>
                    {isPausing ? t("translation.queue.pausing") : t("translation.queue.running")}</div>);
        }
        if (item.status === "paused") {
            return (<div className="flex items-center justify-center gap-2 text-xs font-medium text-amber-500">
                    <Pause className="h-4 w-4"/>
                    {t("translation.queue.paused")}</div>);
        }
        if (item.status === "done") {
            return (<div className="flex items-center justify-center gap-2 text-xs font-medium text-green-500">
                    <CircleCheckBig className="h-4 w-4"/>
                    {t("translation.queue.done")}</div>);
        }
        if (item.status === "partial")
            return (<div className="flex items-center justify-center gap-2 text-xs font-medium text-amber-500"><XCircle className="h-4 w-4"/>{t("translation.queue.partial")}</div>);
        if (item.status === "skipped")
            return (<div className="flex items-center justify-center gap-2 text-xs font-medium text-yellow-500"><FileCheck className="h-4 w-4"/>{t("translation.queue.skipped")}</div>);
        if (item.status === "failed") {
            return (<TooltipProvider>
                    <Tooltip delayDuration={0}>
                        <TooltipTrigger asChild>
                            <div className="flex items-center justify-center gap-2 text-xs font-medium text-red-500">
                                <XCircle className="h-4 w-4"/>
                                {t("translation.queue.failed")}</div>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p className="max-w-xs wrap-break-word">{item.error || t("translation.queue.failed")}</p>
                        </TooltipContent>
                    </Tooltip>
                </TooltipProvider>);
        }
        return (<span className="text-xs font-medium text-muted-foreground">{t("translation.queue.pending")}</span>);
    };
    return (<div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <h1 className="text-2xl font-bold">{t("translation.queue.queue")}</h1>
                    {pendingCount > 0 && (<Badge variant="secondary" className="font-mono">
                            {t("translation.queue.value1Pending", { value1: pendingCount.toLocaleString("en-US") })}
                        </Badge>)}
                    {pausedCount > 0 && (<Badge variant="outline" className="font-mono">
                            {pausedCount.toLocaleString("en-US")} {t("translation.queue.paused")}
                        </Badge>)}
                </div>
                <div className="flex items-center gap-2">
                    {isProcessing ? (<>
                        <Button variant="outline" onClick={() => onPause()} disabled={isPausing} className="cursor-pointer gap-2">
                            <Pause className="h-4 w-4"/>
                            {isPausing ? t("translation.queue.pausing") : t("translation.queue.pauseAll")}
                        </Button>
                        <Button variant="destructive" onClick={() => onStop()} className="cursor-pointer gap-2">
                            <StopCircle className="h-4 w-4"/>
                            {t("translation.queue.stopAll")}
                        </Button>
                    </>) : isDirectDownloading ? (<>
                        <Button variant="destructive" onClick={() => onStopDirect?.()} className="cursor-pointer gap-2">
                            <StopCircle className="h-4 w-4"/>
                            {t("translation.common.stop")}
                        </Button>
                    </>) : (<Button onClick={() => handleStart()} disabled={runnableCount === 0} className="cursor-pointer gap-2">
                            <Play className="h-4 w-4"/>
                            {pausedCount > 0 ? t("translation.queue.resumeAll") : t("translation.queue.startAll")}
                        </Button>)}
                </div>
            </div>

            <div className="flex gap-2 border-b shrink-0 flex-wrap">
                {TABS.map((tab) => {
            const Icon = tab.icon;
            const count = items.filter((item) => item.type === tab.value).length;
            return (<Button key={tab.value} variant={activeTab === tab.value ? "default" : "ghost"} size="sm" onClick={() => handleTabChange(tab.value)} className="rounded-b-none gap-2">
                            <Icon className="h-4 w-4"/>
                            {t(tab.label)}
                            {count > 0 && (<span className={`font-mono text-xs ${activeTab === tab.value ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{count.toLocaleString("en-US")}</span>)}
                        </Button>);
        })}
            </div>

            <div className="flex items-center gap-2">
                <div className="relative flex-1">
                    <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground"/>
                    <Input placeholder={t("translation.queue.searchQueue")} value={searchQuery} onChange={(e) => {
            setSearchQuery(e.target.value);
            setCurrentPage(1);
        }} className="pl-8 h-9"/>
                </div>
                <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value as StatusFilter); setCurrentPage(1); }}>
                    <SelectTrigger className="h-9 min-w-36">
                        <Filter className="h-4 w-4 text-muted-foreground"/>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end">
                        <SelectItem value="all">{t("translation.queue.allStatuses")}</SelectItem>
                        <SelectItem value="pending">{t("translation.queue.pending")}</SelectItem>
                        <SelectItem value="running">{t("translation.queue.running")}</SelectItem>
                        <SelectItem value="paused">{t("translation.queue.paused")}</SelectItem>
                        <SelectItem value="done">{t("translation.queue.done")}</SelectItem>
                        <SelectItem value="partial">{t("translation.queue.partial")}</SelectItem>
                        <SelectItem value="skipped">{t("translation.queue.skipped")}</SelectItem>
                        <SelectItem value="failed">{t("translation.queue.failed")}</SelectItem>
                    </SelectContent>
                </Select>
                <Button variant="outline" onClick={() => clearFinishedQueueItems(activeTab)} disabled={finishedCount === 0} className="cursor-pointer gap-2">
                    <Eraser className="h-4 w-4"/>
                    {t("translation.queue.clearFinished")}</Button>
                <Button variant="destructive" onClick={() => setShowClearConfirm(true)} disabled={tabItems.length === 0} className="cursor-pointer gap-2">
                    <Trash2 className="h-4 w-4"/>
                    {t("translation.common.clearAll")}</Button>
                {isTabRunning ? (<>
                    <Button variant="outline" onClick={() => onPause(activeTab)} disabled={isPausing} className="cursor-pointer gap-2">
                        <Pause className="h-4 w-4"/>
                        {isPausing ? t("translation.queue.pausing") : t("translation.queue.pause")}
                    </Button>
                    <Button variant="destructive" onClick={() => onStop(activeTab)} className="cursor-pointer gap-2">
                        <StopCircle className="h-4 w-4"/>
                        {t("translation.common.stop")}
                    </Button>
                </>) : (<Button onClick={() => handleStart(activeTab)} disabled={isProcessing || tabRunnableCount === 0} className="cursor-pointer gap-2">
                        <Play className="h-4 w-4"/>
                        {tabPausedCount > 0 ? t("translation.queue.resume") : t("translation.queue.start")}
                    </Button>)}
            </div>

            <div className="rounded-md border overflow-hidden">
                {paginated.length === 0 ? (<div className="flex flex-col items-center justify-center p-16 text-center text-muted-foreground gap-3">
                        <div className="rounded-full bg-muted/50 p-4 ring-8 ring-muted/20">
                            <ListOrdered className="h-10 w-10 opacity-40"/>
                        </div>
                        <div className="space-y-1">
                            <p className="font-medium text-foreground/80">{t("translation.queue.emptyQueue")}</p>
                            <p className="text-sm">{t("translation.queue.addToQueueHint")}</p>
                        </div>
                    </div>) : (<table className="w-full table-fixed">
                        <thead>
                            <tr className="border-b bg-muted/50">
                                <th className="h-10 px-3 text-center align-middle font-medium text-muted-foreground w-12 text-xs uppercase">{"#"}</th>
                                <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground text-xs uppercase w-[35%]">{t("translation.common.title")}</th>
                                <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground hidden md:table-cell text-xs uppercase">{t("translation.common.details")}</th>
                                <th className="h-10 px-3 text-center align-middle font-medium text-muted-foreground hidden lg:table-cell w-20 text-xs uppercase text-nowrap">{t("translation.common.tracks")}</th>
                                <th className="h-10 px-3 text-left align-middle font-medium text-muted-foreground hidden xl:table-cell w-20 text-xs uppercase text-nowrap">{t("translation.history.dur")}</th>
                                <th className="h-10 px-3 text-center align-middle font-medium text-muted-foreground w-28 text-xs uppercase text-nowrap">{t("translation.queue.status")}</th>
                                <th className="h-10 px-3 text-center align-middle font-medium text-muted-foreground w-24 text-xs uppercase text-nowrap">{t("translation.common.actions")}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginated.map((item, index) => {
                const canExpand = item.type !== "track";
                const isExpanded = canExpand && expandedIds.includes(item.id);
                const summary = getProgressSummary(item);
                return (<Fragment key={item.id}>
                                <tr onClick={canExpand ? () => toggleExpanded(item.id) : undefined} className={`border-b transition-colors hover:bg-muted/50 ${canExpand ? "cursor-pointer select-none" : ""}`}>
                                    <td className="p-3 align-middle text-sm text-muted-foreground text-center font-mono">
                                        {startIndex + index + 1}
                                    </td>
                                    <td className="p-3 align-middle min-w-0">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="h-10 w-10 rounded shrink-0 bg-secondary overflow-hidden">
                                                {item.image ? (<img src={item.image} alt={item.name} className="h-full w-full object-cover"/>) : (<div className="h-full w-full flex items-center justify-center text-xs text-muted-foreground font-medium bg-muted">
                                                        {item.type.slice(0, 2).toUpperCase()}
                                                    </div>)}
                                            </div>
                                            <div className="flex flex-col min-w-0 flex-1">
                                                <span className="font-medium text-sm truncate">{item.name}</span>
                                                <span className="text-xs text-muted-foreground truncate">{item.artist}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="p-3 align-middle text-sm text-muted-foreground hidden md:table-cell">
                                        <div className="truncate">{item.info}</div>
                                    </td>
                                    <td className="p-3 align-middle text-center text-sm text-muted-foreground hidden lg:table-cell font-mono">
                                        <div className="flex flex-col items-center">
                                            <span>{item.trackCount.toLocaleString("en-US")}</span>
                                            {canExpand && (summary.done > 0 || summary.failed > 0) && (<span className="text-[10px] leading-none">
                                                <span className="text-green-500">{summary.done}</span>
                                                {summary.failed > 0 && (<span className="text-red-500">{t("translation.queue.value1Value2", { value1: "", value2: summary.failed })}</span>)}
                                            </span>)}
                                        </div>
                                    </td>
                                    <td className="p-3 align-middle text-sm text-muted-foreground hidden xl:table-cell font-mono">
                                        {formatDuration(item.durationMs)}
                                    </td>
                                    <td className="p-3 align-middle text-center">
                                        {renderStatus(item)}
                                    </td>
                                    <td className="p-3 align-middle text-center">
                                        <div className="flex items-center justify-center gap-1">
                                            {(item.status === "failed" || item.status === "partial") && (<TooltipProvider>
                                                <Tooltip delayDuration={0}>
                                                    <TooltipTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="cursor-pointer" onClick={() => retryQueueItem(item.id)}>
                                                            <RotateCcw className="h-4 w-4"/>
                                                        </Button>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        <p>{t("translation.queue.retry")}</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>)}
                                            <TooltipProvider>
                                                <Tooltip delayDuration={0}>
                                                    <TooltipTrigger asChild>
                                                        <Button variant="ghost" size="icon" className="cursor-pointer text-destructive hover:text-destructive" onClick={() => removeQueueItem(item.id)} disabled={item.status === "running"}>
                                                            <Trash2 className="h-4 w-4"/>
                                                        </Button>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        <p>{t("translation.queue.removeFromQueue")}</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        </div>
                                    </td>
                                </tr>
                                
                                {isExpanded && item.tracks.length === 0 && (<tr className="border-b bg-muted/20">
                                    <td className="py-2 px-3 align-middle"/>
                                    <td className="py-2 px-3 align-middle text-sm text-muted-foreground">
                                        {t("translation.queue.noTracksItem")}
                                    </td>
                                    <td className="py-2 px-3 align-middle hidden md:table-cell"/>
                                    <td className="py-2 px-3 align-middle hidden lg:table-cell"/>
                                    <td className="py-2 px-3 align-middle hidden xl:table-cell"/>
                                    <td className="py-2 px-3 align-middle"/>
                                    <td className="py-2 px-3 align-middle"/>
                                </tr>)}
                                {isExpanded && item.tracks.map((track, trackIndex) => (<tr key={track.spotify_id || `${item.id}-${trackIndex}`} className="border-b border-border/50 bg-muted/20">
                                    <td className="py-2 px-3 align-middle text-center text-xs text-muted-foreground font-mono">
                                        {trackIndex + 1}
                                    </td>
                                    <td className="py-2 px-3 align-middle min-w-0">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="h-8 w-8 rounded shrink-0 bg-secondary overflow-hidden">
                                                {track.images ? (<img src={track.images} alt={track.name} className="h-full w-full object-cover"/>) : (<div className="h-full w-full flex items-center justify-center bg-muted">
                                                    <Music2 className="h-3.5 w-3.5 text-muted-foreground opacity-50"/>
                                                </div>)}
                                            </div>
                                            <div className="flex flex-col min-w-0 flex-1">
                                                <span className="text-sm truncate">{track.name}</span>
                                                <span className="text-xs text-muted-foreground truncate">{track.artists}</span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="py-2 px-3 align-middle text-xs text-muted-foreground hidden md:table-cell">
                                        <div className="truncate">{track.album_name}</div>
                                    </td>
                                    <td className="py-2 px-3 align-middle hidden lg:table-cell"/>
                                    <td className="py-2 px-3 align-middle text-xs text-muted-foreground hidden xl:table-cell font-mono">
                                        {formatDuration(track.duration_ms)}
                                    </td>
                                    <td className="py-2 px-3 align-middle text-center">
                                        <div className="flex items-center justify-center">
                                            {renderTrackStatusIcon(item, track)}
                                        </div>
                                    </td>
                                    <td className="py-2 px-3 align-middle text-center">
                                        <TooltipProvider>
                                            <Tooltip delayDuration={0}>
                                                <TooltipTrigger asChild>
                                                    <Button variant="ghost" size="icon" className="cursor-pointer text-destructive hover:text-destructive" onClick={() => removeTrackFromQueueItem(item.id, trackIndex)} disabled={item.status === "running"}>
                                                        <Trash2 className="h-4 w-4"/>
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p>{t("translation.queue.removeFromQueue")}</p>
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    </td>
                                </tr>))}
                            </Fragment>);
            })}
                        </tbody>
                    </table>)}
            </div>

            {totalPages > 1 && (<Pagination>
                    <PaginationContent>
                        <PaginationItem>
                            <PaginationPrevious href="#" onClick={(e) => {
                e.preventDefault();
                if (page > 1)
                    setCurrentPage(page - 1);
            }} className={page === 1 ? "pointer-events-none opacity-50" : "cursor-pointer"}/>
                        </PaginationItem>

                        {(() => {
                let ellipsisCount = 0;
                return getPaginationPages(page, totalPages).map((pageNumber) => (pageNumber === "ellipsis" ? (<PaginationItem key={`ellipsis-queue-${page}-${ellipsisCount++}`}>
                                    <PaginationEllipsis />
                                </PaginationItem>) : (<PaginationItem key={pageNumber}>
                                    <PaginationLink href="#" onClick={(e) => {
                        e.preventDefault();
                        setCurrentPage(pageNumber);
                    }} isActive={page === pageNumber} className="cursor-pointer">
                                        {pageNumber}
                                    </PaginationLink>
                                </PaginationItem>)));
            })()}

                        <PaginationItem>
                            <PaginationNext href="#" onClick={(e) => {
                e.preventDefault();
                if (page < totalPages)
                    setCurrentPage(page + 1);
            }} className={page === totalPages ? "pointer-events-none opacity-50" : "cursor-pointer"}/>
                        </PaginationItem>
                    </PaginationContent>
                </Pagination>)}

            <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
                <DialogContent className="max-w-md [&>button]:hidden">
                    <DialogHeader>
                        <DialogTitle>{t("translation.queue.clearQueue")}</DialogTitle>
                        <DialogDescription>
                            {t("translation.queue.willRemoveAllQueued")}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowClearConfirm(false)} className="cursor-pointer">{t("translation.common.cancel")}</Button>
                        <Button variant="destructive" onClick={handleClearTab} className="cursor-pointer">
                            {t("translation.common.clearAll")}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>);
}
