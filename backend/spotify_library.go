package backend

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

const spotifyWebAPIBase = "https://api.spotify.com/v1"

var errSpotifyReauthRequired = errors.New("your Spotify session expired — please reconnect")
var errSpotifyItemForbidden = errors.New("Spotify doesn't allow API access to this item (common for Spotify-generated mixes, Blend playlists, or ones whose owner deleted their account)")
var errSpotifyItemNotFound = errors.New("this item is no longer available on Spotify")

// SpotifyLibraryClient talks to the authenticated Spotify Web API (as opposed
// to the anonymous Pathfinder client in spotify_metadata.go/spotfetch.go).
type SpotifyLibraryClient struct {
	httpClient *http.Client
	authMu     sync.RWMutex
	auth       *spotifyAuthRecord
	clientID   string
}

func (c *SpotifyLibraryClient) currentAccessToken() string {
	c.authMu.RLock()
	defer c.authMu.RUnlock()
	return c.auth.AccessToken
}

// NewSpotifyLibraryClient resolves a valid auth record (refreshing or logging
// in as needed) before returning a ready-to-use client.
func NewSpotifyLibraryClient(clientID string) (*SpotifyLibraryClient, error) {
	record, err := EnsureSpotifyAuth(clientID)
	if err != nil {
		return nil, err
	}
	return &SpotifyLibraryClient{
		httpClient: &http.Client{Timeout: 30 * time.Second},
		auth:       record,
		clientID:   clientID,
	}, nil
}

func (c *SpotifyLibraryClient) forceRefresh() error {
	spotifyAuthMu.Lock()
	defer spotifyAuthMu.Unlock()

	record, err := loadSpotifyAuthRecord()
	if err != nil {
		return err
	}
	if record.RefreshToken == "" {
		return errSpotifyReauthRequired
	}
	token, err := refreshSpotifyToken(c.clientID, record.RefreshToken)
	if err != nil {
		if errors.Is(err, errSpotifyRefreshInvalid) {
			return errSpotifyReauthRequired
		}
		return err
	}
	record.AccessToken = token.AccessToken
	if token.RefreshToken != "" {
		record.RefreshToken = token.RefreshToken
	}
	record.Scope = token.Scope
	record.ExpiresAt = time.Now().Add(time.Duration(token.ExpiresIn) * time.Second).Format(time.RFC3339Nano)
	record.ClientID = c.clientID
	if err := saveSpotifyAuthRecord(record); err != nil {
		return err
	}
	c.authMu.Lock()
	c.auth = record
	c.authMu.Unlock()
	return nil
}

func truncateForError(body []byte, max int) string {
	trimmed := strings.TrimSpace(string(body))
	if len(trimmed) > max {
		return trimmed[:max] + "..."
	}
	return trimmed
}

// doJSON issues a request against a full Spotify Web API URL, handling
// bearer-token auth, a single forced-refresh-and-retry on 401, and bounded
// Retry-After-aware backoff on 429.
func (c *SpotifyLibraryClient) doJSON(ctx context.Context, method, endpoint string, out interface{}) error {
	attempt := func() (*http.Response, []byte, error) {
		req, err := http.NewRequestWithContext(ctx, method, endpoint, nil)
		if err != nil {
			return nil, nil, err
		}
		req.Header.Set("Authorization", "Bearer "+c.currentAccessToken())
		req.Header.Set("Accept", "application/json")
		resp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, nil, err
		}
		defer resp.Body.Close()
		body, readErr := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024))
		return resp, body, readErr
	}

	resp, body, err := attempt()
	if err != nil {
		return err
	}

	if resp.StatusCode == http.StatusUnauthorized {
		if refreshErr := c.forceRefresh(); refreshErr != nil {
			return refreshErr
		}
		resp, body, err = attempt()
		if err != nil {
			return err
		}
	}

	for retries := 0; resp.StatusCode == http.StatusTooManyRequests && retries < 3; retries++ {
		wait := 2 * time.Second
		if retryAfter := strings.TrimSpace(resp.Header.Get("Retry-After")); retryAfter != "" {
			if seconds, convErr := strconv.Atoi(retryAfter); convErr == nil && seconds > 0 {
				wait = time.Duration(seconds) * time.Second
			}
		}
		if wait > 30*time.Second {
			wait = 30 * time.Second
		}
		select {
		case <-time.After(wait):
		case <-ctx.Done():
			return ctx.Err()
		}
		resp, body, err = attempt()
		if err != nil {
			return err
		}
	}

	if resp.StatusCode == http.StatusUnauthorized {
		return errSpotifyReauthRequired
	}
	if resp.StatusCode == http.StatusForbidden {
		return errSpotifyItemForbidden
	}
	if resp.StatusCode == http.StatusNotFound {
		return errSpotifyItemNotFound
	}
	if resp.StatusCode == http.StatusTooManyRequests {
		return fmt.Errorf("spotify rate-limited this request; try again in a moment")
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("spotify API request failed with HTTP %d: %s", resp.StatusCode, truncateForError(body, 200))
	}

	if out == nil || len(body) == 0 {
		return nil
	}
	return json.Unmarshal(body, out)
}

