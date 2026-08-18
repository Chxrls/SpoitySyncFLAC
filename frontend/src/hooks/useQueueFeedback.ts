import { useCallback, useMemo, useSyncExternalStore } from "react";
import { getQueue, subscribeQueue, type QueueItemType } from "@/lib/queue";
function subscribeToQueue(onStoreChange: () => void): () => void {
    return subscribeQueue(() => onStoreChange());
}
export function useQueueFeedback() {
    const queueItems = useSyncExternalStore(subscribeToQueue, getQueue, getQueue);
    const queuedTrackIds = useMemo(() => {
        const ids = new Set<string>();
        for (const item of queueItems) {
            for (const track of item.tracks) {
                if (track.spotify_id) {
                    ids.add(track.spotify_id);
                }
            }
        }
        return ids;
    }, [queueItems]);
    const queuedItemKeys = useMemo(() => new Set(queueItems.map((item) => item.key)), [queueItems]);
    const isQueued = useCallback((trackId?: string | null) => Boolean(trackId && queuedTrackIds.has(trackId)), [queuedTrackIds]);
    const isCollectionQueued = useCallback((type: Exclude<QueueItemType, "track">, name: string) => queuedItemKeys.has(`${type}:${name}`), [queuedItemKeys]);
    const areQueued = useCallback((trackIds: readonly (string | null | undefined)[]) => {
        let hasQueueableTrack = false;
        for (const trackId of trackIds) {
            if (!trackId) {
                continue;
            }
            hasQueueableTrack = true;
            if (!queuedTrackIds.has(trackId)) {
                return false;
            }
        }
        return hasQueueableTrack;
    }, [queuedTrackIds]);
    return { isQueued, isCollectionQueued, areQueued };
}
