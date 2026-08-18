package backend

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type EnrichResult struct {
	FilePath string `json:"file_path"`
	Status   string `json:"status"`
	Source   string `json:"source,omitempty"`
	Message  string `json:"message,omitempty"`
	ISRC     string `json:"isrc,omitempty"`
}

type EnrichMetadataPreview struct {
	FilePath      string `json:"file_path"`
	Title         string `json:"title"`
	Artist        string `json:"artist"`
	Album         string `json:"album"`
	AlbumArtist   string `json:"album_artist"`
	Date          string `json:"date"`
	TrackNumber   int    `json:"track_number"`
	TotalTracks   int    `json:"total_tracks"`
	DiscNumber    int    `json:"disc_number"`
	TotalDiscs    int    `json:"total_discs"`
	Copyright     string `json:"copyright"`
	Publisher     string `json:"publisher"`
	Composer      string `json:"composer"`
	ISRC          string `json:"isrc"`
	UPC           string `json:"upc"`
	Genre         string `json:"genre"`
	Comment       string `json:"comment"`
	LyricsPresent bool   `json:"lyrics_present"`
	Eligible      bool   `json:"eligible"`
	MissingISRC   bool   `json:"missing_isrc"`
	MissingURL    bool   `json:"missing_url"`
	InspectionErr string `json:"inspection_error,omitempty"`
}

func InspectEnrichFile(filePath string) (EnrichMetadataPreview, error) {
	metadata, err := ExtractFullMetadataFromFile(filePath)
	if err != nil {
		return EnrichMetadataPreview{}, err
	}
	return EnrichMetadataPreview{
		FilePath: filePath,
		Title:    metadata.Title, Artist: metadata.Artist, Album: metadata.Album,
		AlbumArtist: metadata.AlbumArtist, Date: metadata.Date,
		TrackNumber: metadata.TrackNumber, TotalTracks: metadata.TotalTracks,
		DiscNumber: metadata.DiscNumber, TotalDiscs: metadata.TotalDiscs,
		Copyright: metadata.Copyright, Publisher: metadata.Publisher,
		Composer: metadata.Composer, ISRC: metadata.ISRC, UPC: metadata.UPC,
		Genre: metadata.Genre, Comment: metadata.Comment,
		LyricsPresent: strings.TrimSpace(metadata.Lyrics) != "",
		Eligible:      strings.TrimSpace(metadata.ISRC) != "" || spotifySourceURL(metadata.Comment) || directSourceURL(metadata.Comment),
		MissingISRC:   strings.TrimSpace(metadata.ISRC) == "",
		MissingURL:    !(spotifySourceURL(metadata.Comment) || directSourceURL(metadata.Comment)),
	}, nil
}

func InspectEnrichFiles(filePaths []string) []EnrichMetadataPreview {
	results := make([]EnrichMetadataPreview, 0, len(filePaths))
	for _, filePath := range filePaths {
		preview, err := InspectEnrichFile(filePath)
		if err != nil {
			results = append(results, EnrichMetadataPreview{
				FilePath: filePath, MissingISRC: true, MissingURL: true, InspectionErr: err.Error(),
			})
			continue
		}
		results = append(results, preview)
	}
	return results
}

func spotifySourceURL(value string) bool {
	lower := strings.ToLower(strings.TrimSpace(value))
	return strings.Contains(lower, "open.spotify.com/track/") || strings.HasPrefix(lower, "spotify:track:")
}

func directSourceURL(value string) bool {
	lower := strings.ToLower(strings.TrimSpace(value))
	return strings.Contains(lower, "deezer.com/track/")
}

func sourceName(value string) string {
	lower := strings.ToLower(value)
	switch {
	case strings.Contains(lower, "spotify"):
		return "spotify"
	case strings.Contains(lower, "deezer"):
		return "deezer"
	default:
		return ""
	}
}

func trackMetadataToMetadata(track TrackMetadata) Metadata {
	return Metadata{
		Title:       track.Name,
		Artist:      track.Artists,
		Album:       track.AlbumName,
		AlbumArtist: track.AlbumArtist,
		Date:        track.ReleaseDate,
		ReleaseDate: track.ReleaseDate,
		TrackNumber: track.TrackNumber,
		TotalTracks: track.TotalTracks,
		DiscNumber:  track.DiscNumber,
		TotalDiscs:  track.TotalDiscs,
		Copyright:   track.Copyright,
		Publisher:   track.Publisher,
		Composer:    track.Composer,
		UPC:         track.UPC,
		URL:         track.ExternalURL,
		Comment:     track.ExternalURL,
	}
}