// LibraryProfile is the current user's basic profile.
type LibraryProfile struct {
	SpotifyUserID string `json:"spotify_user_id"`
	DisplayName   string `json:"display_name"`
	AvatarURL     string `json:"avatar_url,omitempty"`
}

type spotifyProfileResponse struct {
	ID          string `json:"id"`
	DisplayName string `json:"display_name"`
	Images      []struct {
		URL string `json:"url"`
	} `json:"images"`
}

// fetchSpotifyProfileForAuth is a standalone GET /me used right after login,
// before a spotifyAuthMu-holding EnsureSpotifyAuth call has returned — it must
// NOT go through NewSpotifyLibraryClient/EnsureSpotifyAuth, which would
// re-enter the (non-reentrant) spotifyAuthMu lock and deadlock.
func fetchSpotifyProfileForAuth(record *spotifyAuthRecord) (*LibraryProfile, error) {
	req, err := http.NewRequest(http.MethodGet, spotifyWebAPIBase+"/me", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+record.AccessToken)
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to fetch spotify profile: HTTP %d", resp.StatusCode)
	}
	var profile spotifyProfileResponse
	if err := json.Unmarshal(body, &profile); err != nil {
		return nil, err
	}
	avatar := ""
	if len(profile.Images) > 0 {
		avatar = profile.Images[0].URL
	}
	return &LibraryProfile{SpotifyUserID: profile.ID, DisplayName: profile.DisplayName, AvatarURL: avatar}, nil
}

func (c *SpotifyLibraryClient) GetProfile(ctx context.Context) (*LibraryProfile, error) {
	var profile spotifyProfileResponse
	if err := c.doJSON(ctx, http.MethodGet, spotifyWebAPIBase+"/me", &profile); err != nil {
		return nil, err
	}
	avatar := ""
	if len(profile.Images) > 0 {
		avatar = profile.Images[0].URL
	}
	return &LibraryProfile{SpotifyUserID: profile.ID, DisplayName: profile.DisplayName, AvatarURL: avatar}, nil
}

// webAPITrack mirrors the full track object shape returned by Spotify's Web
// API (playlist items, liked songs, and GET /tracks?ids=...) — unlike the
// anonymous Pathfinder client, this exposes external_ids.isrc directly.
type webAPITrack struct {
	ID          string `json:"id"`
	Type        string `json:"type"`
	Name        string `json:"name"`
	DurationMS  int    `json:"duration_ms"`
	TrackNumber int    `json:"track_number"`
	DiscNumber  int    `json:"disc_number"`
	Explicit    bool   `json:"explicit"`
	PreviewURL  string `json:"preview_url"`
	ExternalIDs struct {
		ISRC string `json:"isrc"`
	} `json:"external_ids"`
	ExternalURLs struct {
		Spotify string `json:"spotify"`
	} `json:"external_urls"`
	Artists []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	} `json:"artists"`
	Album struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		ReleaseDate string `json:"release_date"`
		TotalTracks int    `json:"total_tracks"`
		Images      []struct {
			URL string `json:"url"`
		} `json:"images"`
	} `json:"album"`
}

func mapWebAPITrackToAlbumTrackMetadata(track *webAPITrack, separator string) (AlbumTrackMetadata, string) {
	artistNames := make([]string, 0, len(track.Artists))
	artistsData := make([]ArtistSimple, 0, len(track.Artists))
	for _, artist := range track.Artists {
		artistNames = append(artistNames, artist.Name)
		artistsData = append(artistsData, ArtistSimple{
			ID:          artist.ID,
			Name:        artist.Name,
			ExternalURL: fmt.Sprintf("https://open.spotify.com/artist/%s", artist.ID),
		})
	}

	images := ""
	if len(track.Album.Images) > 0 {
		images = track.Album.Images[0].URL
	}

	artistID, artistURL := "", ""
	if len(track.Artists) > 0 {
		artistID = track.Artists[0].ID
		artistURL = fmt.Sprintf("https://open.spotify.com/artist/%s", artistID)
	}

	meta := AlbumTrackMetadata{
		SpotifyID:   track.ID,
		Artists:     strings.Join(artistNames, separator),
		Name:        track.Name,
		AlbumName:   track.Album.Name,
		DurationMS:  track.DurationMS,
		Images:      images,
		ReleaseDate: track.Album.ReleaseDate,
		TrackNumber: track.TrackNumber,
		TotalTracks: track.Album.TotalTracks,
		DiscNumber:  track.DiscNumber,
		ExternalURL: track.ExternalURLs.Spotify,
		AlbumID:     track.Album.ID,
		AlbumURL:    fmt.Sprintf("https://open.spotify.com/album/%s", track.Album.ID),
		ArtistID:    artistID,
		ArtistURL:   artistURL,
		ArtistsData: artistsData,
		PreviewURL:  track.PreviewURL,
		IsExplicit:  track.Explicit,
	}
	return meta, strings.TrimSpace(track.ExternalIDs.ISRC)
}

