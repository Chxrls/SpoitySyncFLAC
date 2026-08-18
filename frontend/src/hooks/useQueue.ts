import { t, translateMessage } from "@/i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import { toastWithSound as toast } from "@/lib/toast-with-sound";
import { getNextRunnableQueueItem, getQueue, getQueueItemStatus, getRemainingQueueTracks, mergeQueueTrackFilePaths, mergeQueueTrackResults, subscribeQueue, summarizeQueueTrackResults, updateQueueItem, type QueueExecutionResult, type QueueItem, type QueueItemStatus, type QueueItemType, type QueueResumeContext, type QueueTrackStatus } from "@/lib/queue";
import type { TrackMetadata } from "@/types/api";
interface QueueDownloadHandlers {
    handleDownloadTrack: (id: string, trackName?: string, artistName?: string, albumName?: string, spotifyId?: string, playlistName?: string, durationMs?: number, position?: number, albumArtist?: string, releaseDate?: string, coverUrl?: string, spotifyTrackNumber?: number, spotifyDiscNumber?: number, spotifyTotalTracks?: number, spotifyTotalDiscs?: number, copyright?: string, publisher?: string, queueItemId?: string) => Promise<QueueTrackStatus | undefined>;
    handleDownloadAll: (tracks: TrackMetadata[], folderName?: string, isAlbum?: boolean, batchSource?: "playlist" | "album" | "discography" | "collection", queueItemId?: string, resumeContext?: QueueResumeContext) => Promise<QueueExecutionResult | undefined>;
    handlePauseDownload: () => void;
    handleResumeDownload: () => void;
    handleStopDownload: () => void;
}
function batchSourceFor(item: QueueItem): "playlist" | "album" | "discography" | "collection" {
    if (item.type === "album")
        return "album";
    if (item.type === "playlist")
        return "playlist";
    if (item.type === "artist")
        return "discography";
    return "collection";
}
export function useQueue(download: QueueDownloadHandlers) {
    const [items, setItems] = useState<QueueItem[]>(() => getQueue());
    const [isProcessing, setIsProcessing] = useState(false);
    const [isPausing, setIsPausing] = useState(false);
    const [processingType, setProcessingType] = useState<QueueItemType | null>(null);
    const shouldStopRef = useRef(false);
    const shouldPauseRef = useRef(false);
    const isProcessingRef = useRef(false);
    const processingTypeRef = useRef<QueueItemType | null>(null);
    const activeItemRef = useRef<QueueItem | null>(null);
    useEffect(() => subscribeQueue(setItems), []);
    const runItem = useCallback(async (item: QueueItem): Promise<QueueItemStatus> => {
        const remainingTracks = getRemainingQueueTracks(item);
        let result: QueueExecutionResult;
        if (remainingTracks.length === 0) {
            result = summarizeQueueTrackResults(item.tracks, item.trackResults || {});
        }
        else if (item.type === "track") {
            const track = remainingTracks[0];
            if (!track?.spotify_id) {
                throw new Error(t("translation.download.noIdFoundTrack"));
            }
            const status = await download.handleDownloadTrack(track.spotify_id, track.name, track.artists, track.album_name, track.spotify_id, item.folderName, track.duration_ms, item.position, track.album_artist, track.release_date, track.images, track.track_number, track.disc_number, track.total_tracks, track.total_discs, track.copyright, track.publisher, item.id);
            result = { trackResults: status ? { [track.spotify_id]: status } : {}, successCount: status === "done" ? 1 : 0, skippedCount: status === "skipped" ? 1 : 0, failedCount: status === "failed" ? 1 : 0, cancelled: status === undefined };
        }
        else {
            result = await download.handleDownloadAll(remainingTracks, item.folderName, item.isAlbum, batchSourceFor(item), item.id, {
                allTracks: item.tracks,
                trackFilePaths: item.trackFilePaths || {},
                trackResults: item.trackResults || {},
            }) || { trackResults: {}, successCount: 0, skippedCount: 0, failedCount: 0, cancelled: true };
        }
        const trackResults = mergeQueueTrackResults(item.trackResults, result.trackResults);
        const trackFilePaths = mergeQueueTrackFilePaths(item.trackFilePaths, result.trackFilePaths);
        const summary = summarizeQueueTrackResults(item.tracks, trackResults, {
            cancelled: result.cancelled,
            paused: result.paused,
        });
        const hasRemaining = getRemainingQueueTracks({ tracks: item.tracks, trackResults }).length > 0;
        const status = getQueueItemStatus(summary, hasRemaining);
        updateQueueItem(item.id, { trackResults, trackFilePaths });
        if (status === "failed") {
            throw new Error(item.type === "track"
                ? t("translation.download.downloadFailed")
                : t("translation.queue.value1TracksFailed", { value1: summary.failedCount.toLocaleString() }));
        }
        return status;
    }, [download]);
    const start = useCallback(async (type?: QueueItemType, itemId?: string) => {
        if (isProcessingRef.current) {
            return;
        }
        const getNextItem = () => itemId
            ? getQueue().find((item) => item.id === itemId && (item.status === "paused" || item.status === "pending"))
            : getNextRunnableQueueItem(type);
        const initialItem = getNextItem();
        if (!initialItem) {
            toast.info(t("translation.queue.nothingQueued"));
            return;
        }
        const effectiveType = type ?? (itemId ? initialItem.type : null);
        isProcessingRef.current = true;
        shouldStopRef.current = false;
        shouldPauseRef.current = false;
        download.handleResumeDownload();
        processingTypeRef.current = effectiveType;
        setProcessingType(effectiveType);
        setIsPausing(false);
        setIsProcessing(true);
        try {
            for (let item: QueueItem | undefined = initialItem; item; item = itemId ? undefined : getNextItem()) {
                if (shouldStopRef.current || shouldPauseRef.current) {
                    break;
                }
                activeItemRef.current = item;
                updateQueueItem(item.id, { status: "running", error: "" });
                try {
                    const status = await runItem(item);
                    updateQueueItem(item.id, { status });
                }
                catch (err) {
                    const message = translateMessage(err instanceof Error ? err.message : String(err));
                    updateQueueItem(item.id, { status: "failed", error: message });
                }
                finally {
                    activeItemRef.current = null;
                }
                if (shouldStopRef.current || shouldPauseRef.current) {
                    break;
                }
            }
        }
        finally {
            if (shouldPauseRef.current && !shouldStopRef.current) {
                const nextItem = getNextItem();
                if (nextItem) {
                    if (nextItem.status === "pending") {
                        updateQueueItem(nextItem.id, { status: "paused" });
                    }
                    toast.info(t("translation.queue.pauseCompleted"));
                }
            }
            isProcessingRef.current = false;
            processingTypeRef.current = null;
            activeItemRef.current = null;
            setIsProcessing(false);
            setIsPausing(false);
            setProcessingType(null);
            shouldStopRef.current = false;
            shouldPauseRef.current = false;
        }
    }, [download, runItem]);
    const startItem = useCallback((itemId: string) => start(undefined, itemId), [start]);
    const pause = useCallback((type?: QueueItemType) => {
        if (!isProcessingRef.current || shouldPauseRef.current)
            return;
        if (type !== undefined && processingTypeRef.current !== type)
            return;
        shouldPauseRef.current = true;
        setIsPausing(true);
        if (activeItemRef.current?.type !== "track") {
            download.handlePauseDownload();
        }
    }, [download]);
    const stop = useCallback((type?: QueueItemType) => {
        if (!isProcessingRef.current)
            return;
        if (type !== undefined && processingTypeRef.current !== type)
            return;
        shouldStopRef.current = true;
        shouldPauseRef.current = false;
        setIsPausing(false);
        download.handleStopDownload();
    }, [download]);
    return { items, isProcessing, isPausing, processingType, start, startItem, pause, stop };
}
