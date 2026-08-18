package backend

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	spotifyOAuthAuthorizeURL = "https://accounts.spotify.com/authorize"
	spotifyOAuthTokenURL     = "https://accounts.spotify.com/api/token"
	spotifyOAuthRedirectPort = 53829
	spotifyOAuthRedirectPath = "/callback"
	spotifyOAuthScopes       = "playlist-read-private playlist-read-collaborative user-library-read user-read-private"
	spotifyOAuthTimeout      = 5 * time.Minute
	spotifyAuthSkew          = 2 * time.Minute
	spotifyAuthFile          = "spotify_auth.json"
)

var errSpotifyRefreshInvalid = errors.New("spotify refresh token is no longer valid")

// SpotifyOAuthRedirectURI returns the fixed loopback redirect URI. Spotify requires
// an exact match against the URI registered in the developer dashboard app, and
// requires the literal 127.0.0.1 (not localhost) for loopback redirects.
func SpotifyOAuthRedirectURI() string {
	return fmt.Sprintf("http://127.0.0.1:%d%s", spotifyOAuthRedirectPort, spotifyOAuthRedirectPath)
}

var (
	spotifyAuthMu           sync.Mutex
	spotifyBrowserMu        sync.RWMutex
	spotifyBrowserOpen      func(string)
	spotifyWindowForeground func()
)

// SetSpotifyAuthHandlers injects the platform-specific browser-open and
// window-foreground callbacks, mirroring SetCommunityVerificationHandlers.
func SetSpotifyAuthHandlers(openBrowser func(string), foreground func()) {
	spotifyBrowserMu.Lock()
	spotifyBrowserOpen = openBrowser
	spotifyWindowForeground = foreground
	spotifyBrowserMu.Unlock()
}

type spotifyAuthRecord struct {
	ClientID      string `json:"client_id,omitempty"`
	AccessToken   string `json:"access_token,omitempty"`
	RefreshToken  string `json:"refresh_token,omitempty"`
	ExpiresAt     string `json:"expires_at,omitempty"`
	Scope         string `json:"scope,omitempty"`
	SpotifyUserID string `json:"spotify_user_id,omitempty"`
	DisplayName   string `json:"display_name,omitempty"`
	AvatarURL     string `json:"avatar_url,omitempty"`
}

func spotifyAuthPath() (string, error) {
	dir, err := EnsureAppDir()
	if err != nil {
		return "", err
	}
	_ = os.Chmod(dir, 0700)
	return filepath.Join(dir, spotifyAuthFile), nil
}

func loadSpotifyAuthRecord() (*spotifyAuthRecord, error) {
	path, err := spotifyAuthPath()
	if err != nil {
		return nil, err
	}
	record := &spotifyAuthRecord{}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return record, nil
		}
		return nil, err
	}
	if err := json.Unmarshal(data, record); err != nil {
		return &spotifyAuthRecord{}, nil
	}
	return record, nil
}

func saveSpotifyAuthRecord(record *spotifyAuthRecord) error {
	path, err := spotifyAuthPath()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return err
	}
	tempPath := path + ".tmp"
	if err := os.WriteFile(tempPath, data, 0600); err != nil {
		return err
	}
	if err := os.Rename(tempPath, path); err != nil {
		_ = os.Remove(tempPath)
		return err
	}
	return os.Chmod(path, 0600)
}

// ClearSpotifyAuth logs the user out by wiping the persisted token record.
func ClearSpotifyAuth() error {
	spotifyAuthMu.Lock()
	defer spotifyAuthMu.Unlock()
	return saveSpotifyAuthRecord(&spotifyAuthRecord{})
}

// SpotifyConnectionInfo is the safe-to-export subset of spotifyAuthRecord
// (no tokens) used for non-blocking connection-status checks.
type SpotifyConnectionInfo struct {
	Connected     bool
	DisplayName   string
	AvatarURL     string
	SpotifyUserID string
}

// LoadSpotifyConnectionInfo reads the persisted auth record without
// refreshing or triggering any network/browser activity.
func LoadSpotifyConnectionInfo() (*SpotifyConnectionInfo, error) {
	record, err := loadSpotifyAuthRecord()
	if err != nil {
		return nil, err
	}
	return &SpotifyConnectionInfo{
		Connected:     record.AccessToken != "" || record.RefreshToken != "",
		DisplayName:   record.DisplayName,
		AvatarURL:     record.AvatarURL,
		SpotifyUserID: record.SpotifyUserID,
	}, nil
}

func spotifyAuthRecordValid(record *spotifyAuthRecord) bool {
	if record == nil || record.AccessToken == "" {
		return false
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, record.ExpiresAt)
	return err == nil && time.Until(expiresAt) > spotifyAuthSkew
}

