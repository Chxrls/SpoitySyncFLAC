import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Heart, ListMusic, Disc3, LogOut, RefreshCw, PlugZap, ExternalLink, FileSignature, Pencil } from "lucide-react";
import { EventsOn, EventsOff } from "../../wailsjs/runtime/runtime";
import { connectSpotifyAccount, disconnectSpotifyAccount, getSpotifyAuthStatus, getSpotifyRedirectURI, type SpotifyAuthStatus } from "@/lib/spotifyAuth";
import { fetchLibraryPlaylists, fetchLibraryAlbums, fetchLibraryPlaylistTracks, fetchLibraryAlbumTracks, fetchLikedSongs } from "@/lib/spotifyLibrary";
import { getSettings, updateSettings } from "@/lib/settings";
import { buildPlaylistFolderName } from "@/lib/playlist";
import { openExternal } from "@/lib/utils";
import { logger } from "@/lib/logger";
import type { AddCollectionInput } from "@/lib/queue";
import type { LibraryPlaylistSummary, LibraryAlbumSummary } from "@/types/api";
import { toastWithSound as toast } from "@/lib/toast-with-sound";

const LIKED_SONGS_ID = "__liked_songs__";
const QUEUE_CONCURRENCY = 3;

interface LibraryPageProps {
    onQueueCollection: (input: AddCollectionInput) => void;
}

async function runWithConcurrency<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (cursor < items.length) {
            const item = items[cursor];
            cursor += 1;
            await task(item);
        }
    });
    await Promise.all(workers);
}