func mergeMissingMetadata(current, incoming Metadata) Metadata {
	if current.Title == "" || isArtworkPlaceholderTitle(current.Title) {
		current.Title = incoming.Title
	}
	if current.Artist == "" {
		current.Artist = incoming.Artist
	}
	if current.Album == "" {
		current.Album = incoming.Album
	}
	if current.AlbumArtist == "" {
		current.AlbumArtist = incoming.AlbumArtist
	}
	if current.Publisher == "" {
		current.Publisher = incoming.Publisher
	}
	if current.Date == "" {
		current.Date = incoming.Date
	}
	if current.ReleaseDate == "" {
		current.ReleaseDate = incoming.ReleaseDate
	}
	if current.TrackNumber == 0 {
		current.TrackNumber = incoming.TrackNumber
	}
	if current.TotalTracks == 0 {
		current.TotalTracks = incoming.TotalTracks
	}
	if current.DiscNumber == 0 {
		current.DiscNumber = incoming.DiscNumber
	}
	if current.TotalDiscs == 0 {
		current.TotalDiscs = incoming.TotalDiscs
	}
	if current.Copyright == "" {
		current.Copyright = incoming.Copyright
	}
	if current.Composer == "" {
		current.Composer = incoming.Composer
	}
	if current.ISRC == "" {
		current.ISRC = incoming.ISRC
	}
	if current.UPC == "" {
		current.UPC = incoming.UPC
	}
	if current.Genre == "" {
		current.Genre = incoming.Genre
	}
	if current.URL == "" {
		current.URL = incoming.URL
	}
	if current.Comment == "" {
		current.Comment = incoming.Comment
	}
	return current
}

func isArtworkPlaceholderTitle(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "cover", "front cover", "cover (front)":
		return true
	default:
		return false
	}
}

