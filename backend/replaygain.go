package backend

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"go.senan.xyz/taglib"
	"golang.org/x/text/unicode/norm"
)

const replayGainReferenceLUFS = -18.0

var replayGainSamplePeakPattern = regexp.MustCompile(`(?m)Peak level dB:\s+(-?(?:\d+(?:\.\d*)?|\.\d+)|-inf)`)

type ReplayGainAnalysisResult struct {
	FilePath           string  `json:"file_path"`
	FileName           string  `json:"file_name"`
	Duration           float64 `json:"duration"`
	IntegratedLoudness float64 `json:"integrated_loudness"`
	TruePeak           float64 `json:"true_peak"`
	SamplePeak         float64 `json:"sample_peak"`
	LoudnessRange      float64 `json:"loudness_range"`
	Threshold          float64 `json:"threshold"`
	Success            bool    `json:"success"`
	Error              string  `json:"error,omitempty"`
}

type ReplayGainTagWrite struct {
	FilePath    string   `json:"file_path"`
	TrackGainDB float64  `json:"track_gain_db"`
	TrackPeak   float64  `json:"track_peak"`
	AlbumGainDB *float64 `json:"album_gain_db,omitempty"`
	AlbumPeak   *float64 `json:"album_peak,omitempty"`
}

type ReplayGainWriteResult struct {
	FilePath string `json:"file_path"`
	Success  bool   `json:"success"`
	Error    string `json:"error,omitempty"`
}

type replayGainLoudnormOutput struct {
	InputIntegrated string `json:"input_i"`
	InputTruePeak   string `json:"input_tp"`
	InputLRA        string `json:"input_lra"`
	InputThreshold  string `json:"input_thresh"`
}

func parseReplayGainLoudnormOutput(output string) (replayGainLoudnormOutput, error) {
	var parsed replayGainLoudnormOutput
	start := strings.LastIndex(output, "{")
	end := strings.LastIndex(output, "}")
	if start < 0 || end <= start {
		return parsed, fmt.Errorf("loudness statistics were not found in FFmpeg output")
	}
	if err := json.Unmarshal([]byte(output[start:end+1]), &parsed); err != nil {
		return parsed, fmt.Errorf("invalid loudness statistics: %w", err)
	}
	return parsed, nil
}

func parseReplayGainFloat(label, value string) (float64, error) {
	parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
	if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) {
		return 0, fmt.Errorf("invalid %s value: %s", label, value)
	}
	return parsed, nil
}

func parseReplayGainSamplePeak(output string) (float64, error) {
	matches := replayGainSamplePeakPattern.FindAllStringSubmatch(output, -1)
	if len(matches) == 0 {
		return 0, fmt.Errorf("sample peak was not found in FFmpeg output")
	}
	value := strings.TrimSpace(matches[len(matches)-1][1])
	if strings.EqualFold(value, "-inf") {
		return 0, nil
	}
	peakDB, err := parseReplayGainFloat("sample peak", value)
	if err != nil {
		return 0, err
	}
	return replayGainLinearPeak(peakDB), nil
}

func replayGainLinearPeak(peakDB float64) float64 {
	return math.Pow(10, peakDB/20)
}

func replayGainMeasurementFilter(input string) string {
	return fmt.Sprintf("%sasplit=2[rg][sample];[rg]loudnorm=I=-18:TP=-1:LRA=11:dual_mono=true:print_format=json[rgout];[sample]astats=metadata=0:reset=0:measure_perchannel=none:measure_overall=Peak_level[sampleout]", input)
}

func replayGainMeasurementOutputArgs() []string {
	return []string{"-map", "[rgout]", "-map", "[sampleout]", "-f", "null", "-"}
}

func parseReplayGainAnalysisOutput(result ReplayGainAnalysisResult, output string) ReplayGainAnalysisResult {
	statistics, err := parseReplayGainLoudnormOutput(output)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.IntegratedLoudness, err = parseReplayGainFloat("integrated loudness", statistics.InputIntegrated)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.TruePeak, err = parseReplayGainFloat("true peak", statistics.InputTruePeak)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.SamplePeak, err = parseReplayGainSamplePeak(output)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.LoudnessRange, err = parseReplayGainFloat("loudness range", statistics.InputLRA)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.Threshold, err = parseReplayGainFloat("threshold", statistics.InputThreshold)
	if err != nil {
		result.Error = err.Error()
		return result
	}
	result.Success = true
	return result
}