// LibraryPlaylistSummary is a lightweight row for the library browse list.
type LibraryPlaylistSummary struct {
	SpotifyID     string `json:"spotify_id"`
	Name          string `json:"name"`
	OwnerName     string `json:"owner_name"`
	OwnerIsSelf   bool   `json:"owner_is_self"`
	TrackCount    int    `json:"track_count"`
	Images        string `json:"images"`
	Public        bool   `json:"public"`
	Collaborative bool   `json:"collaborative"`
}

type spotifyPlaylistsPage struct {
	Items []struct {
		ID            string `json:"id"`
		Name          string `json:"name"`
		Public        bool   `json:"public"`
		Collaborative bool   `json:"collaborative"`
		Owner         struct {
			ID          string `json:"id"`
			DisplayName string `json:"display_name"`
		} `json:"owner"`
		Images []struct {
			URL string `json:"url"`
		} `json:"images"`
		Tracks struct {
			Total int `json:"total"`
		} `json:"tracks"`
	} `json:"items"`
	Next string `json:"next"`
}

func (c *SpotifyLibraryClient) ListMyPlaylists(ctx context.Context) ([]LibraryPlaylistSummary, error) {
	summaries := []LibraryPlaylistSummary{}
	endpoint := spotifyWebAPIBase + "/me/playlists?limit=50"
	for endpoint != "" {
		var page spotifyPlaylistsPage
		if err := c.doJSON(ctx, http.MethodGet, endpoint, &page); err != nil {
			return nil, err
		}
		for _, item := range page.Items {
			if item.ID == "" {
				continue
			}
			ownerIsSelf := c.auth.SpotifyUserID != "" && item.Owner.ID == c.auth.SpotifyUserID
			// Spotify's Development Mode restricts full playlist access (403) to
			// playlists the authenticated user owns or collaborates on. Playlists
			// merely followed (owned by someone else, not collaborative) can't be
			// fetched, so there's no point listing them as selectable.
			if !ownerIsSelf && !item.Collaborative {
				continue
			}
			images := ""
			if len(item.Images) > 0 {
				images = item.Images[0].URL
			}
			summaries = append(summaries, LibraryPlaylistSummary{
				SpotifyID:     item.ID,
				Name:          item.Name,
				OwnerName:     item.Owner.DisplayName,
				OwnerIsSelf:   ownerIsSelf,
				TrackCount:    item.Tracks.Total,
				Images:        images,
				Public:        item.Public,
				Collaborative: item.Collaborative,
			})
		}
		endpoint = page.Next
	}
	c.fillAccuratePlaylistTrackCounts(ctx, summaries)
	return summaries, nil
}

const playlistCountConcurrency = 5

// fillAccuratePlaylistTrackCounts replaces /me/playlists' deprecated (and, in
// practice, always-zero) tracks.total with an accurate count pulled cheaply
// from the non-deprecated items endpoint (fields=total, limit=1). Best-effort:
// a failed lookup just leaves the earlier (likely zero) count in place.
func (c *SpotifyLibraryClient) fillAccuratePlaylistTrackCounts(ctx context.Context, summaries []LibraryPlaylistSummary) {
	sem := make(chan struct{}, playlistCountConcurrency)
	var wg sync.WaitGroup
	for i := range summaries {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int) {
			defer wg.Done()
			defer func() { <-sem }()
			var page struct {
				Total int `json:"total"`
			}
			endpoint := spotifyWebAPIBase + "/playlists/" + url.PathEscape(summaries[i].SpotifyID) + "/items?limit=1&fields=total"
			if err := c.doJSON(ctx, http.MethodGet, endpoint, &page); err == nil {
				summaries[i].TrackCount = page.Total
			}
		}(i)
	}
	wg.Wait()
}

