package backend

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

const (
	chatGPTBaseURL              = "https://android.chat.openai.com/backend-anon"
	chatGPTUserAgent            = "ChatGPT/1.2027.000 (Android 15; RMX3834; build 2700000)"
	chatGPTPackage              = "com.openai.chatgpt"
	chatGPTHandshakeMaxResponse = 128 * 1024
	chatGPTMaxResponse          = 6 * 1024 * 1024
	chatGPTMaxOutputChars       = 64_000

	geminiLyricsURL           = "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate"
	geminiLyricsBuild         = "boq_assistant-bard-web-server_20260807.01_p1"
	geminiLyricsModel         = "gemini-3.6-flash"
	geminiLyricsWebModelID    = "fbb127bbb056c959"
	geminiLyricsResponseLabel = "3.6 Flash"
	geminiMaxResponse         = 4 * 1024 * 1024
	geminiMaxOutputChars      = 64_000

	lyricsTranslationAttemptTimeout = 75 * time.Second
)

const chatGPTSentinelPayload = `{"bot_token":{"failure_reason":"-2: Standard Integrity API error (-2): The Play Store app is either not installed or not the official version.","failure_detail":"[qdb0.j(SourceFile:9), g4n.a(SourceFile:85)]"}}`

type chatGPTGuestSession struct {
	cookie   string
	deviceID string
}

type chatGPTParseState struct {
	output        string
	outputChars   int
	lastPath      string
	lastOperation string
	reportedModel string
}

type chatGPTResult struct {
	text          string
	reportedModel string
}