func replayGainCommandError(result ReplayGainAnalysisResult, ctx context.Context, output []byte, commandErr error) ReplayGainAnalysisResult {
	if ctx.Err() != nil {
		result.Error = ctx.Err().Error()
		return result
	}
	detail := strings.TrimSpace(string(output))
	if len(detail) > 800 {
		detail = detail[len(detail)-800:]
	}
	if detail == "" {
		detail = commandErr.Error()
	}
	result.Error = detail
	return result
}

func validateReplayGainFile(filePath string) (string, os.FileInfo, error) {
	filePath = norm.NFC.String(strings.TrimSpace(filePath))
	if filePath == "" {
		return "", nil, fmt.Errorf("file path is required")
	}
	info, err := os.Stat(filePath)
	if err != nil {
		return filePath, nil, fmt.Errorf("file cannot be read: %w", err)
	}
	if info.IsDir() || info.Size() == 0 {
		return filePath, nil, fmt.Errorf("file is empty or is not an audio file")
	}
	return filePath, info, nil
}

func replayGainFFmpegPath() (string, error) {
	ffmpegPath, err := GetFFmpegPath()
	if err != nil {
		return "", err
	}
	if err := ValidateExecutable(ffmpegPath); err != nil {
		return "", fmt.Errorf("invalid ffmpeg executable: %w", err)
	}
	return ffmpegPath, nil
}

func AnalyzeReplayGainFileContext(ctx context.Context, filePath string) ReplayGainAnalysisResult {
	if ctx == nil {
		ctx = context.Background()
	}
	filePath, _, err := validateReplayGainFile(filePath)
	result := ReplayGainAnalysisResult{FilePath: filePath, FileName: filepath.Base(filePath)}
	if err != nil {
		result.Error = err.Error()
		return result
	}

	ffmpegPath, err := replayGainFFmpegPath()
	if err != nil {
		result.Error = err.Error()
		return result
	}

	analysisCtx, cancel := context.WithTimeout(ctx, 30*time.Minute)
	defer cancel()
	args := []string{
		"-hide_banner", "-nostats", "-i", filePath,
		"-filter_complex", replayGainMeasurementFilter("[0:a:0]"),
	}
	args = append(args, replayGainMeasurementOutputArgs()...)
	cmd := exec.CommandContext(analysisCtx, ffmpegPath, args...)
	setHideWindow(cmd)
	output, commandErr := cmd.CombinedOutput()
	if commandErr != nil {
		return replayGainCommandError(result, analysisCtx, output, commandErr)
	}

	result = parseReplayGainAnalysisOutput(result, string(output))
	if duration, durationErr := getDurationWithFFprobe(filePath); durationErr == nil {
		result.Duration = duration
	}
	return result
}

func replayGainChannelLayout(channels uint) string {
	switch channels {
	case 1, 2:

		return "stereo"
	case 3:
		return "3.0"
	case 4:
		return "quad"
	case 5:
		return "5.0"
	case 6:
		return "5.1"
	case 8:
		return "7.1"
	default:
		return "stereo"
	}
}

func buildReplayGainAlbumFilter(channels []uint) string {
	maxChannels := uint(2)
	for _, count := range channels {
		if count > maxChannels {
			maxChannels = count
		}
	}
	layout := replayGainChannelLayout(maxChannels)
	parts := make([]string, 0, len(channels)+2)
	concatInputs := strings.Builder{}
	for index := range channels {
		label := fmt.Sprintf("album%d", index)
		parts = append(parts, fmt.Sprintf("[%d:a:0]aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=%s[%s]", index, layout, label))
		concatInputs.WriteString("[")
		concatInputs.WriteString(label)
		concatInputs.WriteString("]")
	}
	parts = append(parts, fmt.Sprintf("%sconcat=n=%d:v=0:a=1[album]", concatInputs.String(), len(channels)))
	parts = append(parts, replayGainMeasurementFilter("[album]"))
	return strings.Join(parts, ";")
}