func (c *SpotifyLibraryClient) GetPlaylistTracks(ctx context.Context, playlistID, separator string) (*PlaylistResponsePayload, error) {
	var playlist struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Images      []struct {
			URL string `json:"url"`
		} `json:"images"`
		Owner struct {
			DisplayName string `json:"display_name"`
		} `json:"owner"`
		Followers struct {
			Total int `json:"total"`
		} `json:"followers"`
		Tracks struct {
			Total int `json:"total"`
		} `json:"tracks"`
	}
	if err := c.doJSON(ctx, http.MethodGet, spotifyWebAPIBase+"/playlists/"+url.PathEscape(playlistID), &playlist); err != nil {
		return nil, err
	}

	trackList := []AlbumTrackMetadata{}
	// GET .../tracks was deprecated by Spotify in favor of .../items (same shape,
	// items[].item replaces the old items[].track field, which is now itself
	// deprecated-but-still-present as an alias). limit max is 50, not 100.
	endpoint := spotifyWebAPIBase + "/playlists/" + url.PathEscape(playlistID) + "/items?limit=50"
	for endpoint != "" {
		var page struct {
			Items []struct {
				Item  *webAPITrack `json:"item"`
				Track *webAPITrack `json:"track"`
			} `json:"items"`
			Next string `json:"next"`
		}
		if err := c.doJSON(ctx, http.MethodGet, endpoint, &page); err != nil {
			return nil, err
		}
		for _, entry := range page.Items {
			item := entry.Item
			if item == nil {
				item = entry.Track
			}
			if item == nil || item.ID == "" {
				continue
			}
			if item.Type != "" && item.Type != "track" {
				continue
			}
			meta, isrc := mapWebAPITrackToAlbumTrackMetadata(item, separator)
			if isrc != "" {
				_ = PutCachedISRC(item.ID, isrc)
			}
			trackList = append(trackList, meta)
		}
		endpoint = page.Next
	}

	images := ""
	if len(playlist.Images) > 0 {
		images = playlist.Images[0].URL
	}

	info := PlaylistInfoMetadata{Cover: images, Description: playlist.Description}
	info.Tracks.Total = playlist.Tracks.Total
	info.Followers.Total = playlist.Followers.Total
	info.Owner.Name = playlist.Name
	info.Owner.DisplayName = playlist.Owner.DisplayName

	return &PlaylistResponsePayload{PlaylistInfo: info, TrackList: trackList}, nil
}

// LibraryAlbumSummary is a lightweight row for the saved-albums browse list.
type LibraryAlbumSummary struct {
	SpotifyID   string `json:"spotify_id"`
	Name        string `json:"name"`
	Artists     string `json:"artists"`
	Images      string `json:"images"`
	ReleaseDate string `json:"release_date"`
	TotalTracks int    `json:"total_tracks"`
}

func (c *SpotifyLibraryClient) ListSavedAlbums(ctx context.Context) ([]LibraryAlbumSummary, error) {
	summaries := []LibraryAlbumSummary{}
	endpoint := spotifyWebAPIBase + "/me/albums?limit=50"
	for endpoint != "" {
		var page struct {
			Items []struct {
				Album struct {
					ID          string `json:"id"`
					Name        string `json:"name"`
					ReleaseDate string `json:"release_date"`
					TotalTracks int    `json:"total_tracks"`
					Artists     []struct {
						Name string `json:"name"`
					} `json:"artists"`
					Images []struct {
						URL string `json:"url"`
					} `json:"images"`
				} `json:"album"`
			} `json:"items"`
			Next string `json:"next"`
		}
		if err := c.doJSON(ctx, http.MethodGet, endpoint, &page); err != nil {
			return nil, err
		}
		for _, item := range page.Items {
			if item.Album.ID == "" {
				continue
			}
			artistNames := make([]string, 0, len(item.Album.Artists))
			for _, artist := range item.Album.Artists {
				artistNames = append(artistNames, artist.Name)
			}
			images := ""
			if len(item.Album.Images) > 0 {
				images = item.Album.Images[0].URL
			}
			summaries = append(summaries, LibraryAlbumSummary{
				SpotifyID:   item.Album.ID,
				Name:        item.Album.Name,
				Artists:     strings.Join(artistNames, ", "),
				Images:      images,
				ReleaseDate: item.Album.ReleaseDate,
				TotalTracks: item.Album.TotalTracks,
			})
		}
		endpoint = page.Next
	}
	return summaries, nil
}