func newLyricsTranslationClient() *http.Client {
	return &http.Client{
		Timeout: 50 * time.Second,
		CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
}

func readLyricsResponseBounded(reader io.Reader, maximum int, provider string) ([]byte, error) {
	raw, err := io.ReadAll(io.LimitReader(reader, int64(maximum)+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > maximum {
		return nil, fmt.Errorf("%s response is too large", provider)
	}
	return raw, nil
}

func setChatGPTCommonHeaders(req *http.Request, deviceID, targetPath string) {
	req.Header.Set("User-Agent", chatGPTUserAgent)
	req.Header.Set("OAI-Package-Name", chatGPTPackage)
	req.Header.Set("OAI-Client-Type", "android")
	req.Header.Set("OAI-Device-Id", deviceID)
	req.Header.Set("Accept-Language", "id-ID,id;q=0.9,en;q=0.8")
	req.Header.Set("X-Device-Tier", "upper_mid")
	req.Header.Set("X-OpenAI-Target-Path", targetPath)
	req.Header.Set("ChatGPT-Account-Id", "default")
	req.Header.Set("ChatGPT-Residency-Region", "no_constraint")
	req.Header.Set("Content-Type", "application/json")
}

func createChatGPTGuestSession(ctx context.Context, client *http.Client) (chatGPTGuestSession, error) {
	deviceID := uuid.NewString()
	requestCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(
		requestCtx,
		http.MethodPost,
		chatGPTBaseURL+"/sentinel/chat-requirements",
		strings.NewReader("{}"),
	)
	if err != nil {
		return chatGPTGuestSession{}, err
	}
	setChatGPTCommonHeaders(req, deviceID, "/backend-anon/sentinel/chat-requirements")
	req.Header.Set("Accept", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return chatGPTGuestSession{}, err
	}
	defer resp.Body.Close()
	raw, err := readLyricsResponseBounded(resp.Body, chatGPTHandshakeMaxResponse, "ChatGPT handshake")
	if err != nil {
		return chatGPTGuestSession{}, err
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return chatGPTGuestSession{}, fmt.Errorf("ChatGPT handshake returned HTTP %d", resp.StatusCode)
	}

	cookies := make([]string, 0, len(resp.Cookies())+1)
	hasSessionCookie := false
	for _, cookie := range resp.Cookies() {
		if strings.TrimSpace(cookie.Name) == "" {
			continue
		}
		pair := cookie.Name + "=" + cookie.Value
		cookies = append(cookies, pair)
		if cookie.Name == "oai-sc" {
			hasSessionCookie = true
		}
	}
	if !hasSessionCookie {
		var payload map[string]any
		if json.Unmarshal(raw, &payload) == nil {
			if token, ok := payload["token"].(string); ok && token != "" {
				cookies = append([]string{"oai-sc=0" + token}, cookies...)
			}
		}
	}
	if len(cookies) == 0 {
		return chatGPTGuestSession{}, fmt.Errorf("ChatGPT did not provide a guest session")
	}
	return chatGPTGuestSession{cookie: strings.Join(cookies, "; "), deviceID: deviceID}, nil
}

func appendChatGPTOutput(state *chatGPTParseState, value string) error {
	valueChars := utf8.RuneCountInString(value)
	if state.outputChars+valueChars > chatGPTMaxOutputChars {
		return fmt.Errorf("ChatGPT output is too long")
	}
	state.output += value
	state.outputChars += valueChars
	return nil
}

func replaceChatGPTOutput(state *chatGPTParseState, value string) error {
	valueChars := utf8.RuneCountInString(value)
	if valueChars > chatGPTMaxOutputChars {
		return fmt.Errorf("ChatGPT output is too long")
	}
	state.output = value
	state.outputChars = valueChars
	return nil
}

func chatGPTRecord(value any) (map[string]any, bool) {
	record, ok := value.(map[string]any)
	return record, ok
}

func chatGPTString(record map[string]any, key string) string {
	value, _ := record[key].(string)
	return value
}

func processChatGPTPatch(value any, state *chatGPTParseState) error {
	patch, ok := chatGPTRecord(value)
	if !ok {
		return nil
	}
	operation := chatGPTString(patch, "o")
	path := chatGPTString(patch, "p")
	text, textOK := patch["v"].(string)
	if operation == "append" && strings.HasPrefix(path, "/message/content/parts/") && textOK {
		return appendChatGPTOutput(state, text)
	}
	return nil
}

func processChatGPTEvent(event map[string]any, state *chatGPTParseState) error {
	if path := chatGPTString(event, "p"); path != "" {
		state.lastPath = path
	}
	if operation := chatGPTString(event, "o"); operation != "" {
		state.lastOperation = operation
	}
	if chatGPTString(event, "type") == "server_ste_metadata" {
		if metadata, ok := chatGPTRecord(event["metadata"]); ok {
			if model := chatGPTString(metadata, "model_slug"); model != "" {
				state.reportedModel = model
			}
		}
	}

	operation := chatGPTString(event, "o")
	if operation == "" {
		operation = state.lastOperation
	}
	path := chatGPTString(event, "p")
	if path == "" {
		path = state.lastPath
	}
	value := event["v"]

	if operation == "add" {
		added, ok := chatGPTRecord(value)
		if !ok {
			return nil
		}
		message, ok := chatGPTRecord(added["message"])
		if !ok {
			return nil
		}
		author, authorOK := chatGPTRecord(message["author"])
		content, contentOK := chatGPTRecord(message["content"])
		parts, partsOK := content["parts"].([]any)
		if authorOK && contentOK && partsOK && chatGPTString(author, "role") == "assistant" && len(parts) > 0 {
			if initial, ok := parts[0].(string); ok {
				return replaceChatGPTOutput(state, initial)
			}
		}
		return nil
	}

	if operation == "patch" {
		patches, ok := value.([]any)
		if !ok {
			return nil
		}
		for _, patch := range patches {
			if err := processChatGPTPatch(patch, state); err != nil {
				return err
			}
		}
		return nil
	}

	if operation == "append" && strings.HasPrefix(path, "/message/content/parts/") {
		if text, ok := value.(string); ok {
			return appendChatGPTOutput(state, text)
		}
	}
	return nil
}

func cleanChatGPTEntities(text string) string {
	const (
		startMarker = "\ue200"
		endMarker   = "\ue201"
		separator   = "\ue202"
	)
	var result strings.Builder
	for cursor := 0; cursor < len(text); {
		relativeStart := strings.Index(text[cursor:], startMarker)
		if relativeStart < 0 {
			result.WriteString(text[cursor:])
			break
		}
		start := cursor + relativeStart
		result.WriteString(text[cursor:start])
		contentStart := start + len(startMarker)
		relativeEnd := strings.Index(text[contentStart:], endMarker)
		if relativeEnd < 0 {
			cursor = contentStart
			continue
		}
		end := contentStart + relativeEnd
		content := text[contentStart:end]
		if strings.HasPrefix(content, "entity"+separator) {
			_, encoded, _ := strings.Cut(content, separator)
			var decoded []any
			if json.Unmarshal([]byte(encoded), &decoded) == nil && len(decoded) > 0 {
				labelIndex := 0
				if len(decoded) > 1 {
					labelIndex = 1
				}
				if label, ok := decoded[labelIndex].(string); ok {
					result.WriteString(label)
				}
			}
		}
		cursor = end + len(endMarker)
	}
	return strings.TrimSpace(result.String())
}

func parseChatGPTSSE(raw string) (chatGPTResult, error) {
	state := chatGPTParseState{}
	for _, line := range strings.Split(raw, "\n") {
		trimmed := strings.TrimSpace(line)
		if !strings.HasPrefix(trimmed, "data:") {
			continue
		}
		data := strings.TrimLeft(strings.TrimPrefix(trimmed, "data:"), " \t")
		if data == "[DONE]" {
			continue
		}
		var event map[string]any
		if json.Unmarshal([]byte(data), &event) != nil {
			continue
		}
		if err := processChatGPTEvent(event, &state); err != nil {
			return chatGPTResult{}, err
		}
	}

	text := cleanChatGPTEntities(state.output)
	if text == "" {
		return chatGPTResult{}, fmt.Errorf("ChatGPT did not return text")
	}
	return chatGPTResult{text: text, reportedModel: state.reportedModel}, nil
}

func callChatGPTLyrics(ctx context.Context, client *http.Client, prompt string) (string, error) {
	session, err := createChatGPTGuestSession(ctx, client)
	if err != nil {
		return "", err
	}
	body, err := json.Marshal(map[string]any{
		"action": "next",
		"messages": []any{
			map[string]any{
				"id":        uuid.NewString(),
				"author":    map[string]any{"role": "user"},
				"content":   map[string]any{"content_type": "text", "parts": []string{prompt}},
				"status":    "finished_successfully",
				"recipient": "all",
			},
		},
		"parent_message_id":             uuid.NewString(),
		"model":                         "auto",
		"history_and_training_disabled": true,
		"fork_from_shared_post":         false,
		"enable_message_followups":      false,
		"force_use_sse":                 true,
		"force_use_search":              false,
		"force_paragen":                 false,
		"supported_encodings":           []string{"v1"},
		"supports_buffering":            true,
		"timezone":                      "Asia/Jakarta",
		"timezone_offset_min":           -420,
		"system_hints":                  []any{},
		"is_onboarding_conversation":    false,
		"no_auth_ad_preferences": map[string]any{
			"personalization_enabled": false,
			"history_enabled":         false,
		},
		"client_prepare_state": "none",
		"stream":               true,
	})
	if err != nil {
		return "", err
	}

	requestCtx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(
		requestCtx,
		http.MethodPost,
		chatGPTBaseURL+"/f/conversation",
		bytes.NewReader(body),
	)
	if err != nil {
		return "", err
	}
	setChatGPTCommonHeaders(req, session.deviceID, "/backend-anon/f/conversation")
	req.Header.Set("Accept", "text/event-stream")
	req.Header.Set("Cookie", session.cookie)
	req.Header.Set("X-Sentinel-Payload", chatGPTSentinelPayload)

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, err := readLyricsResponseBounded(resp.Body, chatGPTMaxResponse, "ChatGPT")
	if err != nil {
		return "", err
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return "", fmt.Errorf("ChatGPT conversation returned HTTP %d", resp.StatusCode)
	}
	result, err := parseChatGPTSSE(string(raw))
	if err != nil {
		return "", err
	}
	return result.text, nil
}

func secureGeminiRequestNumber() string {
	id := uuid.New()
	value := binary.BigEndian.Uint32(id[:4])
	return strconv.FormatUint(100_000+uint64(value%900_000), 10)
}

func createGeminiLyricsRequest(prompt, requestID string) []any {
	request := make([]any, 97)
	request[0] = []any{prompt, 0, nil, []any{}, nil, nil, 0}
	request[1] = []any{"en"}
	request[2] = []any{"", "", "", nil, nil, nil, nil, nil, nil, ""}
	request[6] = []any{1}
	request[7] = 1
	request[10] = 1
	request[11] = 0
	request[17] = []any{[]any{0}}
	request[18] = 0
	request[27] = 1
	request[30] = []any{4}
	request[41] = []any{1}
	request[53] = 0
	request[59] = requestID
	request[61] = []any{}
	request[68] = 2
	request[79] = 1
	request[80] = 1
	request[91] = 0
	request[96] = 1
	return request
}

var geminiErrorPattern = regexp.MustCompile(`BardErrorInfo\s*\[(\d+)]`)

func extractGeminiText(raw string) (string, error) {
	if match := geminiErrorPattern.FindStringSubmatch(raw); len(match) > 1 {
		return "", fmt.Errorf("Gemini rejected the request with code %s", match[1])
	}

	longest := ""
	longestChars := 0
	oversized := false
	for _, line := range strings.Split(raw, "\n") {
		if !strings.Contains(line, `"wrb.fr"`) || len(line) < 200 {
			continue
		}
		var envelope []any
		if json.Unmarshal([]byte(line), &envelope) != nil || len(envelope) == 0 {
			continue
		}
		first, ok := envelope[0].([]any)
		if !ok || len(first) < 3 {
			continue
		}
		encoded, ok := first[2].(string)
		if !ok {
			continue
		}
		var payload []any
		if json.Unmarshal([]byte(encoded), &payload) != nil || len(payload) < 5 {
			continue
		}
		parts, ok := payload[4].([]any)
		if !ok {
			continue
		}
		for _, rawPart := range parts {
			part, ok := rawPart.([]any)
			if !ok || len(part) < 2 {
				continue
			}
			candidates, ok := part[1].([]any)
			if !ok {
				continue
			}
			for _, candidate := range candidates {
				text, ok := candidate.(string)
				if !ok {
					continue
				}
				candidateChars := utf8.RuneCountInString(text)
				if candidateChars <= longestChars {
					continue
				}
				if candidateChars > geminiMaxOutputChars {
					oversized = true
					continue
				}
				longest = text
				longestChars = candidateChars
			}
		}
	}
	if oversized {
		return "", fmt.Errorf("Gemini output is too long")
	}
	if strings.TrimSpace(longest) == "" {
		return "", fmt.Errorf("Gemini did not return text")
	}
	return strings.TrimSpace(longest), nil
}

func verifyGeminiModel(raw string) error {
	reportedModel := ""
	switch {
	case strings.Contains(raw, geminiLyricsResponseLabel):
		reportedModel = geminiLyricsModel
	case strings.Contains(raw, "3.5 Flash-Lite"):
		reportedModel = "gemini-3.5-flash-lite"
	}
	if reportedModel != "" && reportedModel != geminiLyricsModel {
		return fmt.Errorf("Gemini switched %s to %s", geminiLyricsModel, reportedModel)
	}
	return nil
}

func callGeminiLyrics(ctx context.Context, client *http.Client, lines map[string]string, language string) (string, error) {
	requestID := strings.ToUpper(uuid.NewString())
	inner, err := json.Marshal(createGeminiLyricsRequest(buildGeminiLyricsPrompt(lines, language), requestID))
	if err != nil {
		return "", err
	}
	fRequest, err := json.Marshal([]any{nil, string(inner)})
	if err != nil {
		return "", err
	}
	body := url.Values{"f.req": []string{string(fRequest)}}.Encode()
	params := url.Values{
		"bl":     []string{geminiLyricsBuild},
		"hl":     []string{"en"},
		"_reqid": []string{secureGeminiRequestNumber()},
		"rt":     []string{"c"},
	}
	modelHeader, err := json.Marshal([]any{
		1, nil, nil, nil, geminiLyricsWebModelID, nil, nil, 0, []any{4}, nil, nil, 1,
	})
	if err != nil {
		return "", err
	}
	requestHeader, err := json.Marshal([]any{requestID, 1})
	if err != nil {
		return "", err
	}

	requestCtx, cancel := context.WithTimeout(ctx, 40*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(
		requestCtx,
		http.MethodPost,
		geminiLyricsURL+"?"+params.Encode(),
		strings.NewReader(body),
	)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "*/*")
	req.Header.Set("Origin", "https://gemini.google.com")
	req.Header.Set("Referer", "https://gemini.google.com/app")
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36")
	req.Header.Set("X-Same-Domain", "1")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8")
	req.Header.Set("x-goog-ext-525001261-jspb", string(modelHeader))
	req.Header.Set("x-goog-ext-73010989-jspb", "[0]")
	req.Header.Set("x-goog-ext-73010990-jspb", "[0]")
	req.Header.Set("x-goog-ext-525005358-jspb", string(requestHeader))

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	raw, err := readLyricsResponseBounded(resp.Body, geminiMaxResponse, "Gemini")
	if err != nil {
		return "", err
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return "", fmt.Errorf("Gemini generation returned HTTP %d", resp.StatusCode)
	}
	text := string(raw)
	if err := verifyGeminiModel(text); err != nil {
		return "", err
	}
	return extractGeminiText(text)
}