func AnalyzeReplayGainAlbumContext(ctx context.Context, filePaths []string) ReplayGainAnalysisResult {
	result := ReplayGainAnalysisResult{FileName: "Album"}
	if ctx == nil {
		ctx = context.Background()
	}
	if len(filePaths) < 2 {
		result.Error = "album analysis requires at least two files"
		return result
	}

	normalizedPaths := make([]string, 0, len(filePaths))
	channels := make([]uint, 0, len(filePaths))
	for _, candidate := range filePaths {
		filePath, _, err := validateReplayGainFile(candidate)
		if err != nil {
			result.Error = err.Error()
			return result
		}
		properties, err := taglib.ReadProperties(filePath)
		if err != nil || properties.Channels == 0 {
			result.Error = fmt.Sprintf("failed to read audio properties for %s", filepath.Base(filePath))
			return result
		}
		normalizedPaths = append(normalizedPaths, filePath)
		channels = append(channels, properties.Channels)
		result.Duration += properties.Length.Seconds()
	}

	ffmpegPath, err := replayGainFFmpegPath()
	if err != nil {
		result.Error = err.Error()
		return result
	}

	args := []string{"-hide_banner", "-nostats"}
	for _, filePath := range normalizedPaths {
		args = append(args, "-i", filePath)
	}
	args = append(args, "-filter_complex", buildReplayGainAlbumFilter(channels))
	args = append(args, replayGainMeasurementOutputArgs()...)

	analysisCtx, cancel := context.WithTimeout(ctx, 2*time.Hour)
	defer cancel()
	cmd := exec.CommandContext(analysisCtx, ffmpegPath, args...)
	setHideWindow(cmd)
	output, commandErr := cmd.CombinedOutput()
	if commandErr != nil {
		return replayGainCommandError(result, analysisCtx, output, commandErr)
	}
	return parseReplayGainAnalysisOutput(result, string(output))
}

func removeReplayGainTag(tags map[string][]string, keys ...string) {
	for existingKey := range tags {
		for _, key := range keys {
			if strings.EqualFold(strings.TrimSpace(existingKey), key) {
				delete(tags, existingKey)
				break
			}
		}
	}
}

func replaceReplayGainTag(tags map[string][]string, key, value string) {
	removeReplayGainTag(tags, key)
	tags[key] = []string{value}
}

func finiteReplayGainValue(label string, value float64) error {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return fmt.Errorf("%s must be a finite number", label)
	}
	return nil
}

func formatReplayGainDB(value float64) string {
	return fmt.Sprintf("%.2f dB", value)
}

func buildITunNORMTag(gainDB, peakLinear float64) string {
	if peakLinear <= 0 || math.IsNaN(peakLinear) || math.IsInf(peakLinear, 0) {
		return ""
	}
	clamp := func(value int64) int64 {
		if value < 0 {
			return 0
		}
		if value > 65534 {
			return 65534
		}
		return value
	}
	gainA := clamp(int64(math.Round(math.Pow(10, gainDB/-10.0) * 1000.0)))
	gainB := clamp(int64(math.Round(math.Pow(10, gainDB/-10.0) * 2500.0)))
	peak := clamp(int64(math.Round(peakLinear * 32768.0)))
	values := []int64{gainA, gainA, gainB, gainB, 0, 0, peak, peak, 0, 0}
	parts := make([]string, 0, len(values))
	for _, value := range values {
		parts = append(parts, strings.ToUpper(fmt.Sprintf("%08x", value)))
	}
	return strings.Join(parts, " ")
}

func replayGainDBToR128Q78(gainDB float64, outputGainQ78 int16) (int16, error) {
	value := int(math.Round((gainDB - 5.0) * 256.0))
	value -= int(outputGainQ78)
	if value < math.MinInt16 || value > math.MaxInt16 {
		return 0, fmt.Errorf("R128 gain is outside the signed 16-bit range")
	}
	return int16(value), nil
}

func readOpusOutputGainQ78(filePath string) (int16, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return 0, err
	}
	defer file.Close()
	buffer := make([]byte, 64*1024)
	count, err := file.Read(buffer)
	if err != nil && count == 0 {
		return 0, err
	}
	buffer = buffer[:count]
	index := strings.Index(string(buffer), "OpusHead")
	if index < 0 || index+18 > len(buffer) {
		return 0, fmt.Errorf("OpusHead output gain was not found")
	}
	return int16(binary.LittleEndian.Uint16(buffer[index+16 : index+18])), nil
}