export function LibraryPage({ onQueueCollection }: LibraryPageProps) {
    const { t } = useTranslation();
    const [authStatus, setAuthStatus] = useState<SpotifyAuthStatus | null>(null);
    const [checkingAuth, setCheckingAuth] = useState(true);
    const [connecting, setConnecting] = useState(false);
    const [loadingLibrary, setLoadingLibrary] = useState(false);
    const [playlists, setPlaylists] = useState<LibraryPlaylistSummary[]>([]);
    const [albums, setAlbums] = useState<LibraryAlbumSummary[]>([]);
    const [selectedPlaylistIds, setSelectedPlaylistIds] = useState<Set<string>>(new Set());
    const [selectedAlbumIds, setSelectedAlbumIds] = useState<Set<string>>(new Set());
    const [addingToQueue, setAddingToQueue] = useState(false);
    const [likedSongsProgress, setLikedSongsProgress] = useState<{ fetched: number; total: number } | null>(null);
    const [clientID, setClientID] = useState("");
    const [savingClientID, setSavingClientID] = useState(false);
    const [editingClientID, setEditingClientID] = useState(false);
    const [redirectURI, setRedirectURI] = useState("");

    const loadLibrary = useCallback(async () => {
        setLoadingLibrary(true);
        try {
            const [playlistResult, albumResult] = await Promise.all([fetchLibraryPlaylists(), fetchLibraryAlbums()]);
            setPlaylists(playlistResult);
            setAlbums(albumResult);
        }
        catch (error) {
            console.error("Failed to load Spotify library:", error);
            toast.error(t("translation.library.failedToLoadLibrary"));
        }
        finally {
            setLoadingLibrary(false);
        }
    }, [t]);

    useEffect(() => {
        (async () => {
            setClientID(getSettings().spotifyClientID || "");
            try {
                const [status, uri] = await Promise.all([getSpotifyAuthStatus(), getSpotifyRedirectURI()]);
                setAuthStatus(status);
                setRedirectURI(uri);
                if (status.connected) {
                    await loadLibrary();
                }
            }
            catch (error) {
                console.error("Failed to read Spotify auth status:", error);
                setAuthStatus({ connected: false });
            }
            finally {
                setCheckingAuth(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const handler = (data: unknown) => {
            const payload = data as { fetched?: number; total?: number };
            setLikedSongsProgress({ fetched: payload.fetched || 0, total: payload.total || 0 });
        };
        EventsOn("spotify-library-progress", handler);
        return () => {
            EventsOff("spotify-library-progress");
        };
    }, []);

    const handleConnect = async () => {
        const trimmedClientID = clientID.trim();
        if (!trimmedClientID) {
            toast.error(t("translation.library.enterClientId"));
            return;
        }
        setConnecting(true);
        try {
            if (trimmedClientID !== (getSettings().spotifyClientID || "")) {
                setSavingClientID(true);
                await updateSettings({ spotifyClientID: trimmedClientID });
                setSavingClientID(false);
            }
            const status = await connectSpotifyAccount();
            setAuthStatus(status);
            setEditingClientID(false);
            if (status.connected) {
                toast.success(t("translation.library.connectedAs", { value1: status.display_name || "" }));
                await loadLibrary();
            }
        }
        catch (error) {
            console.error("Failed to connect Spotify account:", error);
            toast.error(String(error));
        }
        finally {
            setConnecting(false);
            setSavingClientID(false);
        }
    };

    const handleDisconnect = async () => {
        try {
            await disconnectSpotifyAccount();
        }
        catch (error) {
            console.error("Failed to disconnect Spotify account:", error);
        }
        setAuthStatus({ connected: false });
        setPlaylists([]);
        setAlbums([]);
        setSelectedPlaylistIds(new Set());
        setSelectedAlbumIds(new Set());
    };

    const togglePlaylist = (id: string) => {
        setSelectedPlaylistIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            }
            else {
                next.add(id);
            }
            return next;
        });
    };

    const toggleAlbum = (id: string) => {
        setSelectedAlbumIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) {
                next.delete(id);
            }
            else {
                next.add(id);
            }
            return next;
        });
    };

    const selectedCount = selectedPlaylistIds.size + selectedAlbumIds.size;

    const handleAddToQueue = async () => {
        if (selectedCount === 0) {
            return;
        }
        setAddingToQueue(true);
        setLikedSongsProgress(null);
        const settings = getSettings();
        let failures = 0;
        let firstErrorMessage = "";

        try {
            const playlistIds = Array.from(selectedPlaylistIds).filter((id) => id !== LIKED_SONGS_ID);
            await runWithConcurrency(playlistIds, QUEUE_CONCURRENCY, async (id) => {
                try {
                    const response = await fetchLibraryPlaylistTracks(id);
                    const info = response.playlist_info;
                    const folderName = buildPlaylistFolderName(info.owner.name, info.owner.display_name, settings.playlistOwnerFolderName);
                    onQueueCollection({
                        type: "playlist",
                        name: info.owner.name,
                        artist: info.owner.display_name,
                        info: `${response.track_list.length.toLocaleString()} tracks`,
                        image: info.cover || info.owner.images || "",
                        folderName,
                        tracks: response.track_list,
                    });
                }
                catch (error) {
                    const playlistName = playlists.find((p) => p.spotify_id === id)?.name || id;
                    const message = `Failed to fetch playlist "${playlistName}": ${String(error)}`;
                    console.error(message);
                    logger.error(message);
                    failures += 1;
                    if (!firstErrorMessage) {
                        firstErrorMessage = message;
                    }
                }
            });

            if (selectedPlaylistIds.has(LIKED_SONGS_ID)) {
                try {
                    const response = await fetchLikedSongs();
                    const info = response.playlist_info;
                    onQueueCollection({
                        type: "playlist",
                        name: info.owner.name || "Liked Songs",
                        artist: info.owner.display_name || "",
                        info: `${response.track_list.length.toLocaleString()} tracks`,
                        image: "",
                        folderName: "Liked Songs",
                        tracks: response.track_list,
                    });
                }
                catch (error) {
                    const message = `Failed to fetch Liked Songs: ${String(error)}`;
                    console.error(message);
                    logger.error(message);
                    failures += 1;
                    if (!firstErrorMessage) {
                        firstErrorMessage = message;
                    }
                }
            }

            const albumIds = Array.from(selectedAlbumIds);
            await runWithConcurrency(albumIds, QUEUE_CONCURRENCY, async (id) => {
                try {
                    const response = await fetchLibraryAlbumTracks(id);
                    const info = response.album_info;
                    onQueueCollection({
                        type: "album",
                        name: info.name,
                        artist: info.artists,
                        info: `${response.track_list.length.toLocaleString()} tracks`,
                        image: info.images || "",
                        folderName: info.name,
                        isAlbum: true,
                        tracks: response.track_list,
                    });
                }
                catch (error) {
                    const albumName = albums.find((a) => a.spotify_id === id)?.name || id;
                    const message = `Failed to fetch album "${albumName}": ${String(error)}`;
                    console.error(message);
                    logger.error(message);
                    failures += 1;
                    if (!firstErrorMessage) {
                        firstErrorMessage = message;
                    }
                }
            });

            if (failures > 0) {
                toast.error(firstErrorMessage
                    ? t("translation.library.someItemsFailedDetailed", { value1: failures, value2: firstErrorMessage })
                    : t("translation.library.someItemsFailed", { value1: failures }));
            }
            setSelectedPlaylistIds(new Set());
            setSelectedAlbumIds(new Set());
        }
        finally {
            setAddingToQueue(false);
            setLikedSongsProgress(null);
        }
    };

    if (checkingAuth) {
        return (<div className="flex items-center justify-center py-24">
                <Spinner className="size-6"/>
            </div>);
    }

    if (!authStatus?.connected) {
        const showSetupForm = editingClientID || !clientID.trim();
        return (<div className="mx-auto flex max-w-md flex-col items-center justify-center gap-4 py-16 text-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <PlugZap className="h-6 w-6"/>
                </div>
                <div className="space-y-1">
                    <h2 className="text-lg font-semibold">{t("translation.library.connectTitle")}</h2>
                    <p className="max-w-sm text-sm text-muted-foreground">{t("translation.library.connectDescription")}</p>
                </div>

                {showSetupForm ? (<div className="w-full space-y-4 rounded-lg border p-4 text-left">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground">{t("translation.library.setupTitle")}</span>
                            <button type="button" onClick={() => openExternal("https://developer.spotify.com/dashboard")} className="inline-flex cursor-pointer items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
                                {t("translation.library.createAppLink")}
                                <ExternalLink className="h-3 w-3"/>
                            </button>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs text-muted-foreground">{t("translation.library.redirectUriLabel")}</label>
                            <div className="flex gap-2">
                                <Input readOnly value={redirectURI} className="font-mono text-xs"/>
                                <Button type="button" variant="outline" size="icon" onClick={() => void navigator.clipboard.writeText(redirectURI)}>
                                    <FileSignature className="h-4 w-4"/>
                                </Button>
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <label className="text-xs text-muted-foreground">{t("translation.library.clientIdLabel")}</label>
                            <Input value={clientID} onChange={(e) => setClientID(e.target.value)} placeholder="e.g. 8b1c...e42a"/>
                        </div>
                        <Button onClick={() => void handleConnect()} disabled={connecting || savingClientID || !clientID.trim()} className="w-full gap-2">
                            {connecting ? <Spinner className="size-4"/> : <PlugZap className="h-4 w-4"/>}
                            {savingClientID ? t("translation.library.saving") : connecting ? t("translation.library.connecting") : t("translation.library.saveAndConnect")}
                        </Button>
                    </div>) : (<>
                        <Button onClick={() => void handleConnect()} disabled={connecting} className="gap-2">
                            {connecting ? <Spinner className="size-4"/> : <PlugZap className="h-4 w-4"/>}
                            {connecting ? t("translation.library.connecting") : t("translation.library.connectButton")}
                        </Button>
                        <button type="button" onClick={() => setEditingClientID(true)} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
                            <Pencil className="h-3 w-3"/>
                            {t("translation.library.changeClientId")}
                        </button>
                    </>)}
            </div>);
    }

    return (<div className="space-y-6 pb-24">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    {authStatus.avatar_url && (<img src={authStatus.avatar_url} alt={authStatus.display_name} className="h-9 w-9 rounded-full object-cover"/>)}
                    <div>
                        <p className="text-sm font-medium">{t("translation.library.connectedAsLabel", { value1: authStatus.display_name || "" })}</p>
                        <button type="button" onClick={() => void handleDisconnect()} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline">
                            <LogOut className="h-3 w-3"/>
                            {t("translation.library.disconnect")}
                        </button>
                    </div>
                </div>
                <Button variant="outline" size="sm" className="gap-2" onClick={() => void loadLibrary()} disabled={loadingLibrary}>
                    {loadingLibrary ? <Spinner className="size-4"/> : <RefreshCw className="h-4 w-4"/>}
                    {t("translation.library.refresh")}
                </Button>
            </div>

            {loadingLibrary ? (<div className="flex items-center justify-center py-16">
                    <Spinner className="size-6"/>
                </div>) : (<>
                <section className="space-y-2">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                        <ListMusic className="h-4 w-4"/>
                        {t("translation.library.playlistsSection")}
                    </h3>
                    <p className="text-xs text-muted-foreground">{t("translation.library.playlistsOwnedOnlyNote")}</p>
                    <div className="rounded-lg border divide-y">
                        <label className="flex cursor-pointer items-center gap-3 p-3 hover:bg-muted/50">
                            <Checkbox checked={selectedPlaylistIds.has(LIKED_SONGS_ID)} onCheckedChange={() => togglePlaylist(LIKED_SONGS_ID)}/>
                            <Heart className="h-4 w-4 text-primary"/>
                            <span className="flex-1 text-sm font-medium">{t("translation.library.likedSongs")}</span>
                        </label>
                        {playlists.map((playlist) => (<label key={playlist.spotify_id} className="flex cursor-pointer items-center gap-3 p-3 hover:bg-muted/50">
                                <Checkbox checked={selectedPlaylistIds.has(playlist.spotify_id)} onCheckedChange={() => togglePlaylist(playlist.spotify_id)}/>
                                {playlist.images ? <img src={playlist.images} alt={playlist.name} className="h-8 w-8 rounded object-cover"/> : <div className="h-8 w-8 rounded bg-muted"/>}
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium">{playlist.name}</p>
                                    <p className="truncate text-xs text-muted-foreground">{t("translation.library.trackCount", { count: playlist.track_count })}{!playlist.owner_is_self && playlist.owner_name ? ` · ${playlist.owner_name}` : ""}</p>
                                </div>
                            </label>))}
                        {playlists.length === 0 && (<p className="p-3 text-sm text-muted-foreground">{t("translation.library.noPlaylists")}</p>)}
                    </div>
                </section>

                <section className="space-y-2">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
                        <Disc3 className="h-4 w-4"/>
                        {t("translation.library.albumsSection")}
                    </h3>
                    <div className="rounded-lg border divide-y">
                        {albums.map((album) => (<label key={album.spotify_id} className="flex cursor-pointer items-center gap-3 p-3 hover:bg-muted/50">
                                <Checkbox checked={selectedAlbumIds.has(album.spotify_id)} onCheckedChange={() => toggleAlbum(album.spotify_id)}/>
                                {album.images ? <img src={album.images} alt={album.name} className="h-8 w-8 rounded object-cover"/> : <div className="h-8 w-8 rounded bg-muted"/>}
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium">{album.name}</p>
                                    <p className="truncate text-xs text-muted-foreground">{album.artists} · {t("translation.library.trackCount", { count: album.total_tracks })}</p>
                                </div>
                            </label>))}
                        {albums.length === 0 && (<p className="p-3 text-sm text-muted-foreground">{t("translation.library.noAlbums")}</p>)}
                    </div>
                </section>
            </>)}

            {selectedCount > 0 && (<div className="fixed bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-3 rounded-full border bg-card px-4 py-2 shadow-lg">
                    <span className="text-sm font-medium">{t("translation.library.selectedCount", { count: selectedCount })}</span>
                    <Button size="sm" className="gap-2" onClick={() => void handleAddToQueue()} disabled={addingToQueue}>
                        {addingToQueue ? <Spinner className="size-4"/> : null}
                        {addingToQueue
                        ? (likedSongsProgress ? t("translation.library.fetchingLikedSongs", { value1: likedSongsProgress.fetched, value2: likedSongsProgress.total }) : t("translation.library.adding"))
                        : t("translation.library.addToQueue")}
                    </Button>
                </div>)}
        </div>);
}
