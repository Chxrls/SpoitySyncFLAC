# SpoitySyncFLAC

A fork of [SpotiFLAC](https://github.com/spotbye/SpotiFLAC) — a desktop app that gets Spotify tracks in true FLAC from Tidal, Qobuz & Amazon Music — with an added **Spotify account sync** feature.

## What's different from upstream SpotiFLAC

The original app resolves tracks/albums/playlists entirely anonymously: you paste a public Spotify link and it fetches metadata by impersonating the Spotify Web Player, with no login and no connection to your Spotify account. That path is unchanged here and remains the default.

This fork adds an **optional, opt-in** way to browse and download from your own Spotify library instead of pasting links one at a time:

- Real Spotify OAuth login (Authorization Code + PKCE, no client secret shipped in the app)
- A new **Library** page to browse your own playlists, Liked Songs, and saved albums, multi-select what you want, and send it straight into the existing download queue
- A **Spotify Account** section in Settings (Download tab) as an alternative entry point to connect/disconnect

### Known limitation: only your own playlists

Spotify restricts full playlist API access for apps in Development Mode to playlists you **own or actively collaborate on** — playlists you merely follow return `403 Forbidden` and are filtered out of the Library list automatically. Liked Songs and Saved Albums aren't affected by this restriction and always work.

### One-time setup to use it

Because Spotify caps unapproved ("Development Mode") apps at 25 allow-listed users, the Client ID can't be baked into the app — each user connects their own free Spotify app:

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and create an app
2. Add the exact Redirect URI shown in SpotiFLAC's Library or Settings page (`http://127.0.0.1:53829/callback`)
3. Check the **Web API** checkbox and save
4. Copy the app's Client ID into SpotiFLAC and click Connect

## Building from source

Requires Go 1.26+, Node 24+, pnpm, and the [Wails v2 CLI](https://wails.io).

```
wails dev      # run with hot reload
wails build    # produce build/bin/SpotiFLAC.exe
```

## License

MIT, same as upstream — see [LICENSE](LICENSE). All credit for the original application goes to [afkarxyz](https://github.com/afkarxyz) and the SpotiFLAC project.
