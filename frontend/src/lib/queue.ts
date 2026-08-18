import type { TrackMetadata } from "@/types/api";
import { ApplyPersistentDownloadQueueChanges, LoadPersistentDownloadQueue, ReplacePersistentDownloadQueue } from "../../wailsjs/go/main/App";
export type QueueItemType = "track" | "album" | "playlist" | "artist";
export type QueueItemStatus = "pending" | "running" | "paused" | "done" | "partial" | "skipped" | "failed";
export type QueueTrackStatus = "done" | "failed" | "skipped";
export interface QueueItem {
    id: string;
    key: string;
    type: QueueItemType;
    name: string;
    artist: string;
    info: string;
    image: string;
    folderName?: string;
    isAlbum?: boolean;
    position?: number;
    durationMs?: number;
    trackCount: number;
    tracks: TrackMetadata[];
    status: QueueItemStatus;
    error?: string;
    trackResults?: Record<string, QueueTrackStatus>;
    trackFilePaths?: Record<string, string>;
    addedAt: number;
}
export interface AddCollectionInput {
    type: Exclude<QueueItemType, "track">;
    name: string;
    artist: string;
    info: string;
    image: string;
    folderName?: string;
    isAlbum?: boolean;
    tracks: TrackMetadata[];
}
export interface AddTracksOptions {
    folderName?: string;
    startPosition?: number;
}
export interface AddResult {
    added: number;
    skipped: number;
}
export interface QueueExecutionResult {
    trackResults: Record<string, QueueTrackStatus>;
    trackFilePaths?: Record<string, string>;
    successCount: number;
    skippedCount: number;
    failedCount: number;
    cancelled?: boolean;
    paused?: boolean;
}
export interface QueueResumeContext {
    allTracks: TrackMetadata[];
    trackFilePaths: Record<string, string>;
    trackResults: Record<string, QueueTrackStatus>;
}
export interface QueueTrackStatusSets {
    downloadedTracks: Set<string>;
    failedTracks: Set<string>;
    skippedTracks: Set<string>;
}
const LEGACY_STORAGE_KEY = "spotiflac_download_queue";
const listeners = new Set<(items: QueueItem[]) => void>();
let cache: QueueItem[] = [];
let persistedCache: QueueItem[] = [];
let initializationPromise: Promise<void> | null = null;
let persistenceWorker: Promise<void> | null = null;
let needsFullReplace = false;
let legacyMigrationPending = false;
function parseQueue(raw: string | null, source: string, rejectInvalidItems = false): QueueItem[] | null {
    if (raw === null || raw.trim() === "")
        return null;
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return null;
        const items = parsed.filter((item): item is QueueItem => Boolean(item && typeof item.id === "string" && Array.isArray(item.tracks)));
        if (items.length !== parsed.length) {
            console.error(`Download queue from ${source} contains invalid items.`);
            if (rejectInvalidItems) {
                return null;
            }
        }
        return items;
    }
    catch (err) {
        console.error(`Failed to parse download queue from ${source}:`, err);
        return null;
    }
}
function readLegacyQueue(): QueueItem[] {
    try {
        return parseQueue(localStorage.getItem(LEGACY_STORAGE_KEY), "legacy storage") || [];
    }
    catch (err) {
        console.error("Failed to read the legacy download queue:", err);
        return [];
    }
}
function removeLegacyQueue(): void {
    try {
        localStorage.removeItem(LEGACY_STORAGE_KEY);
        legacyMigrationPending = false;
    }
    catch (err) {
        console.error("Failed to remove the migrated legacy download queue:", err);
    }
}
function restoreInterruptedItems(items: QueueItem[]): {
    items: QueueItem[];
    changed: boolean;
} {
    let changed = false;
    const restored = items.map((item) => {
        if (item.status !== "running")
            return item;
        changed = true;
        return { ...item, status: "paused" as QueueItemStatus };
    });
    return { items: restored, changed };
}
async function replacePersistentQueue(items: QueueItem[]): Promise<void> {
    await ReplacePersistentDownloadQueue(JSON.stringify(items));
    needsFullReplace = false;
    if (legacyMigrationPending) {
        removeLegacyQueue();
    }
}
function hasSameOrder(previous: QueueItem[], next: QueueItem[]): boolean {
    return previous.length === next.length && previous.every((item, index) => item.id === next[index]?.id);
}
async function persistChanges(previous: QueueItem[], next: QueueItem[]): Promise<void> {
    const previousByID = new Map(previous.map((item) => [item.id, item]));
    const nextIDs = new Set(next.map((item) => item.id));
    const upserts = next.filter((item) => previousByID.get(item.id) !== item);
    const removedIDs = previous.filter((item) => !nextIDs.has(item.id)).map((item) => item.id);
    const orderJSON = hasSameOrder(previous, next) ? "" : JSON.stringify(next.map((item) => item.id));
    if (upserts.length === 0 && removedIDs.length === 0 && orderJSON === "") {
        return;
    }
    await ApplyPersistentDownloadQueueChanges(JSON.stringify(upserts), removedIDs, orderJSON);
}
function schedulePersistence(): void {
    if (persistenceWorker) {
        return;
    }
    let attemptedCache: QueueItem[] | null = null;
    persistenceWorker = (async () => {
        while (needsFullReplace || persistedCache !== cache) {
            attemptedCache = cache;
            try {
                if (needsFullReplace) {
                    await replacePersistentQueue(attemptedCache);
                }
                else {
                    await persistChanges(persistedCache, attemptedCache);
                }
                persistedCache = attemptedCache;
            }
            catch (err) {
                needsFullReplace = true;
                console.error("Failed to persist download queue to the database:", err);
                break;
            }
        }
    })().finally(() => {
        persistenceWorker = null;
        if (persistedCache !== cache && (!needsFullReplace || cache !== attemptedCache)) {
            schedulePersistence();
        }
    });
}
export function initializeQueuePersistence(): Promise<void> {
    if (initializationPromise) {
        return initializationPromise;
    }
    initializationPromise = (async () => {
        let databasePayload: string;
        try {
            databasePayload = await LoadPersistentDownloadQueue();
        }
        catch (err) {
            console.error("Failed to load download queue database:", err);
            cache = restoreInterruptedItems(readLegacyQueue()).items;
            legacyMigrationPending = true;
            needsFullReplace = true;
            return;
        }
        if (databasePayload.trim() === "") {
            const legacyQueue = readLegacyQueue();
            const restored = restoreInterruptedItems(legacyQueue);
            cache = restored.items;
            legacyMigrationPending = true;
            try {
                await replacePersistentQueue(cache);
                persistedCache = cache;
            }
            catch (err) {
                needsFullReplace = true;
                console.error("Failed to migrate download queue to the database:", err);
            }
            return;
        }
        const persisted = parseQueue(databasePayload, "database", true);
        if (!persisted) {
            cache = [];
            needsFullReplace = true;
            return;
        }
        const restored = restoreInterruptedItems(persisted);
        cache = restored.items;
        if (restored.changed) {
            try {
                await replacePersistentQueue(cache);
                persistedCache = cache;
            }
            catch (err) {
                needsFullReplace = true;
                console.error("Failed to persist the restored download queue:", err);
            }
        }
        else {
            persistedCache = cache;
        }
        removeLegacyQueue();
    })();
    return initializationPromise;
}
function read(): QueueItem[] {
    return cache;
}
function write(items: QueueItem[]): void {
    cache = items;
    schedulePersistence();
    for (const listener of listeners) {
        listener(items);
    }
}
export function getQueue(): QueueItem[] {
    return read();
}
export function subscribeQueue(listener: (items: QueueItem[]) => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
function getTrackKey(track: TrackMetadata): string {
    return `track:${track.spotify_id || track.external_urls || `${track.name}-${track.artists}-${track.album_name}`}`;
}
function getCollectionKey(input: AddCollectionInput): string {
    return `${input.type}:${input.folderName || input.name}`;
}
function createId(): string {
    return crypto.randomUUID();
}
function mergeByKey(items: QueueItem[], incoming: QueueItem): {
    items: QueueItem[];
    added: boolean;
} {
    const existingIndex = items.findIndex((item) => item.key === incoming.key);
    if (existingIndex === -1) {
        return { items: [...items, incoming], added: true };
    }
    const existing = items[existingIndex];
    if (existing.status === "pending" || existing.status === "running" || existing.status === "paused") {
        return { items, added: false };
    }
    const next = [...items];
    next[existingIndex] = { ...incoming, id: existing.id };
    return { items: next, added: true };
}
function beginRunningItem(incoming: QueueItem): string {
    const items = read();
    const existingIndex = items.findIndex((item) => item.key === incoming.key);
    if (existingIndex === -1) {
        write([...items, incoming]);
        return incoming.id;
    }
    const next = [...items];
    const id = next[existingIndex].id;
    next[existingIndex] = { ...incoming, id };
    write(next);
    return id;
}
export function beginDirectTrackQueueItem(track: TrackMetadata, options: AddTracksOptions = {}): string {
    return beginRunningItem({
        id: createId(), key: getTrackKey(track), type: "track", name: track.name,
        artist: track.artists, info: track.album_name || "", image: track.images || "",
        folderName: options.folderName, position: options.startPosition || track.track_number,
        durationMs: track.duration_ms, trackCount: 1, tracks: [track], status: "running", addedAt: Date.now(),
    });
}
export function beginDirectCollectionQueueItem(input: AddCollectionInput): string {
    const tracks = input.tracks.filter((track) => track.spotify_id);
    return beginRunningItem({
        id: createId(), key: getCollectionKey(input), type: input.type, name: input.name,
        artist: input.artist, info: input.info, image: input.image, folderName: input.folderName,
        isAlbum: input.isAlbum, durationMs: tracks.reduce((sum, track) => sum + (track.duration_ms || 0), 0),
        trackCount: tracks.length, tracks, status: "running", addedAt: Date.now(),
    });
}
export function mergeQueueTrackResults(previous?: Record<string, QueueTrackStatus>, incoming?: Record<string, QueueTrackStatus>): Record<string, QueueTrackStatus> {
    return { ...(previous || {}), ...(incoming || {}) };
}
export function mergeQueueTrackFilePaths(previous?: Record<string, string>, incoming?: Record<string, string>): Record<string, string> {
    return { ...(previous || {}), ...(incoming || {}) };
}
export function getQueueTrackStatusSets(items: QueueItem[] = read()): QueueTrackStatusSets {
    const downloadedTracks = new Set<string>();
    const failedTracks = new Set<string>();
    const skippedTracks = new Set<string>();
    for (const item of items) {
        for (const [trackId, status] of Object.entries(item.trackResults || {})) {
            if (!trackId)
                continue;
            if (status === "done") {
                downloadedTracks.add(trackId);
            }
            else if (status === "skipped") {
                skippedTracks.add(trackId);
                downloadedTracks.add(trackId);
            }
            else if (status === "failed") {
                failedTracks.add(trackId);
            }
        }
    }
    return { downloadedTracks, failedTracks, skippedTracks };
}
export function getRemainingQueueTracks(item: Pick<QueueItem, "tracks" | "trackResults">): TrackMetadata[] {
    const results = item.trackResults || {};
    return item.tracks.filter((track) => {
        const id = track.spotify_id || "";
        return Boolean(id) && !results[id];
    });
}
export function summarizeQueueTrackResults(tracks: TrackMetadata[], trackResults: Record<string, QueueTrackStatus>, flags: Pick<QueueExecutionResult, "cancelled" | "paused"> = {}): QueueExecutionResult {
    let successCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    for (const track of tracks) {
        const id = track.spotify_id || "";
        const status = id ? trackResults[id] : undefined;
        if (status === "done")
            successCount += 1;
        else if (status === "skipped")
            skippedCount += 1;
        else if (status === "failed")
            failedCount += 1;
    }
    return { trackResults, successCount, skippedCount, failedCount, ...flags };
}
export function getQueueItemStatus(result: QueueExecutionResult, hasRemaining: boolean): QueueItemStatus {
    if (result.paused && hasRemaining)
        return "paused";
    if (result.cancelled && hasRemaining)
        return "pending";
    if (result.failedCount > 0 && result.successCount + result.skippedCount > 0)
        return "partial";
    if (result.failedCount > 0)
        return "failed";
    if (result.skippedCount > 0 && result.successCount === 0)
        return "skipped";
    return "done";
}
export function finishDirectQueueItem(id: string, result: QueueExecutionResult): void {
    const item = read().find((candidate) => candidate.id === id);
    const trackResults = mergeQueueTrackResults(item?.trackResults, result.trackResults);
    const trackFilePaths = mergeQueueTrackFilePaths(item?.trackFilePaths, result.trackFilePaths);
    const hasRemaining = item ? getRemainingQueueTracks({ tracks: item.tracks, trackResults }).length > 0 : result.cancelled === true || result.paused === true;
    const summary = item
        ? summarizeQueueTrackResults(item.tracks, trackResults, { cancelled: result.cancelled, paused: result.paused })
        : { ...result, trackResults };
    updateQueueItem(id, { status: getQueueItemStatus(summary, hasRemaining), trackResults, trackFilePaths });
}
export function addTracksToQueue(tracks: TrackMetadata[], options: AddTracksOptions = {}): AddResult {
    const queueable = tracks.filter((track) => track.spotify_id);
    if (queueable.length === 0) {
        return { added: 0, skipped: 0 };
    }
    let items = read();
    let added = 0;
    queueable.forEach((track, index) => {
        const item: QueueItem = {
            id: createId(),
            key: getTrackKey(track),
            type: "track",
            name: track.name,
            artist: track.artists,
            info: track.album_name || "",
            image: track.images || "",
            folderName: options.folderName,
            position: options.startPosition ? options.startPosition + index : track.track_number,
            durationMs: track.duration_ms,
            trackCount: 1,
            tracks: [track],
            status: "pending",
            addedAt: Date.now(),
        };
        const result = mergeByKey(items, item);
        items = result.items;
        if (result.added) {
            added += 1;
        }
    });
    write(items);
    return { added, skipped: queueable.length - added };
}
export function addCollectionToQueue(input: AddCollectionInput): AddResult {
    const queueable = input.tracks.filter((track) => track.spotify_id);
    if (queueable.length === 0) {
        return { added: 0, skipped: 0 };
    }
    const item: QueueItem = {
        id: createId(),
        key: getCollectionKey(input),
        type: input.type,
        name: input.name,
        artist: input.artist,
        info: input.info,
        image: input.image,
        folderName: input.folderName,
        isAlbum: input.isAlbum,
        durationMs: queueable.reduce((sum, track) => sum + (track.duration_ms || 0), 0),
        trackCount: queueable.length,
        tracks: queueable,
        status: "pending",
        addedAt: Date.now(),
    };
    const result = mergeByKey(read(), item);
    if (result.added) {
        write(result.items);
        return { added: 1, skipped: 0 };
    }
    return { added: 0, skipped: 1 };
}
export function updateQueueItem(id: string, patch: Partial<Pick<QueueItem, "status" | "error" | "trackResults" | "trackFilePaths">>): void {
    const items = read();
    const index = items.findIndex((item) => item.id === id);
    if (index === -1)
        return;
    const next = [...items];
    next[index] = { ...next[index], ...patch };
    write(next);
}
export function updateQueueTrackResult(itemId: string, trackId: string, status: QueueTrackStatus, filePath?: string): void {
    if (!trackId)
        return;
    const items = read();
    const index = items.findIndex((item) => item.id === itemId);
    if (index === -1)
        return;
    const item = items[index];
    const trackResults = mergeQueueTrackResults(item.trackResults, { [trackId]: status });
    const trackFilePaths = filePath
        ? mergeQueueTrackFilePaths(item.trackFilePaths, { [trackId]: filePath })
        : item.trackFilePaths;
    const next = [...items];
    next[index] = { ...item, trackResults, trackFilePaths };
    write(next);
}
export function removeQueueItem(id: string): void {
    const items = read();
    if (!items.some((item) => item.id === id))
        return;
    write(items.filter((item) => item.id !== id));
}
export function removeTrackFromQueueItem(itemId: string, trackIndex: number): void {
    const items = read();
    const index = items.findIndex((item) => item.id === itemId);
    if (index === -1)
        return;
    const item = items[index];
    if (trackIndex < 0 || trackIndex >= item.tracks.length)
        return;
    const remaining = item.tracks.filter((_, position) => position !== trackIndex);
    if (remaining.length === 0) {
        write(items.filter((candidate) => candidate.id !== itemId));
        return;
    }
    const next = [...items];
    next[index] = {
        ...item,
        tracks: remaining,
        trackCount: remaining.length,
        durationMs: remaining.reduce((sum, track) => sum + (track.duration_ms || 0), 0),
    };
    write(next);
}
export function retryQueueItem(id: string): void {
    const item = read().find((candidate) => candidate.id === id);
    if (!item)
        return;
    const preservedResults = Object.fromEntries(Object.entries(item.trackResults || {}).filter(([, status]) => status === "done" || status === "skipped"));
    const preservedPaths = Object.fromEntries(Object.entries(item.trackFilePaths || {}).filter(([trackId]) => Boolean(preservedResults[trackId])));
    updateQueueItem(id, { status: "pending", error: "", trackResults: preservedResults, trackFilePaths: preservedPaths });
}
export function clearQueue(type?: QueueItemType): void {
    const items = read();
    const next = type ? items.filter((item) => item.type !== type) : [];
    if (next.length === items.length && items.length > 0 && type) {
        return;
    }
    write(next);
}
export function clearFinishedQueueItems(type?: QueueItemType): void {
    const items = read();
    const next = items.filter((item) => {
        const isFinished = item.status === "done" || item.status === "partial" || item.status === "skipped" || item.status === "failed";
        const matchesType = !type || item.type === type;
        return !(isFinished && matchesType);
    });
    if (next.length === items.length)
        return;
    write(next);
}
export function getNextRunnableQueueItem(type?: QueueItemType): QueueItem | undefined {
    return read().find((item) => (item.status === "paused" || item.status === "pending") && (!type || item.type === type));
}
export function countRunnableQueueItems(type?: QueueItemType): number {
    return read().filter((item) => (item.status === "paused" || item.status === "pending") && (!type || item.type === type)).length;
}
