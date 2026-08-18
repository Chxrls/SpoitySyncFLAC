import type { SpotifyAuthStatus } from "@/types/api";
import { ConnectSpotifyAccount, DisconnectSpotifyAccount, GetSpotifyAuthStatus, GetSpotifyRedirectURI } from "../../wailsjs/go/main/App";
export type { SpotifyAuthStatus };
export async function connectSpotifyAccount(): Promise<SpotifyAuthStatus> {
    const status = await ConnectSpotifyAccount();
    return {
        connected: status.connected,
        display_name: status.display_name,
        avatar_url: status.avatar_url,
        spotify_user_id: status.spotify_user_id,
    };
}
export async function disconnectSpotifyAccount(): Promise<void> {
    await DisconnectSpotifyAccount();
}
export async function getSpotifyAuthStatus(): Promise<SpotifyAuthStatus> {
    const status = await GetSpotifyAuthStatus();
    return {
        connected: status.connected,
        display_name: status.display_name,
        avatar_url: status.avatar_url,
        spotify_user_id: status.spotify_user_id,
    };
}
export async function getSpotifyRedirectURI(): Promise<string> {
    return GetSpotifyRedirectURI();
}
