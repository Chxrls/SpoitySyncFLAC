import type { LibraryPlaylistSummary, LibraryAlbumSummary, PlaylistResponse, AlbumResponse } from "@/types/api";
import { GetSpotifyLibraryPlaylists, GetSpotifyLibraryAlbums, GetSpotifyPlaylistTracks, GetSpotifyAlbumTracks, GetSpotifyLikedSongs } from "../../wailsjs/go/main/App";
export async function fetchLibraryPlaylists(): Promise<LibraryPlaylistSummary[]> {
    const raw = await GetSpotifyLibraryPlaylists();
    return raw ? JSON.parse(raw) : [];
}
export async function fetchLibraryAlbums(): Promise<LibraryAlbumSummary[]> {
    const raw = await GetSpotifyLibraryAlbums();
    return raw ? JSON.parse(raw) : [];
}
export async function fetchLibraryPlaylistTracks(playlistId: string): Promise<PlaylistResponse> {
    const raw = await GetSpotifyPlaylistTracks(playlistId);
    return JSON.parse(raw);
}
export async function fetchLibraryAlbumTracks(albumId: string): Promise<AlbumResponse> {
    const raw = await GetSpotifyAlbumTracks(albumId);
    return JSON.parse(raw);
}
export async function fetchLikedSongs(): Promise<PlaylistResponse> {
    const raw = await GetSpotifyLikedSongs();
    return JSON.parse(raw);
}
