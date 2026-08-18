package backend

import (
	"bytes"
	"encoding/json"
	"sort"
)

const ConfigLayoutVersion = 7

var configSections = []struct {
	Page, Section string
	Keys          []string
}{
	{"settingsPage", "general", []string{"downloadPath", "language", "baseColor", "theme", "themeMode", "fontFamily", "operatingSystem", "sfxEnabled", "previewVolume", "showUpdateNotifications"}},
	{"settingsPage", "naming", []string{"folderPreset", "folderTemplate", "applyFolderToSingleTrack", "filenamePreset", "filenameTemplate", "albumFilenameTemplate", "useSeparateAlbumFilename", "trackNumber"}},
	{"settingsPage", "fileManagement", []string{"createPlaylistFolder", "playlistOwnerFolderName", "createM3u8File", "saveCover", "exportLogsFile", "exportLogsOnlyFailed", "autoConvertAudio", "autoConvertFormat", "autoConvertBitrate", "autoConvertDeleteOriginal", "autoResampleAudio", "autoResampleSampleRate", "autoResampleBitDepth", "autoResampleDeleteOriginal", "autoReplayGainTags", "autoReplayGainMode", "redownloadWithSuffix", "existingFileCheckMode", "metadataDateFormat", "metadataTags"}},
	{"settingsPage", "metadata", []string{"embedLyrics", "embedMaxQualityCover", "useFirstArtistOnly", "useSingleGenre", "embedGenre", "separator"}},
	{"workflowPage", "mode", []string{"downloader", "autoQuality", "allowFallback"}},
	{"workflowPage", "ordering", []string{"autoOrder"}},
	{"workflowPage", "linkResolvers", []string{"linkResolver", "allowResolverFallback"}},
	{"sourcePage", "sources", []string{"customTidalApi", "customQobuzApi", "spotifyClientID"}},
	{"sourcePage", "quality", []string{"tidalQuality", "qobuzQuality", "amazonQuality", "allowAtmosFallback", "atmosFallbackQuality"}},
}

var knownConfigKeys = func() map[string]struct{} {
	keys := make(map[string]struct{})
	for _, section := range configSections {
		for _, key := range section.Keys {
			keys[key] = struct{}{}
		}
	}
	return keys
}()

func HasKnownConfigSettings(config map[string]interface{}) bool {
	for key := range FlattenConfigSettings(config) {
		if _, known := knownConfigKeys[key]; known {
			return true
		}
	}
	return false
}

func FlattenConfigSettings(config map[string]interface{}) map[string]interface{} {
	flat := make(map[string]interface{})
	var visit func(map[string]interface{})
	visit = func(values map[string]interface{}) {
		keys := make([]string, 0, len(values))
		for key := range values {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			value := values[key]
			if key == "configVersion" {
				continue
			}
			if _, known := knownConfigKeys[key]; known {
				flat[key] = value
				continue
			}
			if nested, ok := value.(map[string]interface{}); ok {
				visit(nested)
				continue
			}
			flat[key] = value
		}
	}
	visit(config)

	for _, definition := range configSections {
		page, _ := config[definition.Page].(map[string]interface{})
		section, _ := page[definition.Section].(map[string]interface{})
		for _, key := range definition.Keys {
			if value, exists := section[key]; exists {
				flat[key] = value
			}
		}
	}
	return flat
}

func CategorizeConfigSettings(config map[string]interface{}) map[string]interface{} {
	flat := FlattenConfigSettings(config)
	grouped := map[string]interface{}{"configVersion": ConfigLayoutVersion}
	used := make(map[string]struct{})
	for _, definition := range configSections {
		page, _ := grouped[definition.Page].(map[string]interface{})
		if page == nil {
			page = make(map[string]interface{})
			grouped[definition.Page] = page
		}
		target := make(map[string]interface{})
		page[definition.Section] = target
		for _, key := range definition.Keys {
			if value, exists := flat[key]; exists {
				target[key] = value
				used[key] = struct{}{}
			}
		}
	}
	other := make(map[string]interface{})
	for key, value := range flat {
		if _, exists := used[key]; !exists {
			other[key] = value
		}
	}
	if len(other) > 0 {
		grouped["application"] = other
	}
	return grouped
}

type orderedConfigEntry struct {
	key   string
	value interface{}
}
type orderedConfigObject []orderedConfigEntry

func (object orderedConfigObject) MarshalJSON() ([]byte, error) {
	var buffer bytes.Buffer
	buffer.WriteByte('{')
	for index, entry := range object {
		if index > 0 {
			buffer.WriteByte(',')
		}
		key, err := json.Marshal(entry.key)
		if err != nil {
			return nil, err
		}
		value, err := json.Marshal(entry.value)
		if err != nil {
			return nil, err
		}
		buffer.Write(key)
		buffer.WriteByte(':')
		buffer.Write(value)
	}
	buffer.WriteByte('}')
	return buffer.Bytes(), nil
}

func configPathOrders() map[string][]string {
	orders := map[string][]string{"": {"configVersion", "settingsPage", "workflowPage", "sourcePage", "application"}}
	for _, definition := range configSections {
		orders[definition.Page] = append(orders[definition.Page], definition.Section)
		orders[definition.Page+"."+definition.Section] = append([]string(nil), definition.Keys...)
	}
	return orders
}

func makeOrderedConfigValue(value interface{}, path string, orders map[string][]string) interface{} {
	object, ok := value.(map[string]interface{})
	if !ok {
		return value
	}
	keys := make([]string, 0, len(object))
	for key := range object {
		keys = append(keys, key)
	}
	ranks := make(map[string]int)
	for index, key := range orders[path] {
		ranks[key] = index
	}
	sort.SliceStable(keys, func(i, j int) bool {
		left, leftKnown := ranks[keys[i]]
		right, rightKnown := ranks[keys[j]]
		if leftKnown != rightKnown {
			return leftKnown
		}
		if leftKnown {
			return left < right
		}
		return keys[i] < keys[j]
	})
	ordered := make(orderedConfigObject, 0, len(keys))
	for _, key := range keys {
		childPath := key
		if path != "" {
			childPath = path + "." + key
		}
		ordered = append(ordered, orderedConfigEntry{key, makeOrderedConfigValue(object[key], childPath, orders)})
	}
	return ordered
}

func MarshalConfigSettings(config map[string]interface{}) ([]byte, error) {
	return json.MarshalIndent(makeOrderedConfigValue(CategorizeConfigSettings(config), "", configPathOrders()), "", "  ")
}