// EnsureSpotifyAuth returns a valid auth record, transparently refreshing or
// (if necessary) running the full interactive login flow. It mirrors
// ensureCommunitySession's get-or-refresh-or-login shape.
func EnsureSpotifyAuth(clientID string) (*spotifyAuthRecord, error) {
	clientID = strings.TrimSpace(clientID)
	if clientID == "" {
		return nil, fmt.Errorf("add your Spotify Client ID in Settings first")
	}

	spotifyAuthMu.Lock()
	defer spotifyAuthMu.Unlock()

	record, err := loadSpotifyAuthRecord()
	if err != nil {
		return nil, err
	}

	if record.ClientID != "" && record.ClientID != clientID {
		record = &spotifyAuthRecord{}
	}

	if spotifyAuthRecordValid(record) {
		return record, nil
	}

	if record.RefreshToken != "" {
		token, refreshErr := refreshSpotifyToken(clientID, record.RefreshToken)
		if refreshErr == nil {
			record.AccessToken = token.AccessToken
			if token.RefreshToken != "" {
				record.RefreshToken = token.RefreshToken
			}
			record.Scope = token.Scope
			record.ExpiresAt = time.Now().Add(time.Duration(token.ExpiresIn) * time.Second).Format(time.RFC3339Nano)
			record.ClientID = clientID
			if err := saveSpotifyAuthRecord(record); err != nil {
				return nil, err
			}
			return record, nil
		}
		if !errors.Is(refreshErr, errSpotifyRefreshInvalid) {
			return nil, refreshErr
		}
		// Refresh token is dead — fall through to a full interactive re-login.
	}

	newRecord, err := runSpotifyAuthorization(clientID)
	if err != nil {
		return nil, err
	}
	if err := saveSpotifyAuthRecord(newRecord); err != nil {
		return nil, err
	}
	return newRecord, nil
}

func generateSpotifyPKCE() (verifier, challenge string, err error) {
	raw := make([]byte, 64)
	if _, err = rand.Read(raw); err != nil {
		return "", "", err
	}
	verifier = base64.RawURLEncoding.EncodeToString(raw)
	sum := sha256.Sum256([]byte(verifier))
	challenge = base64.RawURLEncoding.EncodeToString(sum[:])
	return verifier, challenge, nil
}

type spotifyAuthCallbackResult struct {
	code string
	err  error
}

func spotifyAuthSuccessPage() string {
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connected</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;background:#000;background-image:radial-gradient(circle,rgba(255,255,255,.2) 1.5px,transparent 1.5px);background-size:30px 30px;color:#f5f5f5;font:14px/1.5 Inter,sans-serif}main{text-align:center}.icon{width:48px;height:48px;margin:0 auto 20px;display:grid;place-items:center;border-radius:50%;background:#fff;color:#000;font-size:22px}h1{margin:0 0 6px;font-size:24px;letter-spacing:-.035em}p{margin:0;color:#888}</style></head><body><main><div class="icon">&#10003;</div><h1>Connected</h1><p>Returning to SpotiFLAC...</p></main><script>setTimeout(()=>window.close(),700)</script></body></html>`
}