func fetchDeezerEnrichMetadata(sourceURL string) (Metadata, error) {
	trackID, err := extractDeezerTrackID(sourceURL)
	if err != nil {
		return Metadata{}, err
	}
	response, err := http.Get("https://api.deezer.com/track/" + trackID)
	if err != nil {
		return Metadata{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return Metadata{}, fmt.Errorf("Deezer API returned status %d", response.StatusCode)
	}
	var track struct {
		Title         string `json:"title"`
		ISRC          string `json:"isrc"`
		TrackPosition int    `json:"track_position"`
		DiskNumber    int    `json:"disk_number"`
		Link          string `json:"link"`
		Artist        struct {
			Name string `json:"name"`
		} `json:"artist"`
		Album struct {
			Title       string `json:"title"`
			ReleaseDate string `json:"release_date"`
			UPC         string `json:"upc"`
		} `json:"album"`
	}
	if err := json.NewDecoder(response.Body).Decode(&track); err != nil {
		return Metadata{}, err
	}
	return Metadata{Title: track.Title, Artist: track.Artist.Name, AlbumArtist: track.Artist.Name, Album: track.Album.Title, Date: track.Album.ReleaseDate, ReleaseDate: track.Album.ReleaseDate, TrackNumber: track.TrackPosition, DiscNumber: track.DiskNumber, ISRC: track.ISRC, UPC: track.Album.UPC, URL: track.Link, Comment: track.Link}, nil
}

func FetchEnrichMetadataFromURL(sourceURL, spotifySeparator string) (Metadata, string, error) {
	if spotifySourceURL(sourceURL) {
		ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancel()
		data, err := GetFilteredSpotifyData(ctx, sourceURL, false, time.Second, spotifySeparator, nil)
		if err != nil {
			return Metadata{}, "spotify", err
		}
		response, ok := data.(TrackResponse)
		if !ok {
			return Metadata{}, "spotify", fmt.Errorf("source URL is not a track")
		}
		return trackMetadataToMetadata(response.Track), "spotify", nil
	}

	if directSourceURL(sourceURL) {
		metadata, err := fetchDeezerEnrichMetadata(sourceURL)
		return metadata, "deezer", err
	}

	return Metadata{}, "", fmt.Errorf("COMMENT does not contain a supported track URL")
}

func FetchEnrichMetadataFromISRC(isrc string) (Metadata, string, error) {
	resolver := NewSongLinkClient()
	deezerURL, err := resolver.lookupDeezerTrackURLByISRC(isrc)
	if err != nil {
		return Metadata{}, "", err
	}
	return FetchEnrichMetadataFromURL(deezerURL, ", ")
}

func EnrichFile(filePath, priority string, allowFallback bool, spotifySeparator string) EnrichResult {
	result := EnrichResult{FilePath: filePath}
	current, err := ExtractFullMetadataFromFile(filePath)
	if err != nil {
		result.Status, result.Message = "failed", err.Error()
		return result
	}
	if strings.TrimSpace(current.ISRC) == "" && !spotifySourceURL(current.Comment) && !directSourceURL(current.Comment) {
		result.Status = "skipped"
		result.Message = "ISRC or a supported source URL in COMMENT is required"
		return result
	}

	var incoming Metadata
	var source string
	fetchURL := func() error {
		var fetchErr error
		incoming, source, fetchErr = FetchEnrichMetadataFromURL(current.Comment, spotifySeparator)
		return fetchErr
	}
	fetchISRC := func() error {
		var fetchErr error
		incoming, source, fetchErr = FetchEnrichMetadataFromISRC(current.ISRC)
		return fetchErr
	}

	var primaryErr, fallbackErr error
	if strings.EqualFold(priority, "isrc") {
		if strings.TrimSpace(current.ISRC) == "" {
			primaryErr = fmt.Errorf("ISRC is missing")
		} else {
			primaryErr = fetchISRC()
		}
		if primaryErr != nil && allowFallback {
			fallbackErr = fetchURL()
		}
	} else {
		if !spotifySourceURL(current.Comment) && !directSourceURL(current.Comment) {
			primaryErr = fmt.Errorf("supported source URL is missing")
		} else {
			primaryErr = fetchURL()
		}
		if primaryErr != nil && allowFallback {
			if strings.TrimSpace(current.ISRC) == "" {
				fallbackErr = fmt.Errorf("ISRC is missing")
			} else {
				fallbackErr = fetchISRC()
			}
		}
	}
	if primaryErr != nil && (!allowFallback || fallbackErr != nil) {
		result.Status = "skipped"
		if allowFallback {
			result.Message = fmt.Sprintf("primary lookup failed: %v; fallback lookup failed: %v", primaryErr, fallbackErr)
		} else {
			result.Message = fmt.Sprintf("primary lookup failed: %v; fallback is disabled", primaryErr)
		}
		return result
	}

	currentISRC := strings.ToUpper(strings.TrimSpace(current.ISRC))
	incomingISRC := strings.ToUpper(strings.TrimSpace(incoming.ISRC))
	if currentISRC != "" && incomingISRC != "" && currentISRC != incomingISRC {
		result.Status, result.Source, result.ISRC = "conflict", source, currentISRC
		result.Message = fmt.Sprintf("ISRC mismatch: file=%s source=%s", currentISRC, incomingISRC)
		return result
	}

	var supplemental Metadata
	var supplementalErr error
	if allowFallback {
		if strings.EqualFold(priority, "isrc") && (spotifySourceURL(current.Comment) || directSourceURL(current.Comment)) {
			supplemental, _, supplementalErr = FetchEnrichMetadataFromURL(current.Comment, spotifySeparator)
		} else if !strings.EqualFold(priority, "isrc") && strings.TrimSpace(current.ISRC) != "" {
			supplemental, _, supplementalErr = FetchEnrichMetadataFromISRC(current.ISRC)
		} else {
			supplementalErr = fmt.Errorf("supplemental lookup unavailable")
		}
	}
	if allowFallback && supplementalErr == nil {
		supplementalISRC := strings.ToUpper(strings.TrimSpace(supplemental.ISRC))
		if supplementalISRC != "" && supplementalISRC != currentISRC {
			result.Status, result.Source, result.ISRC = "conflict", source, currentISRC
			result.Message = fmt.Sprintf("ISRC mismatch: file=%s supplemental=%s", currentISRC, supplementalISRC)
			return result
		}
		incoming = mergeMissingMetadata(incoming, supplemental)
		incomingISRC = strings.ToUpper(strings.TrimSpace(incoming.ISRC))
	}

	merged := mergeMissingMetadata(current, incoming)

	if err := TagFile(filePath, merged, ""); err != nil {
		result.Status, result.Source, result.Message = "failed", source, err.Error()
		return result
	}

	result.Status, result.Source, result.ISRC = "enriched", source, strings.ToUpper(strings.TrimSpace(merged.ISRC))
	return result
}