func validateReplayGainTagWrite(entry ReplayGainTagWrite) error {
	if err := finiteReplayGainValue("track gain", entry.TrackGainDB); err != nil {
		return err
	}
	if err := finiteReplayGainValue("track peak", entry.TrackPeak); err != nil {
		return err
	}
	if entry.TrackPeak < 0 {
		return fmt.Errorf("track peak must not be negative")
	}
	if (entry.AlbumGainDB == nil) != (entry.AlbumPeak == nil) {
		return fmt.Errorf("album gain and album peak must be provided together")
	}
	if entry.AlbumGainDB != nil {
		if err := finiteReplayGainValue("album gain", *entry.AlbumGainDB); err != nil {
			return err
		}
		if err := finiteReplayGainValue("album peak", *entry.AlbumPeak); err != nil {
			return err
		}
		if *entry.AlbumPeak < 0 {
			return fmt.Errorf("album peak must not be negative")
		}
	}
	return nil
}

func applyReplayGainTags(entry ReplayGainTagWrite) error {
	filePath, _, err := validateReplayGainFile(entry.FilePath)
	if err != nil {
		return err
	}
	if err := validateReplayGainTagWrite(entry); err != nil {
		return err
	}

	tags, err := taglib.ReadTags(filePath)
	if err != nil {
		return fmt.Errorf("failed to read tags: %w", err)
	}

	removeReplayGainTag(tags, "REPLAYGAIN_REFERENCE_LOUDNESS")
	if strings.EqualFold(filepath.Ext(filePath), ".opus") {
		outputGain, err := readOpusOutputGainQ78(filePath)
		if err != nil {
			return fmt.Errorf("failed to read Opus output gain: %w", err)
		}
		trackGain, err := replayGainDBToR128Q78(entry.TrackGainDB, outputGain)
		if err != nil {
			return err
		}
		removeReplayGainTag(tags,
			"REPLAYGAIN_TRACK_GAIN", "REPLAYGAIN_TRACK_PEAK",
			"REPLAYGAIN_ALBUM_GAIN", "REPLAYGAIN_ALBUM_PEAK",
			"R128_TRACK_GAIN",
		)
		replaceReplayGainTag(tags, "R128_TRACK_GAIN", strconv.Itoa(int(trackGain)))
		if entry.AlbumGainDB != nil {
			albumGain, err := replayGainDBToR128Q78(*entry.AlbumGainDB, outputGain)
			if err != nil {
				return err
			}
			replaceReplayGainTag(tags, "R128_ALBUM_GAIN", strconv.Itoa(int(albumGain)))
		}
	} else {
		removeReplayGainTag(tags, "R128_TRACK_GAIN", "R128_ALBUM_GAIN")
		replaceReplayGainTag(tags, "REPLAYGAIN_TRACK_GAIN", formatReplayGainDB(entry.TrackGainDB))
		replaceReplayGainTag(tags, "REPLAYGAIN_TRACK_PEAK", fmt.Sprintf("%.6f", entry.TrackPeak))
		if entry.AlbumGainDB != nil {
			replaceReplayGainTag(tags, "REPLAYGAIN_ALBUM_GAIN", formatReplayGainDB(*entry.AlbumGainDB))
			replaceReplayGainTag(tags, "REPLAYGAIN_ALBUM_PEAK", fmt.Sprintf("%.6f", *entry.AlbumPeak))
		}
		extension := strings.ToLower(filepath.Ext(filePath))
		if extension == ".m4a" || extension == ".mp4" || extension == ".m4b" {
			if soundCheck := buildITunNORMTag(entry.TrackGainDB, entry.TrackPeak); soundCheck != "" {
				replaceReplayGainTag(tags, "ITUNNORM", soundCheck)
			}
		}
	}

	if err := taglib.WriteTags(filePath, tags, taglib.Clear); err != nil {
		return fmt.Errorf("failed to write ReplayGain tags: %w", err)
	}
	return nil
}

func WriteReplayGainTags(entries []ReplayGainTagWrite) []ReplayGainWriteResult {
	results := make([]ReplayGainWriteResult, 0, len(entries))
	for _, entry := range entries {
		result := ReplayGainWriteResult{FilePath: entry.FilePath}
		if err := applyReplayGainTags(entry); err != nil {
			result.Error = err.Error()
		} else {
			result.Success = true
		}
		results = append(results, result)
	}
	return results
}