func (c *SpotifyLibraryClient) GetAlbumTracks(ctx context.Context, albumID, separator string) (*AlbumResponsePayload, error) {
	var album struct {
		Name        string `json:"name"`
		ReleaseDate string `json:"release_date"`
		TotalTracks int    `json:"total_tracks"`
		Artists     []struct {
			Name string `json:"name"`
		} `json:"artists"`
		Images []struct {
			URL string `json:"url"`
		} `json:"images"`
		ExternalIDs struct {
			UPC string `json:"upc"`
		} `json:"external_ids"`
	}
	if err := c.doJSON(ctx, http.MethodGet, spotifyWebAPIBase+"/albums/"+url.PathEscape(albumID), &album); err != nil {
		return nil, err
	}

	var trackIDs []string
	endpoint := spotifyWebAPIBase + "/albums/" + url.PathEscape(albumID) + "/tracks?limit=50"
	for endpoint != "" {
		var page struct {
			Items []struct {
				ID string `json:"id"`
			} `json:"items"`
			Next string `json:"next"`
		}
		if err := c.doJSON(ctx, http.MethodGet, endpoint, &page); err != nil {
			return nil, err
		}
		for _, item := range page.Items {
			if item.ID != "" {
				trackIDs = append(trackIDs, item.ID)
			}
		}
		endpoint = page.Next
	}

	// Simplified track objects (from /albums/{id}/tracks) lack external_ids/ISRC,
	// so batch-fetch full track objects (max 50 ids per call) to map through the
	// same mapper used for playlists, and to pre-warm the ISRC cache.
	trackList := make([]AlbumTrackMetadata, 0, len(trackIDs))
	for start := 0; start < len(trackIDs); start += 50 {
		end := start + 50
		if end > len(trackIDs) {
			end = len(trackIDs)
		}
		batch := trackIDs[start:end]
		var batchResp struct {
			Tracks []*webAPITrack `json:"tracks"`
		}
		batchEndpoint := spotifyWebAPIBase + "/tracks?ids=" + url.QueryEscape(strings.Join(batch, ","))
		if err := c.doJSON(ctx, http.MethodGet, batchEndpoint, &batchResp); err != nil {
			return nil, err
		}
		for _, track := range batchResp.Tracks {
			if track == nil || track.ID == "" {
				continue
			}
			meta, isrc := mapWebAPITrackToAlbumTrackMetadata(track, separator)
			if isrc != "" {
				_ = PutCachedISRC(track.ID, isrc)
			}
			trackList = append(trackList, meta)
		}
	}

	artistNames := make([]string, 0, len(album.Artists))
	for _, artist := range album.Artists {
		artistNames = append(artistNames, artist.Name)
	}
	images := ""
	if len(album.Images) > 0 {
		images = album.Images[0].URL
	}

	return &AlbumResponsePayload{
		AlbumInfo: AlbumInfoMetadata{
			TotalTracks: album.TotalTracks,
			Name:        album.Name,
			ReleaseDate: album.ReleaseDate,
			Artists:     strings.Join(artistNames, separator),
			Images:      images,
			UPC:         album.ExternalIDs.UPC,
		},
		TrackList: trackList,
	}, nil
}

// GetLikedSongs fetches the user's saved tracks as a virtual playlist.
// progress (optional) fires after each page with the running fetched/total count.
func (c *SpotifyLibraryClient) GetLikedSongs(ctx context.Context, separator string, progress func(fetched, total int)) (*PlaylistResponsePayload, error) {
	trackList := []AlbumTrackMetadata{}
	total := 0
	endpoint := spotifyWebAPIBase + "/me/tracks?limit=50"
	for endpoint != "" {
		var page struct {
			Items []struct {
				Track *webAPITrack `json:"track"`
			} `json:"items"`
			Next  string `json:"next"`
			Total int    `json:"total"`
		}
		if err := c.doJSON(ctx, http.MethodGet, endpoint, &page); err != nil {
			return nil, err
		}
		total = page.Total
		for _, item := range page.Items {
			if item.Track == nil || item.Track.ID == "" {
				continue
			}
			meta, isrc := mapWebAPITrackToAlbumTrackMetadata(item.Track, separator)
			if isrc != "" {
				_ = PutCachedISRC(item.Track.ID, isrc)
			}
			trackList = append(trackList, meta)
		}
		endpoint = page.Next
		if progress != nil {
			progress(len(trackList), total)
		}
	}

	info := PlaylistInfoMetadata{}
	info.Tracks.Total = total
	info.Owner.Name = "Liked Songs"
	if c.auth != nil {
		info.Owner.DisplayName = c.auth.DisplayName
	}

	return &PlaylistResponsePayload{PlaylistInfo: info, TrackList: trackList}, nil
}