func spotifyAuthDeniedPage(message string) string {
	return fmt.Sprintf(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not connected</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;background:#000;background-image:radial-gradient(circle,rgba(255,255,255,.2) 1.5px,transparent 1.5px);background-size:30px 30px;color:#f5f5f5;font:14px/1.5 Inter,sans-serif}main{text-align:center}.icon{width:48px;height:48px;margin:0 auto 20px;display:grid;place-items:center;border-radius:50%%;background:#fff;color:#000;font-size:22px}h1{margin:0 0 6px;font-size:24px;letter-spacing:-.035em}p{margin:0;color:#888}</style></head><body><main><div class="icon">&#10005;</div><h1>Not connected</h1><p>%s</p></main><script>setTimeout(()=>window.close(),1500)</script></body></html>`, message)
}

func runSpotifyAuthorization(clientID string) (*spotifyAuthRecord, error) {
	listener, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", spotifyOAuthRedirectPort))
	if err != nil {
		return nil, fmt.Errorf("local port %d is already in use by another app; close it and try again (this port must match the Redirect URI registered in your Spotify Developer Dashboard app)", spotifyOAuthRedirectPort)
	}
	defer listener.Close()

	state := communityRandomHex(16)
	verifier, challenge, err := generateSpotifyPKCE()
	if err != nil {
		return nil, err
	}

	resultCh := make(chan spotifyAuthCallbackResult, 1)
	server := &http.Server{ReadHeaderTimeout: 5 * time.Second}
	mux := http.NewServeMux()
	mux.HandleFunc(spotifyOAuthRedirectPath, func(w http.ResponseWriter, req *http.Request) {
		query := req.URL.Query()
		if !hmac.Equal([]byte(query.Get("state")), []byte(state)) {
			http.Error(w, "Invalid authorization callback state", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")

		if authErr := strings.TrimSpace(query.Get("error")); authErr != "" {
			_, _ = io.WriteString(w, spotifyAuthDeniedPage("Spotify authorization was denied or cancelled."))
			select {
			case resultCh <- spotifyAuthCallbackResult{err: fmt.Errorf("spotify authorization was denied or cancelled (%s)", authErr)}:
			default:
			}
			return
		}

		code := strings.TrimSpace(query.Get("code"))
		if code == "" {
			_, _ = io.WriteString(w, spotifyAuthDeniedPage("No authorization code was received."))
			select {
			case resultCh <- spotifyAuthCallbackResult{err: fmt.Errorf("no authorization code was received")}:
			default:
			}
			return
		}

		_, _ = io.WriteString(w, spotifyAuthSuccessPage())
		select {
		case resultCh <- spotifyAuthCallbackResult{code: code}:
		default:
		}

		spotifyBrowserMu.RLock()
		foreground := spotifyWindowForeground
		spotifyBrowserMu.RUnlock()
		if foreground != nil {
			foreground()
		}
	})
	server.Handler = mux
	go func() { _ = server.Serve(listener) }()
	defer func() {
		shutdownCtx, cancel := context.WithTimeout(context.Background(), time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	authorizeURL, err := url.Parse(spotifyOAuthAuthorizeURL)
	if err != nil {
		return nil, err
	}
	query := authorizeURL.Query()
	query.Set("client_id", clientID)
	query.Set("response_type", "code")
	query.Set("redirect_uri", SpotifyOAuthRedirectURI())
	query.Set("code_challenge_method", "S256")
	query.Set("code_challenge", challenge)
	query.Set("scope", spotifyOAuthScopes)
	query.Set("state", state)
	authorizeURL.RawQuery = query.Encode()

	spotifyBrowserMu.RLock()
	openBrowser := spotifyBrowserOpen
	spotifyBrowserMu.RUnlock()
	if openBrowser == nil {
		return nil, fmt.Errorf("browser integration is not ready")
	}
	openBrowser(authorizeURL.String())

	var result spotifyAuthCallbackResult
	select {
	case result = <-resultCh:
	case <-time.After(spotifyOAuthTimeout):
		return nil, fmt.Errorf("spotify authorization timed out")
	}
	if result.err != nil {
		return nil, result.err
	}

	token, err := exchangeSpotifyCode(clientID, result.code, verifier)
	if err != nil {
		return nil, err
	}

	record := &spotifyAuthRecord{
		ClientID:     clientID,
		AccessToken:  token.AccessToken,
		RefreshToken: token.RefreshToken,
		Scope:        token.Scope,
		ExpiresAt:    time.Now().Add(time.Duration(token.ExpiresIn) * time.Second).Format(time.RFC3339Nano),
	}

	if profile, err := fetchSpotifyProfileForAuth(record); err == nil && profile != nil {
		record.SpotifyUserID = profile.SpotifyUserID
		record.DisplayName = profile.DisplayName
		record.AvatarURL = profile.AvatarURL
	}

	return record, nil
}

type spotifyTokenResponse struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	Scope        string `json:"scope"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token,omitempty"`
}

type spotifyTokenErrorResponse struct {
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
}

func postSpotifyTokenRequest(form url.Values) (*spotifyTokenResponse, error) {
	req, err := http.NewRequest(http.MethodPost, spotifyOAuthTokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 32*1024))
	if err != nil {
		return nil, err
	}

	if resp.StatusCode != http.StatusOK {
		var apiErr spotifyTokenErrorResponse
		if jsonErr := json.Unmarshal(body, &apiErr); jsonErr == nil && apiErr.Error != "" {
			if apiErr.Error == "invalid_grant" {
				return nil, errSpotifyRefreshInvalid
			}
			if apiErr.ErrorDescription != "" {
				return nil, fmt.Errorf("spotify: %s", apiErr.ErrorDescription)
			}
			return nil, fmt.Errorf("spotify: %s", apiErr.Error)
		}
		return nil, fmt.Errorf("spotify token request failed with HTTP %d", resp.StatusCode)
	}

	var token spotifyTokenResponse
	if err := json.Unmarshal(body, &token); err != nil {
		return nil, err
	}
	return &token, nil
}

func exchangeSpotifyCode(clientID, code, verifier string) (*spotifyTokenResponse, error) {
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("code", code)
	form.Set("redirect_uri", SpotifyOAuthRedirectURI())
	form.Set("client_id", clientID)
	form.Set("code_verifier", verifier)
	return postSpotifyTokenRequest(form)
}

func refreshSpotifyToken(clientID, refreshToken string) (*spotifyTokenResponse, error) {
	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", refreshToken)
	form.Set("client_id", clientID)
	return postSpotifyTokenRequest(form)
}
